import { t } from '../i18n';
import {
  ENGRAVING_ALLOWED, EXTRUDED_TEXT_ALLOWED, EXTRUDED_TEXT_MAX_LENGTH, EXTRUDED_TEXT_MAX_LINES,
  MAX_ENGRAVING_LINES, PRINT_MAX_MM, PRINT_MIN_MM,
} from '../config';
import type { Customization, EngravingLimits, Product } from '../types';
import { engravingCharCount, engravingLines } from './engraving';
import { AXES, AXIS_LABELS } from './sizing';
import { selectedPlateIds } from './meshPlates';
import { allowsCustomTexture, customizationSurfaces, extrudedTextChoice, textureOption } from './customization';
import { decorationLayoutErrors, decorationLayoutFor } from './decorationLayout';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const isNonNegative = (n: number) => Number.isFinite(n) && n >= 0;

export function customizationEngravingErrors(product: Product, customization: Customization) {
  if (!product.engraving.enabled) return [];
  return customizationSurfaces(product, customization).flatMap(({ plate, choices }) => {
    const message = validateEngraving(choices.engravingText, product.engraving);
    return message ? [{ plateId: plate?.id ?? null, message: plate ? `${plate.name}: ${message}` : message }] : [];
  });
}

/** Problems with the effective 3D lettering of each surface (the customer's text, or the unchanged suggestion). */
export function customizationExtrudedTextErrors(product: Product, customization: Customization) {
  return customizationSurfaces(product, customization).flatMap(({ plate, choices }) => {
    const choice = extrudedTextChoice(decorationLayoutFor(product, plate ?? undefined), choices);
    const message = choice && validateExtrudedText(choice.text);
    return message ? [{ plateId: plate?.id ?? null, message: plate ? `${plate.name}: ${message}` : message }] : [];
  });
}

/**
 * Texture choices the product no longer accepts, e.g. a shop texture the admin removed after the
 * customer added the item to the cart. Mirrors the server's checkout check.
 * Expects the customization as stored, before `normalizeCustomization` repairs it.
 */
export function customizationTextureErrors(product: Product, customization: Customization) {
  return customizationSurfaces(product, customization).flatMap(({ plate, choices }) => {
    const message = choices.textureId && !textureOption(product, choices.textureId)
      ? t("The chosen texture is no longer available. Please configure the product again.")
      : !choices.textureId && choices.textureDataUrl && !allowsCustomTexture(product)
        ? t("Your own texture pictures are no longer accepted for this product. Please configure it again.")
        : null;
    return message ? [{ plateId: plate?.id ?? null, message: plate ? `${plate.name}: ${message}` : message }] : [];
  });
}

/** Returns a list of human-readable problems; empty when the product can be saved. */
export function validateProduct(product: Product): string[] {
  const errors: string[] = [];
  const layoutErrors = (layout: Product['decorationLayout']) => {
    const problems = decorationLayoutErrors(layout);
    const defaultText = layout?.extrudedText?.defaultText;
    const message = defaultText === undefined
      ? null
      : typeof defaultText === 'string' ? validateExtrudedText(defaultText) : t("3D lettering supports Latin letters (including accents), numbers, spaces and basic punctuation (. , ! ? ' & - # @ : +) only.");
    if (message) problems.push(`${t("3D lettering suggested text:")} ${message}`);
    return problems;
  };
  errors.push(...layoutErrors(product.decorationLayout));
  product.mesh?.plates.forEach((plate) => {
    errors.push(...layoutErrors(plate.decorationLayout).map((message) => `${plate.name}: ${message}`));
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
        t("Model {value0} must be between {value1} and {value2} mm (the original size must be printable).", { value0: AXIS_LABELS[axis].toLowerCase(), value1: PRINT_MIN_MM, value2: PRINT_MAX_MM }),
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
        t("Model volume ({value0} cm³) can't exceed its bounding box ({value1} cm³). Check that it's in cm³, not mm³.", { value0: model.volumeCm3, value1: boundingBoxCm3.toFixed(1) }),
      );
    }
  }

  if (product.colors.length === 0) errors.push(t("Add at least one color."));
  product.colors.forEach((color, i) => {
    const name = color.name.trim() || `#${i + 1}`;
    if (!color.name.trim()) errors.push(t("Color #{value0} needs a name.", { value0: i + 1 }));
    if (!HEX_COLOR.test(color.hex)) errors.push(t("Color {value0}: \"{value1}\" is not a valid hex color.", { value0: name, value1: color.hex }));
    if (!Number.isFinite(color.priceDelta)) errors.push(t("Color {value0}: price change must be a number.", { value0: name }));
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
    if (!part.name.trim()) errors.push(t("Color part #{value0} needs a name.", { value0: i + 1 }));
  });

  if (product.engraving.enabled) {
    const { maxLength, price, fonts } = product.engraving;
    if (!Number.isInteger(maxLength) || maxLength < 1) {
      errors.push(t("Engraving max length must be a whole number of at least 1."));
    }
    const { maxLines } = product.engraving;
    if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > MAX_ENGRAVING_LINES) {
      errors.push(t("Engraving max lines must be a whole number from 1 to {value0}.", { value0: MAX_ENGRAVING_LINES }));
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
  const textureOptions = product.texture.options ?? [];
  textureOptions.forEach((option, i) => {
    if (!option.name.trim()) errors.push(t("Shop texture #{value0} needs a name.", { value0: i + 1 }));
    if (!option.url.trim()) errors.push(t("Shop texture {value0} needs an image.", { value0: option.name.trim() || `#${i + 1}` }));
  });
  if (new Set(textureOptions.map((option) => option.id)).size !== textureOptions.length) {
    errors.push(t("Each shop texture needs a unique id."));
  }
  if (product.texture.enabled && product.texture.allowCustom === false && textureOptions.length === 0) {
    errors.push(t("Offer at least one shop texture or let customers upload their own picture."));
  }

  return errors;
}

/** Returns an error message for 3D lettering text, or null if it is acceptable. */
export function validateExtrudedText(text: string): string | null {
  const lines = engravingLines(text);
  if (lines.length > EXTRUDED_TEXT_MAX_LINES) return t("3D lettering can have at most {value0} lines.", { value0: EXTRUDED_TEXT_MAX_LINES });
  if (engravingCharCount(lines.join('\n')) > EXTRUDED_TEXT_MAX_LENGTH) return t("3D lettering can be at most {value0} characters.", { value0: EXTRUDED_TEXT_MAX_LENGTH });
  if (!lines.every((line) => EXTRUDED_TEXT_ALLOWED.test(line))) return t("3D lettering supports Latin letters (including accents), numbers, spaces and basic punctuation (. , ! ? ' & - # @ : +) only.");
  return null;
}

/** Returns an error message for engraving text, or null if it is acceptable. */
export function validateEngraving(text: string, { maxLength, maxLines }: EngravingLimits): string | null {
  const lines = engravingLines(text);
  if (lines.length > maxLines) {
    return maxLines === 1
      ? t("Engraving must fit on a single line.")
      : t("Engraving can have at most {value0} lines.", { value0: maxLines });
  }
  if (engravingCharCount(lines.join('\n')) > maxLength) {
    return t("Engraving can be at most {value0} characters.", { value0: maxLength });
  }
  if (!lines.every((line) => ENGRAVING_ALLOWED.test(line))) {
    return t("Use letters, numbers, spaces and basic punctuation (. , ! ? ' & - # @ : +) only.");
  }
  return null;
}
