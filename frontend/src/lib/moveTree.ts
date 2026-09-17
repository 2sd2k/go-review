import type { Game, GameNode, Move, Point, StoneColor } from '../types/game';
import { pointToDisplay } from './coordinates';

export function getNode(game: Game, id: number): GameNode {
  const node = game.nodes[id];
  if (!node) throw new Error(`Missing move-tree node ${id}`);
  return node;
}

/** Trunk child first, then variation branches — the same order OGS uses. */
export function childIds(node: GameNode): number[] {
  return node.trunkNextId != null ? [node.trunkNextId, ...node.branchIds] : [...node.branchIds];
}

export function movesEqual(a: Move | null, b: Move | null): boolean {
  if (!a || !b) return a === b;
  if (a.color !== b.color) return false;
  if (a.point === 'pass' || b.point === 'pass') return a.point === b.point;
  return a.point[0] === b.point[0] && a.point[1] === b.point[1];
}

export function lookupMove(parent: GameNode, game: Game, move: Move): GameNode | null {
  for (const id of childIds(parent)) {
    const child = getNode(game, id);
    if (movesEqual(child.move, move)) return child;
  }
  return null;
}

export function nextNode(game: Game, node: GameNode): GameNode | null {
  // Always follow the official game when it continues from this node.
  if (node.trunkNextId != null) return getNode(game, node.trunkNextId);

  if (node.hintNextId != null && node.branchIds.includes(node.hintNextId)) {
    return getNode(game, node.hintNextId);
  }

  if (node.branchIds.length > 0) return getNode(game, node.branchIds[0]);
  return null;
}

/** Walk one step toward the root and remember this child as the hint. */
export function prevNode(game: Game, node: GameNode): { game: Game; node: GameNode } | null {
  if (node.parentId == null) return null;
  const parent = getNode(game, node.parentId);
  const updatedParent: GameNode = { ...parent, hintNextId: node.id };
  return {
    game: {
      ...game,
      nodes: { ...game.nodes, [parent.id]: updatedParent },
    },
    node: updatedParent,
  };
}

export function ancestors(game: Game, id: number): GameNode[] {
  const chain: GameNode[] = [];
  let current: GameNode | null = getNode(game, id);
  while (current) {
    chain.push(current);
    current = current.parentId != null ? getNode(game, current.parentId) : null;
  }
  return chain.reverse();
}

/** Nearest ancestor on the official game, which may be this node. */
export function getBranchPoint(game: Game, id: number): GameNode {
  let current = getNode(game, id);
  while (!current.trunk && current.parentId != null) {
    current = getNode(game, current.parentId);
  }
  return current;
}

export function getMoveIndex(game: Game, id: number): number {
  return ancestors(game, id).length - 1;
}

export function trunkLine(game: Game): GameNode[] {
  const line: GameNode[] = [getNode(game, game.rootId)];
  while (line[line.length - 1].trunkNextId != null) {
    line.push(getNode(game, line[line.length - 1].trunkNextId!));
  }
  return line;
}

/**
 * Path used by the slider: root → current via parent pointers, then Next
 * until a leaf. Hint state on off-trunk nodes keeps the continuation stable.
 */
export function currentLine(game: Game, currentId: number): GameNode[] {
  const line = ancestors(game, currentId);
  let cursor = getNode(game, currentId);
  let next = nextNode(game, cursor);
  while (next) {
    line.push(next);
    cursor = next;
    next = nextNode(game, cursor);
  }
  return line;
}

export function activePathIds(game: Game, currentId: number): Set<number> {
  return new Set(currentLine(game, currentId).map((node) => node.id));
}

export function leafOnCurrentLine(game: Game, currentId: number): GameNode {
  const line = currentLine(game, currentId);
  return line[line.length - 1];
}

export interface PlayedMove {
  move: Move;
  boardState: GameNode['boardState'];
  captures: GameNode['captures'];
  nextPlayer: StoneColor;
  comment?: string;
}

/**
 * Attach a child like OGS `MoveTree.move`: reuse an existing child with the
 * same coordinates, otherwise extend the trunk or push a new branch.
 */
export function playFrom(
  game: Game,
  parentId: number,
  played: PlayedMove,
): { game: Game; node: GameNode; created: boolean } {
  const parent = getNode(game, parentId);
  const existing = lookupMove(parent, game, played.move);
  if (existing) {
    return { game, node: existing, created: false };
  }

  const asTrunk = parent.trunk && parent.trunkNextId == null;
  const id = game.nextId;
  const node: GameNode = {
    id,
    parentId,
    trunkNextId: null,
    branchIds: [],
    hintNextId: null,
    trunk: asTrunk,
    move: played.move,
    boardState: played.boardState,
    moveNumber: parent.moveNumber + 1,
    comment: played.comment,
    captures: played.captures,
    nextPlayer: played.nextPlayer,
  };

  const updatedParent: GameNode = asTrunk
    ? { ...parent, trunkNextId: id }
    : { ...parent, branchIds: [...parent.branchIds, id] };

  return {
    game: {
      ...game,
      nextId: id + 1,
      nodes: {
        ...game.nodes,
        [parentId]: updatedParent,
        [id]: node,
      },
    },
    node,
    created: true,
  };
}

/** Used by SGF import, which already knows whether a child is trunk or a branch. */
export function attachChild(
  game: Game,
  parentId: number,
  child: Omit<GameNode, 'id' | 'parentId'>,
): { game: Game; node: GameNode } {
  const id = game.nextId;
  const node: GameNode = { ...child, id, parentId };
  const parent = getNode(game, parentId);
  const updatedParent: GameNode = child.trunk
    ? { ...parent, trunkNextId: id }
    : { ...parent, branchIds: [...parent.branchIds, id] };

  return {
    game: {
      ...game,
      nextId: id + 1,
      nodes: {
        ...game.nodes,
        [parentId]: updatedParent,
        [id]: node,
      },
    },
    node,
  };
}

export function moveLabel(move: Move | null, boardSize: number): string {
  if (!move) return 'Start';
  if (move.point === 'pass') return 'Pass';
  return pointToDisplay(move.point as Point, boardSize);
}

export interface TreeLayoutNode {
  id: number;
  x: number;
  y: number;
}

/**
 * Compact 2D layout in the OGS style: trunk along y = 0, variations dropping
 * below, one column per move number.
 */
export function layoutMoveTree(game: Game): Map<number, TreeLayoutNode> {
  const occupied: number[] = [];
  const positions = new Map<number, TreeLayoutNode>();

  const place = (id: number, depth: number, minY: number, onTrunk: boolean): number => {
    const node = getNode(game, id);
    const y = onTrunk ? 0 : Math.max(minY, (occupied[depth] ?? -1) + 1);
    occupied[depth] = Math.max(occupied[depth] ?? -1, y);
    positions.set(id, { id, x: depth, y });

    let branchMin = y;
    if (node.trunkNextId != null) {
      place(node.trunkNextId, depth + 1, 0, true);
    }
    for (const branchId of node.branchIds) {
      const branchY = place(branchId, depth + 1, branchMin, false);
      branchMin = branchY + 1;
    }
    return y;
  };

  place(game.rootId, 0, 0, true);
  return positions;
}

/**
 * Move to the closest variation above (delta < 0) or below (delta > 0) that
 * also has a node at this move number. Returns null when that column is empty
 * in that direction — the caller should stay put and must not wrap.
 */
export function neighborAtMoveNumber(
  game: Game,
  currentId: number,
  delta: number,
): GameNode | null {
  if (delta === 0) return null;

  const current = getNode(game, currentId);
  const layout = layoutMoveTree(game);
  if (!layout.has(currentId)) return null;

  const column = [...layout.values()]
    .filter((pos) => getNode(game, pos.id).moveNumber === current.moveNumber)
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const index = column.findIndex((pos) => pos.id === currentId);
  if (index < 0) return null;

  const target = column[index + Math.sign(delta)];
  return target ? getNode(game, target.id) : null;
}

/**
 * Up/Down target: another node at this move number, or — if the next move is
 * a fork — the neighboring child of this node.
 */
export function shiftBranchTarget(
  game: Game,
  currentId: number,
  delta: number,
): GameNode | null {
  const sameMove = neighborAtMoveNumber(game, currentId, delta);
  if (sameMove) return sameMove;

  const current = getNode(game, currentId);
  const kids = childIds(current);
  if (kids.length < 2) return null;

  const layout = layoutMoveTree(game);
  const sorted = kids
    .map((id) => layout.get(id))
    .filter((pos): pos is TreeLayoutNode => pos != null)
    .sort((a, b) => a.y - b.y || a.x - b.x);

  const upcoming = nextNode(game, current);
  const index = sorted.findIndex((pos) => pos.id === upcoming?.id);
  if (index < 0) return null;

  const target = sorted[index + Math.sign(delta)];
  return target ? getNode(game, target.id) : null;
}
