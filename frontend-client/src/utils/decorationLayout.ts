import { t } from '../i18n';
import type { DecorationLayout, MeshPlate, Product, TextLayout, TextureLayout } from '../types';

export const DEFAULT_TEXT_LAYOUT: Readonly<TextLayout> = {
  centerX: 50, centerY: 50, horizontalAlign: 'center', verticalAlign: 'middle',
};
export const DEFAULT_TEXTURE_LAYOUT: Readonly<TextureLayout> = {
  centerX: 50, centerY: 50, width: 100, height: 100,
};

export function decorationLayoutFor(product: Product, plate?: MeshPlate | null): DecorationLayout | undefined {
  return plate ? plate.decorationLayout : product.decorationLayout;
}

export function decorationLayoutErrors(layout: DecorationLayout | undefined): string[] {
  if (!layout) return [];
  const errors: string[] = [];
  const point = (value: { centerX: number; centerY: number }, label: string) => {
    for (const axis of ['centerX', 'centerY'] as const) {
      if (!Number.isFinite(value[axis]) || value[axis] < 0 || value[axis] > 100) {
        errors.push(t("{value0} {value1} position must be between 0 and 100%.", { value0: label, value1: axis === 'centerX' ? 'horizontal' : 'vertical' }));
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
      if (!Number.isFinite(value) || value < 1 || value > 100) errors.push(t("Texture {value0} must be between 1 and 100%.", { value0: axis === 'width' ? t('Width').toLowerCase() : t('Height').toLowerCase() }));
    }
  }
  return errors;
}
