import type { Point } from '../types/game';

export const GTP_COLUMNS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';

function assertBoardSize(boardSize: number): void {
  if (!Number.isInteger(boardSize) || boardSize < 2 || boardSize > GTP_COLUMNS.length) {
    throw new Error(`Unsupported board size: ${boardSize}`);
  }
}

/**
 * Convert SGF coordinate string (e.g. "pd") to [row, col].
 * SGF uses 'a'=0, 'b'=1, ... 's'=18 for a 19x19 board.
 * First char is column, second is row.
 */
export function sgfToPoint(sgf: string): Point {
  if (!/^[a-z]{2}$/.test(sgf)) throw new Error(`Invalid SGF coordinate: ${sgf}`);
  const col = sgf.charCodeAt(0) - 97; // 'a' = 0
  const row = sgf.charCodeAt(1) - 97;
  return [row, col];
}

/** Convert [row, col] to SGF coordinate string */
export function pointToSgf(point: Point): string {
  const [row, col] = point;
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row > 25 || col < 0 || col > 25) {
    throw new Error(`Invalid point: ${row},${col}`);
  }
  return String.fromCharCode(col + 97) + String.fromCharCode(row + 97);
}

/**
 * Convert [row, col] to display format like "Q16" (used in Go commentary).
 * Columns: A-T (skipping I), left to right.
 * Rows: 1-19, bottom to top.
 */
export function pointToDisplay(point: Point, boardSize: number = 19): string {
  assertBoardSize(boardSize);
  const [row, col] = point;
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= boardSize || col < 0 || col >= boardSize) {
    throw new Error(`Point outside ${boardSize}x${boardSize} board: ${row},${col}`);
  }
  const colLetter = GTP_COLUMNS[col];
  const rowNumber = boardSize - row;
  return `${colLetter}${rowNumber}`;
}

/** Convert display format like "Q16" to [row, col] */
export function displayToPoint(display: string, boardSize: number = 19): Point {
  assertBoardSize(boardSize);
  const match = /^([A-HJ-Z])(\d{1,2})$/i.exec(display.trim());
  if (!match) throw new Error(`Invalid display coordinate: ${display}`);
  const col = GTP_COLUMNS.indexOf(match[1].toUpperCase());
  const rowNumber = Number.parseInt(match[2], 10);
  const row = boardSize - rowNumber;
  if (col < 0 || col >= boardSize || row < 0 || row >= boardSize) {
    throw new Error(`Coordinate outside ${boardSize}x${boardSize} board: ${display}`);
  }
  return [row, col];
}
