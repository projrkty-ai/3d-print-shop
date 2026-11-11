// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminSlicerPage } from './AdminSlicerPage';
import type { SliceOutput, SlicerClient } from '../../slicer/client';
import type { EstimateResult } from '../../slicer/engine/index.mjs';
import type { ModelInfo, SliceSettings } from '../../slicer/protocol';

let container: HTMLDivElement;
let root: Root;
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

const result: EstimateResult = {
  config_source: 'presets', support: false, time_s: 5260, time: '1h27m', weight_g: 36.84, filament_length_m: 12.35,
  per_extruder: [{ extruder: 1, weight_g: 14.8, length_m: 4.96 }, { extruder: 2, weight_g: 22.04, length_m: 7.39 }],
  layers: 191, first_layer_time_s: 118, tool_changes: 115, copies: 1, scale: 1,
  breakdown: {
    weight_g: { model: 26, support: 0, wipe_tower: 10.8, custom_gcode: 0.04 },
    time_s: { model: 3000, support: 0, wipe_tower: 1700, tool_changes: 575, travel_retract: 300, start_end_gcode: 18, cooling_slowdown: 0 },
  },
  calibration: { source: 'profile' }, elapsed_ms: 25000, printer: 'Snapmaker U1 (0.4 nozzle)', process: '0.20 Standard @Snapmaker U1 (0.4 nozzle)',
};
const info: ModelInfo = { fileName: 'part.3mf', objects: [{ name: 'Part', extruder: 1 }], plates: [], hasProjectSettings: true, projectPrinter: 'Snapmaker U1 (0.4 nozzle)', painted: true };

function fakeClient(slice: SlicerClient['slice']) {
  const client: SlicerClient = {
    inspect: vi.fn(async () => info),
    slice: vi.fn(slice),
    cancel: vi.fn(),
    dispose: vi.fn(),
  };
  return client;
}

async function chooseFile(name = 'part.3mf') {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File([new Uint8Array([1, 2, 3])], name);
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20)); // FileReader + worker round trip
  });
}
const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === text)!;

describe('admin slicer test page', () => {
  it('slices the chosen model with the selected profile and shows the estimate', async () => {
    let settingsSeen: SliceSettings | null = null;
    const client = fakeClient(async (_file, _name, settings, onProgress) => {
      settingsSeen = settings;
      onProgress('perimeters', 0.4);
      return { result, gcode: 'G1 X1' } satisfies SliceOutput;
    });
    await act(async () => root.render(<AdminSlicerPage createClient={() => client} />));
    expect(container.querySelector('h1')?.textContent).toBe('Slicer test');
    expect(button('Slice').disabled).toBe(true);
    await chooseFile();
    expect(container.querySelector('[data-testid="model-info"]')?.textContent).toContain('1 object');
    expect(container.textContent).toContain('multi-colour painting');
    const printer = container.querySelectorAll('select')[0] as HTMLSelectElement;
    await act(async () => { printer.value = 'Snapmaker U1 (0.6 nozzle)'; printer.dispatchEvent(new Event('change', { bubbles: true })); });
    const process = container.querySelectorAll('select')[1] as HTMLSelectElement;
    expect([...process.options].map((o) => o.value)).toEqual(['0.20 Standard @Snapmaker U1 (0.6 nozzle)', '0.30 Standard @Snapmaker U1 (0.6 nozzle)']);
    const overrides = container.querySelector('textarea')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(overrides, 'wall_loops = 3');
      overrides.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const scale = [...container.querySelectorAll('label')].find((label) => label.textContent?.startsWith('Scale (%)'))!.querySelector('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(scale, '150');
      scale.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { button('Slice').click(); });
    expect(settingsSeen).toMatchObject({ printer: 'Snapmaker U1 (0.6 nozzle)', process: '0.30 Standard @Snapmaker U1 (0.6 nozzle)', support: 'off', copies: 1, scale: 1.5, calibration: true, overrides: { wall_loops: '3' } });
    expect(container.querySelector('[data-testid="result-time"]')?.textContent).toBe('1h27m');
    expect(container.querySelector('[data-testid="result-weight"]')?.textContent).toBe('36.84 g');
    expect(container.textContent).toContain('1h 27m 40s');
    expect(container.textContent).toContain('Tool changes');
    expect(button('Download G-code')).toBeDefined();
  });

  it('rejects unsupported files and invalid overrides, and reports engine errors', async () => {
    const client = fakeClient(async () => { throw new Error('The model has no printable objects'); });
    await act(async () => root.render(<AdminSlicerPage createClient={() => client} />));
    await chooseFile('part.obj');
    expect(container.textContent).toContain('Choose a .3mf or .stl file.');
    await chooseFile('part.stl');
    const overrides = container.querySelector('textarea')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(overrides, 'not valid');
      overrides.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.textContent).toContain('Invalid lines: 1.');
    expect(button('Slice').disabled).toBe(true);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(overrides, '');
      overrides.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { button('Slice').click(); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('The model has no printable objects');
  });
});
