import type { AppearanceSummary, CartItem, Product, SurfaceCustomization } from '../types';
import { extrudedTextChoice } from './customization';
import type { ConfiguredModel, ConfiguredSurface } from './modelThumbnail';
import { orderedTextureUrl } from './texture';

/** The parts of a cart item or order item that describe what the customer configured. */
export type Configured = Pick<CartItem, 'customization' | 'sizeLabel' | 'colorName' | 'colorHex' | 'parts' | 'plates' | 'engravingColor' | 'decorationLayout' | 'texture' | 'printVariant'>;

/** Each printed surface of an item: every included plate, or the whole print. */
export function itemSurfaces(item: Configured) {
  return item.plates && item.customization.plates
    ? item.plates.map((plate) => ({
        plate, appearance: plate.appearance ?? item, choices: item.customization.plates?.[plate.id] ?? item.customization,
      }))
    : [{ plate: null, appearance: item as AppearanceSummary, choices: item.customization }];
}

/**
 * Part key → color as ordered. Snapshots record each part's key; for older ones, the product's
 * current filament colors stand in for the chosen filaments.
 */
function orderedPartColors(appearance: AppearanceSummary, choices: SurfaceCustomization, product: Product) {
  if (appearance.parts?.length && appearance.parts.every((part) => part.key)) {
    return Object.fromEntries(appearance.parts.map((part) => [part.key!, part.colorHex]));
  }
  return Object.fromEntries(Object.entries(choices.partColors ?? {}).flatMap(([key, colorId]) => {
    const color = product.colors.find((option) => option.id === colorId);
    return color ? [[key, color.hex]] : [];
  }));
}

/**
 * What to draw for an ordered or carted item. Colors, text, placement and texture come from the
 * item's own snapshot; only the 3D geometry comes from the product, which must still exist.
 */
export function configuredSurfaces(item: Configured, product: Product): (ConfiguredSurface & { name: string | null })[] {
  return itemSurfaces(item).map(({ plate, appearance, choices }) => {
    const model = plate ? product.mesh?.plates.find((candidate) => candidate.id === plate.id)?.model : undefined;
    const lettering = extrudedTextChoice(appearance.decorationLayout, choices);
    return {
      name: plate?.name ?? null,
      plate: plate && product.mesh ? plate.id : null,
      color: appearance.colorHex,
      partColors: orderedPartColors(appearance, choices, product),
      engravingText: choices.engravingText ?? '',
      engravingFont: choices.engravingFont ?? 'Arial',
      engravingColor: choices.engravingText?.trim() ? appearance.engravingColor?.hex ?? null : null,
      textureUrl: orderedTextureUrl(appearance, choices),
      layout: appearance.decorationLayout,
      extrudedText: lettering && {
        layout: lettering.lettering, text: lettering.text, sizeMm: lettering.sizeMm, modelMm: model ?? product.model,
      },
      ...(model && { sizeMm: Math.max(model.widthMm, model.depthMm, model.heightMm) }),
    };
  });
}

export function configuredModel(item: Configured, product: Product): ConfiguredModel {
  return {
    shape: product.shape,
    mesh: product.mesh ? { url: product.mesh.url, plate: product.mesh.plate, plates: product.mesh.selectedPlates } : null,
    surfaces: configuredSurfaces(item, product).map(({ name: _name, ...surface }) => surface),
  };
}
