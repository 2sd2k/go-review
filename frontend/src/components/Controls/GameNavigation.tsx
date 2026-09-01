import { useGameStore } from '../../stores/gameStore';

export default function GameNavigation() {
  const { game, currentMoveIndex, goToStart, prevMove, nextMove, goToEnd, goToMove } =
    useGameStore();

  const totalMoves = game ? game.nodes.length - 1 : 0;
  const nextPlayer = game?.nodes[currentMoveIndex]?.nextPlayer;

  return (
    <div className="flex flex-col items-center gap-2 w-full">
      {/* Move counter */}
      <div className="text-xs text-gray-400">
        {game ? (
          <>
            Move {currentMoveIndex} / {totalMoves}
            {nextPlayer && (
              <span className="ml-2">
                — {nextPlayer === 'B' ? 'Black' : 'White'} to play
              </span>
            )}
          </>
        ) : (
          'Click the board to place stones, or upload an SGF'
        )}
      </div>

      {/* Navigation buttons */}
      <div className="flex gap-1">
        <NavButton onClick={goToStart} disabled={currentMoveIndex === 0} title="Go to start (Home)">
          ⏮
        </NavButton>
        <NavButton onClick={prevMove} disabled={currentMoveIndex === 0} title="Previous move (←)">
          ◀
        </NavButton>
        <NavButton onClick={nextMove} disabled={currentMoveIndex >= totalMoves} title="Next move (→)">
          ▶
        </NavButton>
        <NavButton onClick={goToEnd} disabled={currentMoveIndex >= totalMoves} title="Go to end (End)">
          ⏭
        </NavButton>
      </div>

      {/* Move slider */}
      {totalMoves > 0 && (
        <input
          type="range"
          min={0}
          max={totalMoves}
          value={currentMoveIndex}
          onChange={(e) => goToMove(parseInt(e.target.value))}
          className="w-full accent-amber-500"
        />
      )}
    </div>
  );
}

function NavButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800
                 disabled:text-gray-600 text-white rounded transition-colors
                 text-sm select-none"
    >
      {children}
    </button>
  );
}
