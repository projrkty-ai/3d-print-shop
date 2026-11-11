import { t } from '../../i18n';
import type {
  MeshPlate, ModelSpec, PricingSettings, PrintMeasurements, PrintVariant, Product, ProjectPricing, ProjectPrintChoice, ProjectPrintOptions,
  ProjectProduct, ProjectQuote,
} from '../types';
import { includedProductPlates } from './meshPlates';
import { chosenVariant, measurementsAt, offeredVariants, slicingErrors, summarizeVariant, surfaceSlicing, usesVariantPricing } from './printVariants';
import { priceProject, setPrice } from './projectPricing';
import { percentScaleRange, scaleRange, scalingErrors } from './scaling';
import { AXES, baseDimensions } from './sizing';

type Printable = Pick<ProjectProduct, 'id' | 'title' | 'published' | 'mesh' | 'model' | 'slicing' | 'scaling' | 'createdAt' | 'updatedAt'>;

/** Stand-in size for products without a print file (their price doesn't depend on it). */
const UNKNOWN_SIZE: ModelSpec = { widthMm: 100, depthMm: 100, heightMm: 100, volumeCm3: 1 };

/**
 * A Print on Demand product in the shape of a catalog product, so slicing, scaling and variant
 * helpers are shared. Products without the scaling setting are printed at their original size.
 */
export function projectAsProduct(product: Printable): Product {
  return {
    id: product.id,
    name: product.title,
    description: '',
    category: '',
    material: 'PLA',
    model: product.model ?? UNKNOWN_SIZE,
    basePrice: 0,
    fixedFee: 0,
    productionDays: 0,
    imageUrl: '',
    shape: 'box',
    mesh: product.mesh ?? null,
    published: product.published,
    colors: [],
    engraving: { enabled: false, maxLength: 1, maxLines: 1, price: 0, fonts: [], colorChoice: false, colorPrice: 0 },
    texture: { enabled: false, price: 0 },
    ...(product.slicing && { slicing: product.slicing }),
    scaling: product.scaling ?? { enabled: false, minScale: 1, maxScale: 1 },
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

/** True when the product is priced from its sliced print variants instead of its measurements. */
export const projectUsesVariants = (product: Printable) => usesVariantPricing(projectAsProduct(product));

/** Key of a plate in `ProjectPrintChoice.variants`. */
export const plateKey = (plateId: number | null) => (plateId === null ? 'model' : String(plateId));

function pricedSurfaces(product: Product): (MeshPlate | null)[] {
  const plates = includedProductPlates(product);
  return plates.length > 0 ? plates : [null];
}

export interface ResolvedPrint {
  scale: number;
  plates: { plate: MeshPlate | null; variant: PrintVariant }[];
}

/**
 * The customer's print variants and scale, valid for the product: variants it no longer offers
 * become the defaults; a scale outside the product's range is an error (a message), since it
 * changes what is printed.
 */
export function resolvePrintChoice(product: Printable, choice: ProjectPrintChoice | undefined): ResolvedPrint | string {
  const priced = projectAsProduct(product);
  const scale = choice?.scale ?? 1;
  const range = scaleRange(priced);
  if (!(Number.isFinite(scale) && scale >= range.min - 1e-6 && scale <= range.max + 1e-6)) {
    const percents = percentScaleRange(priced);
    return percents.min === percents.max ? t('fixedScale') : t('scaleOutsideRange', percents.min, percents.max);
  }
  const plates = pricedSurfaces(priced).map((plate) => ({
    plate,
    variant: chosenVariant(priced, plate, { variantId: choice?.variants[plateKey(plate?.id ?? null)] })!,
  }));
  return { scale, plates };
}

/** Print time and filament of one set with the chosen variants at the chosen scale. */
export function printMeasurements({ scale, plates }: ResolvedPrint): PrintMeasurements {
  const parts = plates.map(({ variant }) => measurementsAt(variant, scale));
  return { printMinutes: parts.reduce((sum, part) => sum + part.printMinutes, 0), filaments: parts.flatMap((part) => part.filaments) };
}

/** The price of one set (handling fee included): from the chosen print, or the product's measurements. */
export function projectSetPricing(product: ProjectProduct, settings: PricingSettings, print?: ResolvedPrint): ProjectPricing {
  return priceProject(print ? printMeasurements(print) : product.measurements, settings);
}

/** The default print (default variants at the original size) of a sliced product, else undefined. */
export function defaultPrint(product: ProjectProduct): ResolvedPrint | undefined {
  if (!projectUsesVariants(product)) return undefined;
  const resolved = resolvePrintChoice(product, undefined);
  return typeof resolved === 'string' ? undefined : resolved;
}

/** What the customer chose, as the order keeps it: scale and the variant of every plate, with how the shop prints it. */
export function printSummary(product: ProjectProduct, print: ResolvedPrint) {
  const priced = projectAsProduct(product);
  return {
    scale: print.scale,
    plates: print.plates.map(({ plate, variant }) => ({
      plateId: plate?.id ?? null,
      name: plate?.name ?? t('wholeModel'),
      variant: summarizeVariant(surfaceSlicing(priced, plate), variant),
    })),
  };
}

/**
 * The price of `sets` sets before ordering. Sliced products also get the price of every offered
 * variant of every plate at the chosen scale. Throws the scale problem as a message.
 */
export function quoteProject(product: ProjectProduct, settings: PricingSettings, sets: number, choice?: ProjectPrintChoice): ProjectQuote | string {
  let print: ResolvedPrint | undefined;
  if (projectUsesVariants(product)) {
    const resolved = resolvePrintChoice(product, choice);
    if (typeof resolved === 'string') return resolved;
    print = resolved;
  }
  const pricing = projectSetPricing(product, settings, print);
  const perSet = setPrice(pricing);
  const quote: ProjectQuote = {
    sets,
    setPrice: perSet,
    handlingFee: pricing.handlingFee,
    total: Math.round((pricing.handlingFee + perSet * sets) * 100) / 100,
    currency: pricing.currency,
  };
  if (!print) return quote;
  const priced = projectAsProduct(product);
  const scale = print.scale;
  return {
    ...quote,
    print: { scale, variants: Object.fromEntries(print.plates.map(({ plate, variant }) => [plateKey(plate?.id ?? null), variant.id])) },
    variantPrices: Object.fromEntries(pricedSurfaces(priced).map((plate) => [
      plateKey(plate?.id ?? null),
      Object.fromEntries(offeredVariants(surfaceSlicing(priced, plate)).map((variant) => [
        variant.id, setPrice(priceProject(measurementsAt(variant, scale), settings)),
      ])),
    ])),
  };
}

/** The choices customers have for a sliced product (undefined for products priced by measurements). */
export function projectPrintOptions(product: ProjectProduct): ProjectPrintOptions | undefined {
  if (!projectUsesVariants(product)) return undefined;
  const priced = projectAsProduct(product);
  return {
    plates: pricedSurfaces(priced).map((plate) => {
      const slicing = surfaceSlicing(priced, plate);
      return {
        plateId: plate?.id ?? null,
        name: plate?.name ?? t('wholeModel'),
        defaultVariantId: chosenVariant(priced, plate, {})?.id ?? null,
        variants: offeredVariants(slicing).map(({ id, label, nozzleMm, layerHeightMm, material }) => ({ id, label, nozzleMm, layerHeightMm, material })),
      };
    }),
    scale: scaleRange(priced),
    size: baseDimensions(priced.model),
  };
}

/** Problems with the print file, scaling and print variants of a product (empty when it can be saved). */
export function projectPrintErrors(product: Printable): string[] {
  const errors: string[] = [];
  if (product.mesh && !(product.model && AXES.every((axis) => Number.isFinite(product.model![axis]) && product.model![axis] > 0))) {
    errors.push(t('printFileSize'));
  }
  if (product.scaling?.enabled && !product.mesh) errors.push(t('scalingNeedsModel'));
  const priced = projectAsProduct(product);
  return [...errors, ...scalingErrors(priced), ...slicingErrors(priced)];
}
