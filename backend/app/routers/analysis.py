import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.models.schemas import AnalysisRequest
from app.services.analysis_jobs import QueueFullError, get_job_store
from app.config import CORS_ORIGINS

logger = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/ws/analyze")
async def analyze_game(ws: WebSocket):
    origin = ws.headers.get("origin")
    if origin and origin not in CORS_ORIGINS:
        logger.warning("Rejected analysis WebSocket origin %r", origin)
        await ws.close(code=1008, reason="Origin not allowed")
        return

    await ws.accept()
    job_id = None
    disconnect_task = None
    store = get_job_store()

    try:
        raw = await ws.receive_text()
        request = AnalysisRequest.model_validate_json(raw)
        disconnect_task = asyncio.create_task(ws.receive())
        if not await asyncio.to_thread(store.worker_alive):
            await ws.send_text(json.dumps({
                "type": "error",
                "error": "Analysis worker is offline. Start it with python -m app.worker.",
            }))
            return
        job_id = await asyncio.to_thread(store.enqueue, request)
        await ws.send_text(json.dumps({
            "type": "progress",
            "move_number": 0,
            "total_moves": len(request.moves),
            "job_id": job_id,
        }))
        cursor = 0
        while True:
            if disconnect_task.done():
                return
            events = await asyncio.to_thread(store.events_since, job_id, cursor)
            for event in events:
                cursor = event.pop("id")
                await ws.send_text(json.dumps(event))
            if len(events) == 64:
                continue
            job = await asyncio.to_thread(store.get_job, job_id)
            if job is None or job["state"] in ("complete", "error", "cancelled"):
                return
            assigned_worker = job["worker_id"] if job["state"] == "running" else None
            if not await asyncio.to_thread(store.worker_alive, assigned_worker):
                await asyncio.to_thread(store.fail, job_id, "Analysis worker stopped. Please try again.")
            await asyncio.sleep(0.25)

    except WebSocketDisconnect:
        logger.info("Client disconnected during analysis")
    except QueueFullError as error:
        await ws.send_text(json.dumps({"type": "error", "error": str(error)}))
    except Exception as e:
        logger.exception("Analysis request failed")
        try:
            await ws.send_text(json.dumps({
                "type": "error",
                "error": str(e),
            }))
        except Exception:
            pass
    finally:
        if disconnect_task is not None:
            disconnect_task.cancel()
            await asyncio.gather(disconnect_task, return_exceptions=True)
        if job_id is not None:
            await asyncio.to_thread(store.cancel, job_id)
