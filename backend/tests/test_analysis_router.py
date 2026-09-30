import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException, Request, WebSocketDisconnect

from app.models.schemas import AnalysisRequest, MoveAnalysis
from app.config import DEFAULT_DEV_ORIGINS
from app.routers.analysis import analyze_game, cancel_analysis
from app.services.analysis_jobs import AnalysisJobStore
from app.worker import process_one_job


class FakeWebSocket:
    headers = {}

    def __init__(self, initial_message=None):
        self.sent = []
        self.disconnected = asyncio.Event()
        self.closed_code = None
        self.initial_message = initial_message or {"moves": [["B", "D4"]], "board_size": 9}
        self.followup_message = {"type": "websocket.disconnect"}

    async def accept(self):
        pass

    async def receive_text(self):
        return json.dumps(self.initial_message)

    async def receive(self):
        await self.disconnected.wait()
        return self.followup_message

    async def send_text(self, text):
        self.sent.append(json.loads(text))

    async def close(self, code, reason):
        self.closed_code = code


class FakeEngine:
    async def analyze_game(self, **kwargs):
        for move_number in range(2):
            yield MoveAnalysis(move_number=move_number, current_player="B",
                               win_rate=0.5, score_lead=0, top_moves=[], ownership=[])


class AnalysisRouterTests(unittest.IsolatedAsyncioTestCase):
    async def test_authenticated_job_cannot_be_replayed_or_cancelled_by_other_user(self):
        with tempfile.TemporaryDirectory() as directory:
            store = AnalysisJobStore(Path(directory) / "jobs.sqlite3")
            store.heartbeat("worker-a")
            config = {"SUPABASE_URL": "https://project.supabase.co",
                      "SUPABASE_PUBLISHABLE_KEY": "public-key"}
            with patch.dict(os.environ, config), \
                    patch("app.services.auth._verify_token", return_value="user-a"), \
                    patch("app.routers.analysis.get_job_store", return_value=store):
                start = FakeWebSocket({"job_id": "a" * 32, "access_token": "a.b.c",
                                       "moves": [["B", "D4"]], "board_size": 9})
                relay = asyncio.create_task(analyze_game(start))
                for _ in range(100):
                    if start.sent:
                        break
                    await asyncio.sleep(0.01)
                job_id = start.sent[0]["job_id"]
                start.disconnected.set()
                await asyncio.wait_for(relay, timeout=2)
                self.assertEqual(store.get_job(job_id)["owner_id"], "user-a")
                with store._connection() as db:
                    persisted = db.execute("SELECT request_json FROM jobs WHERE id=?", (job_id,)).fetchone()[0]
                self.assertNotIn("a.b.c", persisted)

                with patch("app.services.auth._verify_token", return_value="user-b"):
                    replay = FakeWebSocket({"action": "resume", "job_id": job_id,
                                            "access_token": "x.y.z"})
                    await analyze_game(replay)
                    self.assertEqual(replay.sent[0]["type"], "error")
                    self.assertEqual(store.get_job(job_id)["state"], "queued")
                    http = Request({"type": "http", "method": "DELETE",
                                    "headers": [(b"authorization", b"Bearer x.y.z")]})
                    with self.assertRaises(HTTPException) as denied:
                        await cancel_analysis(job_id, http)
                    self.assertEqual(denied.exception.status_code, 404)

    async def test_local_vite_fallback_port_is_allowed_by_default(self):
        self.assertIn("http://localhost:5174", DEFAULT_DEV_ORIGINS)
        self.assertIn("http://127.0.0.1:5174", DEFAULT_DEV_ORIGINS)

    async def test_unknown_origin_is_rejected_before_queueing(self):
        ws = FakeWebSocket()
        ws.headers = {"origin": "https://not-allowed.example"}
        with patch("app.routers.analysis.logger.warning"):
            await analyze_game(ws)
        self.assertEqual(ws.closed_code, 1008)

    async def test_oversized_websocket_request_is_rejected_before_queueing(self):
        ws = FakeWebSocket({"moves": [], "padding": "x" * 256_000})
        await analyze_game(ws)
        self.assertEqual(ws.sent[0]["type"], "error")
        self.assertIn("too large", ws.sent[0]["error"])

    async def test_websocket_relays_queued_worker_results(self):
        with tempfile.TemporaryDirectory() as directory:
            store = AnalysisJobStore(Path(directory) / "jobs.sqlite3")
            store.heartbeat("worker-a")
            ws = FakeWebSocket()
            with patch("app.routers.analysis.get_job_store", return_value=store):
                relay = asyncio.create_task(analyze_game(ws))
                for _ in range(100):
                    if ws.sent:
                        break
                    await asyncio.sleep(0.01)
                self.assertEqual(ws.sent[0]["type"], "progress")
                await process_one_job(store, "worker-a", FakeEngine())
                await asyncio.wait_for(relay, timeout=2)

            self.assertEqual([message["type"] for message in ws.sent],
                             ["progress", "result", "result", "complete"])
            self.assertEqual([message["move_number"] for message in ws.sent[1:3]], [0, 1])

    async def test_offline_worker_returns_actionable_error(self):
        with tempfile.TemporaryDirectory() as directory:
            store = AnalysisJobStore(Path(directory) / "jobs.sqlite3")
            ws = FakeWebSocket()
            with patch("app.routers.analysis.get_job_store", return_value=store):
                await analyze_game(ws)
            self.assertEqual(ws.sent[0]["type"], "error")
            self.assertIn("python -m app.worker", ws.sent[0]["error"])

    async def test_disconnect_preserves_job_and_resume_replays_results(self):
        with tempfile.TemporaryDirectory() as directory:
            store = AnalysisJobStore(Path(directory) / "jobs.sqlite3")
            store.heartbeat("busy-worker")
            ws = FakeWebSocket()
            with patch("app.routers.analysis.get_job_store", return_value=store):
                relay = asyncio.create_task(analyze_game(ws))
                for _ in range(100):
                    if ws.sent:
                        break
                    await asyncio.sleep(0.01)
                job_id = ws.sent[0]["job_id"]
                ws.disconnected.set()
                await asyncio.wait_for(relay, timeout=2)
            self.assertEqual(store.get_job(job_id)["state"], "queued")
            await process_one_job(store, "worker-a", FakeEngine())
            resume = FakeWebSocket({"action": "resume", "job_id": job_id})
            with patch("app.routers.analysis.get_job_store", return_value=store):
                await asyncio.wait_for(analyze_game(resume), timeout=2)
            self.assertEqual([message["type"] for message in resume.sent],
                             ["progress", "result", "result", "complete"])
            self.assertEqual(resume.sent[0]["job_id"], job_id)

    async def test_explicit_cancel_stops_reconnectable_job(self):
        with tempfile.TemporaryDirectory() as directory:
            store = AnalysisJobStore(Path(directory) / "jobs.sqlite3")
            job_id = store.enqueue(AnalysisRequest(moves=[], board_size=9))
            with patch("app.routers.analysis.get_job_store", return_value=store):
                await cancel_analysis(job_id, Request({"type": "http", "method": "DELETE",
                                                      "path": f"/api/analysis/jobs/{job_id}", "headers": []}))
            self.assertEqual(store.get_job(job_id)["state"], "cancelled")

    async def test_resume_replays_partial_progress_and_socket_cancel(self):
        with tempfile.TemporaryDirectory() as directory:
            store = AnalysisJobStore(Path(directory) / "jobs.sqlite3")
            job_id = store.enqueue(AnalysisRequest(moves=[["B", "D4"]], board_size=9))
            store.claim("worker-a", "game")
            store.add_result(job_id, "worker-a", MoveAnalysis(
                move_number=0, current_player="B", win_rate=0.5,
                score_lead=0, top_moves=[], ownership=[]))
            ws = FakeWebSocket({"action": "resume", "job_id": job_id})
            ws.followup_message = {"type": "websocket.receive", "text": json.dumps({
                "action": "cancel", "job_id": job_id,
            })}
            with patch("app.routers.analysis.get_job_store", return_value=store):
                relay = asyncio.create_task(analyze_game(ws))
                for _ in range(100):
                    if len(ws.sent) >= 2:
                        break
                    await asyncio.sleep(0.01)
                self.assertEqual([item["type"] for item in ws.sent], ["progress", "result"])
                self.assertEqual(ws.sent[0]["move_number"], 0)
                ws.disconnected.set()
                await asyncio.wait_for(relay, timeout=2)
            self.assertEqual(store.get_job(job_id)["state"], "cancelled")

    async def test_client_id_survives_lost_initial_ack(self):
        class LostAckWebSocket(FakeWebSocket):
            async def send_text(self, text):
                raise WebSocketDisconnect()

        with tempfile.TemporaryDirectory() as directory:
            store = AnalysisJobStore(Path(directory) / "jobs.sqlite3")
            store.heartbeat("worker-a")
            job_id = "c" * 32
            ws = LostAckWebSocket({"job_id": job_id, "moves": [["B", "D4"]], "board_size": 9})
            with patch("app.routers.analysis.get_job_store", return_value=store):
                await analyze_game(ws)
            self.assertEqual(store.get_job(job_id)["state"], "queued")
            self.assertEqual(store.enqueue(AnalysisRequest(moves=[["B", "D4"]], board_size=9), job_id), job_id)


if __name__ == "__main__":
    unittest.main()
