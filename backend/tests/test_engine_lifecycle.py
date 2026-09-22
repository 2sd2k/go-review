import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from app.services.katago import KataGoEngine


class EngineLifecycleTests(unittest.IsolatedAsyncioTestCase):
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
