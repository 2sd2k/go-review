import { useMemo } from 'react';
import { useAnalysisStore } from '../../stores/analysisStore';
import { useGameStore } from '../../stores/gameStore';
import { findReviewIssues, nextReviewIssue, previousReviewIssue } from '../../lib/reviewIssues';
import { QUALITY_COLORS } from '../../lib/moveClassifier';

function MoveComparison({ label, move, muted = false }: {
  label: string;
  move: { move: string; visits: number; pv: string[] } | undefined;
  muted?: boolean;
}) {
  if (!move) return <span className="text-gray-500">Unavailable</span>;
  return (
    <div className={muted ? 'text-gray-400' : 'text-gray-200'}>
      <span className="text-gray-500">{label}: </span>
      <span className="font-medium">{move.move}</span>
      <span className="text-[11px] text-gray-500 ml-1">({move.visits} visits)</span>
      {move.pv.length > 1 && (
        <div className="text-[11px] text-gray-500 truncate" title={move.pv.join(' → ')}>
          {move.pv.slice(0, 5).join(' → ')}
        </div>
      )}
    </div>
  );
}

export default function FlaggedMoments() {
  const results = useAnalysisStore((state) => state.results);
  const { game, currentNodeId, goToTrunkMove } = useGameStore();
  const issues = useMemo(() => findReviewIssues(results), [results]);

  if (results.size === 0) return null;

  const currentNode = game?.nodes[currentNodeId];
  const currentMove = currentNode?.trunk ? currentNode.moveNumber : 0;
  const currentIssueIndex = issues.findIndex((issue) => issue.moveNumber === currentMove);
  const selectedIssue = currentIssueIndex >= 0
    ? issues[currentIssueIndex]
    : issues.find((issue) => issue.moveNumber > currentMove) ?? issues[issues.length - 1];
  const selectedIndex = selectedIssue ? issues.indexOf(selectedIssue) : -1;
  const previous = selectedIssue ? previousReviewIssue(issues, selectedIssue.moveNumber) : null;
  const next = selectedIssue ? nextReviewIssue(issues, selectedIssue.moveNumber) : null;

  return (
    <section className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="text-sm font-semibold text-gray-200">Flagged moments</h2>
        {issues.length > 0 && (
          <span className="text-[11px] text-gray-500">{selectedIndex + 1} of {issues.length}</span>
        )}
      </div>

      {selectedIssue ? (
        <>
          <div className="flex items-center justify-between text-xs mb-2">
            <button
              type="button"
              disabled={!previous}
              onClick={() => previous && goToTrunkMove(previous.moveNumber)}
              className="rounded bg-gray-700 px-2 py-1 text-gray-200 hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ← Previous
            </button>
            <button
              type="button"
              disabled={!next}
              onClick={() => next && goToTrunkMove(next.moveNumber)}
              className="rounded bg-gray-700 px-2 py-1 text-gray-200 hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next →
            </button>
          </div>
          <button
            type="button"
            onClick={() => goToTrunkMove(selectedIssue.moveNumber)}
            className="w-full rounded bg-gray-900/70 p-2 text-left hover:bg-gray-900"
          >
            <div style={{ color: QUALITY_COLORS[selectedIssue.quality] }} className="font-semibold text-xs">
              Move {selectedIssue.moveNumber} · {selectedIssue.player === 'B' ? 'Black' : 'White'} {selectedIssue.quality}
            </div>
            <div className="grid grid-cols-2 gap-2 mt-1 text-xs">
              <MoveComparison label="Played" move={selectedIssue.analysis.played_move} muted />
              <MoveComparison label="Best" move={selectedIssue.analysis.best_move} />
            </div>
          </button>
        </>
      ) : (
        <p className="text-xs text-gray-500">No mistakes or blunders were found.</p>
      )}
    </section>
  );
}
