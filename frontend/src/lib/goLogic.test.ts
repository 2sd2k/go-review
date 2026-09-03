import { describe, expect, it } from 'vitest';
import { applyMove, getLiberties, isLegalMove } from './goLogic';
import { createEmptyBoard, type BoardState } from '../types/game';

function boardWith(stones: Array<['B' | 'W', number, number]>, size = 5): BoardState {
  const board = createEmptyBoard(size);
  for (const [color, row, col] of stones) board[row][col] = color;
  return board;
}

describe('Go move rules', () => {
  it('captures a surrounded stone without mutating the input board', () => {
    const board = boardWith([
      ['W', 2, 2],
      ['B', 1, 2],
      ['B', 2, 1],
      ['B', 3, 2],
    ]);

    const result = applyMove(board, [2, 3], 'B');

    expect(result.captured).toEqual([[2, 2]]);
    expect(result.board[2][2]).toBeNull();
    expect(result.board[2][3]).toBe('B');
    expect(board[2][2]).toBe('W');
  });

  it('counts shared liberties once for a connected group', () => {
    const board = boardWith([
      ['B', 2, 1],
      ['B', 2, 2],
    ]);
    expect(getLiberties(board, 2, 1)).toBe(6);
  });

  it('rejects suicide', () => {
    const board = boardWith([
      ['W', 1, 2],
      ['W', 2, 1],
      ['W', 2, 3],
      ['W', 3, 2],
    ]);

    expect(() => applyMove(board, [2, 2], 'B')).toThrow(/Suicide/);
    expect(isLegalMove(board, [2, 2], 'B')).toBe(false);
  });

  it('identifies simple ko and rejects the immediate recapture', () => {
    const board = boardWith([
      ['W', 1, 1],
      ['B', 0, 1],
      ['B', 1, 0],
      ['B', 2, 1],
      ['W', 0, 2],
      ['W', 1, 3],
      ['W', 2, 2],
    ]);

    const capture = applyMove(board, [1, 2], 'B');
    expect(capture.captured).toEqual([[1, 1]]);
    expect(capture.koPoint).toEqual([1, 1]);
    expect(() => applyMove(capture.board, [1, 1], 'W', capture.koPoint)).toThrow(/Ko violation/);
  });

  it('rejects occupied and out-of-bounds moves', () => {
    const board = boardWith([['B', 0, 0]]);
    expect(() => applyMove(board, [0, 0], 'W')).toThrow(/occupied/);
    expect(() => applyMove(board, [-1, 0], 'W')).toThrow(/out of bounds/);
  });
});
