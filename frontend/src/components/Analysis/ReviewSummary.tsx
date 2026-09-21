import { useMemo } from 'react';
import { useAnalysisStore } from '../../stores/analysisStore';
import { useGameStore } from '../../stores/gameStore';
import { buildReviewSummary, type PlayerReviewSummary } from '../../lib/reviewSummary';
import { QUALITY_COLORS } from '../../lib/moveClassifier';
import type { MoveQuality } from '../../types/analysis';

function PlayerCard({ color, summary }: { color: 'B' | 'W'; summary: PlayerReviewSummary }) {
  const label = color === 'B' ? 'Black' : 'White';
  const visibleQualities: MoveQuality[] = ['best', 'good', 'inaccuracy', 'mistake', 'blunder'];

  return (
    <div className="rounded bg-gray-900/50 p-2">
      <div className="flex items-baseline justify-between">
        <span className="text-gray-300">{label}</span>
        <span className="text-lg font-semibold text-gray-100">
          {summary.accuracy == null ? '—' : `${summary.accuracy.toFixed(1)}%`}
        </span>
      </div>
      <div className="text-[11px] text-gray-500 mb-1">Accuracy · {summary.moves} analyzed moves</div>
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px]">
        {visibleQualities.map((quality) => (
          <span key={quality} style={{ color: QUALITY_COLORS[quality] }}>
            {summary.counts[quality]} {quality}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function ReviewSummary() {
  const results = useAnalysisStore((state) => state.results);
  const goToTrunkMove = useGameStore((state) => state.goToTrunkMove);
  const summary = useMemo(() => buildReviewSummary(results), [results]);

  if (results.size === 0) return null;

  const turningPoint = summary.biggestTurningPoint;
  return (
    <section className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
      <h2 className="text-sm font-semibold text-gray-200 mb-2">Review summary</h2>
      <div className="grid grid-cols-2 gap-2">
        <PlayerCard color="B" summary={summary.black} />
        <PlayerCard color="W" summary={summary.white} />
      </div>
      {turningPoint && (
        <button
          type="button"
          onClick={() => goToTrunkMove(turningPoint.moveNumber)}
          className="mt-2 w-full rounded bg-gray-900/70 px-2 py-1.5 text-left text-xs text-gray-300 hover:bg-gray-900"
        >
          Biggest turning point: <span style={{ color: QUALITY_COLORS[turningPoint.quality] }}>
            {turningPoint.quality}
          </span>{' '}
          on move {turningPoint.moveNumber} ({turningPoint.player === 'B' ? 'Black' : 'White'})
          {turningPoint.pointLoss > 0 && ` · ${turningPoint.pointLoss.toFixed(1)} points`}
        </button>
      )}
    </section>
  );
}
