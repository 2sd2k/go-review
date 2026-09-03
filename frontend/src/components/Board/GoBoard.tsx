import { useRef, useEffect, useCallback, useState } from 'react';
import type { BoardState, Point, StoneColor } from '../../types/game';
import type { SuggestedMove } from '../../types/analysis';
import { displayToPoint, GTP_COLUMNS } from '../../lib/coordinates';

interface GoBoardProps {
  boardState: BoardState;
  size?: number;
  lastMove?: Point | null;
  nextTurn?: StoneColor;
  ownership?: number[] | null; // 361 values, -1 (white) to 1 (black)
  suggestedMoves?: SuggestedMove[] | null;
  showOwnership?: boolean;
  showSuggestions?: boolean;
  onIntersectionClick?: (point: Point) => void;
}

// Star points (hoshi) for a 19x19 board
const STAR_POINTS_19: Point[] = [
  [3, 3], [3, 9], [3, 15],
  [9, 3], [9, 9], [9, 15],
  [15, 3], [15, 9], [15, 15],
];

const STAR_POINTS_13: Point[] = [
  [3, 3], [3, 9],
  [6, 6],
  [9, 3], [9, 9],
];

const STAR_POINTS_9: Point[] = [
  [2, 2], [2, 6],
  [4, 4],
  [6, 2], [6, 6],
];

function getStarPoints(size: number): Point[] {
  if (size === 19) return STAR_POINTS_19;
  if (size === 13) return STAR_POINTS_13;
  if (size === 9) return STAR_POINTS_9;
  return [];
}

export default function GoBoard({
  boardState, size = 19, lastMove, nextTurn = 'B',
  ownership, suggestedMoves, showOwnership = false, showSuggestions = false,
  onIntersectionClick,
}: GoBoardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boardAreaRef = useRef<HTMLDivElement>(null);
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);

  const drawBoard = useCallback(() => {
    const canvas = canvasRef.current;
    const boardArea = boardAreaRef.current;
    if (!canvas || !boardArea) return;

    const dpr = window.devicePixelRatio || 1;
    const canvasSize = boardArea.clientWidth;

    canvas.width = canvasSize * dpr;
    canvas.height = canvasSize * dpr;
    canvas.style.width = `${canvasSize}px`;
    canvas.style.height = `${canvasSize}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);

    const padding = canvasSize * 0.055;
    const gridArea = canvasSize - padding * 2;
    const cellSize = gridArea / (size - 1);
    const stoneRadius = cellSize * 0.47;

    // Draw board background
    ctx.fillStyle = '#dcb35c';
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    // Draw grid lines
    ctx.strokeStyle = '#2c2c2c';
    ctx.lineWidth = 1;

    for (let i = 0; i < size; i++) {
      const pos = padding + i * cellSize;

      ctx.beginPath();
      ctx.moveTo(pos, padding);
      ctx.lineTo(pos, padding + (size - 1) * cellSize);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(padding, pos);
      ctx.lineTo(padding + (size - 1) * cellSize, pos);
      ctx.stroke();
    }

    // Draw star points
    const starPoints = getStarPoints(size);
    for (const [row, col] of starPoints) {
      const x = padding + col * cellSize;
      const y = padding + row * cellSize;
      ctx.fillStyle = '#2c2c2c';
      ctx.beginPath();
      ctx.arc(x, y, cellSize * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw coordinate labels on the board
    ctx.fillStyle = '#5a4a2a';
    ctx.font = `bold ${cellSize * 0.38}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < size; i++) {
      // Column labels (top and bottom)
      const x = padding + i * cellSize;
      ctx.fillText(GTP_COLUMNS[i], x, padding * 0.38);
      ctx.fillText(GTP_COLUMNS[i], x, canvasSize - padding * 0.38);

      // Row labels (left and right)
      const y = padding + i * cellSize;
      const rowNum = String(size - i);
      ctx.fillText(rowNum, padding * 0.38, y);
      ctx.fillText(rowNum, canvasSize - padding * 0.38, y);
    }

    // Draw stones
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const stone = boardState[row]?.[col];
        if (!stone) continue;

        const x = padding + col * cellSize;
        const y = padding + row * cellSize;

        drawStone(ctx, x, y, stoneRadius, stone);

        // Mark last move
        if (lastMove && lastMove[0] === row && lastMove[1] === col) {
          ctx.strokeStyle = stone === 'B' ? '#ffffff' : '#000000';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, stoneRadius * 0.4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // Draw ownership heatmap
    if (showOwnership && ownership && ownership.length === size * size) {
      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
          const val = ownership[row * size + col];
          if (Math.abs(val) < 0.05) continue; // skip near-neutral

          const x = padding + col * cellSize;
          const y = padding + row * cellSize;
          const halfCell = cellSize * 0.45;

          if (val > 0) {
            // Black territory — blue
            ctx.fillStyle = `rgba(59, 130, 246, ${Math.abs(val) * 0.5})`;
          } else {
            // White territory — red
            ctx.fillStyle = `rgba(239, 68, 68, ${Math.abs(val) * 0.5})`;
          }
          ctx.fillRect(x - halfCell, y - halfCell, halfCell * 2, halfCell * 2);
        }
      }
    }

    // Draw suggested moves
    if (showSuggestions && suggestedMoves && suggestedMoves.length > 0) {
      const topMoves = suggestedMoves.slice(0, 3);
      topMoves.forEach((sm, idx) => {
        if (sm.move === 'pass') return;
        const point = displayToPoint(sm.move, size);
        if (!point) return;
        const [row, col] = point;
        const x = padding + col * cellSize;
        const y = padding + row * cellSize;

        // Draw colored circle
        const colors = ['#22c55e', '#60a5fa', '#a78bfa'];
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = colors[idx] || '#60a5fa';
        ctx.beginPath();
        ctx.arc(x, y, stoneRadius * 0.7, 0, Math.PI * 2);
        ctx.fill();

        // Draw label
        ctx.globalAlpha = 1.0;
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${cellSize * 0.3}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(idx + 1), x, y);
      });
      ctx.globalAlpha = 1.0;
    }

    // Draw hover ghost stone
    if (hoverPoint) {
      const [hRow, hCol] = hoverPoint;
      if (boardState[hRow]?.[hCol] === null) {
        const hx = padding + hCol * cellSize;
        const hy = padding + hRow * cellSize;
        ctx.globalAlpha = 0.4;
        drawStone(ctx, hx, hy, stoneRadius, nextTurn);
        ctx.globalAlpha = 1.0;
      }
    }
  }, [boardState, size, lastMove, hoverPoint, nextTurn, ownership, showOwnership, suggestedMoves, showSuggestions]);

  useEffect(() => {
    drawBoard();

    const observer = new ResizeObserver(() => drawBoard());
    if (boardAreaRef.current) {
      observer.observe(boardAreaRef.current);
    }
    return () => observer.disconnect();
  }, [drawBoard]);

  const getIntersection = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>): Point | null => {
      if (!canvasRef.current || !boardAreaRef.current) return null;

      const rect = canvasRef.current.getBoundingClientRect();
      const canvasSize = boardAreaRef.current.clientWidth;
      const padding = canvasSize * 0.055;
      const gridArea = canvasSize - padding * 2;
      const cellSize = gridArea / (size - 1);

      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const col = Math.round((mouseX - padding) / cellSize);
      const row = Math.round((mouseY - padding) / cellSize);

      if (row >= 0 && row < size && col >= 0 && col < size) {
        return [row, col];
      }
      return null;
    },
    [size]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!onIntersectionClick) return;
      const point = getIntersection(e);
      if (point) onIntersectionClick(point);
    },
    [onIntersectionClick, getIntersection]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const point = getIntersection(e);
      setHoverPoint((prev) => {
        if (!point && !prev) return prev;
        if (point && prev && point[0] === prev[0] && point[1] === prev[1]) return prev;
        return point;
      });
    },
    [getIntersection]
  );

  const handleMouseLeave = useCallback(() => {
    setHoverPoint(null);
  }, []);

  return (
    <div
      ref={boardAreaRef}
      className="aspect-square"
      style={{ height: 'calc(100vh - 80px)', maxWidth: 'calc(100vh - 80px)' }}
    >
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="cursor-pointer rounded shadow-lg"
      />
    </div>
  );
}

function drawStone(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: StoneColor
) {
  // Shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.beginPath();
  ctx.arc(x + radius * 0.08, y + radius * 0.08, radius, 0, Math.PI * 2);
  ctx.fill();

  if (color === 'B') {
    const gradient = ctx.createRadialGradient(
      x - radius * 0.3, y - radius * 0.3, radius * 0.1,
      x, y, radius
    );
    gradient.addColorStop(0, '#4a4a4a');
    gradient.addColorStop(1, '#0a0a0a');
    ctx.fillStyle = gradient;
  } else {
    const gradient = ctx.createRadialGradient(
      x - radius * 0.3, y - radius * 0.3, radius * 0.1,
      x, y, radius
    );
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(1, '#d0d0d0');
    ctx.fillStyle = gradient;
  }

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}
