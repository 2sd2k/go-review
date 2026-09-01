import type { BoardState, StoneColor, Point } from '../types/game';

/** Get the opposite color */
export function opponent(color: StoneColor): StoneColor {
  return color === 'B' ? 'W' : 'B';
}

/** Check if a point is within the board */
function inBounds(row: number, col: number, size: number): boolean {
  return row >= 0 && row < size && col >= 0 && col < size;
}

/** Get orthogonal neighbors of a point */
function neighbors(row: number, col: number, size: number): Point[] {
  const result: Point[] = [];
  if (row > 0) result.push([row - 1, col]);
  if (row < size - 1) result.push([row + 1, col]);
  if (col > 0) result.push([row, col - 1]);
  if (col < size - 1) result.push([row, col + 1]);
  return result;
}

/**
 * Find all stones connected to the given point (same color group).
 * Returns the set of points in the group.
 */
function getGroup(board: BoardState, row: number, col: number): Point[] {
  const size = board.length;
  const color = board[row][col];
  if (!color) return [];

  const visited = new Set<string>();
  const group: Point[] = [];
  const stack: Point[] = [[row, col]];

  while (stack.length > 0) {
    const [r, c] = stack.pop()!;
    const key = `${r},${c}`;
    if (visited.has(key)) continue;
    visited.add(key);
    group.push([r, c]);

    for (const [nr, nc] of neighbors(r, c, size)) {
      if (!visited.has(`${nr},${nc}`) && board[nr][nc] === color) {
        stack.push([nr, nc]);
      }
    }
  }

  return group;
}

/**
 * Count the liberties of a group containing the stone at (row, col).
 */
export function getLiberties(board: BoardState, row: number, col: number): number {
  const size = board.length;
  const group = getGroup(board, row, col);
  const libertySet = new Set<string>();

  for (const [r, c] of group) {
    for (const [nr, nc] of neighbors(r, c, size)) {
      if (board[nr][nc] === null) {
        libertySet.add(`${nr},${nc}`);
      }
    }
  }

  return libertySet.size;
}

/**
 * Deep clone a board state.
 */
export function cloneBoard(board: BoardState): BoardState {
  return board.map(row => [...row]);
}

export interface MoveResult {
  board: BoardState;
  captured: Point[];
  koPoint: Point | null;
}

/**
 * Apply a move to the board. Returns the new board state and captured stones.
 * Throws if the move is illegal (occupied, suicide, ko).
 */
export function applyMove(
  board: BoardState,
  point: Point,
  color: StoneColor,
  koPoint: Point | null = null
): MoveResult {
  const [row, col] = point;
  const size = board.length;

  if (!inBounds(row, col, size)) {
    throw new Error(`Move out of bounds: ${row},${col}`);
  }
  if (board[row][col] !== null) {
    throw new Error(`Position occupied: ${row},${col}`);
  }

  // Check ko
  if (koPoint && koPoint[0] === row && koPoint[1] === col) {
    throw new Error(`Ko violation: ${row},${col}`);
  }

  const newBoard = cloneBoard(board);
  newBoard[row][col] = color;

  // Check for captures of opponent groups
  const captured: Point[] = [];
  const opp = opponent(color);

  for (const [nr, nc] of neighbors(row, col, size)) {
    if (newBoard[nr][nc] === opp) {
      if (getLiberties(newBoard, nr, nc) === 0) {
        const capturedGroup = getGroup(newBoard, nr, nc);
        for (const [cr, cc] of capturedGroup) {
          newBoard[cr][cc] = null;
          captured.push([cr, cc]);
        }
      }
    }
  }

  // Check for suicide (no liberties and no captures)
  if (captured.length === 0 && getLiberties(newBoard, row, col) === 0) {
    throw new Error(`Suicide move: ${row},${col}`);
  }

  // Determine ko point: if exactly one stone was captured and the placed stone
  // has exactly one liberty (which is the captured position)
  let newKoPoint: Point | null = null;
  if (captured.length === 1) {
    const placedGroup = getGroup(newBoard, row, col);
    if (placedGroup.length === 1) {
      const liberties = getLiberties(newBoard, row, col);
      if (liberties === 1) {
        newKoPoint = captured[0];
      }
    }
  }

  return { board: newBoard, captured, koPoint: newKoPoint };
}

/**
 * Check if a move is legal without modifying the board.
 */
export function isLegalMove(
  board: BoardState,
  point: Point,
  color: StoneColor,
  koPoint: Point | null = null
): boolean {
  try {
    applyMove(board, point, color, koPoint);
    return true;
  } catch {
    return false;
  }
}
