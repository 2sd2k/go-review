import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.models.schemas import MoveAnalysis
from app.routers.analysis import analyze_game
from app.services.analysis_jobs import AnalysisJobStore
from app.worker import process_one_job


class FakeWebSocket:
    headers = {}

    def __init__(self):
        self.sent = []
        self.disconnected = asyncio.Event()

    async def accept(self):
        pass

    async def receive_text(self):
        return json.dumps({"moves": [["B", "D4"]], "board_size": 9})

    async def receive(self):
        await self.disconnected.wait()
        return {"type": "websocket.disconnect"}

    async def send_text(self, text):
        self.sent.append(json.loads(text))


class FakeEngine:
    async def analyze_game(self, **kwargs):
        for move_number in range(2):
            yield MoveAnalysis(move_number=move_number, current_player="B",
                               win_rate=0.5, score_lead=0, top_moves=[], ownership=[])


class AnalysisRouterTests(unittest.IsolatedAsyncioTestCase):
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

    async def test_disconnect_cancels_queued_job(self):
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
            self.assertEqual(store.get_job(job_id)["state"], "cancelled")


if __name__ == "__main__":
    unittest.main()
