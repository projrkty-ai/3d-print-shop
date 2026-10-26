import { LOCALE, PRINT_MAX_MM, PRINT_MIN_MM } from '../config';
import { t } from '../../i18n';
import type { Dimensions, ModelSpec } from '../types';

export type Axis = keyof Dimensions;

export const AXES: Axis[] = ['widthMm', 'depthMm', 'heightMm'];

export const AXIS_LABELS: Record<Axis, string> = {
  widthMm: t('width'),
  depthMm: t('depth'),
  heightMm: t('height'),
};

/** Sizes are kept to 0.1 mm, well below what an FDM printer can resolve. */
export const roundMm = (value: number) => Math.round(value * 10) / 10;

const mapAxes = (fn: (axis: Axis) => number): Dimensions => ({
  widthMm: fn('widthMm'),
  depthMm: fn('depthMm'),
  heightMm: fn('heightMm'),
});

export function baseDimensions(model: ModelSpec): Dimensions {
  return mapAxes((axis) => model[axis]);
}

/** Uniformly scales the base model (1 = original size). */
export function scaleDimensions(model: ModelSpec, factor: number): Dimensions {
  return mapAxes((axis) => roundMm(model[axis] * factor));
}

/** Scale factor along each axis relative to the base model. */
export function scaleRatios(model: ModelSpec, dims: Dimensions): Dimensions {
  return mapAxes((axis) => dims[axis] / model[axis]);
}

/** Material volume of the scaled print; volume grows with the product of the axis scales. */
export function scaledVolumeCm3(model: ModelSpec, dims: Dimensions): number {
  const r = scaleRatios(model, dims);
  return model.volumeCm3 * r.widthMm * r.depthMm * r.heightMm;
}

/** Largest uniform scale at which the model still fits the printer. */
export function maxUniformScale(model: ModelSpec): number {
  return PRINT_MAX_MM / Math.max(model.widthMm, model.depthMm, model.heightMm);
}

/** Smallest uniform scale at which every axis is still printable. */
export function minUniformScale(model: ModelSpec): number {
  return PRINT_MIN_MM / Math.min(model.widthMm, model.depthMm, model.heightMm);
}

/**
 * Whole-percent bounds for the size slider, rounded inwards so both ends are printable.
 * The epsilon absorbs float noise such as 1.15 * 100 = 114.99999999999999.
 */
export function percentRange(model: ModelSpec): { min: number; max: number } {
  return {
    min: Math.ceil(minUniformScale(model) * 100 - 1e-9),
    max: Math.floor(maxUniformScale(model) * 100 + 1e-9),
  };
}

/**
 * Sets one axis to `value` and scales the other axes by the same factor, so the print
 * keeps the model's proportions. Always deriving from the original model (rather than
 * the current, rounded values) avoids drift while the customer types digit by digit.
 */
export function resizeProportionally(model: ModelSpec, axis: Axis, value: number): Dimensions {
  return mapAxes((a) => (a === axis ? value : roundMm(model[a] * (value / model[axis]))));
}

/**
 * Uniform scale of a print relative to the model, read from the first side that has a
 * value (a side may be empty while the customer is typing). Null if none has.
 */
export function currentScale(model: ModelSpec, dims: Dimensions): number | null {
  const axis = AXES.find((a) => Number.isFinite(dims[a]) && dims[a] > 0);
  return axis ? dims[axis] / model[axis] : null;
}

/** Returns an error message for a requested print size, or null when it can be printed. */
export function validateDimensions(dims: Dimensions): string | null {
  for (const axis of AXES) {
    const value = dims[axis];
    const label = AXIS_LABELS[axis];
    if (!Number.isFinite(value)) return t('enterDimension', label);
    if (value < PRINT_MIN_MM) return t('minDimension', label, PRINT_MIN_MM);
    if (value > PRINT_MAX_MM) {
      return t('maxDimension', label, PRINT_MAX_MM);
    }
  }
  return null;
}

/** Closest printable size with the model's proportions (original size if nothing is entered). */
export function nearestPrintable(model: ModelSpec, dims: Dimensions): Dimensions {
  const scale = currentScale(model, dims) ?? 1;
  return scaleDimensions(model, Math.min(maxUniformScale(model), Math.max(minUniformScale(model), scale)));
}

const mmFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });

export function formatDimensions(dims: Dimensions): string {
  return `${AXES.map((axis) => mmFormat.format(dims[axis])).join(' × ')} mm`;
}

const volumeFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
const smallVolumeFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });

export function formatVolume(cm3: number): string {
  // Tiny prints need the extra digit, otherwise they'd read as "0 cm³".
  return `${(cm3 < 1 ? smallVolumeFormat : volumeFormat).format(cm3)} cm³`;
}

/** Scale for the 3D preview in three.js axis order: x = width, y = height, z = depth. */
export function previewScale(model: ModelSpec, dims: Dimensions): [number, number, number] {
  const r = scaleRatios(model, dims);
  return [r.widthMm, r.heightMm, r.depthMm];
}
