import { beforeEach, describe, expect, it } from 'vitest';
import { useAnalysisStore } from './analysisStore';
import type { MoveAnalysis } from '../types/analysis';

function position(moveNumber: number, winRate: number): MoveAnalysis {
  return {
    move_number: moveNumber,
    current_player: moveNumber % 2 === 0 ? 'B' : 'W',
    win_rate: winRate,
    score_lead: 0,
    top_moves: [],
    ownership: [],
  };
}

describe('analysis result ordering', () => {
  beforeEach(() => useAnalysisStore.getState().clear());

  it('classifies a successor when its predecessor arrives later', () => {
    const addResult = useAnalysisStore.getState().addResult;
    const current = position(2, 0.4);
    current.win_rate_loss = 0.15;
    current.point_loss = 2;
    current.best_move = { move: 'Q16', win_rate: 0.55, score_lead: 2, visits: 100, pv: [] };
    current.played_move = { move: 'D4', win_rate: 0.4, score_lead: 0, visits: 100, pv: [] };

    addResult(current);
    expect(useAnalysisStore.getState().getAnalysis(2)?.quality).toBeUndefined();

    addResult(position(1, 0.5));
    expect(useAnalysisStore.getState().getAnalysis(2)?.quality).toBe('blunder');
    expect(useAnalysisStore.getState().getAnalysis(2)?.win_rate_loss).toBe(0.15);
  });

  it('recomputes a fallback loss when a predecessor is replayed', () => {
    const addResult = useAnalysisStore.getState().addResult;
    addResult(position(0, 0.5));
    addResult(position(1, 0.5));
    expect(useAnalysisStore.getState().getAnalysis(1)?.win_rate_loss).toBe(0);

    addResult(position(0, 0.7));
    expect(useAnalysisStore.getState().getAnalysis(1)?.win_rate_loss).toBeCloseTo(0.2);
    expect(useAnalysisStore.getState().getAnalysis(1)?.quality).toBe('blunder');
  });
});
