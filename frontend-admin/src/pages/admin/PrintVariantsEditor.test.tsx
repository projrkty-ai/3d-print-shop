// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSeedProducts } from '../../data/seedProducts';
import { SliceCancelledError, type SlicerClient } from '../../slicer/client';
import type { EstimateResult } from '../../slicer/engine/index.mjs';
import type { SliceSettings } from '../../slicer/protocol';
import type { PlateSlicing, Product } from '../../types';
import { usesVariantPricing } from '../../utils/printVariants';
import { PrintVariantsEditor } from './PrintVariantsEditor';

let container: HTMLDivElement;
let root: Root;
let latest: Product;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const result = (time_s: number, weight_g: number) => ({ time_s, weight_g } as EstimateResult);

/** Star Vase Set (plates 1 and 2) with the shop's rates: $2/h, PLA $25/kg. */
function starSet(): Product {
  const product = createSeedProducts().find((p) => p.id === 'star-vase-set')!;
  return {
    ...product,
    catalogPricing: {
      ratesPerCm3: { PLA: 0.2145, PETG: 0.2184, ABS: 0.2158, ASA: 0.2236, TPU: 0.234, resin: 0.312 }, handlingFee: 5, updatedAt: null,
      hourlyRate: 2, filamentPricePerKg: { PLA: 25, PETG: 28, ABS: 26, ASA: 32, TPU: 40, resin: 60 },
    },
  };
}

function Harness({ initial, client, loadModel }: { initial: Product; client: SlicerClient; loadModel: (url: string) => Promise<ArrayBuffer> }) {
  const [product, setProduct] = useState(initial);
  latest = product;
  return (
    <PrintVariantsEditor product={product} createClient={() => client} loadModel={loadModel}
      onChange={(update) => setProduct((current) => ({ ...current, slicing: update(current.slicing ?? []) }))} />
  );
}

function fakeClient(slice: SlicerClient['slice']): SlicerClient {
  return { inspect: vi.fn(), slice: vi.fn(slice), cancel: vi.fn(), dispose: vi.fn() };
}

const buttonNamed = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.startsWith(text))!;
const checkbox = (label: string) => [...container.querySelectorAll('label')].find((l) => l.textContent === label)!.querySelector('input')!;
const byLabel = <T extends HTMLElement>(label: string) => container.querySelector<T>(`[aria-label="${label}"]`)!;
async function clickOn(element: HTMLElement) {
  await act(async () => element.click());
}
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const plateEntry = (plateId: number): PlateSlicing | undefined => latest.slicing?.find((entry) => entry.plateId === plateId);

describe('print variants editor', () => {
  it('slices every combination of the plate matrix with its supports and options, then prices the editable results', async () => {
    const seen: SliceSettings[] = [];
    const client = fakeClient(async (_file, name, settings, onProgress) => {
      seen.push(settings);
      expect(name).toBe('star-vase-project.3mf');
      onProgress('perimeters', 0.5);
      return { result: settings.printer.includes('0.6') ? result(4500, 80) : result(7200, 100) };
    });
    const loadModel = vi.fn(async () => new ArrayBuffer(8));
    await act(async () => root.render(<Harness initial={starSet()} client={client} loadModel={loadModel} />));
    expect(container.textContent).toContain('No variants are offered');
    expect(buttonNamed('Choose presets to slice').disabled).toBe(true);

    // choosing a printer preselects its default process and filament
    await clickOn(checkbox('Snapmaker U1 (0.4 nozzle)'));
    await clickOn(checkbox('Snapmaker U1 (0.6 nozzle)'));
    expect(checkbox('0.20 Standard @Snapmaker U1 (0.4 nozzle)').checked).toBe(true);
    expect(checkbox('0.30 Standard @Snapmaker U1 (0.6 nozzle)').checked).toBe(true);
    expect(checkbox('Generic PLA @U1 0.6 nozzle').checked).toBe(true);
    await clickOn(checkbox('0.20 Standard @Snapmaker U1 (0.6 nozzle)'));
    await clickOn(checkbox('Generate supports (every variant of this plate)'));
    const options = byLabel<HTMLTextAreaElement>('OrcaSlicer options');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(options, 'sparse_infill_density = 25%');
      options.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(plateEntry(1)).toMatchObject({ support: true, overrides: { sparse_infill_density: '25%' } });

    await clickOn(buttonNamed('Slice 3 variants'));
    expect(loadModel).toHaveBeenCalledWith('/models/star-vase-project.3mf');
    expect(seen).toHaveLength(3);
    expect(seen[0]).toMatchObject({ useProjectSettings: false, plate: 1, support: 'on', calibration: true, overrides: { sparse_infill_density: '25%' },
      printer: 'Snapmaker U1 (0.4 nozzle)', process: '0.20 Standard @Snapmaker U1 (0.4 nozzle)' });
    expect(seen.map((s) => s.process)).toContain('0.30 Standard @Snapmaker U1 (0.6 nozzle)');

    const variants = plateEntry(1)!.variants;
    expect(variants.map((v) => [v.label, v.measurements.printMinutes, v.measurements.filaments[0].grams])).toEqual([
      ['0.20 mm layers, 0.4 mm nozzle, PLA', 120, 100],
      ['0.20 mm layers, 0.6 mm nozzle, PLA', 75, 80],
      ['0.30 mm layers, 0.6 mm nozzle, PLA', 75, 80],
    ]);
    expect(plateEntry(1)!.defaultVariantId).toBe(variants[0].id);
    // 2 h × $2 + 100 g × $25/kg
    expect(container.querySelector('tbody tr')?.textContent).toContain('$6.50');

    // editing the measurements reprices and can be reset to the sliced values
    await type(byLabel('Print time of 0.20 mm layers, 0.4 mm nozzle, PLA at 100% in minutes'), '60');
    expect(plateEntry(1)!.variants[0].measurements.printMinutes).toBe(60);
    expect(container.querySelector('tbody tr')?.textContent).toContain('$4.50');
    expect(container.textContent).toContain('Sliced: 120 min, 100 g');
    await clickOn(buttonNamed('Use sliced values'));
    expect(plateEntry(1)!.variants[0].measurements.printMinutes).toBe(120);

    // the default follows the offer
    await clickOn(byLabel('Offer 0.20 mm layers, 0.4 mm nozzle, PLA'));
    expect(plateEntry(1)!.defaultVariantId).toBe(variants[1].id);
    await clickOn(byLabel('Default: 0.30 mm layers, 0.6 mm nozzle, PLA'));
    expect(plateEntry(1)!.defaultVariantId).toBe(variants[2].id);
    await type(byLabel('Name of Snapmaker U1 (0.6 nozzle) · 0.30 Standard @Snapmaker U1 (0.6 nozzle) · Generic PLA @U1 0.6 nozzle'), 'Fast');
    expect(plateEntry(1)!.variants[2].label).toBe('Fast');
    await clickOn(byLabel('Remove 0.20 mm layers, 0.6 mm nozzle, PLA'));
    expect(plateEntry(1)!.variants.map((v) => v.label)).toEqual(['0.20 mm layers, 0.4 mm nozzle, PLA', 'Fast']);

    // the second plate has its own matrix; pricing switches to variants once both plates offer one
    expect(usesVariantPricing(latest)).toBe(false);
    expect(container.textContent).toContain('Offer at least one variant on every included plate');
    const plateSelect = container.querySelector<HTMLSelectElement>('.print-variants__plate select')!;
    await act(async () => {
      plateSelect.value = '2';
      plateSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(checkbox('Snapmaker U1 (0.4 nozzle)').checked).toBe(false);
    await clickOn(checkbox('Snapmaker U1 (0.4 nozzle)'));
    await clickOn(buttonNamed('Slice 1 variant'));
    expect(seen.at(-1)).toMatchObject({ plate: 2, support: 'off', overrides: {} });
    expect(usesVariantPricing(latest)).toBe(true);
    expect(container.textContent).toContain('Prices come from the print variants customers choose.');
  });

  it('keeps finished variants when slicing is cancelled and reports failures', async () => {
    let calls = 0;
    const client = fakeClient(async () => {
      calls += 1;
      if (calls === 1) throw new Error('Model is empty');
      if (calls === 2) return { result: result(600, 10) };
      throw new SliceCancelledError();
    });
    const product = starSet();
    product.mesh = { ...product.mesh!, selectedPlates: [1] };
    await act(async () => root.render(<Harness initial={product} client={client} loadModel={async () => new ArrayBuffer(8)} />));
    expect(container.querySelector('.print-variants__plate')).toBeNull();
    await clickOn(checkbox('Snapmaker U1 (0.4 nozzle)'));
    await clickOn(checkbox('Snapmaker U1 (0.6 nozzle)'));
    await clickOn(checkbox('0.20 Standard @Snapmaker U1 (0.6 nozzle)'));
    await clickOn(buttonNamed('Slice 3 variants'));
    expect(calls).toBe(3);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Model is empty');
    expect(plateEntry(1)!.variants).toHaveLength(1);
  });

  it('slices scalable products at the original size and at both ends of the scale range', async () => {
    const seen: SliceSettings[] = [];
    // time ∝ scale², filament ∝ scale³ from 100 min and 50 g
    const client = fakeClient(async (_file, _name, settings) => {
      seen.push(settings);
      const scale = settings.scale ?? 1;
      return { result: result(6000 * scale ** 2, 50 * scale ** 3) };
    });
    const product = { ...starSet(), scaling: { enabled: true, minScale: 0.6, maxScale: 1.4 } };
    await act(async () => root.render(<Harness initial={product} client={client} loadModel={async () => new ArrayBuffer(8)} />));
    await clickOn(checkbox('Snapmaker U1 (0.4 nozzle)'));
    expect(container.textContent).toContain('Each variant is sliced at 100%, 60%, 140%.');
    await clickOn(buttonNamed('Slice 1 variant'));
    expect(seen.map((s) => s.scale)).toEqual([1, 0.6, 1.4]);
    const [variant] = plateEntry(1)!.variants;
    expect(variant.measurements).toEqual({ printMinutes: 100, filaments: [{ material: 'PLA', grams: 50 }] });
    expect(variant.scaled?.map((point) => [point.scale, point.measurements.printMinutes, point.measurements.filaments[0].grams])).toEqual([
      [0.6, 36, 10.8], [1.4, 196, 137.2],
    ]);
    // one row per scale, each priced: 36 min + 10.8 g = $1.20 + $0.27
    const rows = [...container.querySelectorAll('.print-variants__variant tr')];
    expect(rows.map((row) => row.querySelector('.print-variants__scale')?.textContent)).toEqual(['60%', '100%', '140%']);
    expect(rows[0].textContent).toContain('$1.47');
    await type(byLabel('Print time of 0.20 mm layers, 0.4 mm nozzle, PLA at 140% in minutes'), '200');
    expect(plateEntry(1)!.variants[0].scaled![1].measurements.printMinutes).toBe(200);
    expect(container.textContent).toContain('Sliced: 196 min, 137.2 g');

    // a wider range needs slicing again; slicing drops the measurements at scales no longer used
    await act(async () => root.render(<Harness key="wider" initial={{ ...latest, scaling: { enabled: true, minScale: 0.5, maxScale: 1.4 } }} client={client} loadModel={async () => new ArrayBuffer(8)} />));
    expect(container.querySelector('.print-variants__missing')?.textContent).toBe('Not sliced at this scale yet: slice again.');
    expect(container.textContent).toContain('(outside the range)');
    await clickOn(buttonNamed('Slice 1 variant'));
    expect(plateEntry(1)!.variants[0].scaled?.map((point) => point.scale)).toEqual([0.5, 1.4]);
  });

  it('asks for a model file first', async () => {
    const product = { ...starSet(), mesh: null };
    await act(async () => root.render(<Harness initial={product} client={fakeClient(vi.fn())} loadModel={vi.fn()} />));
    expect(container.textContent).toContain('Add a 3D model file to slice print variants.');
  });
});
