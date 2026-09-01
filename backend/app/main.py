import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import analysis, upload
from app.services.katago import engine
from app.config import CORS_ORIGINS

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: try to start KataGo (non-fatal if it fails)
    try:
        await engine.start()
        logger.info("KataGo engine started")
    except Exception as e:
        logger.warning(f"KataGo not available: {e}")
        logger.warning("Analysis features will be unavailable until KataGo is configured")

    yield

    # Shutdown
    await engine.stop()
    logger.info("KataGo engine stopped")


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


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "katago": engine.is_running,
    }
