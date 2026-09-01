import { useAnalysisStore } from '../../stores/analysisStore';
import { useGameStore } from '../../stores/gameStore';
import { QUALITY_COLORS } from '../../lib/moveClassifier';
import type { MoveQuality } from '../../types/analysis';

export default function MoveCommentary() {
  const { results } = useAnalysisStore();
  const { game, currentMoveIndex } = useGameStore();

  const analysis = results.get(currentMoveIndex);
  if (!analysis || currentMoveIndex === 0 || !game) return null;

  const node = game.nodes[currentMoveIndex];
  if (!node?.move || node.move.point === 'pass') return null;

  const quality = analysis.quality;
  const loss = analysis.win_rate_loss;

  if (!quality || loss === undefined) return null;

  // Don't show commentary for good/best moves
  if (quality === 'best' || quality === 'good') {
    return (
      <div className="text-xs text-gray-500">
        Good move.
      </div>
    );
  }

  const bestMove = results.get(currentMoveIndex - 1)?.top_moves[0];
  const lossPercent = (loss * 100).toFixed(1);

  return (
    <div className="text-xs space-y-1">
      <div style={{ color: QUALITY_COLORS[quality as MoveQuality] }} className="font-semibold">
        {quality.charAt(0).toUpperCase() + quality.slice(1)}
        <span className="text-gray-400 font-normal ml-1">
          (-{lossPercent}%)
        </span>
      </div>
      {bestMove && (
        <div className="text-gray-400">
          Best: <span className="text-gray-200">{bestMove.move}</span>
          <span className="ml-1">
            ({(bestMove.win_rate * 100).toFixed(1)}% / {bestMove.score_lead > 0 ? '+' : ''}{bestMove.score_lead.toFixed(1)})
          </span>
        </div>
      )}
    </div>
  );
}
