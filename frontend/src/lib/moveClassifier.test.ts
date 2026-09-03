import { describe, expect, it } from 'vitest';
import { classifyMove } from './moveClassifier';
import type { MoveAnalysis, SuggestedMove } from '../types/analysis';

function analysis(
  currentPlayer: 'B' | 'W',
  winRate: number,
  bestMoveWinRate?: number,
  scoreLead = 0,
  bestMoveScoreLead = scoreLead,
): MoveAnalysis {
  const topMoves: SuggestedMove[] = bestMoveWinRate === undefined ? [] : [{
    move: 'D4',
    win_rate: bestMoveWinRate,
    score_lead: bestMoveScoreLead,
    visits: 100,
    pv: [],
  }];
  return {
    move_number: 0,
    current_player: currentPlayer,
    win_rate: winRate,
    score_lead: scoreLead,
    top_moves: topMoves,
    ownership: [],
  };
}

describe('move classification', () => {
  it.each([
    [0.005, 'best'],
    [0.02, 'good'],
    [0.05, 'inaccuracy'],
    [0.1, 'mistake'],
    [0.15, 'blunder'],
  ] as const)('classifies a Black loss of %f as %s', (loss, quality) => {
    const previous = analysis('B', 0.6, 0.6);
    const current = analysis('W', 0.6 - loss);
    expect(classifyMove(previous, current).quality).toBe(quality);
  });

  it('calculates loss from White’s perspective', () => {
    const previous = analysis('W', 0.4, 0.35);
    const current = analysis('B', 0.5);
    const result = classifyMove(previous, current);
    expect(result.winRateLoss).toBeCloseTo(0.15);
    expect(result.quality).toBe('blunder');
  });

  it('uses point loss when win rate is saturated in a handicap-style position', () => {
    const previous = analysis('B', 0.99, 0.99, 18, 20);
    const current = analysis('W', 0.985, undefined, 14);
    const result = classifyMove(previous, current);

    expect(result.winRateLoss).toBeCloseTo(0.005);
    expect(result.pointLoss).toBeCloseTo(6);
    expect(result.impactScore).toBeGreaterThan(0.08);
    expect(result.quality).toBe('mistake');
  });

  it('calculates White point loss in White’s perspective', () => {
    const previous = analysis('W', 0.01, 0.01, -18, -20);
    const current = analysis('B', 0.015, undefined, -14);
    const result = classifyMove(previous, current);

    expect(result.winRateLoss).toBeCloseTo(0.005);
    expect(result.pointLoss).toBeCloseTo(6);
    expect(result.quality).toBe('mistake');
  });

  it('does not over-penalize a small point loss in a balanced position', () => {
    const previous = analysis('B', 0.5, 0.5, 0, 1);
    const current = analysis('W', 0.5, undefined, 0);
    const result = classifyMove(previous, current);

    expect(result.pointLoss).toBe(1);
    expect(result.impactScore).toBeCloseTo(0.005);
    expect(result.quality).toBe('best');
  });

  it('clamps apparent improvements to zero loss', () => {
    const previous = analysis('B', 0.5, 0.5, 0, 0);
    const current = analysis('W', 0.55, undefined, 2);
    const result = classifyMove(previous, current);

    expect(result.winRateLoss).toBe(0);
    expect(result.pointLoss).toBe(0);
    expect(result.impactScore).toBe(0);
  });

  it('prefers a direct played-move comparison over the next root estimate', () => {
    const previous = analysis('B', 0.99, 0.99, 20, 20);
    const current = analysis('W', 0.999, undefined, 25);
    current.best_move = {
      move: 'Q16', win_rate: 0.99, score_lead: 20, visits: 100, pv: ['Q16', 'D4'],
    };
    current.played_move = {
      move: 'D4', win_rate: 0.91, score_lead: 15, visits: 100, pv: ['D4', 'Q3'],
    };
    current.win_rate_loss = 0.08;
    current.point_loss = 5;

    const result = classifyMove(previous, current);

    expect(result.winRateLoss).toBe(0.08);
    expect(result.pointLoss).toBe(5);
    expect(result.quality).toBe('mistake');
  });

  it('falls back to the root evaluation when no candidate move exists', () => {
    const result = classifyMove(analysis('B', 0.6), analysis('W', 0.58));
    expect(result.winRateLoss).toBeCloseTo(0.02);
    expect(result.quality).toBe('good');
  });

  it('handles a missing previous position', () => {
    expect(classifyMove(undefined, analysis('B', 0.5))).toEqual({
      quality: 'good',
      winRateLoss: 0,
      pointLoss: 0,
      impactScore: 0,
    });
  });
});
