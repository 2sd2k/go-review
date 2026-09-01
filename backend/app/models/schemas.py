from __future__ import annotations

from typing import Annotated, List, Literal, Optional

from pydantic import BaseModel, Field

MoveTuple = tuple[Literal["B", "W"], str]


class AnalysisRequest(BaseModel):
    """Request to analyze a full game."""
    moves: Annotated[List[MoveTuple], Field(max_length=1000)]
    initial_stones: Annotated[List[MoveTuple], Field(max_length=625)] = Field(default_factory=list)
    rules: str = "chinese"
    komi: Annotated[float, Field(ge=-150, le=150)] = 7.5
    board_size: Annotated[int, Field(ge=2, le=25)] = 19
    max_visits: Annotated[int, Field(ge=1, le=100_000)] = 100


class SuggestedMove(BaseModel):
    """A candidate move from KataGo."""
    move: str  # e.g. "Q16" or "pass"
    win_rate: float
    score_lead: float
    visits: int
    pv: List[str]  # principal variation


class MoveAnalysis(BaseModel):
    """Analysis result for a single move/position."""
    move_number: int
    current_player: str  # "B" or "W"
    win_rate: float  # from black's perspective, 0-1
    score_lead: float  # positive = black leads
    top_moves: List[SuggestedMove]
    ownership: List[float]  # 361 values for 19x19, -1 (white) to 1 (black)


class AnalysisProgress(BaseModel):
    """Progress update sent over WebSocket."""
    type: str  # "progress", "result", "complete", "error"
    move_number: Optional[int] = None
    total_moves: Optional[int] = None
    analysis: Optional[MoveAnalysis] = None
    error: Optional[str] = None
