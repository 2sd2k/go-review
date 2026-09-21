import { describe, expect, it } from 'vitest';
import type { MoveAnalysis } from '../types/analysis';
import { findReviewIssues, nextReviewIssue, previousReviewIssue } from './reviewIssues';

function analysis(moveNumber: number, currentPlayer: 'B' | 'W', quality?: MoveAnalysis['quality']): MoveAnalysis {
  return {
    move_number: moveNumber,
    current_player: currentPlayer,
    win_rate: 0.5,
    score_lead: 0,
    top_moves: [],
    ownership: [],
    quality,
  };
}

describe('review issue navigation', () => {
  const results = new Map([
    [0, analysis(0, 'B')],
    [1, analysis(1, 'W', 'good')],
    [2, analysis(2, 'B', 'mistake')],
    [3, analysis(3, 'W', 'best')],
    [4, analysis(4, 'B', 'blunder')],
  ]);

  it('finds only flagged moves and attributes them to the mover', () => {
    const issues = findReviewIssues(results);

    expect(issues.map((issue) => [issue.moveNumber, issue.player, issue.quality])).toEqual([
      [2, 'W', 'mistake'],
      [4, 'W', 'blunder'],
    ]);
  });

  it('moves forward and backward without wrapping around', () => {
    const issues = findReviewIssues(results);

    expect(nextReviewIssue(issues, 0)?.moveNumber).toBe(2);
    expect(nextReviewIssue(issues, 2)?.moveNumber).toBe(4);
    expect(nextReviewIssue(issues, 4)).toBeNull();
    expect(previousReviewIssue(issues, 4)?.moveNumber).toBe(2);
    expect(previousReviewIssue(issues, 2)).toBeNull();
  });
});
