import type { MoveAnalysis, MoveQuality } from '../types/analysis';

export interface PlayerReviewSummary {
  moves: number;
  accuracy: number | null;
  counts: Record<MoveQuality, number>;
}

export interface TurningPoint {
  moveNumber: number;
  player: 'B' | 'W';
  quality: MoveQuality;
  impactScore: number;
  pointLoss: number;
}

export interface ReviewSummary {
  black: PlayerReviewSummary;
  white: PlayerReviewSummary;
  biggestTurningPoint: TurningPoint | null;
}

const QUALITIES: MoveQuality[] = ['best', 'good', 'inaccuracy', 'mistake', 'blunder'];
const POINT_LOSS_TO_WIN_RATE_EQUIVALENT = 0.02;

function emptyCounts(): Record<MoveQuality, number> {
  return {
    best: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
  };
}

function moveImpact(analysis: MoveAnalysis): number {
  if (analysis.impact_score != null) return Math.max(0, Math.min(1, analysis.impact_score));
  const winRateLoss = Math.max(0, analysis.win_rate_loss ?? 0);
  const pointLoss = Math.max(0, analysis.point_loss ?? 0) * POINT_LOSS_TO_WIN_RATE_EQUIVALENT;
  return Math.max(winRateLoss, Math.min(1, pointLoss));
}

function playerForMove(results: Map<number, MoveAnalysis>, moveNumber: number): 'B' | 'W' | null {
  return results.get(moveNumber - 1)?.current_player === 'W' ? 'W' :
    results.has(moveNumber - 1) ? 'B' : null;
}

function summarizePlayer(
  analyses: Array<{ analysis: MoveAnalysis; moveNumber: number }>,
  results: Map<number, MoveAnalysis>,
  player: 'B' | 'W',
): PlayerReviewSummary {
  const playerMoves = analyses.filter(({ moveNumber }) => playerForMove(results, moveNumber) === player);
  const counts = emptyCounts();
  let totalImpact = 0;

  for (const { analysis } of playerMoves) {
    if (analysis.quality) counts[analysis.quality] += 1;
    totalImpact += moveImpact(analysis);
  }

  return {
    moves: playerMoves.length,
    accuracy: playerMoves.length > 0
      ? Math.round((1 - totalImpact / playerMoves.length) * 1000) / 10
      : null,
    counts,
  };
}

/** Aggregate the move classifications into the review screen's headline metrics. */
export function buildReviewSummary(results: Map<number, MoveAnalysis>): ReviewSummary {
  const analyses = [...results.values()]
    .filter((analysis) => analysis.move_number > 0)
    .map((analysis) => ({ analysis, moveNumber: analysis.move_number }))
    .sort((a, b) => a.moveNumber - b.moveNumber);
  let biggestTurningPoint: TurningPoint | null = null;
  for (const { analysis, moveNumber } of analyses) {
    const player = playerForMove(results, moveNumber);
    if (
      !player
      || !analysis.quality
      || analysis.quality === 'best'
      || analysis.quality === 'good'
    ) continue;
    const impactScore = moveImpact(analysis);
    if (!biggestTurningPoint || impactScore > biggestTurningPoint.impactScore) {
      biggestTurningPoint = {
        moveNumber,
        player,
        quality: analysis.quality,
        impactScore,
        pointLoss: Math.max(0, analysis.point_loss ?? 0),
      };
    }
  }

  return {
    black: summarizePlayer(analyses, results, 'B'),
    white: summarizePlayer(analyses, results, 'W'),
    biggestTurningPoint,
  };
}

export { QUALITIES };
