import { describe, expect, it } from 'vitest';
import { parseSgf } from './sgf';

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
    expect(game.nodes).toHaveLength(4);
    expect(game.nodes[2].move).toEqual({ color: 'W', point: 'pass' });
    expect(game.nodes[2].boardState).toEqual(game.nodes[1].boardState);
    expect(game.nodes[3].boardState[4][4]).toBe('B');
  });

  it('loads handicap stones and gives White the first turn', () => {
    const game = parseSgf('(;FF[4]GM[1]SZ[9]HA[2]AB[cc][gg]PL[W];W[ee])');

    expect(game.initialStones).toEqual([
      { color: 'B', point: [2, 2] },
      { color: 'B', point: [6, 6] },
    ]);
    expect(game.nodes[0].boardState[2][2]).toBe('B');
    expect(game.nodes[0].boardState[6][6]).toBe('B');
    expect(game.nodes[0].nextPlayer).toBe('W');
    expect(game.nodes[1].move?.color).toBe('W');
  });

  it('expands compressed setup-stone rectangles', () => {
    const game = parseSgf('(;FF[4]GM[1]SZ[9]AB[aa:bb])');
    expect(game.initialStones).toHaveLength(4);
    expect(game.nodes[0].boardState[0][0]).toBe('B');
    expect(game.nodes[0].boardState[1][1]).toBe('B');
  });

  it.each(['', 'not sgf', '()', '(;SZ[19]'])('rejects malformed SGF: %j', (value) => {
    expect(() => parseSgf(value)).toThrow(/Invalid SGF/);
  });

  it.each(['1', 'banana', '26'])('rejects unsupported board size %s', (size) => {
    expect(() => parseSgf(`(;FF[4]GM[1]SZ[${size}])`)).toThrow(/board size/);
  });
});
