import { describe, expect, it } from 'vitest';
import {
  createEmptyBoard,
  createEmptyGame,
  type BoardState,
  type Game,
  type StoneColor,
} from '../types/game';
import {
  applyMoveWithRules,
  normalizeRules,
  repetitionViolation,
  RuleViolationError,
} from './gobanRules';
import { playFrom } from './moveTree';

function boardWith(stones: Array<[StoneColor, number, number]>, size = 5): BoardState {
  const board = createEmptyBoard(size);
  for (const [color, row, col] of stones) board[row][col] = color;
  return board;
}

function gameAt(board: BoardState, rules = 'chinese', nextPlayer: StoneColor = 'B'): Game {
  const game = createEmptyGame(board.length);
  game.metadata.rules = rules;
  game.nodes[game.rootId] = {
    ...game.nodes[game.rootId],
    boardState: board,
    nextPlayer,
  };
  return game;
}

function attachAppliedMove(game: Game, parentId: number, color: StoneColor, point: [number, number]) {
  const move = { color, point } as const;
  const result = applyMoveWithRules(game, parentId, move);
  return playFrom(game, parentId, { move, ...result });
}

function attachSyntheticPosition(
  game: Game,
  parentId: number,
  boardState: BoardState,
  nextPlayer: StoneColor,
): ReturnType<typeof playFrom> {
  return playFrom(game, parentId, {
    move: { color: nextPlayer === 'B' ? 'W' : 'B', point: 'pass' },
    boardState,
    captures: game.nodes[parentId].captures,
    nextPlayer,
  });
}

function expectRuleError(run: () => unknown, code: RuleViolationError['code']) {
  try {
    run();
    throw new Error('Expected move to be rejected');
  } catch (error) {
    expect(error).toBeInstanceOf(RuleViolationError);
    expect((error as RuleViolationError).code).toBe(code);
  }
}

describe('Goban rule adapter', () => {
  it.each([
    [undefined, 'chinese'],
    ['Japanese', 'japanese'],
    ['AGA Rules', 'aga'],
    ['New-Zealand Rules', 'nz'],
    ['unknown server label', 'chinese'],
  ] as const)('normalizes %s to %s', (label, expected) => {
    expect(normalizeRules(label)).toBe(expected);
  });

  it('captures a surrounded stone without mutating the parent position', () => {
    const board = boardWith([
      ['W', 2, 2],
      ['B', 1, 2],
      ['B', 2, 1],
      ['B', 3, 2],
    ]);
    const game = gameAt(board);

    const result = applyMoveWithRules(game, game.rootId, { color: 'B', point: [2, 3] });

    expect(result.boardState[2][2]).toBeNull();
    expect(result.boardState[2][3]).toBe('B');
    expect(result.captures).toEqual({ black: 1, white: 0 });
    expect(board[2][2]).toBe('W');
  });

  it('rejects suicide under Chinese rules', () => {
    const game = gameAt(boardWith([
      ['W', 1, 2],
      ['W', 2, 1],
      ['W', 2, 3],
      ['W', 3, 2],
    ]));

    expectRuleError(
      () => applyMoveWithRules(game, game.rootId, { color: 'B', point: [2, 2] }),
      'illegal_self_capture',
    );
  });

  it('allows self-capture under New Zealand rules and credits the opponent', () => {
    const game = gameAt(boardWith([
      ['W', 1, 2],
      ['W', 2, 1],
      ['W', 2, 3],
      ['W', 3, 2],
    ]), 'New Zealand');

    const result = applyMoveWithRules(game, game.rootId, { color: 'B', point: [2, 2] });

    expect(result.boardState[2][2]).toBeNull();
    expect(result.captures).toEqual({ black: 0, white: 1 });
  });

  it('rejects occupied and out-of-bounds moves with stable error codes', () => {
    const game = gameAt(boardWith([['B', 0, 0]]));

    expectRuleError(
      () => applyMoveWithRules(game, game.rootId, { color: 'W', point: [0, 0] }),
      'stone_already_placed_here',
    );
    expectRuleError(
      () => applyMoveWithRules(game, game.rootId, { color: 'W', point: [-1, 0] }),
      'move_out_of_bounds',
    );
  });

  it('rejects an immediate ko recapture', () => {
    const game = gameAt(boardWith([
      ['W', 1, 1],
      ['B', 0, 1],
      ['B', 1, 0],
      ['B', 2, 1],
      ['W', 0, 2],
      ['W', 1, 3],
      ['W', 2, 2],
    ]));
    const capture = attachAppliedMove(game, game.rootId, 'B', [1, 2]);

    expect(capture.node.boardState[1][1]).toBeNull();
    expectRuleError(
      () => applyMoveWithRules(capture.game, capture.node.id, { color: 'W', point: [1, 1] }),
      'illegal_ko_move',
    );
  });

  it('allows two passes even though they leave the board unchanged', () => {
    const game = createEmptyGame(9);
    const blackPass = applyMoveWithRules(game, game.rootId, { color: 'B', point: 'pass' });
    const afterBlack = playFrom(game, game.rootId, {
      move: { color: 'B', point: 'pass' },
      ...blackPass,
    });

    const whitePass = applyMoveWithRules(afterBlack.game, afterBlack.node.id, {
      color: 'W',
      point: 'pass',
    });

    expect(blackPass.boardState).toEqual(game.nodes[game.rootId].boardState);
    expect(whitePass.boardState).toEqual(blackPass.boardState);
    expect(whitePass.nextPlayer).toBe('B');
  });

  it('checks positional superko across more than 30 ancestors', () => {
    let game = createEmptyGame(9);
    game.metadata.rules = 'chinese';
    let parentId = game.rootId;

    for (let index = 1; index <= 31; index++) {
      const board = createEmptyBoard(9);
      board[Math.floor(index / 9)][index % 9] = index % 2 === 0 ? 'B' : 'W';
      const attached = attachSyntheticPosition(
        game,
        parentId,
        board,
        index % 2 === 0 ? 'B' : 'W',
      );
      game = attached.game;
      parentId = attached.node.id;
    }

    expect(
      repetitionViolation(game, parentId, createEmptyBoard(9), 'B', 'chinese'),
    ).toBe('superko');
  });

  it('uses the player to move for situational superko', () => {
    const repeated = createEmptyBoard(5);
    const game = createEmptyGame(5);
    game.metadata.rules = 'aga';
    const firstBoard = boardWith([['B', 0, 0]]);
    const first = attachSyntheticPosition(game, game.rootId, firstBoard, 'W');
    const parentBoard = boardWith([['W', 4, 4]]);
    const parent = attachSyntheticPosition(first.game, first.node.id, parentBoard, 'B');

    expect(repetitionViolation(parent.game, parent.node.id, repeated, 'W', 'aga')).toBeNull();
    expect(repetitionViolation(parent.game, parent.node.id, repeated, 'B', 'aga')).toBe('superko');
  });

  it('only considers ancestors on the active branch for superko', () => {
    const game = createEmptyGame(5);
    game.metadata.rules = 'chinese';
    const siblingBoard = boardWith([['B', 0, 0]]);
    const sibling = attachSyntheticPosition(game, game.rootId, siblingBoard, 'W');
    const otherBoard = boardWith([['B', 1, 1]]);
    const other = attachSyntheticPosition(sibling.game, sibling.game.rootId, otherBoard, 'B');

    expect(
      repetitionViolation(other.game, other.node.id, siblingBoard, 'B', 'chinese'),
    ).toBeNull();
  });
});
