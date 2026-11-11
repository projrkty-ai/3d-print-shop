import { describe, expect, it } from 'vitest';
import { formatDuration, parseOverrides } from './overrides';

describe('slicer form helpers', () => {
  it('parses option overrides and reports invalid lines', () => {
    expect(parseOverrides('sparse_infill_density = 25%\n# comment\n\nwall_loops=3')).toEqual({
      overrides: { sparse_infill_density: '25%', wall_loops: '3' }, invalidLines: [],
    });
    expect(parseOverrides('ok=1\nnot an option\n= 2').invalidLines).toEqual([2, 3]);
  });
  it('formats exact durations', () => {
    expect(formatDuration(5260)).toBe('1h 27m 40s');
    expect(formatDuration(59)).toBe('59s');
    expect(formatDuration(90000)).toBe('1d 1h 0m 0s');
  });
});
