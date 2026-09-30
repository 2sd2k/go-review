import asyncio
import hmac
import os
import sqlite3
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from app.routers import analysis, upload, ogs, coach
from app.services.analysis_jobs import get_job_store
from app.services.auth import auth_configuration_ready
from app.services.observability import observe_http, request_metrics
from app.config import CORS_ORIGINS

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Both full-game and focused coach analysis run in separate workers.
    yield


app = FastAPI(title="Go Game Assistant API", lifespan=lifespan)
app.middleware("http")(observe_http)

# CORS — allow frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID", "Retry-After"],
)

app.include_router(analysis.router)
app.include_router(upload.router)
app.include_router(ogs.router)
app.include_router(coach.router)


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "analysis_worker": await asyncio.to_thread(get_job_store().worker_alive),
    }


@app.get("/api/health/live")
async def live():
    return {"status": "ok"}


@app.get("/api/health/ready")
async def ready():
    try:
        store = get_job_store()
        database = await asyncio.to_thread(store.ping)
        worker = await asyncio.to_thread(store.worker_alive)
    except (OSError, sqlite3.Error):
        database, worker = False, False
    auth_configured = auth_configuration_ready()
    if not (database and worker and auth_configured):
        raise HTTPException(503, {"database": database, "analysis_worker": worker,
                                  "auth_configured": auth_configured})
    return {"status": "ready", "database": True, "analysis_worker": True,
            "auth_configured": True}


@app.get("/api/metrics")
async def metrics(request: Request):
    expected = os.getenv("METRICS_TOKEN", "")
    supplied = request.headers.get("x-metrics-token", "")
    if not expected:
        raise HTTPException(404, "Metrics are disabled.")
    if not hmac.compare_digest(supplied.encode(), expected.encode()):
        raise HTTPException(403, "Metrics token required.")
    return {"requests": request_metrics.snapshot()}
