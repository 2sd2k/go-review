import { useState } from 'react';
import GoBoard from './components/Board/GoBoard';
import GameNavigation from './components/Controls/GameNavigation';
import UploadPanel from './components/Controls/UploadPanel';
import MoveList from './components/Analysis/MoveList';
import WinRateGraph from './components/Analysis/WinRateGraph';
import ScoreBar from './components/Analysis/ScoreBar';
import MoveCommentary from './components/Analysis/MoveCommentary';
import { useGameStore } from './stores/gameStore';
import { useAnalysisStore } from './stores/analysisStore';
import { useAnalysis } from './hooks/useAnalysis';
import { useKeyboardNav } from './hooks/useKeyboardNav';
import type { Point, StoneColor } from './types/game';

function App() {
  useKeyboardNav();

  const { game, currentMoveIndex, playMove } = useGameStore();
  const { results, isAnalyzing, progress, totalMoves, error, clear: clearAnalysis } = useAnalysisStore();
  const { analyzeGame, stopAnalysis } = useAnalysis();
  const nextTurn: StoneColor = game?.nodes[currentMoveIndex]?.nextPlayer ?? 'B';

  const [showOwnership, setShowOwnership] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);

  const currentNode = game?.nodes[currentMoveIndex] ?? null;
  const boardState = currentNode?.boardState ?? Array.from({ length: 19 }, () => Array(19).fill(null));

  const currentAnalysis = results.get(currentMoveIndex);
  const prevAnalysis = currentMoveIndex > 0 ? results.get(currentMoveIndex - 1) : undefined;

  // Find the last move's point for the marker
  let lastMove: Point | null = null;
  if (currentNode?.move && currentNode.move.point !== 'pass') {
    lastMove = currentNode.move.point;
  }

  const handleIntersectionClick = (point: Point) => {
    clearAnalysis();
    playMove(point);
  };

  const hasAnalysis = results.size > 0;

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-2">
        <h1 className="text-2xl font-bold text-amber-400 text-center">
          Go Game Assistant
        </h1>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-row justify-center gap-6 px-2 pb-2 min-h-0">
        {/* Board section */}
        <div className="flex-shrink-0 flex items-center justify-center">
          <GoBoard
            boardState={boardState}
            size={game?.size ?? 19}
            lastMove={lastMove}
            nextTurn={nextTurn}
            ownership={currentAnalysis?.ownership}
            suggestedMoves={prevAnalysis?.top_moves}
            showOwnership={showOwnership}
            showSuggestions={showSuggestions}
            onIntersectionClick={handleIntersectionClick}
          />
        </div>

        {/* Right panel */}
        <div className="flex-shrink-0 flex flex-col gap-2 w-[220px] min-h-0 overflow-y-auto">
          {/* Upload */}
          <UploadPanel />

          {/* Analyze button */}
          {game && (
            <div>
              {isAnalyzing ? (
                <button
                  onClick={stopAnalysis}
                  className="w-full px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs rounded transition-colors"
                >
                  Stop Analysis ({progress}/{totalMoves})
                </button>
              ) : (
                <button
                  onClick={() => analyzeGame(game)}
                  className="w-full px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs rounded transition-colors"
                >
                  {hasAnalysis ? 'Re-analyze' : 'Analyze Game'}
                </button>
              )}
              {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
            </div>
          )}

          {/* Score bar */}
          {hasAnalysis && (
            <div className="bg-gray-800/50 rounded-lg p-2 border border-gray-700">
              <ScoreBar />
            </div>
          )}

          {/* Win rate graph */}
          {hasAnalysis && (
            <div className="bg-gray-800/50 rounded-lg p-2 border border-gray-700">
              <WinRateGraph />
            </div>
          )}

          {/* Overlay toggles */}
          {hasAnalysis && (
            <div className="flex gap-2">
              <button
                onClick={() => setShowOwnership(v => !v)}
                className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                  showOwnership ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                }`}
              >
                Territory
              </button>
              <button
                onClick={() => setShowSuggestions(v => !v)}
                className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                  showSuggestions ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                }`}
              >
                Best Moves
              </button>
            </div>
          )}

          {/* Move commentary */}
          {hasAnalysis && (
            <div className="bg-gray-800/50 rounded-lg p-2 border border-gray-700">
              <MoveCommentary />
            </div>
          )}

          {/* Game info */}
          <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
            <h2 className="text-sm font-semibold text-gray-200 mb-2">Game Info</h2>
            {game ? (
              <div className="space-y-1 text-xs text-gray-400">
                <p>Board size: {game.size}x{game.size}</p>
                <p>Total moves: {game.nodes.length - 1}</p>
                {game.metadata.blackPlayer && (
                  <p>Black: {game.metadata.blackPlayer} {game.metadata.blackRank ?? ''}</p>
                )}
                {game.metadata.whitePlayer && (
                  <p>White: {game.metadata.whitePlayer} {game.metadata.whiteRank ?? ''}</p>
                )}
                {game.metadata.result && <p>Result: {game.metadata.result}</p>}
                {currentNode && (
                  <div className="mt-2 pt-2 border-t border-gray-700">
                    <p>Captures — B: {currentNode.captures.black} W: {currentNode.captures.white}</p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-500">
                Click the board to place stones, or upload an SGF file.
              </p>
            )}
          </div>

          {/* Navigation controls */}
          <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
            <GameNavigation />
          </div>

          {/* Move list */}
          <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700 min-h-0 flex-1 overflow-hidden">
            <h2 className="text-sm font-semibold text-gray-200 mb-2">Moves</h2>
            <MoveList />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
