import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildConfig } from '../src/config.mjs';
import { parseTime } from '../src/reference.mjs';
import { DEFAULT_PROFILES_DIR, loadProfileLibrary, parseReferenceTable } from '../src/node.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

test('profile inheritance and per-extruder variant values', () => {
  const lib = loadProfileLibrary(DEFAULT_PROFILES_DIR);
  const cfg = buildConfig(lib, { printer: 'Snapmaker U1 (0.4 nozzle)' });
  assert.equal(cfg.names.process, '0.20 Standard @Snapmaker U1 (0.4 nozzle)');
  assert.equal(cfg.names.filaments[0], 'Generic PLA @U1 0.4 nozzle');
  assert.equal(cfg.num('layer_height'), 0.2);
  assert.equal(cfg.num('outer_wall_speed', 0), 200); // "Direct Drive Standard" variant
  assert.equal(cfg.filNum('filament_max_volumetric_speed', 0), 12);
  assert.equal(cfg.nExtruders, 4);
  const mixed = buildConfig(lib, { printer: 'Snapmaker U1 (0.4+0.6 nozzle)' });
  assert.equal(mixed.num('nozzle_diameter', 3), 0.6);
});

test('reference table parser', () => {
  const rows = parseReferenceTable(path.join(DEFAULT_PROFILES_DIR, 'SliceTestTimes.txt'));
  assert.equal(rows.length, 12);
  const r = rows.find((x) => x.process.startsWith('0.10') && !x.support);
  assert.equal(r.time_s, parseTime('6h53m'));
  assert.equal(r.weight_g, 41.8);
});
