import { describe, expect, it } from 'vitest';
import { displayToPoint, pointToDisplay, pointToSgf, sgfToPoint } from './coordinates';

describe('coordinate conversion', () => {
  it.each([
    [[0, 0] as [number, number], 19, 'A19'],
    [[3, 15] as [number, number], 19, 'Q16'],
    [[8, 8] as [number, number], 9, 'J1'],
    [[12, 12] as [number, number], 13, 'N1'],
  ])('converts board point %j on size %i to %s and back', (point, size, display) => {
    expect(pointToDisplay(point, size)).toBe(display);
    expect(displayToPoint(display, size)).toEqual(point);
  });

  it('skips I in GTP coordinates', () => {
    expect(displayToPoint('J9', 9)).toEqual([0, 8]);
  });

  it('round-trips SGF coordinates', () => {
    expect(sgfToPoint('pd')).toEqual([3, 15]);
    expect(pointToSgf([3, 15])).toBe('pd');
  });

  it.each(['I9', 'A0', 'A20', 'Z1', 'nope'])('rejects invalid display coordinate %s', (value) => {
    expect(() => displayToPoint(value, 19)).toThrow();
  });

  it('rejects malformed SGF coordinates', () => {
    expect(() => sgfToPoint('')).toThrow(/Invalid SGF coordinate/);
    expect(() => sgfToPoint('aaa')).toThrow(/Invalid SGF coordinate/);
  });
});
