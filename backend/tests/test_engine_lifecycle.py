import asyncio
import json
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

from app.services.katago import KataGoEngine


class EngineLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_subprocess_waits_for_final_response(self):
        script = (
            "import json, sys\n"
            "for line in sys.stdin:\n"
            "    query = json.loads(line)\n"
            "    if query.get('action') == 'terminate':\n"
            "        continue\n"
            "    print(json.dumps({'id': query['id'], 'warning': 'mock warning'}), flush=True)\n"
            "    print(json.dumps({'id': query['id'], 'isDuringSearch': True, 'rootInfo': {'visits': 1}}), flush=True)\n"
            "    print(json.dumps({'id': query['id'], 'isDuringSearch': False, 'rootInfo': {'visits': 10}}), flush=True)\n"
        )
        engine = KataGoEngine()
        engine._process = await asyncio.create_subprocess_exec(
            sys.executable, '-u', '-c', script,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        engine._reader_task = asyncio.create_task(engine._read_responses())
        try:
            with self.assertLogs('app.services.katago', level='WARNING'):
                response = await asyncio.wait_for(engine._send_query({'id': 'partial'}), 2)
            self.assertEqual(response['rootInfo']['visits'], 10)
            self.assertEqual(engine._pending, {})
        finally:
            await engine.stop()

    async def test_subprocess_exit_rejects_pending_query(self):
        script = "import sys\nsys.stdin.readline()\n"
        engine = KataGoEngine()
        engine._process = await asyncio.create_subprocess_exec(
            sys.executable, '-u', '-c', script,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        engine._reader_task = asyncio.create_task(engine._read_responses())
        try:
            with self.assertRaisesRegex(RuntimeError, 'stopped responding'):
                await asyncio.wait_for(engine._send_query({'id': 'dead'}), 2)
            self.assertEqual(engine._pending, {})
        finally:
            await engine.stop()

    async def test_subprocess_no_results_is_an_error(self):
        script = (
            "import json, sys\n"
            "query = json.loads(sys.stdin.readline())\n"
            "print(json.dumps({'id': query['id'], 'turnNumber': 0, 'isDuringSearch': False, 'noResults': True}), flush=True)\n"
            "sys.stdin.readline()\n"
        )
        engine = KataGoEngine()
        engine._process = await asyncio.create_subprocess_exec(
            sys.executable, '-u', '-c', script,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        engine._reader_task = asyncio.create_task(engine._read_responses())
        try:
            with self.assertRaisesRegex(RuntimeError, 'no analysis results'):
                await asyncio.wait_for(engine._send_query({'id': 'no-results'}), 2)
        finally:
            await engine.stop()

    async def test_game_query_timeout_starts_when_submitted(self):
        engine = KataGoEngine()
        engine.game_query_timeout = 0.02
        sent = []

        def write(payload):
            query = json.loads(payload)
            sent.append(query)
            if query.get('action') == 'terminate':
                return
            if query['id'].endswith('_t0'):
                engine._pending[query['id']].set_result({
                    'rootInfo': {'currentPlayer': 'B'}, 'moveInfos': [],
                })

        engine._process = SimpleNamespace(returncode=None, stdin=SimpleNamespace(
            write=Mock(side_effect=write), drain=AsyncMock()))
        stream = engine.analyze_game(moves=[['B', 'D4']])
        self.assertEqual((await stream.__anext__()).move_number, 0)
        await asyncio.sleep(0.04)
        with self.assertLogs('app.services.katago', level='ERROR'):
            with self.assertRaises(asyncio.TimeoutError):
                await stream.__anext__()
        self.assertEqual(engine._pending, {})
        self.assertTrue(any(query.get('terminateId', '').endswith('_t1') for query in sent))

    async def test_closing_game_stream_cleans_unfinished_queries(self):
        engine = KataGoEngine()
        unfinished = []
        terminated = []

        def write(payload):
            query = json.loads(payload)
            if query.get("action") == "terminate":
                terminated.append(query["terminateId"])
                return
            query_id = query["id"]
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
        self.assertEqual(len(terminated), 1)

    async def test_query_timeout_cleans_pending(self):
        engine = KataGoEngine()
        engine.query_timeout = 0.01
        sent = []
        engine._process = SimpleNamespace(returncode=None, stdin=SimpleNamespace(
            write=Mock(side_effect=lambda payload: sent.append(json.loads(payload))), drain=AsyncMock()))
        with self.assertRaises(asyncio.TimeoutError):
            await engine._send_query({'id': 'slow'})
        self.assertEqual(engine._pending, {})
        self.assertEqual(sent[-1]["terminateId"], "slow")

    async def test_eof_rejects_pending_queries(self):
        engine = KataGoEngine()
        engine._process = SimpleNamespace(stdout=SimpleNamespace(readline=AsyncMock(return_value=b'')))
        futures = [engine._register_pending(query_id) for query_id in ('dead-1', 'dead-2')]
        await engine._read_responses()
        for future in futures:
            with self.assertRaisesRegex(RuntimeError, 'stopped responding'):
                await future
        self.assertEqual(engine._pending, {})
        self.assertEqual(engine._pending_deadlines, {})

    async def test_game_stdin_drain_has_timeout(self):
        engine = KataGoEngine()
        engine.query_timeout = 0.01
        sent = []

        async def stuck_drain():
            await asyncio.sleep(1)

        engine._process = SimpleNamespace(returncode=None, stdin=SimpleNamespace(
            write=Mock(side_effect=lambda payload: sent.append(json.loads(payload))),
            drain=stuck_drain,
        ))
        stream = engine.analyze_game(moves=[])
        with self.assertRaises(asyncio.TimeoutError):
            await stream.__anext__()
        self.assertEqual(engine._pending, {})
        self.assertEqual(engine._pending_deadlines, {})
        self.assertEqual(sent[-1]['action'], 'terminate')

    async def test_stderr_is_drained_and_bounded(self):
        engine = KataGoEngine()
        reader = AsyncMock(side_effect=[b'x' * 4096] * 100 + [b''])
        engine._process = SimpleNamespace(stderr=SimpleNamespace(read=reader))
        await engine._read_stderr()
        self.assertEqual(len(engine.stderr_tail), 64)
        self.assertEqual(reader.await_count, 101)
