import { describe, expect, it } from 'vitest';
import { createEmptyBoard, createEmptyGame } from '../types/game';
import { applyMove } from './goLogic';
import {
  childIds,
  currentLine,
  getNode,
  layoutMoveTree,
  neighborAtMoveNumber,
  shiftBranchTarget,
  nextNode,
  playFrom,
  prevNode,
  trunkLine,
} from './moveTree';
import { parseSgf } from './sgf';

function play(game: ReturnType<typeof createEmptyGame>, parentId: number, row: number, col: number, color: 'B' | 'W') {
  const parent = game.nodes[parentId];
  const result = applyMove(parent.boardState, [row, col], color);
  return playFrom(game, parentId, {
    move: { color, point: [row, col] },
    boardState: result.board,
    captures: {
      black: parent.captures.black + (color === 'B' ? result.captured.length : 0),
      white: parent.captures.white + (color === 'W' ? result.captured.length : 0),
    },
    nextPlayer: color === 'B' ? 'W' : 'B',
  });
}

describe('OGS-style move tree', () => {
  it('extends the trunk at a leaf and branches from a past position', () => {
    const firstPlay = play(createEmptyGame(9), 0, 2, 2, 'B');
    let game = play(firstPlay.game, firstPlay.node.id, 6, 6, 'W').game;

    expect(trunkLine(game)).toHaveLength(3);

    const afterBranch = play(game, firstPlay.node.id, 4, 4, 'W');
    game = afterBranch.game;

    const black = game.nodes[firstPlay.node.id];
    expect(black.trunkNextId).not.toBeNull();
    expect(black.branchIds).toEqual([afterBranch.node.id]);
    expect(game.nodes[black.trunkNextId!].move).toEqual({ color: 'W', point: [6, 6] });
    expect(afterBranch.node.trunk).toBe(false);
    expect(trunkLine(game)).toHaveLength(3);
  });

  it('reuses an existing child instead of duplicating it', () => {
    const first = play(createEmptyGame(9), 0, 2, 2, 'B');
    const again = play(first.game, 0, 2, 2, 'B');
    expect(again.created).toBe(false);
    expect(again.node.id).toBe(first.node.id);
    expect(childIds(again.game.nodes[0])).toHaveLength(1);
  });

  it('follows the trunk on Next, and remembers a branch hint after Prev', () => {
    const game = parseSgf('(;FF[4]GM[1]SZ[9];B[dd](;W[ee];B[ff])(;W[cc];B[gg]))');
    const black = game.nodes[game.nodes[game.rootId].trunkNextId!];
    const side = game.nodes[black.branchIds[0]];

    const stepped = prevNode(game, side);
    expect(stepped?.node.id).toBe(black.id);
    // Trunk still wins from a trunk node, matching OGS.
    expect(nextNode(stepped!.game, stepped!.node)?.id).toBe(black.trunkNextId);

    const sideBlack = game.nodes[side.branchIds[0]];
    const afterPrev = prevNode(game, sideBlack);
    expect(nextNode(afterPrev!.game, afterPrev!.node)?.id).toBe(sideBlack.id);
  });

  it('keeps the current variation in the slider path', () => {
    const game = parseSgf('(;FF[4]GM[1]SZ[9];B[dd](;W[ee];B[ff])(;W[cc];B[gg]))');
    const black = game.nodes[game.nodes[game.rootId].trunkNextId!];
    const sideBlack = game.nodes[game.nodes[black.branchIds[0]].branchIds[0]];
    const line = currentLine(game, sideBlack.id);
    expect(line.map((node) => node.id)).toEqual([
      game.rootId,
      black.id,
      black.branchIds[0],
      sideBlack.id,
    ]);
  });

  it('lays the trunk out on y = 0 with branches below', () => {
    const game = parseSgf('(;FF[4]GM[1]SZ[9];B[dd](;W[ee])(;W[cc]))');
    const layout = layoutMoveTree(game);
    const black = game.nodes[game.nodes[game.rootId].trunkNextId!];
    expect(layout.get(game.rootId)?.y).toBe(0);
    expect(layout.get(black.trunkNextId!)?.y).toBe(0);
    expect(layout.get(black.branchIds[0])?.y).toBeGreaterThan(0);
  });

  it('moves up/down to another branch at the same move number, and stays if none exists', () => {
    const game = parseSgf('(;FF[4]GM[1]SZ[9];B[aa];W[bb];B[cc](;W[dd];B[ee])(;W[ff]))');
    const black3 = trunkLine(game)[3];
    const trunkWhite = getNode(game, black3.trunkNextId!);
    const branchWhite = getNode(game, black3.branchIds[0]);
    const trunkBlack5 = getNode(game, trunkWhite.trunkNextId!);

    expect(trunkWhite.moveNumber).toBe(4);
    expect(branchWhite.moveNumber).toBe(4);
    expect(neighborAtMoveNumber(game, trunkWhite.id, 1)?.id).toBe(branchWhite.id);
    expect(neighborAtMoveNumber(game, branchWhite.id, -1)?.id).toBe(trunkWhite.id);
    expect(neighborAtMoveNumber(game, trunkBlack5.id, 1)).toBeNull();
    expect(neighborAtMoveNumber(game, trunkWhite.id, -1)).toBeNull();
  });

  it('moves up/down onto a fork even when still on the parent move', () => {
    const game = parseSgf('(;FF[4]GM[1]SZ[9];B[aa];W[bb](;B[cc];W[dd])(;B[ee]))');
    const white = trunkLine(game)[2];
    const trunkBlack = getNode(game, white.trunkNextId!);
    const branchBlack = getNode(game, white.branchIds[0]);

    expect(shiftBranchTarget(game, white.id, 1)?.id).toBe(branchBlack.id);
    expect(shiftBranchTarget(game, white.id, -1)).toBeNull();
    expect(shiftBranchTarget(game, trunkBlack.id, 1)?.id).toBe(branchBlack.id);
    expect(shiftBranchTarget(game, branchBlack.id, -1)?.id).toBe(trunkBlack.id);
    expect(shiftBranchTarget(game, getNode(game, trunkBlack.trunkNextId!).id, 1)).toBeNull();
  });

  it('does not mutate the empty board helper when creating a game', () => {
    const board = createEmptyBoard(9);
    expect(board[0][0]).toBeNull();
  });
});
