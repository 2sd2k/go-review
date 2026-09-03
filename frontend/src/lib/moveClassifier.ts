import type { MoveAnalysis, MoveQuality } from '../types/analysis';

const POINT_LOSS_TO_WIN_RATE_EQUIVALENT = 0.02;

export interface MoveClassification {
  quality: MoveQuality;
  winRateLoss: number;
  pointLoss: number;
  impactScore: number;
}

function fromPlayerPerspective(value: number, player: string): number {
  return player === 'W' ? -value : value;
}

function classifyImpact(impact: number): MoveQuality {
  if (impact < 0.01) return 'best';
  if (impact < 0.03) return 'good';
  if (impact < 0.06) return 'inaccuracy';
  if (impact < 0.12) return 'mistake';
  return 'blunder';
}

/**
 * Classify a move using KataGo's direct comparison when available, with a
 * root-position fallback for older analysis results. Engine values use Black's
 * perspective; returned losses always use the mover's perspective.
 */
export function classifyMove(
  prevAnalysis: MoveAnalysis | undefined,
  currentAnalysis: MoveAnalysis
): MoveClassification {
  if (!prevAnalysis) {
    return { quality: 'good', winRateLoss: 0, pointLoss: 0, impactScore: 0 };
  }

  // The move was played by the player whose turn it was at the previous position
  const playerWhoMoved = prevAnalysis.current_player;

  // Calculate win rate change from the perspective of the player who moved
  // prevAnalysis.win_rate = position before the move (from black's perspective)
  // currentAnalysis.win_rate = position after the move (from black's perspective)
  let winRateBefore = prevAnalysis.win_rate;
  let winRateAfter = currentAnalysis.win_rate;

  // If white moved, flip perspective so loss is always positive for a bad move
  if (playerWhoMoved === 'W') {
    winRateBefore = 1 - winRateBefore;
    winRateAfter = 1 - winRateAfter;
  }

  // Best possible win rate = what the top move would have given
  const bestMove = currentAnalysis.best_move ?? prevAnalysis.top_moves[0];
  const bestMoveWinRate = bestMove
    ? (playerWhoMoved === 'W' ? 1 - bestMove.win_rate : bestMove.win_rate)
    : winRateBefore;

  // Loss in winning chances compared with KataGo's best candidate.
  const winRateLoss = currentAnalysis.win_rate_loss
    ?? Math.max(0, bestMoveWinRate - winRateAfter);

  // Score values are always stored from Black's perspective. Flip them for
  // White so a positive pointLoss consistently means the mover lost points.
  const bestScoreLead = bestMove?.score_lead ?? prevAnalysis.score_lead;
  const bestScoreForPlayer = fromPlayerPerspective(bestScoreLead, playerWhoMoved);
  const actualScoreForPlayer = fromPlayerPerspective(currentAnalysis.score_lead, playerWhoMoved);
  const pointLoss = currentAnalysis.point_loss
    ?? Math.max(0, bestScoreForPlayer - actualScoreForPlayer);

  // Win rate stops being informative near 0% and 100%. Convert point loss to
  // a comparable scale and increase its influence as the position saturates.
  // Win-rate loss is retained as a floor so point estimates never dilute an
  // otherwise obvious tactical swing.
  const saturation = Math.min(1, Math.abs(winRateBefore - 0.5) * 2);
  const scoreWeight = 0.25 + saturation * 0.5;
  const pointLossEquivalent = Math.min(1, pointLoss * POINT_LOSS_TO_WIN_RATE_EQUIVALENT);
  const blendedImpact = winRateLoss * (1 - scoreWeight) + pointLossEquivalent * scoreWeight;
  const impactScore = Math.max(winRateLoss, blendedImpact);

  return {
    quality: classifyImpact(impactScore),
    winRateLoss,
    pointLoss,
    impactScore,
  };
}

export const QUALITY_COLORS: Record<MoveQuality, string> = {
  best: '#22c55e',     // green
  good: '#86efac',     // light green
  inaccuracy: '#facc15', // yellow
  mistake: '#f97316',   // orange
  blunder: '#ef4444',   // red
};
