import type { MoveAnalysis, MoveQuality } from '../types/analysis';

/**
 * Classify a move's quality based on win rate loss compared to the previous position.
 * Win rates are from black's perspective (0-1).
 */
export function classifyMove(
  prevAnalysis: MoveAnalysis | undefined,
  currentAnalysis: MoveAnalysis
): { quality: MoveQuality; winRateLoss: number } {
  if (!prevAnalysis) {
    return { quality: 'good', winRateLoss: 0 };
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
  const bestMoveWinRate = prevAnalysis.top_moves.length > 0
    ? (playerWhoMoved === 'W' ? 1 - prevAnalysis.top_moves[0].win_rate : prevAnalysis.top_moves[0].win_rate)
    : winRateBefore;

  // Loss = how much worse the played move is compared to the best
  const winRateLoss = Math.max(0, bestMoveWinRate - winRateAfter);

  let quality: MoveQuality;
  if (winRateLoss < 0.01) {
    quality = 'best';
  } else if (winRateLoss < 0.03) {
    quality = 'good';
  } else if (winRateLoss < 0.06) {
    quality = 'inaccuracy';
  } else if (winRateLoss < 0.12) {
    quality = 'mistake';
  } else {
    quality = 'blunder';
  }

  return { quality, winRateLoss };
}

export const QUALITY_COLORS: Record<MoveQuality, string> = {
  best: '#22c55e',     // green
  good: '#86efac',     // light green
  inaccuracy: '#facc15', // yellow
  mistake: '#f97316',   // orange
  blunder: '#ef4444',   // red
};
