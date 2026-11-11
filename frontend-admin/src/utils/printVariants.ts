import { PRINT_MATERIALS } from '../types';
import type {
  CatalogPricing, MeshPlate, PlateSlicing, PrintMeasurements, PrintVariant, PrintVariantSummary, Product, SurfaceCustomization,
  VariantScalePrice,
} from '../types';
import { includedProductPlates } from './meshPlates';
import { formatScale, slicedScales } from './scaling';
import { t } from '../i18n';

const roundCents = (value: number) => Math.round(value * 100) / 100;

/** Limits of the admin's slicing setup. */
export const SLICING_LIMITS = { variants: 60, matrixEntries: 30, label: 120, overrides: 40, minutes: 60 * 24 * 30, grams: 100_000, scales: 10 } as const;

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

/**
 * Print time and filament of a variant at any scale, each interpolated between the sliced scales
 * like prices (`interpolatePrice`): the basis of Print on Demand prices.
 */
export function measurementsAt(variant: Pick<PrintVariant, 'measurements' | 'scaled'>, scale: number): PrintMeasurements {
  const points = [{ scale: 1, measurements: variant.measurements }, ...(variant.scaled ?? [])];
  const along = (value: (measurements: PrintMeasurements) => number) =>
    Math.max(0, interpolatePrice(points.map((point) => ({ scale: point.scale, price: value(point.measurements) })), scale));
  const materials = [...new Set(points.flatMap((point) => point.measurements.filaments.map((line) => line.material)))];
  return {
    printMinutes: along((measurements) => measurements.printMinutes),
    filaments: materials
      .map((material) => ({ material, grams: along((m) => m.filaments.filter((line) => line.material === material).reduce((sum, line) => sum + line.grams, 0)) }))
      .filter((line) => line.grams > 0),
  };
}

/** Prices of every offered variant at its other sliced scales, published with the product. */
export function variantScalePrices(product: Product): Record<string, VariantScalePrice[]> {
  return Object.fromEntries((product.slicing ?? []).flatMap((slicing) => offeredVariants(slicing).flatMap((variant) => {
    const points = variant.scaled?.length ? variantPricePoints(product, slicing.plateId, variant) : null;
    const others = points?.filter(({ scale }) => !sameScale(scale, 1)) ?? [];
    return others.length ? [[variantPriceKey(slicing.plateId, variant.id), others]] : [];
  })));
}

/** What customers receive: offered variants of the included plates, without presets, measurements or the matrix. */
export function publicSlicing(product: Product): Product['slicing'] {
  if (!product.slicing) return undefined;
  const surfaces = pricedSurfaces(product).map((plate) => plate?.id ?? null);
  return product.slicing
    .filter((slicing) => surfaces.includes(slicing.plateId))
    .map((slicing) => ({
      plateId: slicing.plateId,
      defaultVariantId: slicing.defaultVariantId,
      variants: offeredVariants(slicing).map(({ id, label, nozzleMm, layerHeightMm, material, enabled }) => ({ id, label, nozzleMm, layerHeightMm, material, enabled })),
    })) as unknown as PlateSlicing[];
}

/** Snapshot of a chosen variant for carts and orders; the server adds how the shop prints it. */
export function summarizeVariant(slicing: PlateSlicing | undefined, variant: PrintVariant): PrintVariantSummary {
  return {
    id: variant.id,
    label: variant.label,
    nozzleMm: variant.nozzleMm,
    layerHeightMm: variant.layerHeightMm,
    material: variant.material,
    ...(variant.presets && { presets: { ...variant.presets } }),
    ...(slicing?.support !== undefined && { support: slicing.support }),
    ...(slicing?.overrides && Object.keys(slicing.overrides).length > 0 && { overrides: { ...slicing.overrides } }),
  };
}

const isPositive = (value: number) => Number.isFinite(value) && value > 0;

function measurementErrors(measurements: PrintMeasurements | undefined): string[] {
  if (!measurements) return [t("print time and filament are missing.")];
  const errors: string[] = [];
  if (!isPositive(measurements.printMinutes) || measurements.printMinutes > SLICING_LIMITS.minutes) errors.push(t("print time must be greater than 0."));
  if (measurements.filaments.length === 0) errors.push(t("enter the filament used."));
  measurements.filaments.forEach(({ material, grams }) => {
    if (!PRINT_MATERIALS.includes(material)) errors.push(t("unknown material."));
    if (!isPositive(grams) || grams > SLICING_LIMITS.grams) errors.push(t("filament weight must be greater than 0."));
  });
  return errors;
}

/** Problems with the product's slicing setup (part of `validateProduct`). */
export function slicingErrors(product: Product): string[] {
  const slicing = product.slicing ?? [];
  if (slicing.length === 0) return [];
  const errors: string[] = [];
  if (!product.mesh) return [t("Print variants need a 3D model file.")];
  const plates = product.mesh.plates;
  const priced = pricedSurfaces(product).map((plate) => plate?.id ?? null);
  const seen = new Set<string>();
  for (const entry of slicing) {
    const plate = entry.plateId === null ? null : plates.find((candidate) => candidate.id === entry.plateId);
    const name = plate?.name ?? t("Model");
    if (entry.plateId === null ? plates.length > 0 : !plate) errors.push(t("Print variants refer to a plate that is not in the model file."));
    const key = String(entry.plateId);
    if (seen.has(key)) errors.push(t("{0}: print variants are defined twice.", name));
    seen.add(key);
    if (entry.variants.length > SLICING_LIMITS.variants) errors.push(t("{0}: at most {1} print variants.", name, SLICING_LIMITS.variants));
    if (new Set(entry.variants.map((variant) => variant.id)).size !== entry.variants.length) errors.push(t("{0}: print variant ids must be unique.", name));
    entry.variants.forEach((variant, i) => {
      const label = variant.label.trim() || `#${i + 1}`;
      const prefix = `${name}, ${label}:`;
      if (!variant.label.trim()) errors.push(`${name}: ${t("print variant {0} needs a name.", i + 1)}`);
      if (!isPositive(variant.nozzleMm) || !isPositive(variant.layerHeightMm)) errors.push(`${prefix} ${t("nozzle and layer height must be greater than 0.")}`);
      if (!PRINT_MATERIALS.includes(variant.material)) errors.push(`${prefix} ${t("unknown material.")}`);
      measurementErrors(variant.measurements).forEach((message) => errors.push(`${prefix} ${message}`));
      const scaled = variant.scaled ?? [];
      if (scaled.length > SLICING_LIMITS.scales || scaled.some(({ scale }) => !isPositive(scale) || sameScale(scale, 1))
        || new Set(scaled.map(({ scale }) => Math.round(scale * 1e6))).size !== scaled.length) {
        errors.push(`${prefix} ${t("scaled measurements must have distinct scales above 0 other than 100%.")}`);
      }
      scaled.forEach(({ scale, measurements }) => measurementErrors(measurements)
        .forEach((message) => errors.push(`${prefix} ${formatScale(scale)}: ${message}`)));
      // Offered variants are priced at every size customers can choose, so they need the ends of the range.
      if (variant.enabled && priced.includes(entry.plateId)) {
        const missing = slicedScales(product).filter((scale) => !scaled.some((point) => sameScale(point.scale, scale)));
        if (missing.length > 0) errors.push(`${prefix} ${t("not sliced at {0}: slice the variants again after changing the scaling.", missing.map(formatScale).join(', '))}`);
      }
    });
    if (entry.defaultVariantId !== null && !offeredVariants(entry).some((variant) => variant.id === entry.defaultVariantId)) {
      errors.push(t("{0}: the default print variant must be one that is offered.", name));
    }
  }
  // Variant pricing needs every included plate; a partial setup would price plates differently.
  const surfaces = pricedSurfaces(product);
  const offering = surfaces.filter((plate) => offeredVariants(surfaceSlicing(product, plate)).length > 0);
  if (offering.length > 0 && offering.length < surfaces.length) {
    const missing = surfaces.filter((plate) => !offering.includes(plate)).map((plate) => plate?.name ?? t("Model"));
    errors.push(t("Offer at least one print variant on every included plate, or none: missing on {0}.", missing.join(', ')));
  }
  return errors;
}
