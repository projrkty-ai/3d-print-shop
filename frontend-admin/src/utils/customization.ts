import type { Customization, Dimensions, MeshPart, Product, SurfaceCustomization } from '../types';
import { AXES, baseDimensions } from './sizing';
import { includedProductPlates, plateParts } from './meshPlates';
import { normalizeEngravingText } from './engraving';

export function defaultSurfaceCustomization(product: Product): SurfaceCustomization {
  return {
    colorId: product.colors[0]?.id ?? '',
    // Every part starts in the color the designer gave it in the file.
    partColors: {},
    engravingText: '',
    engravingFont: product.engraving.fonts[0] ?? 'Arial',
    engravingColorId: null,
    textureDataUrl: null,
  };
}

export function defaultCustomization(product: Product): Customization {
  const plates = includedProductPlates(product);
  return {
    ...defaultSurfaceCustomization(product),
    dimensions: baseDimensions(product.model),
    ...(plates.length > 0 && {
      plates: Object.fromEntries(plates.map((plate) => [plate.id, defaultSurfaceCustomization(product)])),
    }),
  };
}

const isDimensions = (value: unknown): value is Dimensions =>
  typeof value === 'object' && value !== null && AXES.every((axis) => typeof (value as Dimensions)[axis] === 'number');

/**
 * Repairs choices that no longer match the product (e.g. an admin removed a color
 * while a customer had it selected) and drops options the product doesn't offer.
 * Dimensions are kept as typed — they are validated separately so the customer sees why.
 */
function normalizeSurface(product: Product, c: SurfaceCustomization, parts: MeshPart[]): SurfaceCustomization {
  const fallback = defaultSurfaceCustomization(product);
  return {
    colorId: product.colors.some((col) => col.id === c.colorId) ? c.colorId : fallback.colorId,
    // Keep only choices for parts that still exist, with colors that are still offered.
    partColors: Object.fromEntries(
      parts.flatMap((part) => {
        const colorId = c.partColors?.[part.key];
        return colorId && product.colors.some((col) => col.id === colorId) ? [[part.key, colorId]] : [];
      }),
    ),
    engravingText: product.engraving.enabled ? c.engravingText : '',
    engravingFont: product.engraving.fonts.includes(c.engravingFont) ? c.engravingFont : fallback.engravingFont,
    engravingColorId:
      product.engraving.enabled &&
      product.engraving.colorChoice &&
      product.colors.some((col) => col.id === c.engravingColorId)
        ? c.engravingColorId
        : null,
    textureDataUrl: product.texture.enabled ? c.textureDataUrl : null,
  };
}

export function normalizeCustomization(product: Product, c: Customization): Customization {
  const plates = includedProductPlates(product);
  return {
    ...normalizeSurface(product, c, product.mesh?.parts ?? []),
    dimensions: isDimensions(c.dimensions) ? c.dimensions : baseDimensions(product.model),
    ...(plates.length > 0 && {
      plates: Object.fromEntries(plates.map((plate) => [
        plate.id, normalizeSurface(product, c.plates?.[plate.id] ?? c, plateParts(product, plate)),
      ])),
    }),
  };
}

/** Effective appearances, including the root fallback for legacy cart items. */
export function customizationSurfaces(product: Product, c: Customization) {
  const plates = includedProductPlates(product);
  return plates.length > 0
    ? plates.map((plate) => ({ plate, choices: c.plates?.[plate.id] ?? c, parts: plateParts(product, plate) }))
    : [{ plate: null, choices: c, parts: product.mesh?.parts ?? [] }];
}

export function normalizeCustomizationText(c: Customization): Customization {
  return {
    ...c,
    engravingText: normalizeEngravingText(c.engravingText),
    ...(c.plates && {
      plates: Object.fromEntries(Object.entries(c.plates).map(([id, choices]) => [
        id, { ...choices, engravingText: normalizeEngravingText(choices.engravingText) },
      ])),
    }),
  };
}
