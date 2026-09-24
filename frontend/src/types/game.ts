export type StoneColor = 'B' | 'W';

/** [row, col] where 0,0 is top-left */
export type Point = [number, number];

export interface Move {
  color: StoneColor;
  point: Point | 'pass';
}

/** 2D array: board[row][col] */
export type BoardState = (StoneColor | null)[][];

/**
 * One node in an OGS-style move tree.
 *
 * The official game is a linked list via `trunkNextId`. User explorations and
 * SGF sidelines live in `branchIds`. `hintNextId` remembers which child was
 * last visited so Next on a non-trunk node can stay on that variation.
 */
export interface GameNode {
  id: number;
  parentId: number | null;
  trunkNextId: number | null;
  branchIds: number[];
  hintNextId: number | null;
  /** True when this node is on the original/main game line. */
  trunk: boolean;
  move: Move | null; // null for the root node (empty or handicap board)
  boardState: BoardState;
  moveNumber: number;
  comment?: string;
  captures: { black: number; white: number };
  nextPlayer: StoneColor;
  /** OGS-style markup on this node only (SGF TR / CR / SQ). */
  marks?: BoardMark[];
}

export type BoardMarkKind = 'triangle' | 'circle' | 'square';
export type EditTool = 'play' | BoardMarkKind;

export interface BoardMark {
  kind: BoardMarkKind;
  point: Point;
}

export interface GameMetadata {
  blackPlayer?: string;
  whitePlayer?: string;
  blackRank?: string;
  whiteRank?: string;
  result?: string;
  komi?: number;
  date?: string;
  event?: string;
  rules?: string;
}

export interface Game {
  /** Imported source is retained separately from edited/exported variations. */
  originalSgf?: string;
  /** Browser-local saved review identity; excluded from SGF exports. */
  localReviewId?: string;
  size: number;
  rootId: number;
  nodes: Record<number, GameNode>;
  nextId: number;
  metadata: GameMetadata;
  initialStones: Move[];
}

export function createEmptyBoard(size: number): BoardState {
  return Array.from({ length: size }, () => Array(size).fill(null));
}

export function createEmptyGame(size: number = 19): Game {
  const root: GameNode = {
    id: 0,
    parentId: null,
    trunkNextId: null,
    branchIds: [],
    hintNextId: null,
    trunk: true,
    move: null,
    boardState: createEmptyBoard(size),
    moveNumber: 0,
    captures: { black: 0, white: 0 },
    nextPlayer: 'B',
  };

  return {
    size,
    rootId: 0,
    nodes: { 0: root },
    nextId: 1,
    metadata: {},
    initialStones: [],
  };
}
