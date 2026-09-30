"""Run this separately from uvicorn: python -m app.worker."""

from __future__ import annotations

import asyncio
import logging
import time
from uuid import uuid4

from app.services.analysis_jobs import AnalysisJobStore, get_job_store
from app.services.katago import KataGoEngine, engine

logger = logging.getLogger(__name__)
GAME_TIMEOUT_SECONDS = 20 * 60
CANDIDATE_TIMEOUT_SECONDS = 45


async def _await_job_work(store: AnalysisJobStore, job_id: str, work, timeout: float):
    """Cancel running engine work when the client cancels or the job times out."""
    task = asyncio.create_task(work)
    deadline = time.monotonic() + timeout
    try:
        while not task.done():
            await asyncio.sleep(0.25)
            job = await asyncio.to_thread(store.get_job, job_id)
            if job is None or job["state"] != "running":
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                return None
            if time.monotonic() >= deadline:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                raise asyncio.TimeoutError("Analysis job exceeded its time limit")
        return await task
    finally:
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


async def process_one_job(store: AnalysisJobStore, worker_id: str,
                          analysis_engine: KataGoEngine = engine) -> bool:
    claimed = await asyncio.to_thread(store.claim, worker_id, "game")
    if claimed is None:
        return False
    job_id, request = claimed
    logger.info("Starting analysis job %s", job_id)
    async def analyze():
        stream = analysis_engine.analyze_game(
            moves=[list(move) for move in request.moves],
            initial_stones=[list(stone) for stone in request.initial_stones],
            rules=request.rules,
            komi=request.komi,
            board_size=request.board_size,
            max_visits=request.max_visits,
        )
        try:
            async for analysis in stream:
                if not await asyncio.to_thread(store.add_result, job_id, worker_id, analysis):
                    return False
            return True
        finally:
            await stream.aclose()

    try:
        if await _await_job_work(store, job_id, analyze(), GAME_TIMEOUT_SECONDS):
            await asyncio.to_thread(store.complete, job_id, worker_id)
    except Exception as error:
        logger.exception("Analysis job %s failed", job_id)
        await asyncio.to_thread(store.fail, job_id, str(error), worker_id)
    return True


async def process_one_candidate(store: AnalysisJobStore, worker_id: str,
                                analysis_engine: KataGoEngine = engine) -> bool:
    claimed = await asyncio.to_thread(store.claim, worker_id, "candidate")
    if claimed is None:
        return False
    job_id, request = claimed
    try:
        candidate = await _await_job_work(store, job_id, analysis_engine.analyze_candidate(
            moves=[list(move) for move in request.moves],
            initial_stones=[list(stone) for stone in request.initial_stones],
            player=request.player,
            move=request.move,
            rules=request.rules,
            komi=request.komi,
            board_size=request.board_size,
            max_visits=request.max_visits,
        ), CANDIDATE_TIMEOUT_SECONDS)
        if candidate is not None:
            await asyncio.to_thread(store.complete_candidate, job_id, worker_id, candidate)
    except Exception as error:
        logger.exception("Candidate job %s failed", job_id)
        await asyncio.to_thread(store.fail, job_id, str(error), worker_id)
    return True


async def run_worker() -> None:
    store = get_job_store()
    worker_id = uuid4().hex
    await engine.start()

    async def heartbeat() -> None:
        while True:
            await asyncio.to_thread(store.heartbeat, worker_id)
            await asyncio.sleep(5)

    async def work_loop(process):
        while True:
            if not await process(store, worker_id):
                await asyncio.sleep(0.5)

    tasks = [asyncio.create_task(heartbeat()),
             asyncio.create_task(work_loop(process_one_job)),
             asyncio.create_task(work_loop(process_one_candidate))]
    try:
        await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        try:
            await engine.stop()
        finally:
            await asyncio.to_thread(store.unregister_worker, worker_id)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    try:
        asyncio.run(run_worker())
    except KeyboardInterrupt:
        pass
