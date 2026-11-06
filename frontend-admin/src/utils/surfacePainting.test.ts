// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { TextLayout } from '../types';
import { DEFAULT_TEXT_LAYOUT } from './decorationLayout';
import type { SurfaceSpec } from './mesh';
import { CANVAS_H, CANVAS_W, defaultTextureLayout, drawEngraving, paintEngravingMask, paintRelief, paintSurface, paintTextureColors, textureRectangles, type SurfaceDrawingContext } from './surfacePainting';

const spec: SurfaceSpec = {
  slots: ['side'], slotParts: [0], rotationY: 0, surfaceAspect: 2, textWidthFraction: 0.5, bottomY: -1,
};

function drawingContext() {
  return {
    save: vi.fn(), restore: vi.fn(), fillRect: vi.fn(), clearRect: vi.fn(), drawImage: vi.fn(),
    translate: vi.fn(), scale: vi.fn(), fillText: vi.fn(), measureText: vi.fn(() => ({ width: 100 })),
    fillStyle: '#ffffff', font: '', globalAlpha: 1, globalCompositeOperation: 'source-over',
    textAlign: 'center', textBaseline: 'middle',
  } satisfies SurfaceDrawingContext;
}

describe('surface decoration painting', () => {
  it('preserves centered multiline text and original height/aspect correction without settings', () => {
    const ctx = drawingContext();
    const draw = vi.fn();
    drawEngraving(ctx, '\nFirst\nSecond\n', 'Arial', { ...spec, surfaceAspect: 4 }, draw);
    expect(ctx.translate.mock.calls).toEqual([[CANVAS_W / 2, CANVAS_H / 2]]);
    expect(ctx.scale).toHaveBeenCalledWith(0.5, 1);
    expect(draw.mock.calls).toEqual([['First', -61.44, 102.4], ['Second', 61.44, 102.4]]);
    expect(ctx.textAlign).toBe('center');
  });

  it.each([
    ['top', 51.2, 174.08],
    ['middle', -61.44, 61.44],
    ['bottom', -174.08, -51.2],
  ] as const)('aligns the entire multiline block to its %s anchor', (verticalAlign, first, last) => {
    const ctx = drawingContext();
    const draw = vi.fn();
    drawEngraving(ctx, 'One\nTwo', 'Arial', spec, draw, {
      centerX: 25, centerY: 75, horizontalAlign: 'left', verticalAlign,
    });
    expect(ctx.textAlign).toBe('left');
    expect(ctx.translate).toHaveBeenCalledWith(256, 128);
    expect(draw.mock.calls[2]?.[1]).toBeCloseTo(first);
    expect(draw.mock.calls[3]?.[1]).toBeCloseTo(last);
  });

  it.each(['left', 'center', 'right'] as const)('applies %s alignment to each line and retains width fitting', (horizontalAlign) => {
    const ctx = drawingContext();
    ctx.measureText.mockReturnValue({ width: 1024 });
    const draw = vi.fn();
    drawEngraving(ctx, 'Wide\nShort', 'Arial', spec, draw, { ...DEFAULT_TEXT_LAYOUT, horizontalAlign });
    expect(ctx.textAlign).toBe(horizontalAlign);
    expect(draw.mock.calls[0]?.[2]).toBeCloseTo(51.2);
    expect(ctx.translate.mock.calls).toEqual([[-512, 256], [512, 256], [1536, 256]]);
  });

  it('uses exactly the same text transforms and baselines for grooves and the colored mask', () => {
    const surface = drawingContext();
    const mask = drawingContext();
    const text: TextLayout = { centerX: 3, centerY: 80, horizontalAlign: 'right', verticalAlign: 'bottom' };
    const options = { text: 'First\nSecond', font: 'Arial', spec, layout: { text } };
    paintSurface({ getContext: () => surface }, options);
    paintEngravingMask({ getContext: () => mask }, options);
    expect(surface.translate.mock.calls).toEqual(mask.translate.mock.calls);
    expect(surface.scale.mock.calls).toEqual(mask.scale.mock.calls);
    expect(surface.fillText.mock.calls.filter((_, index) => index % 2 === 1)).toEqual(mask.fillText.mock.calls);
    expect(surface.textAlign).toBe(mask.textAlign);
  });

  it('positions and sizes one texture using surface percentages, in relief and in color', () => {
    expect(textureRectangles({ centerX: 25, centerY: 75, width: 20, height: 50 })).toEqual([
      { left: 153.6, top: 0, width: 204.8, height: 256 },
    ]);
    const image = document.createElement('img');
    const layout = { texture: { centerX: 25, centerY: 75, width: 20, height: 50 } };
    const relief = drawingContext();
    paintRelief({ getContext: () => relief }, { image, text: '', font: 'Arial', spec, layout });
    expect(relief.drawImage.mock.calls).toEqual([[image, 153.6, 0, 204.8, 256]]);
    const colors = drawingContext();
    paintTextureColors({ getContext: () => colors }, { image, spec, layout });
    expect(colors.clearRect).toHaveBeenCalledWith(0, 0, CANVAS_W, CANVAS_H);
    expect(colors.drawImage.mock.calls).toEqual([[image, 153.6, 0, 204.8, 256]]);
    // The overlay keeps the picture's own colors: no desaturation, unlike the relief.
    expect(colors.globalCompositeOperation).toBe('source-over');
    expect(colors.fillRect).not.toHaveBeenCalled();
  });

  it('keeps pictures out of the color map, which only shades the engraving', () => {
    const ctx = drawingContext();
    paintSurface({ getContext: () => ctx }, { text: 'Hi', font: 'Arial', spec });
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalled();
  });

  it('wraps texture across the horizontal seam but leaves vertical clipping to the canvas', () => {
    expect(textureRectangles({ centerX: 0, centerY: 100, width: 50, height: 50 })).toEqual([
      { left: -256, top: -128, width: 512, height: 256 },
      { left: 768, top: -128, width: 512, height: 256 },
    ]);
    expect(textureRectangles({ centerX: 100, centerY: 0, width: 50, height: 50 })).toEqual([
      { left: -256, top: 384, width: 512, height: 256 },
      { left: 768, top: 384, width: 512, height: 256 },
    ]);
  });

  it('places one undistorted picture on the front when no texture placement is set', () => {
    const image = document.createElement('img');
    Object.defineProperties(image, { naturalWidth: { value: 100 }, naturalHeight: { value: 100 } });
    // On a surface twice as wide as tall, a square picture 60% high needs 30% of the width.
    expect(defaultTextureLayout(image, spec)).toEqual({ centerX: 50, centerY: 50, width: 30, height: 60 });
    for (const layout of [undefined, { text: DEFAULT_TEXT_LAYOUT }]) {
      for (const paint of [paintRelief, paintTextureColors]) {
        const ctx = drawingContext();
        paint({ getContext: () => ctx }, { image, text: '', font: 'Arial', spec, layout });
        expect(ctx.drawImage.mock.calls).toEqual([[image, 358.4, 102.4, 307.2, 307.2]]);
      }
    }
  });

  it('shrinks wide pictures to the default width instead of wrapping them around the model', () => {
    expect(defaultTextureLayout({ naturalWidth: 400, naturalHeight: 100 }, spec)).toEqual({ centerX: 50, centerY: 50, width: 30, height: 15 });
    expect(defaultTextureLayout({ naturalWidth: 100, naturalHeight: 400 }, { ...spec, surfaceAspect: 1 })).toEqual({ centerX: 50, centerY: 50, width: 15, height: 60 });
    expect(defaultTextureLayout({ naturalWidth: 0, naturalHeight: 0 }, spec).width).toBe(30);
  });

  it('reports unavailable drawing contexts instead of producing a misleading blank preview', () => {
    const canvas = { getContext: () => null };
    expect(() => paintSurface(canvas, { text: '', font: 'Arial', spec })).toThrow('preview surface canvas');
    expect(() => paintTextureColors(canvas, { image: null, spec })).toThrow('preview surface canvas');
    expect(() => paintEngravingMask(canvas, { text: '', font: 'Arial', spec })).toThrow('engraving mask canvas');
  });
});
