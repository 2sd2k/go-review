import type { MoveAnalysis, MoveQuality } from '../types/analysis';

export interface ReviewIssue {
  moveNumber: number;
  player: 'B' | 'W';
  quality: Exclude<MoveQuality, 'best' | 'good'>;
  analysis: MoveAnalysis;
}

const FLAGGED_QUALITIES: Array<ReviewIssue['quality']> = [
  'inaccuracy',
  'mistake',
  'blunder',
];

/** Return navigable review issues in main-line move order. */
export function findReviewIssues(results: Map<number, MoveAnalysis>): ReviewIssue[] {
  const issues: ReviewIssue[] = [];

  for (const analysis of results.values()) {
    if (
      analysis.move_number <= 0
      || !analysis.quality
      || !FLAGGED_QUALITIES.includes(analysis.quality as ReviewIssue['quality'])
    ) continue;

    const previous = results.get(analysis.move_number - 1);
    const player = previous?.current_player === 'W' ? 'W' : previous?.current_player === 'B' ? 'B' : null;
    if (!player) continue;

    issues.push({
      moveNumber: analysis.move_number,
      player,
      quality: analysis.quality as ReviewIssue['quality'],
      analysis,
    });
  }

  return issues.sort((a, b) => a.moveNumber - b.moveNumber);
}

export function nextReviewIssue(issues: ReviewIssue[], moveNumber: number): ReviewIssue | null {
  return issues.find((issue) => issue.moveNumber > moveNumber) ?? null;
}

export function previousReviewIssue(issues: ReviewIssue[], moveNumber: number): ReviewIssue | null {
  for (let index = issues.length - 1; index >= 0; index -= 1) {
    if (issues[index].moveNumber < moveNumber) return issues[index];
  }
  return null;
}
