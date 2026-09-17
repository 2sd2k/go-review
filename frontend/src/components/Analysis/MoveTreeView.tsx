import { useEffect, useMemo, useRef } from 'react';
import { useGameStore } from '../../stores/gameStore';
import {
  activePathIds,
  childIds,
  getNode,
  layoutMoveTree,
  moveLabel,
} from '../../lib/moveTree';

const CELL = 22;
const RADIUS = 8;
const BRANCH_COLORS = ['#f87171', '#34d399', '#60a5fa', '#fbbf24', '#c084fc', '#22d3ee', '#fb923c'];

export default function MoveTreeView() {
  const { game, currentNodeId, goToNode } = useGameStore();
  const currentRef = useRef<SVGGElement>(null);

  const layout = useMemo(() => (game ? layoutMoveTree(game) : null), [game]);
  const active = useMemo(
    () => (game ? activePathIds(game, currentNodeId) : new Set<number>()),
    [game, currentNodeId],
  );

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [currentNodeId, layout]);

  if (!game || !layout || layout.size <= 1) {
    return <p className="text-xs text-gray-500">Play or upload a game to see the tree.</p>;
  }

  let maxX = 0;
  let maxY = 0;
  for (const pos of layout.values()) {
    maxX = Math.max(maxX, pos.x);
    maxY = Math.max(maxY, pos.y);
  }

  const width = (maxX + 1) * CELL + 8;
  const height = (maxY + 1) * CELL + 8;
  const center = (pos: { x: number; y: number }) => ({
    cx: pos.x * CELL + CELL / 2,
    cy: pos.y * CELL + CELL / 2,
  });

  const edges: { key: string; x1: number; y1: number; x2: number; y2: number; color: string; active: boolean }[] = [];
  for (const node of Object.values(game.nodes)) {
    const from = layout.get(node.id);
    if (!from) continue;
    const start = center(from);
    childIds(node).forEach((childId, index) => {
      const to = layout.get(childId);
      if (!to) return;
      const end = center(to);
      const child = getNode(game, childId);
      edges.push({
        key: `${node.id}-${childId}`,
        x1: start.cx,
        y1: start.cy,
        x2: end.cx,
        y2: end.cy,
        color: child.trunk ? '#6b7280' : BRANCH_COLORS[(index - (node.trunkNextId != null ? 1 : 0) + BRANCH_COLORS.length) % BRANCH_COLORS.length],
        active: active.has(node.id) && active.has(childId),
      });
    });
  }

  return (
    <div className="overflow-auto h-full min-h-[180px] rounded bg-gray-950/40">
      <svg width={width} height={height} className="block">
        {edges.map((edge) => (
          <line
            key={edge.key}
            x1={edge.x1}
            y1={edge.y1}
            x2={edge.x2}
            y2={edge.y2}
            stroke={edge.color}
            strokeWidth={edge.active ? 2 : 1}
            opacity={edge.active ? 0.95 : 0.45}
          />
        ))}
        {[...layout.values()].map((pos) => {
          const node = getNode(game, pos.id);
          const { cx, cy } = center(pos);
          const isCurrent = node.id === currentNodeId;
          const onPath = active.has(node.id);
          const fill = !node.move
            ? '#1f2937'
            : node.move.color === 'B'
              ? '#111827'
              : '#f3f4f6';
          const stroke = isCurrent ? '#f59e0b' : node.move?.color === 'W' ? '#9ca3af' : '#6b7280';
          const label = node.moveNumber > 0 ? String(node.moveNumber) : '';
          const textFill = node.move?.color === 'W' ? '#111827' : '#e5e7eb';

          return (
            <g
              key={node.id}
              ref={isCurrent ? currentRef : undefined}
              onClick={() => goToNode(node.id)}
              className="cursor-pointer"
            >
              <title>
                {moveLabel(node.move, game.size)}
                {node.trunk ? '' : ' (variation)'}
                {node.comment ? `\n${node.comment}` : ''}
              </title>
              <circle
                cx={cx}
                cy={cy}
                r={RADIUS}
                fill={fill}
                stroke={stroke}
                strokeWidth={isCurrent ? 2.5 : 1}
                opacity={onPath || isCurrent ? 1 : 0.4}
              />
              {label && (
                <text
                  x={cx}
                  y={cy + 3}
                  textAnchor="middle"
                  fontSize={7}
                  fill={textFill}
                  className="select-none pointer-events-none"
                >
                  {label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
