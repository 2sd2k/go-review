import { useMemo, useState } from 'react';
import { useAnalysisStore } from '../../stores/analysisStore';
import { useGameStore } from '../../stores/gameStore';
import { displayToPoint } from '../../lib/coordinates';

interface PlaybackState {
  startNodeId: number;
  moves: string[];
}

export default function VariationPlayback() {
  const results = useAnalysisStore((state) => state.results);
  const {
    game,
    currentNodeId,
    playMove,
    goToNode,
  } = useGameStore();
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [cursor, setCursor] = useState(0);

  const currentNode = game?.nodes[currentNodeId];
  const currentAnalysis = currentNode?.trunk ? results.get(currentNode.moveNumber) : undefined;
  const candidate = currentAnalysis?.top_moves[0];
  const startPv = useMemo(() => candidate?.pv ?? [], [candidate]);
  const activeMoves = playback?.moves ?? [];
  const nextMove = activeMoves[cursor];
  const canStart = Boolean(game && currentNode?.trunk && startPv.length > 0);

  if (results.size === 0 || !game) return null;

  const startPlayback = () => {
    if (!canStart || !currentNode) return;
    setPlayback({ startNodeId: currentNode.id, moves: startPv });
    setCursor(0);
  };

  const playNext = () => {
    if (!nextMove) return;
    const point = nextMove === 'pass' ? 'pass' : displayToPoint(nextMove, game.size);
    if (!point) return;
    if (playMove(point)) setCursor((index) => index + 1);
  };

  const resetPlayback = () => {
    if (playback) goToNode(playback.startNodeId);
    setPlayback(null);
    setCursor(0);
  };

  return (
    <section className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="text-sm font-semibold text-gray-200">KataGo variation</h2>
        {playback && (
          <span className="text-[11px] text-gray-500">{Math.min(cursor, activeMoves.length)} of {activeMoves.length}</span>
        )}
      </div>

      {!playback ? (
        <>
          <p className="text-xs text-gray-500 mb-2">
            Play KataGo&apos;s top line as a new variation. Your original game stays unchanged.
          </p>
          <button
            type="button"
            disabled={!canStart}
            onClick={startPlayback}
            className="w-full rounded bg-gray-700 px-2 py-1.5 text-xs text-gray-200 hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Start PV{candidate?.move ? ` · ${candidate.move}` : ''}
          </button>
        </>
      ) : (
        <>
          <p className="text-xs text-gray-400 mb-2 truncate" title={activeMoves.join(' → ')}>
            {nextMove ? `Next: ${nextMove}` : 'PV complete'}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!nextMove}
              onClick={playNext}
              className="flex-1 rounded bg-amber-600 px-2 py-1.5 text-xs text-white hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {nextMove ? 'Play next' : 'Complete'}
            </button>
            <button
              type="button"
              onClick={resetPlayback}
              className="rounded bg-gray-700 px-2 py-1.5 text-xs text-gray-200 hover:bg-gray-600"
            >
              Reset
            </button>
          </div>
        </>
      )}
    </section>
  );
}
