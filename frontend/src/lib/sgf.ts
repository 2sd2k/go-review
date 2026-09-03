import { parse } from '@sabaki/sgf';
import type { Game, GameNode, GameMetadata, BoardState, Move, StoneColor, Point } from '../types/game';
import { createEmptyBoard } from '../types/game';
import { applyMove } from './goLogic';
import { sgfToPoint } from './coordinates';

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

/** Walk the main variation (first child at each branch) and collect moves */
function collectMoves(root: SgfNode, boardSize: number): { move: Move | null; comment?: string }[] {
  const moves: { move: Move | null; comment?: string }[] = [];
  let current: SgfNode | null = root;

  while (current) {
    const black = prop(current, 'B');
    const white = prop(current, 'W');
    const comment = prop(current, 'C');

    if (black !== undefined) {
      const move: Move = {
        color: 'B',
        point: black === '' || (black === 'tt' && boardSize <= 19) ? 'pass' : sgfToPoint(black),
      };
      moves.push({ move, comment });
    } else if (white !== undefined) {
      const move: Move = {
        color: 'W',
        point: white === '' || (white === 'tt' && boardSize <= 19) ? 'pass' : sgfToPoint(white),
      };
      moves.push({ move, comment });
    } else if (moves.length === 0) {
      // Root node — no move
      moves.push({ move: null, comment });
    }

    // Follow main variation (first child)
    current = current.children.length > 0 ? current.children[0] : null;
  }

  return moves;
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

function nextPlayerAt(
  rawMoves: { move: Move | null }[],
  index: number,
  currentMove: Move | null,
  root: SgfNode,
): StoneColor {
  for (let i = index + 1; i < rawMoves.length; i++) {
    const futureMove = rawMoves[i].move;
    if (futureMove) return futureMove.color;
  }
  const explicit = prop(root, 'PL');
  if (!currentMove && (explicit === 'B' || explicit === 'W')) return explicit;
  if (currentMove) return currentMove.color === 'B' ? 'W' : 'B';
  return (root.data.AB?.length ?? 0) > 1 ? 'W' : 'B';
}

/**
 * Parse an SGF string into our Game type.
 * Precomputes the board state at every move for instant navigation.
 */
export function parseSgf(sgfText: string): Game {
  const trimmed = sgfText.trim();
  if (!trimmed.startsWith('(;') || !trimmed.endsWith(')')) {
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
  const metadata = extractMetadata(root);
  const rawMoves = collectMoves(root, size);

  // Build game nodes with precomputed board states
  const nodes: GameNode[] = [];
  let currentBoard: BoardState = createEmptyBoard(size);
  const initialStones = applyRootSetup(currentBoard, root);
  let totalCapturesBlack = 0;
  let totalCapturesWhite = 0;

  for (let i = 0; i < rawMoves.length; i++) {
    const { move, comment } = rawMoves[i];

    if (!move) {
      // Root node
      nodes.push({
        move: null,
        boardState: currentBoard,
        moveNumber: 0,
        comment,
        captures: { black: 0, white: 0 },
        nextPlayer: nextPlayerAt(rawMoves, i, move, root),
      });
      continue;
    }

    if (move.point === 'pass') {
      nodes.push({
        move,
        boardState: currentBoard,
        moveNumber: i,
        comment,
        captures: { black: totalCapturesBlack, white: totalCapturesWhite },
        nextPlayer: nextPlayerAt(rawMoves, i, move, root),
      });
      continue;
    }

    try {
      const result = applyMove(currentBoard, move.point as Point, move.color as StoneColor);
      currentBoard = result.board;

      if (move.color === 'B') {
        totalCapturesBlack += result.captured.length;
      } else {
        totalCapturesWhite += result.captured.length;
      }

      nodes.push({
        move,
        boardState: currentBoard,
        moveNumber: i,
        comment,
        captures: { black: totalCapturesBlack, white: totalCapturesWhite },
        nextPlayer: nextPlayerAt(rawMoves, i, move, root),
      });
    } catch (err) {
      // If a move is illegal (rare in real games), skip it but keep going
      console.warn(`Skipping illegal move ${i}:`, err);
      nodes.push({
        move,
        boardState: currentBoard,
        moveNumber: i,
        comment: comment ? `${comment} [illegal move skipped]` : '[illegal move skipped]',
        captures: { black: totalCapturesBlack, white: totalCapturesWhite },
        nextPlayer: nextPlayerAt(rawMoves, i, move, root),
      });
    }
  }

  // Ensure we have at least a root node
  if (nodes.length === 0) {
    nodes.push({
      move: null,
      boardState: createEmptyBoard(size),
      moveNumber: 0,
      captures: { black: 0, white: 0 },
      nextPlayer: prop(root, 'PL') === 'W' ? 'W' : 'B',
    });
  }

  return { size, nodes, metadata, initialStones };
}
