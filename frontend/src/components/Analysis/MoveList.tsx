import { useEffect, useRef } from 'react';
import { useGameStore } from '../../stores/gameStore';
import { pointToDisplay } from '../../lib/coordinates';

export default function MoveList() {
  const { game, currentMoveIndex, goToMove } = useGameStore();
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll to active move
  useEffect(() => {
    if (activeRef.current && listRef.current) {
      const container = listRef.current;
      const el = activeRef.current;
      const top = el.offsetTop - container.offsetTop;
      const bottom = top + el.offsetHeight;
      if (top < container.scrollTop || bottom > container.scrollTop + container.clientHeight) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [currentMoveIndex]);

  if (!game || game.nodes.length <= 1) return null;

  // Pair moves into rows: (black, white)
  const rows: { moveNum: number; black?: { index: number; label: string }; white?: { index: number; label: string } }[] = [];

  for (let i = 1; i < game.nodes.length; i++) {
    const node = game.nodes[i];
    if (!node.move) continue;

    const label = node.move.point === 'pass'
      ? 'Pass'
      : pointToDisplay(node.move.point, game.size);

    if (node.move.color === 'B') {
      rows.push({
        moveNum: Math.ceil(i / 2),
        black: { index: i, label },
      });
    } else {
      // Attach to last row if it exists and has no white move yet
      const lastRow = rows[rows.length - 1];
      if (lastRow && !lastRow.white) {
        lastRow.white = { index: i, label };
      } else {
        rows.push({
          moveNum: Math.ceil(i / 2),
          white: { index: i, label },
        });
      }
    }
  }

  return (
    <div ref={listRef} className="overflow-y-auto max-h-[300px] text-xs">
      <table className="w-full">
        <thead>
          <tr className="text-gray-500 border-b border-gray-700">
            <th className="w-8 py-1 text-left">#</th>
            <th className="py-1 text-left">Black</th>
            <th className="py-1 text-left">White</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-gray-800/50">
              <td className="text-gray-600 py-0.5">{row.moveNum}</td>
              <td className="py-0.5">
                {row.black && (
                  <button
                    ref={row.black.index === currentMoveIndex ? activeRef : undefined}
                    onClick={() => goToMove(row.black!.index)}
                    className={`px-1.5 py-0.5 rounded text-left w-full transition-colors
                      ${row.black.index === currentMoveIndex
                        ? 'bg-amber-500/30 text-amber-300'
                        : 'hover:bg-gray-700 text-gray-300'
                      }`}
                  >
                    {row.black.label}
                  </button>
                )}
              </td>
              <td className="py-0.5">
                {row.white && (
                  <button
                    ref={row.white.index === currentMoveIndex ? activeRef : undefined}
                    onClick={() => goToMove(row.white!.index)}
                    className={`px-1.5 py-0.5 rounded text-left w-full transition-colors
                      ${row.white.index === currentMoveIndex
                        ? 'bg-amber-500/30 text-amber-300'
                        : 'hover:bg-gray-700 text-gray-300'
                      }`}
                  >
                    {row.white.label}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
