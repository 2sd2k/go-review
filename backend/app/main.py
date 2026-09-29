import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import analysis, upload, ogs, coach
from app.services.analysis_jobs import get_job_store
from app.services.katago import engine
from app.config import CORS_ORIGINS

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Full-game analysis runs in a separate worker, never in this API process.
    yield
    # A focused coach query may have started a separate, lazy engine here.
    await engine.stop()


app = FastAPI(title="Go Game Assistant API", lifespan=lifespan)

# CORS — allow frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
        "coach_katago": engine.is_running,
    }
