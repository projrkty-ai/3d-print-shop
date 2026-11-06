import { EXTRUDED_SIZE_FACTORS } from '../config';
import type { Customization, DecorationLayout, Dimensions, ExtrudedTextLayout, MeshPart, MeshPlate, Product, SurfaceCustomization, TextureOption } from '../types';
import { AXES, baseDimensions } from './sizing';
import { decorationLayoutFor } from './decorationLayout';
import { includedProductPlates, plateParts } from './meshPlates';
import { normalizeEngravingText } from './engraving';

/** A shop texture the product currently offers, or null (unknown id, or textures are off). */
export function textureOption(product: Product, id: string | null | undefined): TextureOption | null {
  if (!id || !product.texture.enabled) return null;
  return product.texture.options?.find((option) => option.id === id) ?? null;
}

/** Customers may upload their own picture (older products without the setting always allowed it). */
export function allowsCustomTexture(product: Product): boolean {
  return product.texture.enabled && product.texture.allowCustom !== false;
}

/** True when customers have any texture to apply: a shop texture or their own picture. */
export function offersTexture(product: Product): boolean {
  return allowsCustomTexture(product) || (product.texture.enabled && (product.texture.options?.length ?? 0) > 0);
}

/** Sizes the customer may choose for the 3D lettering, around the shop's size. */
export function extrudedSizeBounds(lettering: ExtrudedTextLayout): { min: number; max: number } {
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    min: round(Math.max(1, lettering.sizeMm * EXTRUDED_SIZE_FACTORS.min)),
    max: round(lettering.sizeMm * EXTRUDED_SIZE_FACTORS.max),
  };
}

export function clampExtrudedSizeMm(lettering: ExtrudedTextLayout, sizeMm: number | undefined): number {
  if (typeof sizeMm !== 'number' || !Number.isFinite(sizeMm)) return lettering.sizeMm;
  const { min, max } = extrudedSizeBounds(lettering);
  return Math.round(Math.min(max, Math.max(min, sizeMm)) * 10) / 10;
}

/** The 3D lettering on a surface — the shop's placement with the customer's text and size — or null. */
export function extrudedTextChoice(layout: DecorationLayout | undefined, choices: SurfaceCustomization) {
  const lettering = layout?.extrudedText;
  if (!lettering) return null;
  const text = typeof choices.extrudedText === 'string' ? choices.extrudedText : lettering.defaultText;
  if (!text.trim()) return null;
  return { lettering, text, sizeMm: clampExtrudedSizeMm(lettering, choices.extrudedSizeMm) };
}

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
function normalizeSurface(product: Product, c: SurfaceCustomization, parts: MeshPart[], plate?: MeshPlate): SurfaceCustomization {
  const fallback = defaultSurfaceCustomization(product);
  const libraryTexture = textureOption(product, c.textureId);
  const lettering = decorationLayoutFor(product, plate)?.extrudedText;
  const letteringSize = lettering && clampExtrudedSizeMm(lettering, c.extrudedSizeMm);
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
    // A shop texture replaces an uploaded picture; only one texture is applied to a surface.
    ...(libraryTexture
      ? { textureDataUrl: null, textureId: libraryTexture.id }
      : { textureDataUrl: allowsCustomTexture(product) ? c.textureDataUrl : null }),
    // 3D lettering choices exist only as differences from the shop's suggestion.
    ...(lettering && typeof c.extrudedText === 'string' && c.extrudedText !== lettering.defaultText && { extrudedText: c.extrudedText }),
    ...(lettering && letteringSize !== undefined && letteringSize !== lettering.sizeMm && { extrudedSizeMm: letteringSize }),
  };
}

export function normalizeCustomization(product: Product, c: Customization): Customization {
  const plates = includedProductPlates(product);
  return {
    ...normalizeSurface(product, c, product.mesh?.parts ?? []),
    dimensions: isDimensions(c.dimensions) ? c.dimensions : baseDimensions(product.model),
    ...(plates.length > 0 && {
      plates: Object.fromEntries(plates.map((plate) => [
        plate.id, normalizeSurface(product, c.plates?.[plate.id] ?? c, plateParts(product, plate), plate),
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
  const normalizeSurfaceText = <T extends SurfaceCustomization>(choices: T): T => ({
    ...choices,
    engravingText: normalizeEngravingText(choices.engravingText),
    ...(typeof choices.extrudedText === 'string' && { extrudedText: normalizeEngravingText(choices.extrudedText) }),
  });
  return {
    ...normalizeSurfaceText(c),
    ...(c.plates && {
      plates: Object.fromEntries(Object.entries(c.plates).map(([id, choices]) => [id, normalizeSurfaceText(choices)])),
    }),
  };
}
