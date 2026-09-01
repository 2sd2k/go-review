export type StoneColor = 'B' | 'W';

/** [row, col] where 0,0 is top-left */
export type Point = [number, number];

export interface Move {
  color: StoneColor;
  point: Point | 'pass';
}

/** 2D array: board[row][col] */
export type BoardState = (StoneColor | null)[][];

export interface GameNode {
  move: Move | null; // null for the root node (empty board)
  boardState: BoardState;
  moveNumber: number;
  comment?: string;
  captures: { black: number; white: number };
  nextPlayer: StoneColor;
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
  size: number;
  nodes: GameNode[];
  metadata: GameMetadata;
  initialStones: Move[];
}

export function createEmptyBoard(size: number): BoardState {
  return Array.from({ length: size }, () => Array(size).fill(null));
}
