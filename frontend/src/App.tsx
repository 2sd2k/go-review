import { useState } from 'react';
import GoBoard from './components/Board/GoBoard';
import GameNavigation from './components/Controls/GameNavigation';
import UploadPanel from './components/Controls/UploadPanel';
import ReviewLibrary from './components/Controls/ReviewLibrary';
import MarkupToolbar from './components/Controls/MarkupToolbar';
import MoveTreeView from './components/Analysis/MoveTreeView';
import WinRateGraph from './components/Analysis/WinRateGraph';
import ScoreBar from './components/Analysis/ScoreBar';
import MoveCommentary from './components/Analysis/MoveCommentary';
import ReviewSummary from './components/Analysis/ReviewSummary';
import FlaggedMoments from './components/Analysis/FlaggedMoments';
import VariationPlayback from './components/Analysis/VariationPlayback';
import CoachPanel from './components/Analysis/CoachPanel';
import AnalysisSettingsPanel from './components/Controls/AnalysisSettingsPanel';
import { useGameStore } from './stores/gameStore';
import { useAnalysisStore } from './stores/analysisStore';
import { useAnalysis } from './hooks/useAnalysis';
import { useKeyboardNav } from './hooks/useKeyboardNav';
import type { Point, StoneColor } from './types/game';
import { createEmptyGame } from './types/game';
import { DEFAULT_ANALYSIS_SETTINGS, type AnalysisSettings } from './types/analysis';
import { normalizeRules } from './lib/gobanRules';
import { trunkLine } from './lib/moveTree';

function App() {
  useKeyboardNav();

  const { game, currentNodeId, playMove, editTool, toggleBoardMark, loadGame } = useGameStore();
  const gameSessionId = useGameStore((state) => state.gameSessionId);
  const { results, isAnalyzing, progress, totalMoves, error } = useAnalysisStore();
  const clearAnalysis = useAnalysisStore((state) => state.clear);
  const { analyzeGame, stopAnalysis } = useAnalysis();
  const currentNode = game?.nodes[currentNodeId] ?? null;
  const nextTurn: StoneColor = currentNode?.nextPlayer ?? 'B';

  const [showOwnership, setShowOwnership] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [settings, setSettings] = useState<AnalysisSettings>(DEFAULT_ANALYSIS_SETTINGS);

  const boardState = currentNode?.boardState ?? Array.from({ length: 19 }, () => Array(19).fill(null));

  const currentAnalysis = currentNode?.trunk ? results.get(currentNode.moveNumber) : undefined;
  const prevAnalysis = currentNode?.trunk && currentNode.moveNumber > 0
    ? results.get(currentNode.moveNumber - 1)
    : undefined;

  let lastMove: Point | null = null;
  if (currentNode?.move && currentNode.move.point !== 'pass') {
    lastMove = currentNode.move.point;
  }

  const handleIntersectionClick = (point: Point) => {
    if (editTool === 'play') playMove(point);
    else toggleBoardMark(point);
  };

  const hasAnalysis = results.size > 0;
  const trunkMoves = game ? Math.max(0, trunkLine(game).length - 1) : 0;

  const updateSettings = (next: AnalysisSettings) => {
    stopAnalysis();
    setSettings(next);
    if (results.size > 0) clearAnalysis();
  };

  return (
    <div className="min-h-screen md:h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-2">
        <h1 className="text-2xl font-bold text-amber-400 text-center">
          Go Game Assistant
        </h1>
      </div>

      {/* Main content */}
      <main className="flex-1 min-h-0 min-w-0 flex flex-col md:flex-row justify-center gap-4 lg:gap-6 px-2 pb-2 overflow-y-auto md:overflow-hidden">
        {/* Board section */}
        <div className="flex-none md:flex-1 min-w-0 min-h-0 flex items-center justify-center py-1 md:py-0">
          <GoBoard
            boardState={boardState}
            size={game?.size ?? 19}
            lastMove={lastMove}
            nextTurn={nextTurn}
            ownership={currentAnalysis?.ownership}
            suggestedMoves={prevAnalysis?.top_moves}
            showOwnership={showOwnership}
            showSuggestions={showSuggestions}
            marks={currentNode?.marks ?? []}
            editTool={editTool}
            onIntersectionClick={handleIntersectionClick}
          />
        </div>

        {/* Right panel */}
        <aside className="w-full md:w-[280px] md:max-w-[280px] flex-shrink-0 flex flex-col gap-2 min-h-0 md:overflow-y-auto pb-2 md:pb-0">
          {/* Upload */}
          <UploadPanel
            onGameLoaded={(loadedGame) => {
              stopAnalysis();
              setSettings((current) => ({
                ...current,
                rules: normalizeRules(loadedGame.metadata.rules),
                komi: loadedGame.metadata.komi ?? current.komi,
                boardSize: loadedGame.size,
              }));
            }}
          />

          <MarkupToolbar />
          <ReviewLibrary settings={settings} onRestore={(savedSettings) => {
            stopAnalysis();
            setSettings(savedSettings);
          }} />

          <AnalysisSettingsPanel
            settings={{ ...settings, boardSize: game?.size ?? settings.boardSize }}
            hasGame={Boolean(game)}
            onChange={updateSettings}
            onCreateBoard={() => {
              clearAnalysis();
              loadGame(createEmptyGame(settings.boardSize));
            }}
          />

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
                  onClick={() => analyzeGame(game, settings)}
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
            <ReviewSummary />
          )}

          {hasAnalysis && (
            <FlaggedMoments />
          )}

          {hasAnalysis && (
            <VariationPlayback />
          )}

          {currentAnalysis && (
            <CoachPanel key={`${gameSessionId}:${currentNodeId}`} settings={settings} />
          )}

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
                aria-pressed={showOwnership}
                className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                  showOwnership ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                }`}
              >
                Territory
              </button>
              <button
                onClick={() => setShowSuggestions(v => !v)}
                aria-pressed={showSuggestions}
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
                <p>Main line: {trunkMoves} moves</p>
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
                {currentNode?.comment && (
                  <div className="mt-2 pt-2 border-t border-gray-700">
                    <p className="text-gray-500 mb-0.5">Comment</p>
                    <p className="text-gray-200 whitespace-pre-wrap">{currentNode.comment}</p>
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

          {/* Variation tree */}
          <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700 min-h-0 flex-1 flex flex-col overflow-hidden">
            <h2 className="text-sm font-semibold text-gray-200 mb-2">Variation tree</h2>
            <div className="min-h-0 flex-1">
              <MoveTreeView />
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

export default App;
