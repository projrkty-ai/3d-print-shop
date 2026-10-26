import { ENGRAVING_ALLOWED, MAX_ENGRAVING_LINES, PRINT_MAX_MM, PRINT_MIN_MM } from '../config';
import type { Customization, EngravingLimits, Product } from '../types';
import { engravingCharCount, engravingLines } from './engraving';
import { AXES, AXIS_LABELS } from './sizing';
import { selectedPlateIds } from './meshPlates';
import { customizationSurfaces } from './customization';
import { decorationLayoutErrors } from './decorationLayout';
import { t } from '../../i18n';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const isNonNegative = (n: number) => Number.isFinite(n) && n >= 0;

export function customizationEngravingErrors(product: Product, customization: Customization) {
  if (!product.engraving.enabled) return [];
  return customizationSurfaces(product, customization).flatMap(({ plate, choices }) => {
    const message = validateEngraving(choices.engravingText, product.engraving);
    return message ? [{ plateId: plate?.id ?? null, message: plate ? `${plate.name}: ${message}` : message }] : [];
  });
}

/** Returns a list of human-readable problems; empty when the product can be saved. */
export function validateProduct(product: Product): string[] {
  const errors: string[] = [];
  errors.push(...decorationLayoutErrors(product.decorationLayout));
  product.mesh?.plates.forEach((plate) => {
    errors.push(...decorationLayoutErrors(plate.decorationLayout).map((message) => `${plate.name}: ${message}`));
  });

  if (!product.name.trim()) errors.push(t('nameRequired'));
  if (!isNonNegative(product.basePrice)) errors.push(t('basePrice'));
  if (!Number.isInteger(product.productionDays) || product.productionDays < 0) {
    errors.push(t('productionDays'));
  }

  if (!isNonNegative(product.fixedFee)) {
    errors.push(t('fixedFee'));
  } else if (product.fixedFee > product.basePrice) {
    errors.push(t('excessiveFee'));
  }

  const { model } = product;
  let dimensionsValid = true;
  for (const axis of AXES) {
    const value = model[axis];
    if (!Number.isFinite(value) || value < PRINT_MIN_MM || value > PRINT_MAX_MM) {
      dimensionsValid = false;
      errors.push(
        t('modelDimension', AXIS_LABELS[axis], PRINT_MIN_MM, PRINT_MAX_MM),
      );
    }
  }
  if (!Number.isFinite(model.volumeCm3) || model.volumeCm3 <= 0) {
    errors.push(t('modelVolume'));
  } else if (dimensionsValid) {
    // A solid block filling the bounding box is the most a model can contain; more means a unit mix-up (mm³ vs cm³).
    const plateCount = product.mesh ? Math.max(1, selectedPlateIds(product.mesh).length) : 1;
    const boundingBoxCm3 = (model.widthMm * model.depthMm * model.heightMm * plateCount) / 1000;
    if (model.volumeCm3 > boundingBoxCm3) {
      errors.push(
        t('excessiveVolume', model.volumeCm3, boundingBoxCm3.toFixed(1)),
      );
    }
  }

  if (product.colors.length === 0) errors.push(t('addColor'));
  product.colors.forEach((color, i) => {
    const name = color.name.trim() || `#${i + 1}`;
    if (!color.name.trim()) errors.push(t('colorName', i + 1));
    if (!HEX_COLOR.test(color.hex)) errors.push(t('colorHex', name, color.hex));
    if (!Number.isFinite(color.priceDelta)) errors.push(t('colorPrice', name));
  });

  const { mesh } = product;
  if (mesh) {
    const ids = selectedPlateIds(mesh);
    if (mesh.selectedPlates !== undefined) {
      if (ids.length === 0 || new Set(ids).size !== ids.length || ids.some((id) => !mesh.plates.some((p) => p.id === id))) {
        errors.push(t('choosePlates'));
      }
    } else if (mesh.plates.length > 0 && !mesh.plates.some((p) => p.id === mesh.plate)) {
      errors.push(t('choosePlate'));
    }
  }

  product.mesh?.parts.forEach((part, i) => {
    if (!part.name.trim()) errors.push(t('partName', i + 1));
  });

  if (product.engraving.enabled) {
    const { maxLength, price, fonts } = product.engraving;
    if (!Number.isInteger(maxLength) || maxLength < 1) {
      errors.push(t('engravingLength'));
    }
    const { maxLines } = product.engraving;
    if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > MAX_ENGRAVING_LINES) {
      errors.push(t('engravingLines', MAX_ENGRAVING_LINES));
    }
    if (!isNonNegative(price)) errors.push(t('engravingPrice'));
    if (fonts.length === 0) errors.push(t('engravingFont'));
    if (product.engraving.colorChoice && !isNonNegative(product.engraving.colorPrice)) {
      errors.push(t('coloredPrice'));
    }
  }

  if (product.texture.enabled && !isNonNegative(product.texture.price)) {
    errors.push(t('texturePrice'));
  }

  return errors;
}

/** Returns an error message for engraving text, or null if it is acceptable. */
export function validateEngraving(text: string, { maxLength, maxLines }: EngravingLimits): string | null {
  const lines = engravingLines(text);
  if (lines.length > maxLines) {
    return maxLines === 1
      ? t('singleLine')
      : t('maxLines', maxLines);
  }
  if (engravingCharCount(lines.join('\n')) > maxLength) {
    return t('maxCharacters', maxLength);
  }
  if (!lines.every((line) => ENGRAVING_ALLOWED.test(line))) {
    return t('engravingCharacters');
  }
  return null;
}
