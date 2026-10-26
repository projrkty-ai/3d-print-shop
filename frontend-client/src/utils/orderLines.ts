import { t } from '../i18n';
import type { AppearanceSummary, CartItem, Customization, DecorationLayout, MeshPart, Product, SurfaceCustomization } from '../types';
import { engravingColor } from './pricing';
import { formatDimensions } from './sizing';
import { customizationSurfaces } from './customization';
import { decorationLayoutFor } from './decorationLayout';

export type ConfigurationSummary = Pick<CartItem, 'sizeLabel' | 'colorName' | 'colorHex' | 'parts' | 'plates' | 'engravingColor' | 'decorationLayout'>;

/**
 * Readable snapshot of a configured product, stored with cart items and orders so they
 * stay understandable even if the product is later edited or deleted.
 * Expects a customization already passed through `normalizeCustomization`.
 */
export function summarizeConfiguration(product: Product, customization: Customization): ConfigurationSummary {
  const surfaces = customizationSurfaces(product, customization);
  const appearances = surfaces.map(({ choices, parts, plate }) => summarizeAppearance(product, choices, parts, decorationLayoutFor(product, plate)));
  const plates = surfaces.flatMap(({ plate }, i) => plate
    ? [{ id: plate.id, name: plate.name, objectCount: plate.objectCount, appearance: appearances[i] }]
    : []);
  return {
    ...appearances[0],
    sizeLabel: formatDimensions(customization.dimensions),
    ...(plates.length > 0 && { plates }),
  };
}

function summarizeAppearance(product: Product, customization: SurfaceCustomization, parts: MeshPart[], layout?: DecorationLayout): AppearanceSummary {
  const textColor = engravingColor(product, customization);
  const common = {
    ...(textColor && { engravingColor: { name: textColor.name, hex: textColor.hex } }),
    ...(layout && { decorationLayout: structuredClone(layout) }),
  };
  if (parts.length > 0) {
    const choices = parts.map((part) => {
      const filament = product.colors.find((c) => c.id === customization.partColors[part.key]);
      return { name: part.name, colorName: filament?.name ?? t("Original"), colorHex: filament?.hex ?? part.fileColor };
    });
    return { ...common, colorName: t("Multi-color"), colorHex: choices[0].colorHex, parts: choices };
  }

  const color = product.colors.find((c) => c.id === customization.colorId) ?? product.colors[0];
  return { ...common, colorName: color.name, colorHex: color.hex };
}
