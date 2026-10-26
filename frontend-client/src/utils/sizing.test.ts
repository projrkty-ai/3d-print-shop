import { describe, expect, it } from 'vitest';
import type { Dimensions, ModelSpec } from '../types';
import {
  currentScale,
  formatDimensions,
  maxUniformScale,
  minUniformScale,
  nearestPrintable,
  percentRange,
  resizeProportionally,
  scaleDimensions,
  scaledVolumeCm3,
  validateDimensions,
} from './sizing';

const vase: ModelSpec = { widthMm: 110, depthMm: 110, heightMm: 200, volumeCm3: 95 };
const dims = (widthMm: number, depthMm: number, heightMm: number): Dimensions => ({ widthMm, depthMm, heightMm });

describe('resizeProportionally', () => {
  it('scales the other axes by the same factor', () => {
    expect(resizeProportionally(vase, 'widthMm', 55)).toEqual(dims(55, 55, 100));
    expect(resizeProportionally(vase, 'heightMm', 270)).toEqual(dims(148.5, 148.5, 270));
  });

  it('does not drift while typing digit by digit', () => {
    // "1" → "15" → "150": each step starts from the same reference, not the rounded previous step.
    resizeProportionally(vase, 'widthMm', 1);
    resizeProportionally(vase, 'widthMm', 15);
    expect(resizeProportionally(vase, 'widthMm', 150)).toEqual(dims(150, 150, 272.7));
  });
});

describe('build volume limits', () => {
  it('finds the largest uniform scale that fits 270 mm', () => {
    expect(maxUniformScale(vase)).toBeCloseTo(1.35);
    const largest = scaleDimensions(vase, maxUniformScale(vase));
    expect(largest).toEqual(dims(148.5, 148.5, 270));
    expect(validateDimensions(largest)).toBeNull();
  });

  it('finds the smallest uniform scale that keeps every side printable', () => {
    expect(scaleDimensions(vase, minUniformScale(vase))).toEqual(dims(5, 5, 9.1));
  });

  it('accepts exactly 270 mm and rejects anything larger', () => {
    expect(validateDimensions(dims(270, 270, 270))).toBeNull();
    expect(validateDimensions(dims(100, 270.1, 100))).toMatch(/Depth can be at most 270 mm/);
  });

  it('rejects missing or too small values', () => {
    expect(validateDimensions(dims(Number.NaN, 100, 100))).toBe('Enter a width in millimeters.');
    expect(validateDimensions(dims(100, 100, 4.9))).toBe('Height must be at least 5 mm.');
  });

  it('finds the nearest printable size without changing proportions', () => {
    expect(nearestPrintable(vase, dims(150, 150, 272.7))).toEqual(dims(148.5, 148.5, 270));
    expect(nearestPrintable(vase, dims(1, 1, 1.8))).toEqual(dims(5, 5, 9.1));
    expect(nearestPrintable(vase, dims(Number.NaN, Number.NaN, Number.NaN))).toEqual(dims(110, 110, 200));
  });
});

describe('percentRange', () => {
  it('rounds inwards to whole percents that are still printable', () => {
    expect(percentRange(vase)).toEqual({ min: 5, max: 135 }); // 4.5% … 135%
    expect(percentRange({ widthMm: 50, depthMm: 50, heightMm: 270, volumeCm3: 10 })).toEqual({ min: 10, max: 100 });
  });

  it('is not thrown off by floating-point noise', () => {
    // 270 / 1.15 → the exact max is 115%, but 1.15 * 100 in floating point is 114.999…
    const model = { widthMm: 100, depthMm: 100, heightMm: 270 / 1.15, volumeCm3: 10 };
    expect(percentRange(model).max).toBe(115);
  });
});

describe('currentScale', () => {
  it('reads the scale from the first side that has a value', () => {
    expect(currentScale(vase, dims(165, 165, 300))).toBe(1.5);
    expect(currentScale(vase, dims(Number.NaN, 55, 100))).toBe(0.5);
    expect(currentScale(vase, dims(Number.NaN, Number.NaN, Number.NaN))).toBeNull();
  });
});

describe('scaledVolumeCm3', () => {
  it('multiplies the base volume by every axis ratio', () => {
    expect(scaledVolumeCm3(vase, dims(110, 110, 200))).toBe(95);
    expect(scaledVolumeCm3(vase, dims(220, 110, 200))).toBe(190);
    expect(scaledVolumeCm3(vase, dims(220, 220, 400))).toBe(760);
  });
});

describe('formatDimensions', () => {
  it('shows up to one decimal', () => {
    expect(formatDimensions(dims(148.5, 148.5, 270))).toBe('148.5 × 148.5 × 270 mm');
  });
});
