import type { CatalogPricing, MeshPlate, PlateSlicing, PrintVariant, PrintVariantSummary, Product, SurfaceCustomization, VariantScalePrice } from '../types';
import { includedProductPlates } from './meshPlates';

type PrintMeasurements = NonNullable<PrintVariant['measurements']>;

const roundCents = (value: number) => Math.round(value * 100) / 100;

/** Key of a variant in `CatalogPricing.variantPrices`. */
export const variantPriceKey = (plateId: number | null, variantId: string) => `${plateId ?? 'model'}:${variantId}`;

/** The slicing setup of a plate, or of the whole model (`plate` null) for files without plates. */
export function surfaceSlicing(product: Product, plate: Pick<MeshPlate, 'id'> | null): PlateSlicing | undefined {
  const plateId = plate?.id ?? null;
  return product.slicing?.find((entry) => entry.plateId === plateId);
}

/** Variants customers can choose. */
export const offeredVariants = (slicing: PlateSlicing | undefined): PrintVariant[] => slicing?.variants.filter((variant) => variant.enabled) ?? [];

/** The surfaces that are priced: the included plates, or the whole model. */
function pricedSurfaces(product: Product): (MeshPlate | null)[] {
  const plates = includedProductPlates(product);
  return plates.length > 0 ? plates : [null];
}

/**
 * True when every included plate (or the model) offers at least one sliced variant: the print
 * price then comes from the variants chosen by the customer, not from the volume estimate.
 */
export function usesVariantPricing(product: Product): boolean {
  if (!product.mesh || !product.slicing?.length) return false;
  return pricedSurfaces(product).every((plate) => offeredVariants(surfaceSlicing(product, plate)).length > 0);
}

/** The customer's variant when still offered, else the shop's default (or the first offered). */
export function chosenVariant(product: Product, plate: Pick<MeshPlate, 'id'> | null, choices: Pick<SurfaceCustomization, 'variantId'>): PrintVariant | null {
  const offered = offeredVariants(surfaceSlicing(product, plate));
  return offered.find((variant) => variant.id === choices.variantId)
    ?? offered.find((variant) => variant.id === surfaceSlicing(product, plate)?.defaultVariantId)
    ?? offered[0]
    ?? null;
}

/** Print time × hourly rate + Σ grams × price per kilogram, rounded to cents (no handling fee). */
export function measurementsPrice(measurements: PrintMeasurements, rates: Pick<Required<CatalogPricing>, 'hourlyRate' | 'filamentPricePerKg'>): number {
  const time = roundCents((measurements.printMinutes / 60) * rates.hourlyRate);
  const filament = measurements.filaments.reduce((sum, { material, grams }) => sum + roundCents((grams / 1000) * rates.filamentPricePerKg[material]), 0);
  return roundCents(time + filament);
}

/**
 * Price of a variant at the model's original size: calculated from its measurements with the
 * shop's rates when they are known (server, admin), else the price the API published.
 */
export function variantOriginalPrice(product: Product, plateId: number | null, variant: PrintVariant): number | null {
  const pricing = product.catalogPricing;
  if (variant.measurements && pricing?.hourlyRate !== undefined && pricing.filamentPricePerKg) {
    return measurementsPrice(variant.measurements, { hourlyRate: pricing.hourlyRate, filamentPricePerKg: pricing.filamentPricePerKg });
  }
  return pricing?.variantPrices?.[variantPriceKey(plateId, variant.id)] ?? null;
}

/** Original-size prices of every offered variant, published with the product. */
export function variantPrices(product: Product): Record<string, number> {
  return Object.fromEntries((product.slicing ?? []).flatMap((slicing) => offeredVariants(slicing).flatMap((variant) => {
    const price = variantOriginalPrice(product, slicing.plateId, variant);
    return price === null ? [] : [[variantPriceKey(slicing.plateId, variant.id), price]];
  })));
}

const sameScale = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/**
 * A variant's prices at the scales it was sliced at (always the original size): from its
 * measurements with the shop's rates when known, else the prices the API published.
 */
export function variantPricePoints(product: Product, plateId: number | null, variant: PrintVariant): VariantScalePrice[] | null {
  const original = variantOriginalPrice(product, plateId, variant);
  if (original === null) return null;
  const pricing = product.catalogPricing;
  const rates = pricing?.hourlyRate !== undefined && pricing.filamentPricePerKg
    ? { hourlyRate: pricing.hourlyRate, filamentPricePerKg: pricing.filamentPricePerKg }
    : null;
  const others = variant.measurements && rates
    ? (variant.scaled ?? []).map(({ scale, measurements }) => ({ scale, price: measurementsPrice(measurements, rates) }))
    : pricing?.variantScalePrices?.[variantPriceKey(plateId, variant.id)] ?? [];
  return [{ scale: 1, price: original }, ...others.filter(({ scale }) => !sameScale(scale, 1))].sort((a, b) => a.scale - b.scale);
}

/**
 * Price at any scale from the sliced points: between two points it follows the power law through
 * them (price ∝ scale^k, exact for prices growing with area or volume); beyond the points the
 * nearest segment is continued. A single point scales with the volume (k = 3).
 */
export function interpolatePrice(points: VariantScalePrice[], scale: number): number {
  const sorted = points.filter((point) => point.scale > 0 && Number.isFinite(point.price)).sort((a, b) => a.scale - b.scale);
  if (sorted.length === 0) return NaN;
  const exact = sorted.find((point) => sameScale(point.scale, scale));
  if (exact) return exact.price;
  if (sorted.length === 1) return sorted[0].price * (scale / sorted[0].scale) ** 3;
  const above = sorted.findIndex((point) => point.scale > scale);
  const i = above === -1 ? sorted.length - 1 : Math.max(1, above);
  const a = sorted[i - 1];
  const b = sorted[i];
  if (a.price > 0 && b.price > 0) {
    const k = Math.log(b.price / a.price) / Math.log(b.scale / a.scale);
    return a.price * (scale / a.scale) ** k;
  }
  return a.price + ((b.price - a.price) * (scale - a.scale)) / (b.scale - a.scale);
}

/** Price of a variant at a uniform scale of the product (unrounded), or null without a price. */
export function variantPriceAt(product: Product, plateId: number | null, variant: PrintVariant, scale: number): number | null {
  const points = variantPricePoints(product, plateId, variant);
  return points ? interpolatePrice(points, scale) : null;
}

/** Prices of every offered variant at its other sliced scales, published with the product. */
export function variantScalePrices(product: Product): Record<string, VariantScalePrice[]> {
  return Object.fromEntries((product.slicing ?? []).flatMap((slicing) => offeredVariants(slicing).flatMap((variant) => {
    const points = variant.scaled?.length ? variantPricePoints(product, slicing.plateId, variant) : null;
    const others = points?.filter(({ scale }) => !sameScale(scale, 1)) ?? [];
    return others.length ? [[variantPriceKey(slicing.plateId, variant.id), others]] : [];
  })));
}

/** Snapshot of a chosen variant for carts and orders; the server adds how the shop prints it. */
export function summarizeVariant(_slicing: PlateSlicing | undefined, variant: PrintVariant): PrintVariantSummary {
  return {
    id: variant.id,
    label: variant.label,
    nozzleMm: variant.nozzleMm,
    layerHeightMm: variant.layerHeightMm,
    material: variant.material,
  };
}
