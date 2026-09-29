"""Run this separately from uvicorn: python -m app.worker."""

from __future__ import annotations

import asyncio
import logging
from uuid import uuid4

from app.services.analysis_jobs import AnalysisJobStore, get_job_store
from app.services.katago import KataGoEngine, engine

logger = logging.getLogger(__name__)


async def process_one_job(store: AnalysisJobStore, worker_id: str,
                          analysis_engine: KataGoEngine = engine) -> bool:
    claimed = await asyncio.to_thread(store.claim, worker_id)
    if claimed is None:
        return False
    job_id, request = claimed
    logger.info("Starting analysis job %s", job_id)
    cancelled = False
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
                cancelled = True
                break
        if not cancelled:
            await asyncio.to_thread(store.complete, job_id, worker_id)
    except Exception as error:
        logger.exception("Analysis job %s failed", job_id)
        await asyncio.to_thread(store.fail, job_id, str(error), worker_id)
    finally:
        await stream.aclose()
    if cancelled:
        # This worker owns only one game at a time; restart to discard the
        # cancelled game's already-submitted KataGo queries.
        await analysis_engine.stop()
        await analysis_engine.start()
    return True


async def run_worker() -> None:
    store = get_job_store()
    worker_id = uuid4().hex
    await engine.start()

    async def heartbeat() -> None:
        while True:
            await asyncio.to_thread(store.heartbeat, worker_id)
            await asyncio.sleep(5)

    heartbeat_task = asyncio.create_task(heartbeat())
    try:
        while True:
            if not await process_one_job(store, worker_id):
                await asyncio.sleep(0.5)
    finally:
        heartbeat_task.cancel()
        await asyncio.gather(heartbeat_task, return_exceptions=True)
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
