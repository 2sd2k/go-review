import {
  GobanEngine,
  JGOFNumericPlayerColor,
  type GobanEngineRules,
  type GobanMoveErrorMessageId,
} from 'goban-engine';
import type { BoardState, Game, GameNode, Move, Point, StoneColor } from '../types/game';
import { ancestors, getNode } from './moveTree';

export type RuleViolationCode =
  | GobanMoveErrorMessageId
  | 'move_out_of_bounds'
  | 'illegal_ko_move'
  | 'illegal_board_repetition';

export class RuleViolationError extends Error {
  public readonly code: RuleViolationCode;

  constructor(code: RuleViolationCode) {
    super(ruleViolationMessage(code));
    this.code = code;
    this.name = 'RuleViolationError';
  }
}

export interface AppliedRuleMove {
  boardState: BoardState;
  captures: GameNode['captures'];
  nextPlayer: StoneColor;
}

export type RepetitionViolation = 'ko' | 'superko' | null;

const RULE_ALIASES: Array<[GobanEngineRules, string[]]> = [
  ['japanese', ['japanese', 'japan']],
  ['korean', ['korean', 'korea']],
  ['aga', ['aga', 'american']],
  ['ing', ['ing', 'ing rules']],
  ['nz', ['nz', 'new zealand', 'newzealand']],
  ['chinese', ['chinese', 'china']],
];

/** Map common SGF rule labels onto the presets supported by GobanEngine. */
export function normalizeRules(rules?: string): GobanEngineRules {
  const normalized = rules?.trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (!normalized) return 'chinese';

  for (const [preset, aliases] of RULE_ALIASES) {
    if (aliases.some((alias) => normalized === alias || normalized.startsWith(`${alias} `))) {
      return preset;
    }
  }
  return 'chinese';
}

function ruleViolationMessage(code: RuleViolationCode): string {
  switch (code) {
    case 'stone_already_placed_here':
      return 'That point is already occupied.';
    case 'illegal_self_capture':
      return 'That move is suicide under the selected rules.';
    case 'illegal_ko_move':
      return 'That move violates ko.';
    case 'illegal_board_repetition':
      return 'That move repeats an earlier position.';
    case 'move_out_of_bounds':
      return 'That move is outside the board.';
    default:
      return 'That move is not legal.';
  }
}

function toNumericBoard(board: BoardState): JGOFNumericPlayerColor[][] {
  return board.map((row) => row.map((stone) => {
    if (stone === 'B') return JGOFNumericPlayerColor.BLACK;
    if (stone === 'W') return JGOFNumericPlayerColor.WHITE;
    return JGOFNumericPlayerColor.EMPTY;
  }));
}

function fromNumericBoard(board: JGOFNumericPlayerColor[][]): BoardState {
  return board.map((row) => row.map((stone) => {
    if (stone === JGOFNumericPlayerColor.BLACK) return 'B';
    if (stone === JGOFNumericPlayerColor.WHITE) return 'W';
    return null;
  }));
}

function boardKey(board: BoardState): string {
  return board.map((row) => row.map((stone) => stone ?? '.').join('')).join('/');
}

function superkoMode(rules: GobanEngineRules): 'psk' | 'ssk' | null {
  if (rules === 'aga' || rules === 'nz') return 'ssk';
  if (rules === 'chinese' || rules === 'ing') return 'psk';
  return null;
}

/**
 * Check the complete active branch, rather than GobanEngine's bounded
 * superko scan. Passes are handled by the caller and do not enter this check.
 */
export function repetitionViolation(
  game: Game,
  parentId: number,
  nextBoard: BoardState,
  nextPlayer: StoneColor,
  rules: GobanEngineRules = normalizeRules(game.metadata.rules),
): RepetitionViolation {
  const history = ancestors(game, parentId);
  const nextKey = boardKey(nextBoard);

  // Simple ko is prohibited by every supported preset, even rulesets that
  // treat longer cycles as no-result rather than illegal.
  const grandparent = history.at(-2);
  if (grandparent && boardKey(grandparent.boardState) === nextKey) return 'ko';

  const mode = superkoMode(rules);
  if (!mode) return null;

  for (const node of history) {
    if (boardKey(node.boardState) !== nextKey) continue;
    if (mode === 'psk' || node.nextPlayer === nextPlayer) return 'superko';
  }
  return null;
}

function errorCode(error: unknown): RuleViolationCode {
  if (typeof error === 'object' && error !== null && 'message_id' in error) {
    return String(error.message_id) as GobanMoveErrorMessageId;
  }
  return 'move_error';
}

/** Apply one move using OGS rules while keeping our immutable game tree. */
export function applyMoveWithRules(game: Game, parentId: number, move: Move): AppliedRuleMove {
  const parent = getNode(game, parentId);
  const rules = normalizeRules(game.metadata.rules);
  const engine = new GobanEngine({
    width: game.size,
    height: game.size,
    board: toNumericBoard(parent.boardState),
    initial_player: move.color === 'B' ? 'black' : 'white',
    rules,
    komi: game.metadata.komi,
    throw_all_errors: true,
  });

  let x = -1;
  let y = -1;
  if (move.point !== 'pass') {
    const point = move.point as Point;
    [y, x] = point;
    if (
      !Number.isInteger(x)
      || !Number.isInteger(y)
      || x < 0
      || y < 0
      || x >= game.size
      || y >= game.size
    ) {
      throw new RuleViolationError('move_out_of_bounds');
    }
  }

  try {
    // Our immutable ancestor chain performs complete ko/superko checks below.
    // Disabling Goban's bounded repetition scan avoids its 30-position limit.
    engine.place(x, y, false, false, true, false, false);
  } catch (error) {
    throw new RuleViolationError(errorCode(error));
  }

  const boardState = fromNumericBoard(engine.board);
  const nextPlayer: StoneColor = engine.colorToMove() === 'black' ? 'B' : 'W';

  if (move.point !== 'pass') {
    const repetition = repetitionViolation(game, parentId, boardState, nextPlayer, rules);
    if (repetition === 'ko') throw new RuleViolationError('illegal_ko_move');
    if (repetition === 'superko') {
      throw new RuleViolationError('illegal_board_repetition');
    }
  }

  return {
    boardState,
    captures: {
      black: parent.captures.black + engine.getBlackPrisoners(),
      white: parent.captures.white + engine.getWhitePrisoners(),
    },
    nextPlayer,
  };
}
