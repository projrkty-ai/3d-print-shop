import { t } from '../i18n';
import { PRINT_MATERIALS, type ModelSpec, type PricingSettings, type Product, type ProjectProduct } from '../types';
import { includedProductPlates } from './meshPlates';
import { chosenVariant, measurementsAt, slicingErrors } from './printVariants';
import { priceProject } from './projectPricing';
import { scalingErrors } from './scaling';
import { AXES } from './sizing';

/** The print file, its size, scaling and print variants of a Print on Demand product (what the admin edits together). */
export type ProjectPrintSetup = Pick<ProjectProduct, 'mesh' | 'model' | 'slicing' | 'scaling'>;

/** Stand-in size for products without a print file (their price doesn't depend on it). */
const UNKNOWN_SIZE: ModelSpec = { widthMm: 100, depthMm: 100, heightMm: 100, volumeCm3: 1 };

/**
 * A Print on Demand product in the shape of a catalog product, so the catalog's slicing and
 * scaling editors and helpers work for it (the server does the same). The shop's rates price the
 * variants; products without the scaling setting are printed at their original size.
 */
export function projectAsProduct(product: Pick<ProjectProduct, 'id' | 'title' | 'published' | 'createdAt' | 'updatedAt'>, setup: ProjectPrintSetup, pricing: PricingSettings | null): Product {
  return {
    id: product.id,
    name: product.title,
    description: '',
    category: '',
    material: 'PLA',
    model: setup.model ?? UNKNOWN_SIZE,
    basePrice: 0,
    fixedFee: 0,
    productionDays: 0,
    imageUrl: '',
    shape: 'box',
    mesh: setup.mesh ?? null,
    published: product.published,
    colors: [],
    engraving: { enabled: false, maxLength: 1, maxLines: 1, price: 0, fonts: [], colorChoice: false, colorPrice: 0 },
    texture: { enabled: false, price: 0 },
    ...(setup.slicing && { slicing: setup.slicing }),
    scaling: setup.scaling ?? { enabled: false, minScale: 1, maxScale: 1 },
    ...(pricing && {
      catalogPricing: {
        ratesPerCm3: Object.fromEntries(PRINT_MATERIALS.map((material) => [material, 0])) as Record<(typeof PRINT_MATERIALS)[number], number>,
        handlingFee: pricing.handlingFee,
        updatedAt: pricing.updatedAt,
        hourlyRate: pricing.hourlyRate,
        filamentPricePerKg: pricing.filamentPricePerKg,
      },
    }),
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

/**
 * One set's price (without handling) with the default print variants at `scale`: every plate's
 * print time and filament interpolated between its sliced scales, priced together — as the server does.
 */
export function defaultSetPrice(product: Product, pricing: PricingSettings, scale: number): number | null {
  const plates = includedProductPlates(product);
  const surfaces = plates.length > 0 ? plates : [null];
  const variants = surfaces.map((plate) => chosenVariant(product, plate, {}));
  if (variants.some((variant) => !variant)) return null;
  const parts = variants.map((variant) => measurementsAt(variant!, scale));
  const pricingResult = priceProject({
    printMinutes: parts.reduce((sum, part) => sum + part.printMinutes, 0),
    filaments: parts.flatMap((part) => part.filaments),
  }, pricing);
  return Math.round((pricingResult.printTimeCost + pricingResult.filamentCost) * 100) / 100;
}

/** Problems with the print setup (empty when it can be saved); the server checks the same. */
export function projectPrintErrors(product: Product, setup: ProjectPrintSetup): string[] {
  const errors: string[] = [];
  if (setup.mesh && !(setup.model && AXES.every((axis) => Number.isFinite(setup.model![axis]) && setup.model![axis] > 0))) {
    errors.push(t("The print file needs its size: load it again."));
  }
  if (setup.scaling?.enabled && !setup.mesh) errors.push(t("Scaling needs a print file."));
  return [...errors, ...scalingErrors(product), ...slicingErrors(product)];
}
