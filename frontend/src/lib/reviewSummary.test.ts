import { describe, expect, it } from 'vitest';
import type { MoveAnalysis } from '../types/analysis';
import { buildReviewSummary } from './reviewSummary';

function analysis(
  moveNumber: number,
  currentPlayer: 'B' | 'W',
  quality?: MoveAnalysis['quality'],
  impactScore = 0,
  pointLoss = 0,
): MoveAnalysis {
  return {
    move_number: moveNumber,
    current_player: currentPlayer,
    win_rate: 0.5,
    score_lead: 0,
    top_moves: [],
    ownership: [],
    quality,
    impact_score: impactScore,
    point_loss: pointLoss,
  };
}

describe('review summary', () => {
  it('groups move quality and accuracy by the player who made the move', () => {
    const summary = buildReviewSummary(new Map([
      [0, analysis(0, 'B')],
      [1, analysis(1, 'W', 'best', 0)],
      [2, analysis(2, 'B', 'mistake', 0.1, 2)],
      [3, analysis(3, 'W', 'blunder', 0.3, 8)],
    ]));

    expect(summary.black.counts.best).toBe(1);
    expect(summary.black.counts.blunder).toBe(1);
    expect(summary.white.counts.mistake).toBe(1);
    expect(summary.black.accuracy).toBe(85);
    expect(summary.white.accuracy).toBe(90);
  });

  it('finds the largest turning point and handles an empty result set', () => {
    const summary = buildReviewSummary(new Map([
      [0, analysis(0, 'B')],
      [1, analysis(1, 'W', 'inaccuracy', 0.02)],
      [2, analysis(2, 'B', 'blunder', 0.5, 12)],
    ]));

    expect(summary.biggestTurningPoint).toMatchObject({
      moveNumber: 2,
      player: 'W',
      quality: 'blunder',
      pointLoss: 12,
    });
    expect(buildReviewSummary(new Map()).biggestTurningPoint).toBeNull();
    expect(buildReviewSummary(new Map([
      [0, analysis(0, 'B')],
      [1, analysis(1, 'W', 'best')],
    ])).biggestTurningPoint).toBeNull();
  });
});
