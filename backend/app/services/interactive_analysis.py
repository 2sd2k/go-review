"""API-side client for prioritized KataGo queries handled by the worker."""

from __future__ import annotations

import asyncio

from app.models.schemas import CandidateAnalysisRequest, SuggestedMove
from app.services.analysis_jobs import get_job_store


async def request_candidate_analysis(**kwargs) -> SuggestedMove:
    store = get_job_store()
    if not await asyncio.to_thread(store.worker_alive):
        raise RuntimeError("Analysis worker is offline")
    request = CandidateAnalysisRequest(**kwargs)
    job_id = await asyncio.to_thread(store.enqueue_candidate, request)
    deadline = asyncio.get_running_loop().time() + 50
    try:
        while True:
            job = await asyncio.to_thread(store.get_job, job_id)
            if job is None:
                raise RuntimeError("The interactive analysis job disappeared")
            if job["state"] == "complete":
                return SuggestedMove.model_validate_json(job["response_json"])
            if job["state"] in ("error", "cancelled"):
                raise RuntimeError(job["error"] or "Interactive analysis was cancelled")
            assigned = job["worker_id"] if job["state"] == "running" else None
            if not await asyncio.to_thread(store.worker_alive, assigned):
                raise RuntimeError("Analysis worker stopped")
            if asyncio.get_running_loop().time() >= deadline:
                raise asyncio.TimeoutError("Interactive analysis timed out")
            await asyncio.sleep(0.25)
    finally:
        await asyncio.to_thread(store.cancel, job_id)
