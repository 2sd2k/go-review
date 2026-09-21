import { useGameStore } from '../../stores/gameStore';
import { currentLine, getMoveIndex } from '../../lib/moveTree';

export default function GameNavigation() {
  const { game, currentNodeId, goToStart, prevMove, nextMove, goToEnd, goToMove } =
    useGameStore();

  const line = game ? currentLine(game, currentNodeId) : [];
  const totalMoves = Math.max(0, line.length - 1);
  const currentIndex = game ? getMoveIndex(game, currentNodeId) : 0;
  const current = game?.nodes[currentNodeId];
  const nextPlayer = current?.nextPlayer;

  return (
    <div className="flex flex-col items-center gap-2 w-full">
      <div className="text-xs text-gray-400">
        {game && current ? (
          <>
            Move {current.moveNumber} / {line[line.length - 1]?.moveNumber ?? 0}
            {!current.trunk && <span className="ml-1 text-emerald-400">variation</span>}
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

      <div className="flex gap-1">
        <NavButton onClick={goToStart} disabled={currentIndex === 0} title="Go to start (Home)">
          ⏮
        </NavButton>
        <NavButton onClick={prevMove} disabled={currentIndex === 0} title="Previous move (←)">
          ◀
        </NavButton>
        <NavButton onClick={nextMove} disabled={currentIndex >= totalMoves} title="Next move (→)">
          ▶
        </NavButton>
        <NavButton onClick={goToEnd} disabled={currentIndex >= totalMoves} title="Go to end of this line (End)">
          ⏭
        </NavButton>
      </div>

      {totalMoves > 0 && (
        <input
          type="range"
          min={0}
          max={totalMoves}
          value={currentIndex}
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
      aria-label={title}
      className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800
                 disabled:text-gray-600 text-white rounded transition-colors
                 text-sm select-none"
    >
      {children}
    </button>
  );
}
