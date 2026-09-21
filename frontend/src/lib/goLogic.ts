import type { BoardState, StoneColor } from '../types/game';

/** Get the opposite color */
export function opponent(color: StoneColor): StoneColor {
  return color === 'B' ? 'W' : 'B';
}

/**
 * Deep clone a board state.
 */
export function cloneBoard(board: BoardState): BoardState {
  return board.map(row => [...row]);
}
