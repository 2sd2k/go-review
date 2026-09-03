import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.models.schemas import AnalysisRequest
from app.services.katago import engine
from app.config import CORS_ORIGINS

logger = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/ws/analyze")
async def analyze_game(ws: WebSocket):
    origin = ws.headers.get("origin")
    if origin and origin not in CORS_ORIGINS:
        await ws.close(code=1008, reason="Origin not allowed")
        return

    await ws.accept()

    try:
        # Receive game data from client
        raw = await ws.receive_text()
        request = AnalysisRequest.model_validate_json(raw)

        total_moves = len(request.moves)
        await ws.send_text(json.dumps({
            "type": "progress",
            "move_number": 0,
            "total_moves": total_moves,
        }))

        # Stream analysis results as they complete
        analyzed = 0
        async for analysis in engine.analyze_game(
            moves=request.moves,
            initial_stones=request.initial_stones,
            rules=request.rules,
            komi=request.komi,
            board_size=request.board_size,
            max_visits=request.max_visits,
        ):
            analyzed += 1
            await ws.send_text(json.dumps({
                "type": "result",
                "move_number": analysis.move_number,
                "total_moves": total_moves,
                "analysis": analysis.model_dump(exclude_none=True),
            }))

        # Signal completion
        await ws.send_text(json.dumps({
            "type": "complete",
            "total_moves": total_moves,
        }))

    except WebSocketDisconnect:
        logger.info("Client disconnected during analysis")
    except Exception as e:
        logger.error(f"Analysis error: {e}")
        try:
            await ws.send_text(json.dumps({
                "type": "error",
                "error": str(e),
            }))
        except Exception:
            pass
