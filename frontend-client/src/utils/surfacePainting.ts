import { t } from '../i18n';
import { fontStack } from '../config';
import type { DecorationLayout, TextLayout, TextureLayout } from '../types';
import { DEFAULT_TEXT_LAYOUT, DEFAULT_TEXTURE_LAYOUT } from './decorationLayout';
import { engravingLines } from './engraving';
import type { SurfaceSpec } from './mesh';

export const CANVAS_W = 1024;
export const CANVAS_H = 512;
const TEXT_HEIGHT_FRACTION = 0.6;
const LINE_HEIGHT = 1.2;

export type SurfaceDrawingContext = Pick<CanvasRenderingContext2D,
  'save' | 'restore' | 'fillRect' | 'clearRect' | 'drawImage' | 'translate' | 'scale' | 'fillText' |
  'fillStyle' | 'font' | 'globalAlpha' | 'globalCompositeOperation' | 'textAlign' | 'textBaseline'
> & { measureText(text: string): { width: number } };

interface SurfaceCanvas {
  getContext(contextId: '2d'): SurfaceDrawingContext | null;
}

/** The picture to place; only its pixel size matters for the default placement. */
type Picture = CanvasImageSource & { naturalWidth: number; naturalHeight: number };

interface PaintOptions {
  image: Picture | null;
  text: string;
  font: string;
  spec: SurfaceSpec;
  layout?: DecorationLayout;
}

const squeezeFor = (spec: SurfaceSpec) => CANVAS_W / CANVAS_H / spec.surfaceAspect;

export function textureRectangles(layout: TextureLayout) {
  const width = CANVAS_W * layout.width / 100;
  const height = CANVAS_H * layout.height / 100;
  const left = CANVAS_W * layout.centerX / 100 - width / 2;
  const top = CANVAS_H * (1 - layout.centerY / 100) - height / 2;
  return [-CANVAS_W, 0, CANVAS_W].map((offset) => ({ left: left + offset, top, width, height }))
    .filter((rect) => rect.left < CANVAS_W && rect.left + rect.width > 0);
}

/**
 * Without an administrator placement the picture appears once, on the front, undistorted: as large
 * as fits inside DEFAULT_TEXTURE_LAYOUT, so it never wraps around the whole model.
 */
export function defaultTextureLayout(image: Pick<Picture, 'naturalWidth' | 'naturalHeight'>, spec: SurfaceSpec): TextureLayout {
  const box = DEFAULT_TEXTURE_LAYOUT;
  const aspect = image.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 1;
  // Width and height percentages of the unwrapped surface, whose width is surfaceAspect × its height.
  let height = box.height;
  let width = aspect * height / spec.surfaceAspect;
  if (width > box.width) {
    width = box.width;
    height = width * spec.surfaceAspect / aspect;
  }
  return { centerX: box.centerX, centerY: box.centerY, width, height };
}

function pictureRectangles(image: Picture, spec: SurfaceSpec, layout?: DecorationLayout) {
  return textureRectangles(layout?.texture ?? defaultTextureLayout(image, spec));
}

function context(canvas: SurfaceCanvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(t("The browser could not create a preview surface canvas."));
  return ctx;
}

/**
 * Color map: white, with engraved letters shaded darker. The picture itself is not here — it is
 * mixed in at full color from `paintTextureColors`, and its relief comes from `paintRelief`.
 */
export function paintSurface(canvas: SurfaceCanvas, { text, font, spec, layout }: Omit<PaintOptions, 'image'>) {
  const ctx = context(canvas);
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  drawGrooves(ctx, text, font, spec, layout);
  ctx.restore();
}

/** Bump map: the picture's brightness becomes height, and the lettering is pressed in. */
export function paintRelief(canvas: SurfaceCanvas, { image, text, font, spec, layout }: PaintOptions) {
  const ctx = context(canvas);
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  if (image) {
    for (const rect of pictureRectangles(image, spec, layout)) ctx.drawImage(image, rect.left, rect.top, rect.width, rect.height);
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.globalCompositeOperation = 'source-over';
  }
  drawGrooves(ctx, text, font, spec, layout);
  ctx.restore();
}

/** The picture in its own colors on a transparent surface; the preview shader lays it over the filament. */
export function paintTextureColors(canvas: SurfaceCanvas, { image, spec, layout }: Pick<PaintOptions, 'image' | 'spec' | 'layout'>) {
  const ctx = context(canvas);
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  if (image) {
    for (const rect of pictureRectangles(image, spec, layout)) ctx.drawImage(image, rect.left, rect.top, rect.width, rect.height);
  }
  ctx.restore();
}

function drawGrooves(ctx: SurfaceDrawingContext, text: string, font: string, spec: SurfaceSpec, layout?: DecorationLayout) {
  drawEngraving(ctx, text, font, spec, (line, y, fontSize) => {
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(line, 0, y + fontSize * 0.04);
    ctx.fillStyle = 'rgba(20,20,20,0.75)';
    ctx.fillText(line, 0, y);
  }, layout?.text);
}

export function paintEngravingMask(canvas: SurfaceCanvas, { text, font, spec, layout }: Omit<PaintOptions, 'image'>) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(t("The browser could not create an engraving mask canvas."));
  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = '#ffffff';
  drawEngraving(ctx, text, font, spec, (line, y) => ctx.fillText(line, 0, y), layout?.text);
  ctx.restore();
}

export function drawEngraving(
  ctx: SurfaceDrawingContext,
  text: string,
  font: string,
  spec: SurfaceSpec,
  draw: (line: string, y: number, fontSize: number) => void,
  layout?: TextLayout,
) {
  const lines = engravingLines(text);
  if (lines.length === 0) return;
  const placement = layout ?? DEFAULT_TEXT_LAYOUT;
  const squeeze = squeezeFor(spec);
  const maxWidth = CANVAS_W * spec.textWidthFraction / squeeze;
  const maxHeight = CANVAS_H * TEXT_HEIGHT_FRACTION;
  let fontSize = Math.min(CANVAS_H * 0.2, maxHeight / (lines.length * LINE_HEIGHT));
  ctx.save();
  ctx.font = `bold ${fontSize}px ${fontStack(font)}`;
  const widest = Math.max(...lines.map((line) => ctx.measureText(line).width));
  if (widest > maxWidth) {
    fontSize *= maxWidth / widest;
    ctx.font = `bold ${fontSize}px ${fontStack(font)}`;
  }
  ctx.textAlign = placement.horizontalAlign;
  ctx.textBaseline = 'middle';
  const lineHeight = fontSize * LINE_HEIGHT;
  const blockHeight = fontSize + (lines.length - 1) * lineHeight;
  const firstY = placement.verticalAlign === 'top' ? fontSize / 2
    : placement.verticalAlign === 'bottom' ? -blockHeight + fontSize / 2
    : -(lines.length - 1) * lineHeight / 2;
  // Copies at the seam keep moved text continuous around the back of the model.
  for (const offset of layout ? [-CANVAS_W, 0, CANVAS_W] : [0]) {
    ctx.save();
    ctx.translate(CANVAS_W * placement.centerX / 100 + offset, CANVAS_H * (1 - placement.centerY / 100));
    ctx.scale(squeeze, 1);
    lines.forEach((line, i) => draw(line, firstY + i * lineHeight, fontSize));
    ctx.restore();
  }
  ctx.restore();
}
