import { describe, expect, it } from 'vitest';
import { marksToSgfProps, parseSgfMarks, toggleMark } from './marks';

describe('board marks', () => {
  it('adds, replaces, and removes a mark on the same point', () => {
    const added = toggleMark([], [3, 3], 'triangle');
    expect(added).toEqual([{ kind: 'triangle', point: [3, 3] }]);

    const replaced = toggleMark(added, [3, 3], 'circle');
    expect(replaced).toEqual([{ kind: 'circle', point: [3, 3] }]);

    expect(toggleMark(replaced, [3, 3], 'circle')).toEqual([]);
  });

  it('parses SGF markup properties, including compressed rectangles', () => {
    expect(parseSgfMarks({ TR: ['dd'], CR: ['aa:ba'], SQ: ['cc'] })).toEqual([
      { kind: 'triangle', point: [3, 3] },
      { kind: 'circle', point: [0, 0] },
      { kind: 'circle', point: [0, 1] },
      { kind: 'square', point: [2, 2] },
    ]);
  });

  it('serializes marks back to SGF properties', () => {
    expect(marksToSgfProps([
      { kind: 'triangle', point: [3, 3] },
      { kind: 'square', point: [1, 1] },
    ])).toEqual({
      TR: ['dd'],
      SQ: ['bb'],
    });
  });
});
