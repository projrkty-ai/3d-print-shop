import { formatNumber, t } from '../i18n';
import { ENGRAVING_ALLOWED, MAX_ENGRAVING_LINES, PRINT_MAX_MM, PRINT_MIN_MM } from '../config';
import type { Customization, EngravingLimits, Product } from '../types';
import { engravingCharCount, engravingLines } from './engraving';
import { AXES, AXIS_LABELS } from './sizing';
import { selectedPlateIds } from './meshPlates';
import { customizationSurfaces } from './customization';
import { decorationLayoutErrors } from './decorationLayout';

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

  if (!product.name.trim()) errors.push(t("Name is required."));
  if (!isNonNegative(product.basePrice)) errors.push(t("Base price must be 0 or more."));
  if (!Number.isInteger(product.productionDays) || product.productionDays < 0) {
    errors.push(t("Production time must be a whole number of days."));
  }

  if (!isNonNegative(product.fixedFee)) {
    errors.push(t("Fixed fee must be 0 or more."));
  } else if (product.fixedFee > product.basePrice) {
    errors.push(t("Fixed fee can't be more than the price at original size."));
  }

  const { model } = product;
  let dimensionsValid = true;
  for (const axis of AXES) {
    const value = model[axis];
    if (!Number.isFinite(value) || value < PRINT_MIN_MM || value > PRINT_MAX_MM) {
      dimensionsValid = false;
      errors.push(
        t("Model {0} must be between {1} and {2} mm (the original size must be printable).", AXIS_LABELS[axis].toLowerCase(), PRINT_MIN_MM, PRINT_MAX_MM),
      );
    }
  }
  if (!Number.isFinite(model.volumeCm3) || model.volumeCm3 <= 0) {
    errors.push(t("Model volume must be greater than 0 cm³."));
  } else if (dimensionsValid) {
    // A solid block filling the bounding box is the most a model can contain; more means a unit mix-up (mm³ vs cm³).
    const plateCount = product.mesh ? Math.max(1, selectedPlateIds(product.mesh).length) : 1;
    const boundingBoxCm3 = (model.widthMm * model.depthMm * model.heightMm * plateCount) / 1000;
    if (model.volumeCm3 > boundingBoxCm3) {
      errors.push(
        t("Model volume ({0} cm³) can't exceed its bounding box ({1} cm³). Check that it's in cm³, not mm³.", formatNumber(model.volumeCm3, { maximumFractionDigits: 20, useGrouping: false }), formatNumber(boundingBoxCm3, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false })),
      );
    }
  }

  if (product.colors.length === 0) errors.push(t("Add at least one color."));
  product.colors.forEach((color, i) => {
    const name = color.name.trim() || `#${i + 1}`;
    if (!color.name.trim()) errors.push(t("Color #{0} needs a name.", i + 1));
    if (!HEX_COLOR.test(color.hex)) errors.push(t("Color {0}: \"{1}\" is not a valid hex color.", name, color.hex));
    if (!Number.isFinite(color.priceDelta)) errors.push(t("Color {0}: price change must be a number.", name));
  });

  const { mesh } = product;
  if (mesh) {
    const ids = selectedPlateIds(mesh);
    if (mesh.selectedPlates !== undefined) {
      if (ids.length === 0 || new Set(ids).size !== ids.length || ids.some((id) => !mesh.plates.some((p) => p.id === id))) {
        errors.push(t("Choose at least one valid, distinct plate for this product."));
      }
    } else if (mesh.plates.length > 0 && !mesh.plates.some((p) => p.id === mesh.plate)) {
      errors.push(t("Choose which plate of the project this product is."));
    }
  }

  product.mesh?.parts.forEach((part, i) => {
    if (!part.name.trim()) errors.push(t("Color part #{0} needs a name.", i + 1));
  });

  if (product.engraving.enabled) {
    const { maxLength, price, fonts } = product.engraving;
    if (!Number.isInteger(maxLength) || maxLength < 1) {
      errors.push(t("Engraving max length must be a whole number of at least 1."));
    }
    const { maxLines } = product.engraving;
    if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > MAX_ENGRAVING_LINES) {
      errors.push(t("Engraving max lines must be a whole number from 1 to {0}.", MAX_ENGRAVING_LINES));
    }
    if (!isNonNegative(price)) errors.push(t("Engraving price must be 0 or more."));
    if (fonts.length === 0) errors.push(t("Pick at least one engraving font."));
    if (product.engraving.colorChoice && !isNonNegative(product.engraving.colorPrice)) {
      errors.push(t("Colored text surcharge must be 0 or more."));
    }
  }

  if (product.texture.enabled && !isNonNegative(product.texture.price)) {
    errors.push(t("Texture price must be 0 or more."));
  }

  return errors;
}

/** Returns an error message for engraving text, or null if it is acceptable. */
export function validateEngraving(text: string, { maxLength, maxLines }: EngravingLimits): string | null {
  const lines = engravingLines(text);
  if (lines.length > maxLines) {
    return maxLines === 1
      ? t("Engraving must fit on a single line.")
      : t("Engraving can have at most {0} lines.", maxLines);
  }
  if (engravingCharCount(lines.join('\n')) > maxLength) {
    return t("Engraving can be at most {0} characters.", maxLength);
  }
  if (!lines.every((line) => ENGRAVING_ALLOWED.test(line))) {
    return t("Use letters, numbers, spaces and basic punctuation (. , ! ? ' & - # @ : +) only.");
  }
  return null;
}
