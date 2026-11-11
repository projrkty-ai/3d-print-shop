import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { estimate, loadModelBytes } from '../src/index.mjs';
import { loadProfileLibrary, loadCalibration, estimateFile } from '../src/node.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const lib = loadProfileLibrary();
const PROC = '0.20 Standard @Snapmaker U1 (0.4 nozzle)';

test('engine modules are platform neutral (browser / Web Worker)', () => {
  const dir = path.join(here, '..', 'src');
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.mjs') && !['node.mjs', 'parallel.mjs', 'worker.mjs'].includes(f))) {
    const src = readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/from 'node:|require\(/.test(src), `${f} must not use Node.js APIs`);
  }
});

function cube3mf(size = 12, topMaterial = true) {
  const V = [[0, 0, 0], [size, 0, 0], [size, size, 0], [0, size, 0], [0, 0, size], [size, 0, size], [size, size, size], [0, size, size]];
  const T = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  const xml = `<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>
<basematerials id="1"><base name="A" displaycolor="#F00"/><base name="B" displaycolor="#00F"/></basematerials>
<object id="2" type="model" pid="1" pindex="0"><mesh><vertices>${V.map(([x, y, z]) => `<vertex x="${x + 130}" y="${y + 130}" z="${z}"/>`).join('')}</vertices>
<triangles>${T.map(([a, b, c], i) => `<triangle v1="${a}" v2="${b}" v3="${c}"${topMaterial && (i === 2 || i === 3) ? ' pid="1" p1="1"' : ''}/>`).join('')}</triangles></mesh></object>
</resources><build><item objectid="2"/></build></model>`;
  return zipSync({ '3D/3dmodel.model': strToU8(xml) });
}

test('3MF colour materials become filaments (tool changes + wipe tower)', () => {
  const r = estimate({ model: loadModelBytes(cube3mf(), 'cube.3mf'), library: lib, process: PROC, support: false });
  assert.deepEqual(r.per_extruder.map((x) => x.extruder), [1, 2]);
  assert.ok(r.tool_changes >= 1);
  assert.ok(r.breakdown.weight_g.wipe_tower > 0);
  const plain = estimate({ model: loadModelBytes(cube3mf(12, false), 'cube.3mf'), library: lib, process: PROC, support: false });
  assert.equal(plain.tool_changes, 0);
  assert.equal(plain.breakdown.weight_g.wipe_tower, 0);
});

test('copies multiply the model part', () => {
  const one = estimate({ model: loadModelBytes(cube3mf(12, false), 'c.3mf'), library: lib, process: PROC, support: false });
  const three = estimate({ model: loadModelBytes(cube3mf(12, false), 'c.3mf'), library: lib, process: PROC, support: false, copies: 3 });
  assert.equal(three.copies, 3);
  const k = three.breakdown.weight_g.model / one.breakdown.weight_g.model;
  assert.ok(k > 2.95 && k < 3.05, String(k));
  assert.ok(three.breakdown.time_s.model > 2.8 * one.breakdown.time_s.model);
  // a single small cube is slowed down for layer cooling (4 s minimum layer time), three much less
  assert.ok(one.breakdown.time_s.cooling_slowdown > 0);
  assert.ok(three.breakdown.time_s.cooling_slowdown < one.breakdown.time_s.cooling_slowdown / 2);
});

test('reference: podstawa-1 with the 0.8 nozzle profile matches OrcaSlicer within 1.5 %', () => {
  // OrcaSlicer 2.3: 35m19s, 29.73 g (references/podstawa-1/times.txt)
  const r = estimateFile({ model: path.join(here, '..', 'references', 'podstawa-1', 'model.3mf'), process: '0.40 Standard @Snapmaker U1 (0.8 nozzle)', support: false, calibration: loadCalibration() });
  const ref = 35 * 60 + 19;
  assert.ok(Math.abs(r.time_s / ref - 1) < 0.015, `time ${r.time_s}`);
  assert.ok(Math.abs(r.weight_g / 29.73 - 1) < 0.015, `weight ${r.weight_g}`);
});
