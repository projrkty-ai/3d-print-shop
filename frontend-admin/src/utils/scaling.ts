import { t } from '../i18n';
import { LOCALE, PRINT_MAX_MM, PRINT_MIN_MM } from '../config';
import type { Dimensions, Product } from '../types';
import { AXES, baseDimensions, currentScale, maxUniformScale, minUniformScale, scaleDimensions, scaleRatios, validateDimensions } from './sizing';

/** Uniform scale factors customers may choose (1 = original size). */
export interface ScaleRange {
  min: number;
  max: number;
}

type Scalable = Pick<Product, 'model' | 'scaling'>;

/** Older products without the setting can be scaled (within the printer's limits). */
export const scalingEnabled = (product: Scalable): boolean => product.scaling?.enabled ?? true;

/** Scales customers may choose: the admin's range within the printer's limits, or only the original size. */
export function scaleRange(product: Scalable): ScaleRange {
  const printable = { min: minUniformScale(product.model), max: maxUniformScale(product.model) };
  const { scaling } = product;
  if (!scaling) return printable;
  if (!scaling.enabled) return { min: 1, max: 1 };
  return { min: Math.max(printable.min, scaling.minScale), max: Math.min(printable.max, scaling.maxScale) };
}

/** Whole-percent bounds of the size slider, rounded inwards so both ends can be ordered. */
export function percentScaleRange(product: Scalable): ScaleRange {
  const range = scaleRange(product);
  return { min: Math.ceil(range.min * 100 - 1e-9), max: Math.floor(range.max * 100 + 1e-9) };
}

/** The scales print variants are sliced at besides the original size: the admin's smallest and largest. */
export function slicedScales(product: Scalable): number[] {
  const { scaling } = product;
  if (!scaling?.enabled) return [];
  return [...new Set([scaling.minScale, scaling.maxScale])].filter((scale) => Math.abs(scale - 1) > 1e-9);
}

/**
 * Uniform scale of a print: the geometric mean of its axis scales (exact for proportional sizes),
 * to 0.1% and within the product's range, so sizes rounded to 0.1 mm price as the scale chosen.
 */
export function printScale(product: Scalable, dims: Dimensions): number {
  const ratios = scaleRatios(product.model, dims);
  const scale = Math.round(Math.cbrt(ratios.widthMm * ratios.depthMm * ratios.heightMm) * 1000) / 1000;
  const range = scaleRange(product);
  return range.min <= range.max ? Math.min(range.max, Math.max(range.min, scale)) : scale;
}

/** The size a customer may order: as chosen for scalable products, else the original size. */
export function orderDimensions(product: Scalable, dims: Dimensions): Dimensions {
  return scalingEnabled(product) ? dims : baseDimensions(product.model);
}

const percentFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
export const formatScale = (scale: number) => `${percentFormat.format(scale * 100)}%`;

/** Problem with a requested size, or null when it can be printed and is within the product's scale range. */
export function productDimensionsError(product: Scalable, dims: Dimensions): string | null {
  const basic = validateDimensions(dims);
  if (basic) return basic;
  const range = percentScaleRange(product);
  // Sizes are kept to 0.1 mm, so every side may be off by that rounding.
  const outside = AXES.some((axis) => {
    const tolerance = 0.05 / product.model[axis] + 1e-9;
    const ratio = dims[axis] / product.model[axis];
    return ratio < range.min / 100 - tolerance || ratio > range.max / 100 + tolerance;
  });
  return outside ? t("Choose a size from {0}% to {1}% of the original.", range.min, range.max) : null;
}

/** Closest size the customer may order, keeping the model's proportions (original size if nothing is entered). */
export function nearestAllowed(product: Scalable, dims: Dimensions): Dimensions {
  const range = scaleRange(product);
  const scale = currentScale(product.model, dims) ?? 1;
  return scaleDimensions(product.model, Math.min(range.max, Math.max(range.min, scale)));
}

/** Problems with the admin's scaling setup (part of `validateProduct`). */
export function scalingErrors(product: Scalable): string[] {
  const { scaling, model } = product;
  if (!scaling?.enabled) return [];
  const { minScale, maxScale } = scaling;
  if (![minScale, maxScale].every((value) => Number.isFinite(value) && value > 0)) return [t("Enter the smallest and largest scale in percent.")];
  const errors: string[] = [];
  if (minScale > 1 || maxScale < 1 || minScale >= maxScale) errors.push(t("The smallest scale must be at most 100% and the largest at least 100%, and they must differ."));
  const modelValid = AXES.every((axis) => Number.isFinite(model[axis]) && model[axis] > 0);
  if (modelValid && minScale < minUniformScale(model) - 1e-9) {
    errors.push(t("At the smallest scale every side must be at least {0} mm: use at least {1}%.", PRINT_MIN_MM, Math.ceil(minUniformScale(model) * 100 - 1e-9)));
  }
  if (modelValid && maxScale > maxUniformScale(model) + 1e-9) {
    errors.push(t("At the largest scale the model must fit {0} mm: use at most {1}%.", PRINT_MAX_MM, Math.floor(maxUniformScale(model) * 100 + 1e-9)));
  }
  return errors;
}
