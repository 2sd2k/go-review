import type { BoardMark, BoardMarkKind, Point } from '../types/game';
import { pointToSgf, sgfToPoint } from './coordinates';

export const SGF_MARK_PROPERTIES: Record<BoardMarkKind, string> = {
  triangle: 'TR',
  circle: 'CR',
  square: 'SQ',
};

const PROPERTY_TO_KIND: Record<string, BoardMarkKind> = {
  TR: 'triangle',
  CR: 'circle',
  SQ: 'square',
};

export function pointsEqual(a: Point, b: Point): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

export function toggleMark(
  marks: BoardMark[],
  point: Point,
  kind: BoardMarkKind,
): BoardMark[] {
  const existing = marks.find((mark) => pointsEqual(mark.point, point));
  const withoutPoint = marks.filter((mark) => !pointsEqual(mark.point, point));
  if (existing?.kind === kind) return withoutPoint;
  return [...withoutPoint, { kind, point }];
}

function expandSgfPoints(value: string): Point[] {
  const [start, end] = value.split(':');
  const [startRow, startCol] = sgfToPoint(start);
  const [endRow, endCol] = end ? sgfToPoint(end) : [startRow, startCol];
  const points: Point[] = [];
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) points.push([row, col]);
  }
  return points;
}

export function parseSgfMarks(data: Record<string, string[]>): BoardMark[] {
  const byPoint = new Map<string, BoardMark>();
  for (const [property, kind] of Object.entries(PROPERTY_TO_KIND)) {
    for (const value of data[property] ?? []) {
      if (!value) continue;
      for (const point of expandSgfPoints(value)) {
        byPoint.set(`${point[0]},${point[1]}`, { kind, point });
      }
    }
  }
  return [...byPoint.values()];
}

export function marksToSgfProps(marks: BoardMark[] | undefined): Record<string, string[]> {
  if (!marks?.length) return {};
  const grouped: Record<string, string[]> = {};
  for (const mark of marks) {
    const property = SGF_MARK_PROPERTIES[mark.kind];
    (grouped[property] ??= []).push(pointToSgf(mark.point));
  }
  return grouped;
}
