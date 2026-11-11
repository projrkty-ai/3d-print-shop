import { t } from '../i18n';
import {
  EXTRUDED_DEPTH_MM, EXTRUDED_LINE_SPACING, EXTRUDED_POSITION_MAX_MM, EXTRUDED_SIZE_MM,
} from '../config';
import type { DecorationLayout, Dimensions, ExtrudedTextLayout, MeshPlate, Product, TextLayout, TextureLayout } from '../types';

export const DEFAULT_TEXT_LAYOUT: Readonly<TextLayout> = {
  centerX: 50, centerY: 50, horizontalAlign: 'center', verticalAlign: 'middle',
};
/**
 * Starting point for an administrator placement, and the area an unplaced texture fits into
 * (keeping its proportions): one picture on the front, never wrapping around the whole model.
 */
export const DEFAULT_TEXTURE_LAYOUT: Readonly<TextureLayout> = {
  centerX: 50, centerY: 50, width: 30, height: 60,
};

/** Starting values when the shop adds 3D lettering: upright on the front, sized to the model. */
export function defaultExtrudedTextLayout(model: Dimensions): ExtrudedTextLayout {
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    x: 0,
    y: round(-model.depthMm / 2),
    z: round(model.heightMm / 2),
    rotationDeg: 0,
    tiltDeg: 0,
    sizeMm: Math.min(EXTRUDED_SIZE_MM.max, Math.max(EXTRUDED_SIZE_MM.min, Math.round(model.heightMm * 0.12))),
    depthMm: 1.5,
    lineSpacing: 1.2,
    horizontalAlign: 'center',
    verticalAlign: 'middle',
    defaultText: '',
  };
}

export function decorationLayoutFor(product: Product, plate?: MeshPlate | null): DecorationLayout | undefined {
  return plate ? plate.decorationLayout : product.decorationLayout;
}

export function decorationLayoutErrors(layout: DecorationLayout | undefined): string[] {
  if (!layout) return [];
  const errors: string[] = [];
  const point = (value: { centerX: number; centerY: number }, label: string) => {
    for (const axis of ['centerX', 'centerY'] as const) {
      if (!Number.isFinite(value[axis]) || value[axis] < 0 || value[axis] > 100) {
        errors.push(t("{0} {1} position must be between 0 and 100%.", label, axis === 'centerX' ? t("horizontal") : t("vertical")));
      }
    }
  };
  if (layout.text) {
    point(layout.text, t("Text"));
    if (!['left', 'center', 'right'].includes(layout.text.horizontalAlign)) errors.push(t("Choose a valid horizontal text alignment."));
    if (!['top', 'middle', 'bottom'].includes(layout.text.verticalAlign)) errors.push(t("Choose a valid vertical text alignment."));
  }
  if (layout.texture) {
    point(layout.texture, t("Texture"));
    for (const axis of ['width', 'height'] as const) {
      const value = layout.texture[axis];
      if (!Number.isFinite(value) || value < 1 || value > 100) errors.push(t("Texture {0} must be between 1 and 100%.", axis === 'width' ? t('width') : t('height')));
    }
  }
  errors.push(...extrudedTextLayoutErrors(layout.extrudedText));
  return errors;
}

function extrudedTextLayoutErrors(lettering: ExtrudedTextLayout | undefined): string[] {
  if (!lettering) return [];
  const errors: string[] = [];
  const within = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;
  for (const axis of ['x', 'y', 'z'] as const) {
    if (!within(lettering[axis], -EXTRUDED_POSITION_MAX_MM, EXTRUDED_POSITION_MAX_MM)) {
      errors.push(t("3D lettering: the {0} position must be between −{1} and {2} mm.", axis.toUpperCase(), EXTRUDED_POSITION_MAX_MM, EXTRUDED_POSITION_MAX_MM));
    }
  }
  if (!within(lettering.rotationDeg, -360, 360)) errors.push(t("3D lettering: rotation must be between −360 and 360 degrees."));
  if (!within(lettering.tiltDeg, 0, 90)) errors.push(t("3D lettering: tilt must be between 0 and 90 degrees."));
  if (!within(lettering.sizeMm, EXTRUDED_SIZE_MM.min, EXTRUDED_SIZE_MM.max)) {
    errors.push(t("3D lettering: size must be between {0} and {1} mm.", EXTRUDED_SIZE_MM.min, EXTRUDED_SIZE_MM.max));
  }
  if (!within(lettering.depthMm, EXTRUDED_DEPTH_MM.min, EXTRUDED_DEPTH_MM.max)) {
    errors.push(t("3D lettering: depth must be between {0} and {1} mm.", EXTRUDED_DEPTH_MM.min, EXTRUDED_DEPTH_MM.max));
  }
  if (!within(lettering.lineSpacing, EXTRUDED_LINE_SPACING.min, EXTRUDED_LINE_SPACING.max)) {
    errors.push(t("3D lettering: line spacing must be between {0} and {1}.", EXTRUDED_LINE_SPACING.min, EXTRUDED_LINE_SPACING.max));
  }
  if (!['left', 'center', 'right'].includes(lettering.horizontalAlign)) errors.push(t("Choose a valid horizontal text alignment."));
  if (!['top', 'middle', 'bottom'].includes(lettering.verticalAlign)) errors.push(t("Choose a valid vertical text alignment."));
  // The default text itself is checked by validateProduct, with the same rules as customer text.
  return errors;
}
