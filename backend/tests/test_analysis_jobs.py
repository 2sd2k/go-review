import asyncio
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from app.models.schemas import AnalysisRequest, CandidateAnalysisRequest, MoveAnalysis, SuggestedMove
from app.services.analysis_jobs import AnalysisJobStore, QueueFullError
from app.services.interactive_analysis import request_candidate_analysis
from app.worker import process_one_job, process_one_candidate


def request():
    return AnalysisRequest(moves=[("B", "D4")], board_size=9, max_visits=100)


def result(move_number):
    return MoveAnalysis(move_number=move_number, current_player="B", win_rate=0.5,
                        score_lead=0, top_moves=[], ownership=[])


def candidate_request():
    return CandidateAnalysisRequest(moves=[], player="B", move="D4", board_size=9, max_visits=10)


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

    def test_repeated_client_job_id_rejoins_without_duplicate_work(self):
        job_id = "a" * 32
        self.assertEqual(self.store.enqueue(request(), job_id), job_id)
        self.assertEqual(self.store.enqueue(request(), job_id), job_id)
        with self.assertRaisesRegex(ValueError, "different request"):
            self.store.enqueue(AnalysisRequest(moves=[], board_size=9), job_id)
        with self.store._connection() as db:
            self.assertEqual(db.execute("SELECT count(*) FROM jobs").fetchone()[0], 1)

    def test_owned_jobs_cannot_be_reused_by_another_user(self):
        store = AnalysisJobStore(self.path, max_active=16, max_user_active=1)
        job_id = "b" * 32
        self.assertEqual(store.enqueue(request(), job_id, "user-a"), job_id)
        self.assertEqual(store.get_job(job_id)["owner_id"], "user-a")
        with self.assertRaisesRegex(ValueError, "different request"):
            store.enqueue(request(), job_id, "user-b")
        with self.assertRaises(QueueFullError):
            store.enqueue(request(), owner_id="user-a")
        self.assertIsNotNone(store.enqueue(request(), owner_id="user-b"))

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

    def test_candidate_claims_before_a_queued_game(self):
        game_id = self.store.enqueue(request())
        candidate_id = self.store.enqueue_candidate(candidate_request())
        self.assertEqual(self.store.claim("worker-a")[0], candidate_id)
        self.assertEqual(self.store.claim("worker-b")[0], game_id)

    def test_existing_database_is_upgraded_in_place(self):
        old_path = Path(self.temp.name) / "old.sqlite3"
        with closing(sqlite3.connect(old_path)) as db:
            with db:
                db.execute("""CREATE TABLE jobs (id TEXT PRIMARY KEY, request_json TEXT NOT NULL,
                            state TEXT NOT NULL, total_moves INTEGER NOT NULL,
                            completed_count INTEGER NOT NULL DEFAULT 0, worker_id TEXT,
                            error TEXT, created_at REAL NOT NULL, updated_at REAL NOT NULL)""")
        upgraded = AnalysisJobStore(old_path)
        self.assertEqual(upgraded.get_job(upgraded.enqueue_candidate(candidate_request()))["kind"], "candidate")

    def test_legacy_oversized_job_fails_without_stopping_queue(self):
        legacy = self.store.enqueue(request())
        with self.store._connection() as db:
            db.execute("UPDATE jobs SET request_json=? WHERE id=?",
                       ('{"moves": [], "max_visits": 100000}', legacy))
        valid = self.store.enqueue_candidate(candidate_request())
        # Candidate work stays first; the invalid game is retired on its next claim.
        self.assertEqual(self.store.claim("worker-a")[0], valid)
        self.assertIsNone(self.store.claim("worker-a", "game"))
        self.assertEqual(self.store.get_job(legacy)["state"], "error")


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
            closed = False

            async def analyze_game(self, **kwargs):
                try:
                    yield result(0)
                    store.cancel(job_id)
                    yield result(1)
                finally:
                    self.closed = True

        fake = CancellingEngine()
        await process_one_job(store, "worker-a", fake)
        self.assertTrue(fake.closed)
        self.assertEqual(store.get_job(job_id)["state"], "cancelled")
        self.assertEqual([event["type"] for event in store.events_since(job_id, 0)],
                         ["result", "cancelled"])

    async def test_in_flight_game_is_cancelled_before_first_result(self):
        job_id = self.store.enqueue(request())
        class SlowEngine:
            closed = False
            async def analyze_game(self, **kwargs):
                try:
                    await asyncio.Event().wait()
                    yield result(0)
                finally:
                    self.closed = True

        fake = SlowEngine()
        task = asyncio.create_task(process_one_job(self.store, "worker-a", fake))
        for _ in range(100):
            if self.store.get_job(job_id)["state"] == "running":
                break
            await asyncio.sleep(0.01)
        self.store.cancel(job_id)
        await asyncio.wait_for(task, timeout=2)
        self.assertTrue(fake.closed)
        self.assertEqual(self.store.get_job(job_id)["state"], "cancelled")

    async def test_coach_query_uses_prioritized_worker_job(self):
        class CandidateEngine:
            async def analyze_candidate(self, **kwargs):
                return SuggestedMove(move="D4", win_rate=0.55, score_lead=1, visits=10, pv=["D4"])

        self.store.heartbeat("worker-a")
        with patch("app.services.interactive_analysis.get_job_store", return_value=self.store):
            reply = asyncio.create_task(request_candidate_analysis(
                moves=[], initial_stones=[], player="B", move="D4", rules="chinese",
                komi=7.5, board_size=9, max_visits=10))
            for _ in range(100):
                with self.store._connection() as db:
                    row = db.execute("SELECT id FROM jobs WHERE kind='candidate' AND state='queued'").fetchone()
                if row:
                    break
                await asyncio.sleep(0.01)
            await process_one_candidate(self.store, "worker-a", CandidateEngine())
            candidate = await asyncio.wait_for(reply, timeout=2)
        self.assertEqual(candidate.move, "D4")
        self.assertEqual(candidate.visits, 10)

    async def test_candidate_completes_while_game_search_is_running(self):
        class SharedEngine:
            game_started = asyncio.Event()
            game_closed = False

            async def analyze_game(self, **kwargs):
                try:
                    self.game_started.set()
                    await asyncio.Event().wait()
                    yield result(0)
                finally:
                    self.game_closed = True

            async def analyze_candidate(self, **kwargs):
                return SuggestedMove(move="D4", win_rate=0.55, score_lead=1,
                                     visits=10, pv=["D4"])

        fake = SharedEngine()
        game_id = self.store.enqueue(request())
        game_task = asyncio.create_task(process_one_job(self.store, "worker-a", fake))
        await asyncio.wait_for(fake.game_started.wait(), timeout=2)
        candidate_id = self.store.enqueue_candidate(candidate_request())
        await process_one_candidate(self.store, "worker-a", fake)
        self.assertEqual(self.store.get_job(candidate_id)["state"], "complete")
        self.assertEqual(self.store.get_job(game_id)["state"], "running")
        self.store.cancel(game_id)
        await asyncio.wait_for(game_task, timeout=2)
        self.assertTrue(fake.game_closed)


if __name__ == "__main__":
    unittest.main()
