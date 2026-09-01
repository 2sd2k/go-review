import { useAnalysisStore } from '../../stores/analysisStore';
import { useGameStore } from '../../stores/gameStore';

export default function ScoreBar() {
  const { results } = useAnalysisStore();
  const { currentMoveIndex } = useGameStore();

  const analysis = results.get(currentMoveIndex);
  if (!analysis) return null;

  const blackPct = Math.max(5, Math.min(95, analysis.win_rate * 100));
  const score = analysis.score_lead;
  const scoreStr = score > 0 ? `B+${score.toFixed(1)}` : `W+${Math.abs(score).toFixed(1)}`;

  return (
    <div className="w-full">
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>Black {(analysis.win_rate * 100).toFixed(1)}%</span>
        <span>{scoreStr}</span>
        <span>White {((1 - analysis.win_rate) * 100).toFixed(1)}%</span>
      </div>
      <div className="h-3 rounded-full overflow-hidden flex bg-white">
        <div
          className="bg-gray-900 transition-all duration-300"
          style={{ width: `${blackPct}%` }}
        />
      </div>
    </div>
  );
}
