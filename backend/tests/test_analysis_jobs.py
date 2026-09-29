import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.models.schemas import AnalysisRequest, MoveAnalysis
from app.services.analysis_jobs import AnalysisJobStore, QueueFullError
from app.worker import process_one_job


def request():
    return AnalysisRequest(moves=[("B", "D4")], board_size=9, max_visits=100)


def result(move_number):
    return MoveAnalysis(move_number=move_number, current_player="B", win_rate=0.5,
                        score_lead=0, top_moves=[], ownership=[])


class FakeEngine:
    async def analyze_game(self, **kwargs):
        assert kwargs["moves"] == [["B", "D4"]]
        yield result(0)
        yield result(1)


class JobStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "jobs.sqlite3"
        self.store = AnalysisJobStore(self.path, max_active=1)

    def test_two_processes_claim_a_job_only_once(self):
        second = AnalysisJobStore(self.path)
        job_id = self.store.enqueue(request())
        self.assertEqual(second.claim("worker-a")[0], job_id)
        self.assertIsNone(self.store.claim("worker-b"))
        self.assertEqual(self.store.get_job(job_id)["state"], "running")

    def test_capacity_and_cancellation(self):
        first = self.store.enqueue(request())
        with self.assertRaises(QueueFullError):
            self.store.enqueue(request())
        self.assertTrue(self.store.cancel(first))
        self.assertFalse(self.store.cancel(first))
        self.assertIsNotNone(self.store.enqueue(request()))

    def test_worker_heartbeat_is_visible_across_store_instances(self):
        second = AnalysisJobStore(self.path)
        self.assertFalse(second.worker_alive())
        self.store.heartbeat("worker-a")
        self.assertTrue(second.worker_alive("worker-a"))
        self.assertFalse(second.worker_alive("worker-b"))
        self.store.unregister_worker("worker-a")
        self.assertFalse(second.worker_alive())

    def test_stale_running_job_releases_capacity_with_error(self):
        with patch("app.services.analysis_jobs.time.time", return_value=1000):
            self.store.heartbeat("lost-worker")
            old_job = self.store.enqueue(request())
            self.store.claim("lost-worker")
        with patch("app.services.analysis_jobs.time.time", return_value=1040):
            new_job = self.store.enqueue(request())
        self.assertNotEqual(new_job, old_job)
        self.assertEqual(self.store.get_job(old_job)["state"], "error")
        self.assertEqual(self.store.events_since(old_job, 0)[0]["type"], "error")

    def test_duplicate_or_out_of_range_results_cannot_complete_review(self):
        job_id = self.store.enqueue(request())
        self.store.claim("worker-a")
        self.assertTrue(self.store.add_result(job_id, "worker-a", result(0)))
        with self.assertRaisesRegex(ValueError, "same turn"):
            self.store.add_result(job_id, "worker-a", result(0))
        with self.assertRaisesRegex(ValueError, "outside"):
            self.store.add_result(job_id, "worker-a", result(2))
        self.assertFalse(self.store.complete(job_id, "worker-a"))
        self.assertEqual(self.store.get_job(job_id)["state"], "error")


class AnalysisWorkerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = AnalysisJobStore(Path(self.temp.name) / "jobs.sqlite3")

    async def test_worker_persists_results_and_completion_for_websocket_relay(self):
        job_id = self.store.enqueue(request())
        self.assertTrue(await process_one_job(self.store, "worker-a", FakeEngine()))
        self.assertFalse(await process_one_job(self.store, "worker-a", FakeEngine()))
        self.assertEqual(self.store.get_job(job_id)["state"], "complete")
        events = self.store.events_since(job_id, 0)
        self.assertEqual([event["type"] for event in events], ["result", "result", "complete"])
        self.assertEqual([event["move_number"] for event in events[:2]], [0, 1])
        self.assertEqual([event["type"] for event in self.store.events_since(job_id, events[0]["id"])],
                         ["result", "complete"])

    async def test_error_is_persisted_and_does_not_look_complete(self):
        class FailingEngine:
            async def analyze_game(self, **kwargs):
                yield result(0)
                raise RuntimeError("engine failed")

        job_id = self.store.enqueue(request())
        with patch("app.worker.logger.exception"):
            await process_one_job(self.store, "worker-a", FailingEngine())
        self.assertEqual(self.store.get_job(job_id)["state"], "error")
        self.assertEqual([event["type"] for event in self.store.events_since(job_id, 0)],
                         ["result", "error"])

    async def test_short_engine_stream_fails_instead_of_caching_partial_review(self):
        class ShortEngine:
            async def analyze_game(self, **kwargs):
                yield result(0)

        job_id = self.store.enqueue(request())
        await process_one_job(self.store, "worker-a", ShortEngine())
        self.assertEqual(self.store.get_job(job_id)["state"], "error")
        self.assertEqual(self.store.events_since(job_id, 0)[-1]["type"], "error")

    async def test_cancelled_job_discards_remaining_engine_queries(self):
        job_id = self.store.enqueue(request())
        store = self.store

        class CancellingEngine:
            stopped = False
            restarted = False

            async def analyze_game(self, **kwargs):
                yield result(0)
                store.cancel(job_id)
                yield result(1)

            async def stop(self):
                self.stopped = True

            async def start(self):
                self.restarted = True

        fake = CancellingEngine()
        await process_one_job(store, "worker-a", fake)
        self.assertTrue(fake.stopped)
        self.assertTrue(fake.restarted)
        self.assertEqual(store.get_job(job_id)["state"], "cancelled")
        self.assertEqual([event["type"] for event in store.events_since(job_id, 0)],
                         ["result", "cancelled"])


if __name__ == "__main__":
    unittest.main()
