import type { Point } from '../types/game';

/**
 * Convert SGF coordinate string (e.g. "pd") to [row, col].
 * SGF uses 'a'=0, 'b'=1, ... 's'=18 for a 19x19 board.
 * First char is column, second is row.
 */
export function sgfToPoint(sgf: string): Point {
  const col = sgf.charCodeAt(0) - 97; // 'a' = 0
  const row = sgf.charCodeAt(1) - 97;
  return [row, col];
}

/** Convert [row, col] to SGF coordinate string */
export function pointToSgf(point: Point): string {
  const [row, col] = point;
  return String.fromCharCode(col + 97) + String.fromCharCode(row + 97);
}

/**
 * Convert [row, col] to display format like "Q16" (used in Go commentary).
 * Columns: A-T (skipping I), left to right.
 * Rows: 1-19, bottom to top.
 */
export function pointToDisplay(point: Point, boardSize: number = 19): string {
  const [row, col] = point;
  // Column letters skip 'I' to avoid confusion with '1'
  const colLetters = 'ABCDEFGHJKLMNOPQRST';
  const colLetter = colLetters[col];
  const rowNumber = boardSize - row;
  return `${colLetter}${rowNumber}`;
}

/** Convert display format like "Q16" to [row, col] */
export function displayToPoint(display: string, boardSize: number = 19): Point {
  const colLetters = 'ABCDEFGHJKLMNOPQRST';
  const colLetter = display[0].toUpperCase();
  const col = colLetters.indexOf(colLetter);
  const rowNumber = parseInt(display.slice(1));
  const row = boardSize - rowNumber;
  return [row, col];
}
