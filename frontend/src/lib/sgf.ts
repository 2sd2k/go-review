import { parse, stringify } from '@sabaki/sgf';
import type { Game, GameNode, GameMetadata, BoardState, Move, StoneColor, Point } from '../types/game';
import { createEmptyBoard } from '../types/game';
import { applyMove, cloneBoard, opponent } from './goLogic';
import { pointToSgf, sgfToPoint } from './coordinates';
import { attachChild, getNode } from './moveTree';
import { marksToSgfProps, parseSgfMarks } from './marks';

interface SgfNode {
  id: number;
  data: Record<string, string[]>;
  children: SgfNode[];
}

/** Get first value of an SGF property, or undefined */
function prop(node: SgfNode, key: string): string | undefined {
  return node.data[key]?.[0];
}

/** Extract game metadata from the root SGF node */
function extractMetadata(root: SgfNode): GameMetadata {
  return {
    blackPlayer: prop(root, 'PB'),
    whitePlayer: prop(root, 'PW'),
    blackRank: prop(root, 'BR'),
    whiteRank: prop(root, 'WR'),
    result: prop(root, 'RE'),
    komi: prop(root, 'KM') ? parseFloat(prop(root, 'KM')!) : undefined,
    date: prop(root, 'DT'),
    event: prop(root, 'EV'),
    rules: prop(root, 'RU')?.toLowerCase(),
  };
}

function setupPoints(value: string): Point[] {
  const [start, end] = value.split(':');
  const [startRow, startCol] = sgfToPoint(start);
  const [endRow, endCol] = end ? sgfToPoint(end) : [startRow, startCol];
  const points: Point[] = [];

  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) points.push([row, col]);
  }
  return points;
}

function applyRootSetup(board: BoardState, root: SgfNode): Move[] {
  const stones: Move[] = [];
  for (const [property, color] of [['AB', 'B'], ['AW', 'W']] as const) {
    for (const value of root.data[property] ?? []) {
      for (const [row, col] of setupPoints(value)) {
        if (row < 0 || row >= board.length || col < 0 || col >= board.length) {
          throw new Error(`Invalid setup stone: ${value}`);
        }
        board[row][col] = color;
        stones.push({ color, point: [row, col] });
      }
    }
  }
  return stones;
}

function parseMove(sgfNode: SgfNode, boardSize: number): Move | null {
  const black = prop(sgfNode, 'B');
  const white = prop(sgfNode, 'W');
  if (black !== undefined) {
    return {
      color: 'B',
      point: black === '' || (black === 'tt' && boardSize <= 19) ? 'pass' : sgfToPoint(black),
    };
  }
  if (white !== undefined) {
    return {
      color: 'W',
      point: white === '' || (white === 'tt' && boardSize <= 19) ? 'pass' : sgfToPoint(white),
    };
  }
  return null;
}

function nextPlayerFor(
  sgfNode: SgfNode,
  move: Move | null,
  root: SgfNode,
  boardSize: number,
): StoneColor {
  for (const child of sgfNode.children) {
    const childMove = parseMove(child, boardSize);
    if (childMove) return childMove.color;
  }
  const explicit = prop(root, 'PL');
  if (!move && (explicit === 'B' || explicit === 'W')) return explicit;
  if (move) return opponent(move.color);
  return (root.data.AB?.length ?? 0) > 1 ? 'W' : 'B';
}

function applyPlayedMove(
  parent: GameNode,
  move: Move,
): { boardState: BoardState; captures: GameNode['captures']; commentSuffix?: string } {
  if (move.point === 'pass') {
    return { boardState: parent.boardState, captures: parent.captures };
  }

  try {
    const result = applyMove(parent.boardState, move.point as Point, move.color);
    return {
      boardState: result.board,
      captures: {
        black: parent.captures.black + (move.color === 'B' ? result.captured.length : 0),
        white: parent.captures.white + (move.color === 'W' ? result.captured.length : 0),
      },
    };
  } catch (err) {
    console.warn(`Skipping illegal move ${parent.moveNumber + 1}:`, err);
    return {
      boardState: parent.boardState,
      captures: parent.captures,
      commentSuffix: '[illegal move skipped]',
    };
  }
}

function ingestChildren(
  game: Game,
  parentId: number,
  sgfNode: SgfNode,
  root: SgfNode,
  boardSize: number,
  parentIsTrunk: boolean,
): Game {
  let nextGame = game;
  sgfNode.children.forEach((child, index) => {
    const asTrunk = parentIsTrunk && index === 0;
    nextGame = ingestNode(nextGame, parentId, child, root, boardSize, asTrunk);
  });
  return nextGame;
}

function ingestNode(
  game: Game,
  parentId: number,
  sgfNode: SgfNode,
  root: SgfNode,
  boardSize: number,
  asTrunk: boolean,
): Game {
  const parent = getNode(game, parentId);
  const move = parseMove(sgfNode, boardSize);
  const rawComment = prop(sgfNode, 'C');
  let comment = rawComment;
  let boardState = parent.boardState;
  let captures = parent.captures;
  let moveNumber = parent.moveNumber;

  if (move) {
    const played = applyPlayedMove(parent, move);
    boardState = played.boardState;
    captures = played.captures;
    moveNumber = parent.moveNumber + 1;
    if (played.commentSuffix) {
      comment = comment ? `${comment} ${played.commentSuffix}` : played.commentSuffix;
    }
  }

  const { game: withChild, node } = attachChild(game, parentId, {
    trunkNextId: null,
    branchIds: [],
    hintNextId: null,
    trunk: asTrunk,
    move,
    boardState,
    moveNumber,
    comment,
    captures,
    nextPlayer: nextPlayerFor(sgfNode, move, root, boardSize),
    marks: parseSgfMarks(sgfNode.data),
  });

  return ingestChildren(withChild, node.id, sgfNode, root, boardSize, asTrunk);
}

/**
 * Parse an SGF string into a Game tree.
 * The first child at each trunk node is the official line; remaining children
 * become branches. Comments stay on the node that owned the `C` property.
 */
export function parseSgf(sgfText: string): Game {
  const trimmed = sgfText.trim();
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) {
    throw new Error('Invalid SGF: expected a complete game tree');
  }

  const trees = parse(sgfText) as SgfNode[];
  if (!trees || trees.length === 0) {
    throw new Error('Invalid SGF: no game trees found');
  }

  const root = trees[0];
  const sizeStr = prop(root, 'SZ');
  const size = sizeStr ? parseInt(sizeStr) : 19;
  if (!Number.isInteger(size) || size < 2 || size > 25) {
    throw new Error(`Invalid or unsupported board size: ${sizeStr ?? size}`);
  }

  const board = createEmptyBoard(size);
  const initialStones = applyRootSetup(board, root);
  const rootComment = prop(root, 'C');
  const rootNode: GameNode = {
    id: 0,
    parentId: null,
    trunkNextId: null,
    branchIds: [],
    hintNextId: null,
    trunk: true,
    move: null,
    boardState: cloneBoard(board),
    moveNumber: 0,
    comment: rootComment,
    captures: { black: 0, white: 0 },
    nextPlayer: nextPlayerFor(root, null, root, size),
    marks: parseSgfMarks(root.data),
  };

  const game: Game = {
    size,
    rootId: 0,
    nodes: { 0: rootNode },
    nextId: 1,
    metadata: extractMetadata(root),
    initialStones,
  };

  return ingestChildren(game, 0, root, root, size, true);
}

function metadataProps(game: Game): Record<string, string[]> {
  const data: Record<string, string[]> = {
    FF: ['4'],
    GM: ['1'],
    SZ: [String(game.size)],
    CA: ['UTF-8'],
  };
  const meta = game.metadata;
  if (meta.blackPlayer) data.PB = [meta.blackPlayer];
  if (meta.whitePlayer) data.PW = [meta.whitePlayer];
  if (meta.blackRank) data.BR = [meta.blackRank];
  if (meta.whiteRank) data.WR = [meta.whiteRank];
  if (meta.result) data.RE = [meta.result];
  if (meta.komi != null && !Number.isNaN(meta.komi)) data.KM = [String(meta.komi)];
  if (meta.date) data.DT = [meta.date];
  if (meta.event) data.EV = [meta.event];
  if (meta.rules) data.RU = [meta.rules];
  return data;
}

function setupProps(game: Game): Record<string, string[]> {
  const black = game.initialStones
    .filter((stone) => stone.color === 'B' && stone.point !== 'pass')
    .map((stone) => pointToSgf(stone.point as Point));
  const white = game.initialStones
    .filter((stone) => stone.color === 'W' && stone.point !== 'pass')
    .map((stone) => pointToSgf(stone.point as Point));
  const data: Record<string, string[]> = {};
  if (black.length) data.AB = black;
  if (white.length) data.AW = white;
  return data;
}

function toSgfNode(game: Game, nodeId: number, isRoot: boolean): SgfNode {
  const node = getNode(game, nodeId);
  const data: Record<string, string[]> = {};

  if (isRoot) {
    Object.assign(data, metadataProps(game), setupProps(game));
    if (node.nextPlayer === 'W') data.PL = ['W'];
  } else if (node.move) {
    const value = node.move.point === 'pass' ? '' : pointToSgf(node.move.point);
    data[node.move.color] = [value];
  }

  if (node.comment) data.C = [node.comment];
  Object.assign(data, marksToSgfProps(node.marks));

  const children: SgfNode[] = [];
  if (node.trunkNextId != null) children.push(toSgfNode(game, node.trunkNextId, false));
  for (const branchId of node.branchIds) children.push(toSgfNode(game, branchId, false));

  return { id: node.id, data, children };
}

/** Serialize the full variation tree, trunk first, preserving per-node comments. */
export function exportSgf(game: Game): string {
  return stringify([toSgfNode(game, game.rootId, true)]);
}
