import { describe, expect, it } from 'vitest';
import { parseOverrides } from '../slicer/overrides';
import {
  emptySlicing, formatOverrides, matrixCombinations, measurementsEdited, mergeSliced, presetFacts, resultMeasurements, unmatchedPrinters,
} from './printVariantMatrix';

const U1_04 = 'Snapmaker U1 (0.4 nozzle)';
const U1_06 = 'Snapmaker U1 (0.6 nozzle)';
const matrix = {
  printers: [U1_04, U1_06],
  processes: ['0.20 Standard @Snapmaker U1 (0.4 nozzle)', '0.20 Standard @Snapmaker U1 (0.6 nozzle)', '0.30 Standard @Snapmaker U1 (0.6 nozzle)'],
  filaments: ['Generic PLA @U1 0.4 nozzle', 'Generic PLA @U1 0.6 nozzle'],
};

describe('print variant matrix', () => {
  it('combines every printer with the chosen processes and filaments made for it', () => {
    expect(matrixCombinations(matrix)).toEqual([
      { printer: U1_04, process: '0.20 Standard @Snapmaker U1 (0.4 nozzle)', filament: 'Generic PLA @U1 0.4 nozzle' },
      { printer: U1_06, process: '0.20 Standard @Snapmaker U1 (0.6 nozzle)', filament: 'Generic PLA @U1 0.6 nozzle' },
      { printer: U1_06, process: '0.30 Standard @Snapmaker U1 (0.6 nozzle)', filament: 'Generic PLA @U1 0.6 nozzle' },
    ]);
    // a printer without a fitting process gives no variant
    expect(unmatchedPrinters({ ...matrix, printers: [...matrix.printers, 'Snapmaker U1 (0.8 nozzle)'] })).toEqual(['Snapmaker U1 (0.8 nozzle)']);
    expect(matrixCombinations(emptySlicing(1).matrix)).toEqual([]);
  });

  it('reads nozzle, layer height and material from the presets', () => {
    expect(presetFacts(matrixCombinations(matrix)[2])).toEqual({ nozzleMm: 0.6, layerHeightMm: 0.3, material: 'PLA' });
    expect(resultMeasurements({ time_s: 11_883, weight_g: 123.456 }, 'PLA')).toEqual({ printMinutes: 198.1, filaments: [{ material: 'PLA', grams: 123.46 }] });
  });

  it('adds new combinations and re-slices known ones without losing the admin names and offers', () => {
    const [fine, fast, coarse] = matrixCombinations(matrix);
    let slicing = mergeSliced(emptySlicing(1), [{ presets: fine, result: { time_s: 600, weight_g: 10 } }, { presets: fast, result: { time_s: 300, weight_g: 11 } }], 'T1');
    expect(slicing.variants.map((v) => v.label)).toEqual(['0.20 mm layers, 0.4 mm nozzle, PLA', '0.20 mm layers, 0.6 mm nozzle, PLA']);
    expect(slicing.defaultVariantId).toBe(slicing.variants[0].id);
    const [first, second] = slicing.variants;
    slicing = {
      ...slicing,
      variants: [{ ...first, label: 'Fine', measurements: { printMinutes: 12, filaments: [{ material: 'PLA', grams: 10 }] } }, { ...second, enabled: false }],
    };
    expect(measurementsEdited(slicing.variants[0])).toBe(true);
    slicing = mergeSliced(slicing, [{ presets: fine, result: { time_s: 660, weight_g: 10.5 } }, { presets: coarse, result: { time_s: 240, weight_g: 12 } }], 'T2');
    expect(slicing.variants).toHaveLength(3);
    expect(slicing.variants[0]).toMatchObject({ id: first.id, label: 'Fine', enabled: true, measurements: { printMinutes: 11 }, sliced: { printMinutes: 11, slicedAt: 'T2' } });
    expect(measurementsEdited(slicing.variants[0])).toBe(false);
    expect(slicing.variants[1]).toMatchObject({ id: second.id, enabled: false, measurements: { printMinutes: 5 } });
    expect(slicing.variants[2]).toMatchObject({ label: '0.30 mm layers, 0.6 mm nozzle, PLA', layerHeightMm: 0.3, enabled: true });
  });

  it('names duplicates after their filament', () => {
    const system = { printer: U1_04, process: '0.20 Standard @Snapmaker U1 (0.4 nozzle)', filament: 'Generic PLA @System' };
    const slicing = mergeSliced(emptySlicing(null), [
      { presets: matrixCombinations(matrix)[0], result: { time_s: 600, weight_g: 10 } },
      { presets: system, result: { time_s: 600, weight_g: 10 } },
    ]);
    expect(slicing.variants[1].label).toBe('0.20 mm layers, 0.4 mm nozzle, PLA (Generic PLA @System)');
  });

  it('writes overrides in the format the slicer form reads', () => {
    const overrides = { sparse_infill_density: '20%', wall_loops: '3' };
    expect(parseOverrides(formatOverrides(overrides))).toEqual({ overrides, invalidLines: [] });
  });
});

describe('scaled slicing results', () => {
  it('adds results at other scales to the variant sliced at the original size and drops unused scales', () => {
    const [fine] = matrixCombinations(matrix);
    let slicing = mergeSliced(emptySlicing(1), [{ presets: fine, scale: 0.5, result: { time_s: 60, weight_g: 1 } }]);
    // a scaled result alone makes no variant
    expect(slicing.variants).toEqual([]);
    slicing = mergeSliced(slicing, [
      { presets: fine, result: { time_s: 600, weight_g: 10 } },
      { presets: fine, scale: 1.5, result: { time_s: 1500, weight_g: 33 } },
      { presets: fine, scale: 0.5, result: { time_s: 180, weight_g: 1.3 } },
    ], 'T1');
    expect(slicing.variants[0].scaled?.map((point) => [point.scale, point.measurements.printMinutes])).toEqual([[0.5, 3], [1.5, 25]]);
    slicing = mergeSliced(slicing, [{ presets: fine, result: { time_s: 660, weight_g: 11 } }], 'T2', undefined, [1, 0.6, 1.5]);
    expect(slicing.variants[0].scaled?.map((point) => point.scale)).toEqual([1.5]);
  });
});
