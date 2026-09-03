from __future__ import annotations

import asyncio
import json
import logging
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
        self._reader_task: asyncio.Task | None = None
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

        # Wait briefly and check it didn't crash immediately
        await asyncio.sleep(0.5)
        if self._process.returncode is not None:
            stderr = ""
            if self._process.stderr:
                stderr = (await self._process.stderr.read()).decode()
            raise RuntimeError(f"KataGo failed to start: {stderr}")

        logger.info("KataGo started successfully")

    async def stop(self):
        """Stop the KataGo process."""
        if self._reader_task:
            self._reader_task.cancel()
            self._reader_task = None

        if self._process and self._process.returncode is None:
            self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=5)
            except asyncio.TimeoutError:
                self._process.kill()

        self._process = None

        # Cancel all pending futures
        for future in self._pending.values():
            if not future.done():
                future.set_exception(RuntimeError("KataGo stopped"))
        self._pending.clear()

    async def _read_responses(self):
        """Background task that reads KataGo stdout and resolves pending queries."""
        try:
            while self._process and self._process.stdout:
                line = await self._process.stdout.readline()
                if not line:
                    break

                try:
                    response = json.loads(line.decode())
                except json.JSONDecodeError:
                    continue

                query_id = response.get("id")
                if query_id and query_id in self._pending:
                    future = self._pending.pop(query_id)
                    if not future.done():
                        if "error" in response:
                            future.set_exception(RuntimeError(response["error"]))
                        else:
                            future.set_result(response)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"KataGo reader error: {e}")
        finally:
            for future in self._pending.values():
                if not future.done():
                    future.set_exception(RuntimeError("KataGo stopped responding"))
            self._pending.clear()

    async def _send_query(self, query: dict) -> dict:
        """Send a query to KataGo and wait for the response."""
        if not self.is_running:
            await self.start()

        query_id = query["id"]
        if query_id in self._pending:
            raise ValueError(f"Duplicate KataGo query id: {query_id}")
        future = asyncio.get_event_loop().create_future()
        self._pending[query_id] = future

        query_json = json.dumps(query) + "\n"
        self._process.stdin.write(query_json.encode())
        await self._process.stdin.drain()

        return await future

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
        for turn in range(len(moves) + 1):
            query_id = f"{game_id}_t{turn}"
            moves_so_far = moves[:turn]

            query = {
                "id": query_id,
                "moves": moves_so_far,
                "initialStones": initial_stones or [],
                "rules": rules,
                "komi": komi,
                "boardXSize": board_size,
                "boardYSize": board_size,
                "maxVisits": visits,
                "includeOwnership": True,
            }

            future = asyncio.get_event_loop().create_future()
            self._pending[query_id] = future

            query_json = json.dumps(query) + "\n"
            self._process.stdin.write(query_json.encode())

            futures.append((turn, future))

        await self._process.stdin.drain()

        # Yield results as they complete (not necessarily in order)
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
            except Exception as e:
                logger.error(f"Error analyzing turn {turn}: {e}")
                continue

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
