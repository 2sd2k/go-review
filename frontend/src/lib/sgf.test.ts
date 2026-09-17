import { describe, expect, it } from 'vitest';
import { exportSgf, parseSgf } from './sgf';
import { childIds, getNode, trunkLine } from './moveTree';

describe('SGF parsing', () => {
  it('parses metadata, passes, and ordinary moves', () => {
    const game = parseSgf(
      '(;FF[4]GM[1]SZ[9]KM[6.5]RU[Japanese]PB[Lee]PW[Cho];B[dd];W[];B[ee])',
    );

    expect(game.size).toBe(9);
    expect(game.metadata).toMatchObject({
      blackPlayer: 'Lee',
      whitePlayer: 'Cho',
      komi: 6.5,
      rules: 'japanese',
    });
    const nodes = trunkLine(game);
    expect(nodes).toHaveLength(4);
    expect(nodes[2].move).toEqual({ color: 'W', point: 'pass' });
    expect(nodes[2].boardState).toEqual(nodes[1].boardState);
    expect(nodes[3].boardState[4][4]).toBe('B');
  });

  it('loads handicap stones and gives White the first turn', () => {
    const game = parseSgf('(;FF[4]GM[1]SZ[9]HA[2]AB[cc][gg]PL[W];W[ee])');
    const root = getNode(game, game.rootId);

    expect(game.initialStones).toEqual([
      { color: 'B', point: [2, 2] },
      { color: 'B', point: [6, 6] },
    ]);
    expect(root.boardState[2][2]).toBe('B');
    expect(root.boardState[6][6]).toBe('B');
    expect(root.nextPlayer).toBe('W');
    expect(trunkLine(game)[1].move?.color).toBe('W');
  });

  it('expands compressed setup-stone rectangles', () => {
    const game = parseSgf('(;FF[4]GM[1]SZ[9]AB[aa:bb])');
    const root = getNode(game, game.rootId);
    expect(game.initialStones).toHaveLength(4);
    expect(root.boardState[0][0]).toBe('B');
    expect(root.boardState[1][1]).toBe('B');
  });

  it.each(['', 'not sgf', '()', '(;SZ[19]'])('rejects malformed SGF: %j', (value) => {
    expect(() => parseSgf(value)).toThrow(/Invalid SGF/);
  });

  it.each(['1', 'banana', '26'])('rejects unsupported board size %s', (size) => {
    expect(() => parseSgf(`(;FF[4]GM[1]SZ[${size}])`)).toThrow(/board size/);
  });

  it('loads every variation and keeps comments on the original nodes', () => {
    const game = parseSgf(
      '(;FF[4]GM[1]SZ[9]C[root note];B[dd]C[black opening](;W[ee]C[main line];B[ff])(;W[cc]C[sideline];B[gg]C[side black]))',
    );

    const root = getNode(game, game.rootId);
    expect(root.comment).toBe('root note');
    expect(childIds(root)).toHaveLength(1);

    const black = getNode(game, root.trunkNextId!);
    expect(black.comment).toBe('black opening');
    expect(black.trunk).toBe(true);
    expect(black.trunkNextId).not.toBeNull();
    expect(black.branchIds).toHaveLength(1);

    const mainWhite = getNode(game, black.trunkNextId!);
    expect(mainWhite.move).toEqual({ color: 'W', point: [4, 4] });
    expect(mainWhite.comment).toBe('main line');
    expect(mainWhite.trunk).toBe(true);

    const sideWhite = getNode(game, black.branchIds[0]);
    expect(sideWhite.move).toEqual({ color: 'W', point: [2, 2] });
    expect(sideWhite.comment).toBe('sideline');
    expect(sideWhite.trunk).toBe(false);
    expect(getNode(game, sideWhite.branchIds[0]).comment).toBe('side black');
  });

  it('round-trips variations and comments through export', () => {
    const original =
      '(;FF[4]GM[1]SZ[9]C[root note];B[dd]C[black opening](;W[ee]C[main line];B[ff])(;W[cc]C[sideline];B[gg]C[side black]))';
    const again = parseSgf(exportSgf(parseSgf(original)));

    const root = getNode(again, again.rootId);
    const black = getNode(again, root.trunkNextId!);
    expect(root.comment).toBe('root note');
    expect(black.comment).toBe('black opening');
    expect(getNode(again, black.trunkNextId!).comment).toBe('main line');
    expect(getNode(again, black.branchIds[0]).comment).toBe('sideline');
    expect(getNode(again, getNode(again, black.branchIds[0]).branchIds[0]).comment).toBe('side black');
  });

  it('loads and exports triangle, circle, and square marks on their original nodes', () => {
    const game = parseSgf('(;FF[4]GM[1]SZ[9]TR[aa];B[dd]CR[ee]SQ[ff])');
    const root = getNode(game, game.rootId);
    const black = getNode(game, root.trunkNextId!);

    expect(root.marks).toEqual([{ kind: 'triangle', point: [0, 0] }]);
    expect(black.marks).toEqual([
      { kind: 'circle', point: [4, 4] },
      { kind: 'square', point: [5, 5] },
    ]);

    const again = parseSgf(exportSgf(game));
    expect(getNode(again, again.rootId).marks).toEqual(root.marks);
    expect(getNode(again, getNode(again, again.rootId).trunkNextId!).marks).toEqual(black.marks);
  });
});
