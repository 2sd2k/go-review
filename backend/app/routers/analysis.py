import asyncio
import json
import logging
import re

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from app.models.schemas import AnalysisRequest
from app.services.analysis_jobs import QueueFullError, get_job_store
from app.config import CORS_ORIGINS

logger = logging.getLogger(__name__)
router = APIRouter()


@router.delete("/api/analysis/jobs/{job_id}", status_code=204)
async def cancel_analysis(job_id: str):
    store = get_job_store()
    job = await asyncio.to_thread(store.get_job, job_id)
    if job is None or job["kind"] != "game":
        raise HTTPException(status_code=404, detail="Analysis job not found")
    await asyncio.to_thread(store.cancel, job_id)


@router.websocket("/ws/analyze")
async def analyze_game(ws: WebSocket):
    origin = ws.headers.get("origin")
    if origin and origin not in CORS_ORIGINS:
        logger.warning("Rejected analysis WebSocket origin %r", origin)
        await ws.close(code=1008, reason="Origin not allowed")
        return

    await ws.accept()
    job_id = None
    acknowledged = False
    created_new_job = False
    server_generated_id = False
    disconnect_task = None
    store = get_job_store()

    try:
        raw = await ws.receive_text()
        message = json.loads(raw)
        if message.get("action") == "resume":
            job_id = message.get("job_id")
            if not isinstance(job_id, str) or not re.fullmatch(r"[0-9a-f]{32}", job_id):
                job_id = None
                await ws.send_text(json.dumps({
                    "type": "error", "error": "Analysis job expired or was not found.",
                }))
                return
            job = await asyncio.to_thread(store.get_job, job_id)
            if job is None or job["kind"] != "game":
                await ws.send_text(json.dumps({
                    "type": "error", "error": "Analysis job expired or was not found.",
                }))
                return
        else:
            request = AnalysisRequest.model_validate(message)
            requested_id = message.get("job_id")
            if requested_id is not None and (
                not isinstance(requested_id, str) or not re.fullmatch(r"[0-9a-f]{32}", requested_id)
            ):
                await ws.send_text(json.dumps({"type": "error", "error": "Invalid analysis job ID."}))
                return
            existing = await asyncio.to_thread(store.get_job, requested_id) if requested_id else None
            if existing is None and not await asyncio.to_thread(store.worker_alive):
                await ws.send_text(json.dumps({
                    "type": "error",
                    "error": "Analysis worker is offline. Start it with python -m app.worker.",
                }))
                return
            job_id = await asyncio.to_thread(store.enqueue, request, requested_id)
            created_new_job = existing is None
            server_generated_id = requested_id is None
            job = await asyncio.to_thread(store.get_job, job_id)
        disconnect_task = asyncio.create_task(ws.receive())
        await ws.send_text(json.dumps({
            "type": "progress",
            "move_number": min(max(job["completed_count"] - 1, 0), job["total_moves"]),
            "total_moves": job["total_moves"],
            "job_id": job_id,
        }))
        acknowledged = True
        cursor = 0
        while True:
            if disconnect_task.done():
                event = disconnect_task.result()
                if event.get("type") == "websocket.receive":
                    try:
                        command = json.loads(event.get("text", ""))
                    except (TypeError, ValueError):
                        command = {}
                    if command.get("action") == "cancel" and command.get("job_id") == job_id:
                        await asyncio.to_thread(store.cancel, job_id)
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
        # Only abandon a new job when its identifier never reached the client.
        # A normal disconnect leaves acknowledged work available for replay.
        if job_id is not None and created_new_job and server_generated_id and not acknowledged:
            await asyncio.to_thread(store.cancel, job_id)
