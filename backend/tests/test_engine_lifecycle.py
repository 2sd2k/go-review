import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from app.services.katago import KataGoEngine


class EngineLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_closing_game_stream_cleans_unfinished_queries(self):
        engine = KataGoEngine()
        unfinished = []

        def write(payload):
            query_id = json.loads(payload)["id"]
            future = engine._pending[query_id]
            if query_id.endswith("_t0"):
                future.set_result({"rootInfo": {"currentPlayer": "B"}, "moveInfos": []})
            else:
                unfinished.append(future)

        engine._process = SimpleNamespace(returncode=None, stdin=SimpleNamespace(
            write=Mock(side_effect=write), drain=AsyncMock()))
        stream = engine.analyze_game(moves=[["B", "D4"]])
        self.assertEqual((await stream.__anext__()).move_number, 0)
        await stream.aclose()
        self.assertEqual(engine._pending, {})
        self.assertTrue(unfinished[0].cancelled())

    async def test_query_timeout_cleans_pending(self):
        engine = KataGoEngine()
        engine.query_timeout = 0.01
        engine._process = SimpleNamespace(returncode=None, stdin=SimpleNamespace(write=Mock(), drain=AsyncMock()))
        with self.assertRaises(asyncio.TimeoutError):
            await engine._send_query({'id': 'slow'})
        self.assertEqual(engine._pending, {})

    async def test_eof_rejects_pending_queries(self):
        engine = KataGoEngine()
        engine._process = SimpleNamespace(stdout=SimpleNamespace(readline=AsyncMock(return_value=b'')))
        future = asyncio.get_running_loop().create_future()
        engine._pending['dead'] = future
        await engine._read_responses()
        with self.assertRaisesRegex(RuntimeError, 'stopped responding'):
            await future
        self.assertEqual(engine._pending, {})

    async def test_stderr_is_drained_and_bounded(self):
        engine = KataGoEngine()
        reader = AsyncMock(side_effect=[b'x' * 4096] * 100 + [b''])
        engine._process = SimpleNamespace(stderr=SimpleNamespace(read=reader))
        await engine._read_stderr()
        self.assertEqual(len(engine.stderr_tail), 64)
        self.assertEqual(reader.await_count, 101)
