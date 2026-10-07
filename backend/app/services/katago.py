from __future__ import annotations

import asyncio
import json
import logging
from collections import deque
from typing import AsyncIterator
from uuid import uuid4

from app.config import (
    DEFAULT_MAX_VISITS,
    KATAGO_BINARY,
    KATAGO_CONFIG,
    KATAGO_MODEL,
    KATAGO_REPORT_PERSPECTIVE,
)
from app.models.schemas import MoveAnalysis, SuggestedMove

logger = logging.getLogger(__name__)


class KataGoEngine:
    """Manages a KataGo analysis engine subprocess."""

    def __init__(self):
        self._process: asyncio.subprocess.Process | None = None
        self._pending: dict[str, asyncio.Future] = {}
        self._pending_deadlines: dict[str, asyncio.TimerHandle] = {}
        self._reader_task: asyncio.Task | None = None
        self._stderr_task: asyncio.Task | None = None
        self.stderr_tail = deque(maxlen=64)
        self.query_timeout = 120.0
        self.game_query_timeout = 20 * 60.0
        self._lock = asyncio.Lock()

    @property
    def is_running(self) -> bool:
        return self._process is not None and self._process.returncode is None

    async def start(self):
        """Start the KataGo analysis engine process."""
        if self.is_running:
            return

        async with self._lock:
            if self.is_running:
                return
            await self._start_process()

    async def _start_process(self):
        """Start KataGo while the lifecycle lock is held."""

        cmd = [KATAGO_BINARY, "analysis"]
        if KATAGO_MODEL:
            cmd.extend(["-model", KATAGO_MODEL])
        if KATAGO_CONFIG:
            cmd.extend(["-config", KATAGO_CONFIG])
        cmd.extend([
            "-override-config",
            f"reportAnalysisWinratesAs={KATAGO_REPORT_PERSPECTIVE}",
        ])

        logger.info(f"Starting KataGo: {' '.join(cmd)}")

        self._process = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        # Start reading stdout for responses
        self._reader_task = asyncio.create_task(self._read_responses())
        self._stderr_task = asyncio.create_task(self._read_stderr())

        # Wait briefly and check it didn't crash immediately
        await asyncio.sleep(0.5)
        if self._process.returncode is not None:
            if self._stderr_task:
                await self._stderr_task
            stderr = ''.join(self.stderr_tail)
            raise RuntimeError(f"KataGo failed to start: {stderr}")

        logger.info("KataGo started successfully")

    async def stop(self):
        """Stop the KataGo process."""
        if self._reader_task:
            self._reader_task.cancel()
            await asyncio.gather(self._reader_task, return_exceptions=True)
            self._reader_task = None

        if self._process and self._process.returncode is None:
            self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=5)
            except asyncio.TimeoutError:
                self._process.kill()
                await self._process.wait()

        if self._stderr_task:
            self._stderr_task.cancel()
            await asyncio.gather(self._stderr_task, return_exceptions=True)
            self._stderr_task = None

        self._process = None

        # Cancel all pending futures
        for query_id in list(self._pending):
            future = self._drop_pending(query_id)
            if not future.done():
                future.set_exception(RuntimeError("KataGo stopped"))

    def _register_pending(self, query_id: str, terminate_on_timeout: bool = True,
                          timeout: float | None = None) -> asyncio.Future:
        if query_id in self._pending:
            raise ValueError(f"Duplicate KataGo query id: {query_id}")
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        self._pending[query_id] = future
        self._pending_deadlines[query_id] = loop.call_later(
            self.query_timeout if timeout is None else timeout,
            self._expire_pending, query_id, terminate_on_timeout,
        )
        return future

    def _drop_pending(self, query_id: str) -> asyncio.Future | None:
        deadline = self._pending_deadlines.pop(query_id, None)
        if deadline is not None:
            deadline.cancel()
        return self._pending.pop(query_id, None)

    def _expire_pending(self, query_id: str, terminate_on_timeout: bool) -> None:
        future = self._drop_pending(query_id)
        if future is not None and not future.done():
            future.set_exception(asyncio.TimeoutError(f"KataGo query {query_id} timed out"))
            if terminate_on_timeout:
                asyncio.create_task(self._terminate_queries([query_id]))

    async def _read_stderr(self):
        """Drain diagnostics in bounded chunks, including output without newlines."""
        process = self._process
        if not process or not process.stderr:
            return
        while True:
            chunk = await process.stderr.read(4096)
            if not chunk:
                return
            self.stderr_tail.append(chunk.decode(errors='replace'))

    async def _read_responses(self):
        """Background task that reads KataGo stdout and resolves pending queries."""
        process = self._process
        reader_error = None
        try:
            while process and process.stdout:
                line = await process.stdout.readline()
                if not line:
                    break

                try:
                    response = json.loads(line.decode())
                except json.JSONDecodeError:
                    continue

                if "error" in response and not response.get("id"):
                    raise RuntimeError(str(response["error"]))
                if "warning" in response:
                    logger.warning("KataGo returned a query warning")
                    continue
                query_id = response.get("id")
                if not query_id or response.get("isDuringSearch") is True:
                    continue
                future = self._drop_pending(query_id)
                if future is not None and not future.done():
                    if "error" in response:
                        future.set_exception(RuntimeError(str(response["error"])))
                    elif response.get("noResults"):
                        future.set_exception(RuntimeError("KataGo returned no analysis results"))
                    else:
                        future.set_result(response)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            reader_error = RuntimeError(f"KataGo reader error: {e}")
            logger.error("KataGo reader error: %s", e)
        finally:
            for query_id in list(self._pending):
                future = self._drop_pending(query_id)
                if not future.done():
                    future.set_exception(reader_error or RuntimeError("KataGo stopped responding"))

    async def _send_query(self, query: dict) -> dict:
        """Send a query to KataGo and wait for the response."""
        if not self.is_running:
            await self.start()

        query_id = query["id"]
        future = self._register_pending(query_id, terminate_on_timeout=False)

        query_json = json.dumps(query) + "\n"
        completed = False
        try:
            self._process.stdin.write(query_json.encode())
            await asyncio.wait_for(self._process.stdin.drain(), self.query_timeout)
            response = await future
            completed = True
            return response
        finally:
            if not completed:
                await self._terminate_queries([query_id])
            self._drop_pending(query_id)
            if not future.done():
                future.cancel()
            elif not future.cancelled():
                future.exception()

    async def _terminate_queries(self, query_ids: list[str]) -> None:
        """Ask KataGo to stop exact pending searches without restarting the engine."""
        if not query_ids or not self.is_running or not self._process.stdin:
            return
        try:
            payload = "".join(json.dumps({
                "id": f"terminate_{uuid4().hex}", "action": "terminate", "terminateId": query_id,
            }) + "\n" for query_id in query_ids)
            self._process.stdin.write(payload.encode())
            await asyncio.wait_for(self._process.stdin.drain(), timeout=5)
        except (OSError, RuntimeError, asyncio.TimeoutError) as error:
            logger.warning("Could not terminate %s KataGo searches: %s", len(query_ids), error)

    async def analyze_position(
        self,
        query_id: str,
        moves: list[list[str]],
        rules: str = "chinese",
        komi: float = 7.5,
        board_size: int = 19,
        max_visits: int | None = None,
    ) -> dict:
        """Analyze a single position (after the given move sequence)."""
        query = {
            "id": query_id,
            "moves": moves,
            "rules": rules,
            "komi": komi,
            "boardXSize": board_size,
            "boardYSize": board_size,
            "maxVisits": max_visits or DEFAULT_MAX_VISITS,
            "includeOwnership": True,
            "includePolicy": True,
        }
        return await self._send_query(query)

    async def analyze_candidate(
        self,
        *,
        moves: list[list[str]],
        initial_stones: list[list[str]],
        player: str,
        move: str,
        rules: str,
        komi: float,
        board_size: int,
        max_visits: int,
    ) -> SuggestedMove:
        """Run one focused KataGo search at the supplied position."""
        response = await self._send_query({
            "id": f"coach_{uuid4().hex}",
            "moves": moves,
            "initialStones": initial_stones,
            "rules": rules,
            "komi": komi,
            "boardXSize": board_size,
            "boardYSize": board_size,
            "maxVisits": max_visits,
            "priority": 10,
            "includeOwnership": False,
            "allowMoves": [{"player": player, "moves": [move], "untilDepth": 1}],
        })
        match = next((info for info in response.get("moveInfos", [])
                      if same_move(info.get("move"), move)), None)
        if match is None:
            raise RuntimeError("KataGo did not evaluate the requested move")
        return parse_suggested_move(match)

    async def analyze_game(
        self,
        moves: list[list[str]],
        initial_stones: list[list[str]] | None = None,
        rules: str = "chinese",
        komi: float = 7.5,
        board_size: int = 19,
        max_visits: int | None = None,
    ) -> AsyncIterator[MoveAnalysis]:
        """
        Analyze every position in a game, yielding results as they complete.
        Sends all queries at once for efficient GPU batching.
        """
        if not self.is_running:
            await self.start()

        visits = max_visits or DEFAULT_MAX_VISITS

        # Send a query for each position (including the empty board)
        futures: list[tuple[int, asyncio.Future]] = []
        comparisons: dict[int, tuple[SuggestedMove, SuggestedMove, float, float]] = {}

        game_id = uuid4().hex
        completed_all = False
        try:
            for turn in range(len(moves) + 1):
                query_id = f"{game_id}_t{turn}"
                query = {
                    "id": query_id,
                    "moves": moves[:turn],
                    "initialStones": initial_stones or [],
                    "rules": rules,
                    "komi": komi,
                    "boardXSize": board_size,
                    "boardYSize": board_size,
                    "maxVisits": visits,
                    "priority": 0,
                    "includeOwnership": True,
                }
                # A batched game may queue many positions. Their deadline follows
                # the full job budget, not the focused-query timeout.
                future = self._register_pending(query_id, timeout=self.game_query_timeout)
                futures.append((turn, future))
                self._process.stdin.write((json.dumps(query) + "\n").encode())

            await asyncio.wait_for(self._process.stdin.drain(), self.query_timeout)

            # Comparisons for a played move depend on its preceding position,
            # so process turns in order even if KataGo answers out of order.
            for turn, future in futures:
                try:
                    response = await future
                    analysis = parse_katago_response(response, turn)
                    comparison = comparisons.get(turn)
                    if comparison:
                        played_move, best_move, win_rate_loss, point_loss = comparison
                        analysis.played_move = played_move
                        analysis.best_move = best_move
                        analysis.win_rate_loss = win_rate_loss
                        analysis.point_loss = point_loss
                    yield analysis

                    if turn < len(moves):
                        comparison = await self._get_played_move_comparison(
                            game_id=game_id,
                            turn=turn,
                            position_response=response,
                            moves=moves,
                            initial_stones=initial_stones or [],
                            rules=rules,
                            komi=komi,
                            board_size=board_size,
                            max_visits=visits,
                        )
                        if comparison:
                            comparisons[turn + 1] = comparison
                except Exception as error:
                    logger.error("Error analyzing turn %s: %s", turn, error)
                    raise
                finally:
                    self._drop_pending(f"{game_id}_t{turn}")
            completed_all = True
        finally:
            # Also run when a worker closes this generator after cancellation.
            if not completed_all:
                await self._terminate_queries([
                    f"{game_id}_t{turn}" for turn, future in futures if not future.done()
                ])
            for pending_turn, pending_future in futures:
                self._drop_pending(f"{game_id}_t{pending_turn}")
                if not pending_future.done():
                    pending_future.cancel()
                elif not pending_future.cancelled():
                    pending_future.exception()

    async def _get_played_move_comparison(
        self,
        *,
        game_id: str,
        turn: int,
        position_response: dict,
        moves: list[list[str]],
        initial_stones: list[list[str]],
        rules: str,
        komi: float,
        board_size: int,
        max_visits: int,
    ) -> tuple[SuggestedMove, SuggestedMove, float, float] | None:
        """Compare the next played move with KataGo's best move at this position."""
        player, move = moves[turn]
        move_infos = position_response.get("moveInfos", [])
        if not move_infos:
            return None

        best_info = min(move_infos, key=lambda info: info.get("order", 10_000))
        best_move = parse_suggested_move(best_info)
        played_info = next(
            (info for info in move_infos if same_move(info.get("move"), move)),
            None,
        )

        # A barely explored candidate is too noisy for review labels. Force a
        # focused search while allowing well-explored normal results to be reused.
        minimum_visits = max(1, max_visits // 4)
        if played_info is None or played_info.get("visits", 0) < minimum_visits:
            query = {
                "id": f"{game_id}_played_t{turn + 1}",
                "moves": moves[:turn],
                "initialStones": initial_stones,
                "rules": rules,
                "komi": komi,
                "boardXSize": board_size,
                "boardYSize": board_size,
                "maxVisits": max_visits,
                "allowMoves": [{
                    "player": player,
                    "moves": [move],
                    "untilDepth": 1,
                }],
            }
            focused_response = await self._send_query(query)
            focused_moves = focused_response.get("moveInfos", [])
            played_info = next(
                (info for info in focused_moves if same_move(info.get("move"), move)),
                focused_moves[0] if focused_moves else None,
            )

        if played_info is None:
            logger.warning("KataGo returned no evaluation for played move %s at turn %s", move, turn)
            return None

        played_move = parse_suggested_move(played_info)
        win_rate_loss, point_loss = calculate_move_losses(player, best_move, played_move)
        return played_move, best_move, win_rate_loss, point_loss


def same_move(first: str | None, second: str) -> bool:
    return first is not None and first.casefold() == second.casefold()


def parse_suggested_move(move_info: dict) -> SuggestedMove:
    return SuggestedMove(
        move=move_info.get("move", "pass"),
        win_rate=move_info.get("winrate", 0.5),
        score_lead=move_info.get("scoreLead", 0.0),
        visits=move_info.get("visits", 0),
        pv=move_info.get("pv", []),
    )


def calculate_move_losses(
    player: str,
    best_move: SuggestedMove,
    played_move: SuggestedMove,
) -> tuple[float, float]:
    """Return non-negative win-rate and point losses from the mover's perspective."""
    direction = 1 if player == "B" else -1
    win_rate_loss = max(
        0.0,
        direction * (best_move.win_rate - played_move.win_rate),
    )
    point_loss = max(
        0.0,
        direction * (best_move.score_lead - played_move.score_lead),
    )
    return win_rate_loss, point_loss


def parse_katago_response(response: dict, move_number: int) -> MoveAnalysis:
    """Convert raw KataGo JSON response to our MoveAnalysis model."""
    root_info = response.get("rootInfo", {})
    move_infos = response.get("moveInfos", [])
    ownership = response.get("ownership", [])

    # start() forces KataGo to report every value from Black's perspective.
    current_player = root_info.get("currentPlayer", "B")
    win_rate = root_info.get("winrate", 0.5)
    score_lead = root_info.get("scoreLead", 0.0)

    # Parse top candidate moves
    top_moves = []
    for mi in move_infos[:5]:  # top 5 moves
        top_moves.append(parse_suggested_move(mi))

    return MoveAnalysis(
        move_number=move_number,
        current_player=current_player,
        win_rate=win_rate,
        score_lead=score_lead,
        top_moves=top_moves,
        ownership=ownership,
    )


# Singleton engine instance
engine = KataGoEngine()
