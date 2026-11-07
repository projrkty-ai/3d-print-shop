import { t } from '../i18n';
import type { FilamentColor, FilamentType, LayerHeightOption, NozzleOption, PrintSettings } from './types';

/** Upper bounds that keep the settings sane (and the customer's pickers usable). */
export const PRINT_SETTINGS_LIMITS = { nozzles: 10, layerHeights: 20, filaments: 30, colors: 40 } as const;
export const NOZZLE_DIAMETER_MM = { min: 0.1, max: 2 } as const;
export const LAYER_HEIGHT_MM = { min: 0.02, max: 1.6 } as const;

/** Layer heights a nozzle can print: from a quarter of its diameter to 0.8 × its diameter. */
export function layerHeightRange(diameterMm: number): { min: number; max: number } {
  return { min: diameterMm / 4, max: diameterMm * 0.8 };
}

/** Tolerates float noise such as 0.4 × 0.8 = 0.32000000000000006. */
export function layerFitsNozzle(heightMm: number, diameterMm: number): boolean {
  const { min, max } = layerHeightRange(diameterMm);
  return heightMm >= min - 1e-9 && heightMm <= max + 1e-9;
}

const HEX = /^#[0-9a-f]{6}$/i;
const mm = (value: number) => String(Math.round(value * 1000) / 1000);

/**
 * Business rules for the print options, reported all at once like product problems: unique ids
 * and values, sensible sizes, positive prices and densities, defaults that exist and fit each
 * other, a layer height for every nozzle, and at least one filament with a color, so customers
 * always have something valid to choose.
 */
export function validatePrintSettings(settings: Omit<PrintSettings, 'updatedAt'>): string[] {
  const problems: string[] = [];
  const unique = (values: (string | number)[]) => new Set(values).size === values.length;
  const multiplierOk = (value: number) => value > 0 && value <= 10;

  if (settings.nozzles.length === 0) problems.push(t('addNozzle'));
  if (!unique(settings.nozzles.map((n) => n.id))) problems.push(t('nozzleIds'));
  if (!unique(settings.nozzles.map((n) => n.diameterMm))) problems.push(t('nozzleDuplicates'));
  settings.nozzles.forEach((nozzle) => {
    const label = t('nozzleLabel', mm(nozzle.diameterMm));
    if (!(nozzle.diameterMm >= NOZZLE_DIAMETER_MM.min && nozzle.diameterMm <= NOZZLE_DIAMETER_MM.max)) {
      problems.push(t('nozzleDiameter', label, NOZZLE_DIAMETER_MM.min, NOZZLE_DIAMETER_MM.max));
    }
    if (!multiplierOk(nozzle.priceMultiplier)) problems.push(t('priceMultiplier', label));
  });

  if (settings.layerHeights.length === 0) problems.push(t('addLayerHeight'));
  if (!unique(settings.layerHeights.map((l) => l.id))) problems.push(t('layerHeightIds'));
  if (!unique(settings.layerHeights.map((l) => l.heightMm))) problems.push(t('layerHeightDuplicates'));
  settings.layerHeights.forEach((layer) => {
    const label = t('layerLabel', mm(layer.heightMm));
    if (!(layer.heightMm >= LAYER_HEIGHT_MM.min && layer.heightMm <= LAYER_HEIGHT_MM.max)) {
      problems.push(t('layerHeight', label, LAYER_HEIGHT_MM.min, LAYER_HEIGHT_MM.max));
    }
    if (!multiplierOk(layer.priceMultiplier)) problems.push(t('priceMultiplier', label));
  });

  // Every nozzle must leave the customer at least one layer height to choose.
  for (const nozzle of settings.nozzles) {
    if (settings.layerHeights.length > 0 && !settings.layerHeights.some((l) => layerFitsNozzle(l.heightMm, nozzle.diameterMm))) {
      const { min, max } = layerHeightRange(nozzle.diameterMm);
      problems.push(t('nozzleWithoutLayers', t('nozzleLabel', mm(nozzle.diameterMm)), mm(min), mm(max)));
    }
  }
  const defaultNozzle = settings.nozzles.find((n) => n.id === settings.defaultNozzleId);
  const defaultLayer = settings.layerHeights.find((l) => l.id === settings.defaultLayerHeightId);
  if (settings.nozzles.length > 0 && !defaultNozzle) problems.push(t('defaultNozzle'));
  if (settings.layerHeights.length > 0 && !defaultLayer) problems.push(t('defaultLayerHeight'));
  if (defaultNozzle && defaultLayer && !layerFitsNozzle(defaultLayer.heightMm, defaultNozzle.diameterMm)) {
    problems.push(t('defaultsDontFit'));
  }

  if (settings.filaments.length === 0) problems.push(t('addFilament'));
  if (!unique(settings.filaments.map((f) => f.id))) problems.push(t('filamentIds'));
  settings.filaments.forEach((filament, i) => {
    const label = filament.name.trim() || t('filamentNumber', i + 1);
    if (!filament.name.trim()) problems.push(t('filamentName', i + 1));
    if (!(filament.pricePerKg > 0)) problems.push(t('filamentPrice', label));
    if (!(filament.densityGPerCm3 >= 0.5 && filament.densityGPerCm3 <= 3)) problems.push(t('filamentDensity', label));
    if (filament.colors.length === 0) problems.push(t('filamentColors', label));
    if (!unique(filament.colors.map((c) => c.id))) problems.push(t('filamentColorIds', label));
    filament.colors.forEach((color, j) => {
      if (!color.name.trim()) problems.push(t('filamentColorName', label, j + 1));
      if (!HEX.test(color.hex)) problems.push(t('colorHex', color.name || `#${j + 1}`, color.hex));
    });
  });
  return problems;
}

const color = (id: string, name: string, hex: string): FilamentColor => ({ id, name, hex });
const nozzle = (diameterMm: number, priceMultiplier: number): NozzleOption =>
  ({ id: `nozzle-${mm(diameterMm).replace('.', '-')}`, diameterMm, priceMultiplier });
const layer = (heightMm: number, priceMultiplier: number): LayerHeightOption =>
  ({ id: `layer-${mm(heightMm).replace('.', '-')}`, heightMm, priceMultiplier });

/**
 * Example options for a new shop: four common nozzles, layer heights covering each of them, and
 * four filaments with typical prices. Multipliers follow print time: thin layers and small
 * nozzles are slow, so they cost more.
 */
export function createSeedPrintSettings(now = new Date().toISOString()): PrintSettings {
  const nozzles = [nozzle(0.2, 1.3), nozzle(0.4, 1), nozzle(0.6, 0.9), nozzle(0.8, 0.85)];
  const layerHeights = [
    layer(0.08, 2), layer(0.12, 1.5), layer(0.16, 1.2), layer(0.2, 1), layer(0.24, 0.9), layer(0.28, 0.8),
    layer(0.32, 0.75), layer(0.4, 0.7), layer(0.48, 0.65), layer(0.56, 0.6),
  ];
  const filaments: FilamentType[] = [
    {
      id: 'pla', name: 'PLA', description: 'Everyday material: crisp details, matte finish, for indoor use.',
      pricePerKg: 80, densityGPerCm3: 1.24,
      colors: [
        color('black', 'Black', '#1c1c1e'), color('white', 'White', '#f4f4f2'), color('gray', 'Gray', '#8a8d91'),
        color('red', 'Red', '#c62828'), color('orange', 'Orange', '#ef6c00'), color('yellow', 'Yellow', '#f9c80e'),
        color('green', 'Green', '#2e7d32'), color('blue', 'Blue', '#1e5bb8'),
      ],
    },
    {
      id: 'petg', name: 'PETG', description: 'Tough, slightly flexible and heat resistant; good for functional parts.',
      pricePerKg: 100, densityGPerCm3: 1.27,
      colors: [
        color('black', 'Black', '#1c1c1e'), color('white', 'White', '#f4f4f2'),
        color('clear', 'Translucent', '#d9e7ef'), color('blue', 'Blue', '#1e5bb8'), color('orange', 'Orange', '#ef6c00'),
      ],
    },
    {
      id: 'silk-pla', name: 'Silk PLA', description: 'Glossy metallic look for decorative prints.',
      pricePerKg: 120, densityGPerCm3: 1.24,
      colors: [color('gold', 'Gold', '#c9a227'), color('silver', 'Silver', '#c0c4c8'), color('copper', 'Copper', '#b87333')],
    },
    {
      id: 'tpu', name: 'TPU 95A', description: 'Flexible, rubber-like; for grips, bumpers and seals.',
      pricePerKg: 160, densityGPerCm3: 1.21,
      colors: [color('black', 'Black', '#1c1c1e'), color('white', 'White', '#f4f4f2'), color('red', 'Red', '#c62828')],
    },
  ];
  return {
    nozzles, defaultNozzleId: 'nozzle-0-4', layerHeights, defaultLayerHeightId: 'layer-0-2', filaments, updatedAt: now,
  };
}

/** Print options as saved by the first version: named qualities and prices per gram. */
interface LegacyPrintSettings {
  qualities: { id: string; layerHeightMm: number; priceMultiplier: number }[];
  defaultQualityId: string;
  filaments: (Omit<FilamentType, 'pricePerKg'> & { pricePerGram: number })[];
  updatedAt: string;
}

/**
 * Converts options saved in the first format, keeping the shop's filaments and colors: prices per
 * gram become prices per kilogram, qualities become layer heights (nozzle 0.4 mm). Current documents
 * are returned unchanged; null when `stored` is neither.
 */
export function upgradePrintSettings(stored: unknown): PrintSettings | null {
  const value = stored as Partial<PrintSettings & LegacyPrintSettings> | null;
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value.nozzles) && Array.isArray(value.layerHeights)) return value as PrintSettings;
  if (!Array.isArray(value.qualities) || !Array.isArray(value.filaments)) return null;
  const legacy = value as LegacyPrintSettings;
  const seed = createSeedPrintSettings(legacy.updatedAt);
  const standard = seed.nozzles.find((n) => n.id === seed.defaultNozzleId)!;
  const layerHeights = legacy.qualities.map((q) => ({ id: q.id, heightMm: q.layerHeightMm, priceMultiplier: q.priceMultiplier }))
    .filter((l) => layerFitsNozzle(l.heightMm, standard.diameterMm));
  const defaultLayer = layerHeights.find((l) => l.id === legacy.defaultQualityId) ?? layerHeights[0];
  return {
    nozzles: [standard],
    defaultNozzleId: standard.id,
    layerHeights: defaultLayer ? layerHeights : seed.layerHeights,
    defaultLayerHeightId: defaultLayer?.id ?? seed.defaultLayerHeightId,
    filaments: legacy.filaments.map(({ pricePerGram, ...filament }) => ({ ...filament, pricePerKg: Math.round(pricePerGram * 1000 * 100) / 100 })),
    updatedAt: legacy.updatedAt,
  };
}
