import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { paintedTriangle } from './paintedTriangle';

const triangle = (): [Vector3, Vector3, Vector3] => [
  new Vector3(0, 0, 0), new Vector3(8, 0, 0), new Vector3(0, 8, 0),
];

describe('slicer paint subdivision', () => {
  it.each([['0', 0], ['4', 1], ['8', 2], ['0C', 3], ['EC', 17], ['0FC', 18], ['EFC', 32]])(
    'decodes filament state %s as %i', (paint, filament) => {
      const result: number[] = [];
      paintedTriangle(triangle(), paint, (_, state) => result.push(state));
      expect(result).toEqual([filament]);
    },
  );

  it.each(['1', '5', '9', '2', '6', 'A', '3'])('preserves area and winding for split %s', (code) => {
    const splits = Number.parseInt(code, 16) & 3;
    const paint = '4'.repeat(splits + 1) + code;
    const areas: number[] = [];
    paintedTriangle(triangle(), paint, ([a, b, c], filament) => {
      expect(filament).toBe(1);
      areas.push(b.clone().sub(a).cross(c.clone().sub(a)).z / 2);
    });
    expect(areas).toHaveLength(splits + 1);
    expect(areas.every((area) => area > 0)).toBe(true);
    expect(areas.reduce((sum, area) => sum + area, 0)).toBe(32);
  });

  it('reads children in reverse order and keeps their spatial color assignment', () => {
    const result: { filament: number; points: number[][] }[] = [];
    paintedTriangle(triangle(), '481', (vertices, filament) => {
      result.push({ filament, points: vertices.map((vertex) => vertex.toArray()) });
    });
    expect(result).toEqual([
      { filament: 2, points: [[4, 4, 0], [0, 8, 0], [0, 0, 0]] },
      { filament: 1, points: [[0, 0, 0], [8, 0, 0], [4, 4, 0]] },
    ]);
  });

  it('handles nested splits', () => {
    let count = 0;
    let area = 0;
    paintedTriangle(triangle(), '44811', ([a, b, c]) => {
      count++;
      area += b.clone().sub(a).cross(c.clone().sub(a)).z / 2;
    });
    expect(count).toBe(3);
    expect(area).toBe(32);
  });

  it.each(['xyz', 'C', '1', '44D', '440', '4447'])('rejects malformed paint %s explicitly', (paint) => {
    expect(() => paintedTriangle(triangle(), paint, () => {})).toThrow(/paint/i);
  });
});
