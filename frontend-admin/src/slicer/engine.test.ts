import { describe, expect, it } from 'vitest';
import { inspectModel, loadModel, runSlice } from './runSlice';
import type { SliceSettings } from './protocol';
import { cubeStl, twoColourCube3mf } from './testing/models';

const base: SliceSettings = {
  useProjectSettings: false,
  printer: 'Snapmaker U1 (0.4 nozzle)',
  process: '0.20 Standard @Snapmaker U1 (0.4 nozzle)',
  filament: '',
  support: 'off',
  plate: 1,
  copies: 1,
  calibration: true,
  overrides: {},
  gcode: false,
};

describe('browser slicing engine (vendored copy)', () => {
  it('slices an STL cube with the bundled profiles', () => {
    const stages: string[] = [];
    const r = runSlice(cubeStl(20), 'cube.stl', base, (stage) => stages.push(stage));
    expect(r.layers).toBe(100);
    expect(r.tool_changes).toBe(0);
    expect(r.per_extruder).toHaveLength(1);
    // 20 mm cube, 2 walls, 15 % infill, 5 top / 3 bottom layers: ~3 cm3 of plastic
    expect(r.weight_g).toBeGreaterThan(3);
    expect(r.weight_g).toBeLessThan(5);
    expect(r.time_s).toBeGreaterThan(4 * 60);
    expect(r.time_s).toBeLessThan(15 * 60);
    expect(r.time).toMatch(/^\d+m$/);
    expect(stages).toContain('slicing');
    expect(stages.at(-1)).toBe('done');
  }, 60_000);

  it('maps 3MF colour materials to filaments and plans tool changes with a wipe tower', () => {
    const file = twoColourCube3mf();
    const info = inspectModel(loadModel(file, 'cube.3mf'), 'cube.3mf');
    expect(info).toMatchObject({ objects: [{ extruder: 1 }], painted: true, hasProjectSettings: false });
    const r = runSlice(file, 'cube.3mf', { ...base, gcode: true }, () => {});
    expect(r.per_extruder.map((x) => x.extruder)).toEqual([1, 2]);
    expect(r.tool_changes).toBeGreaterThan(0);
    expect(r.breakdown.weight_g.wipe_tower).toBeGreaterThan(0);
    expect(r.gcode).toContain(';LAYER_CHANGE');
  }, 60_000);

  it('applies copies and overrides', () => {
    const one = runSlice(cubeStl(10), 'c.stl', base, () => {});
    const four = runSlice(cubeStl(10), 'c.stl', { ...base, copies: 4 }, () => {});
    expect(four.copies).toBe(4);
    // the model part scales with the copies, the start G-code purge does not
    expect(four.breakdown.weight_g.model).toBeGreaterThan(3.9 * one.breakdown.weight_g.model);
    expect(four.breakdown.weight_g.model).toBeLessThan(4.1 * one.breakdown.weight_g.model);
    const dense = runSlice(cubeStl(10), 'c.stl', { ...base, overrides: { sparse_infill_density: '60%' } }, () => {});
    expect(dense.weight_g).toBeGreaterThan(one.weight_g * 1.3);
  }, 60_000);

  it('reports unreadable files', () => {
    expect(() => runSlice(new ArrayBuffer(10), 'broken.3mf', base, () => {})).toThrow();
    expect(() => runSlice(new ArrayBuffer(10), 'model.obj', base, () => {})).toThrow(/Unsupported/);
  });
});
