import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { estimateFile as estimate } from '../src/node.mjs';
import { sliceMesh } from '../src/meshslice.mjs';
import { exsAreaMm2 } from '../src/geom.mjs';

function cubeStl(file, s, ox = 100, oy = 100) {
  const v = [[0,0,0],[s,0,0],[s,s,0],[0,s,0],[0,0,s],[s,0,s],[s,s,s],[0,s,s]].map(([x,y,z]) => [x + ox, y + oy, z]);
  const f = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  const buf = Buffer.alloc(84 + f.length * 50);
  buf.writeUInt32LE(f.length, 80);
  f.forEach((t, i) => { const o = 84 + i * 50 + 12; t.forEach((vi, k) => v[vi].forEach((c, j) => buf.writeFloatLE(c, o + (k * 3 + j) * 4))); });
  writeFileSync(file, buf);
}

test('mesh slicing of a cube gives the exact cross-section', () => {
  const vertices = Float64Array.from([0,0,0, 10,0,0, 10,10,0, 0,10,0, 0,0,10, 10,0,10, 10,10,10, 0,10,10]);
  const indices = Uint32Array.from([0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4, 1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7]);
  const s = sliceMesh({ vertices, indices }, [0.1, 5, 9.9]);
  for (const ex of s) assert.ok(Math.abs(exsAreaMm2(ex) - 100) < 1e-3);
});

test('20 mm cube on a single tool: plausible time and weight, no tool changes', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'slicer-test-'));
  const file = path.join(dir, 'cube.stl');
  cubeStl(file, 20);
  const r = estimate({ model: file, process: '0.20 Standard @Snapmaker U1 (0.4 nozzle)', support: false });
  assert.equal(r.layers, 100);
  assert.equal(r.tool_changes, 0);
  assert.equal(r.breakdown.weight_g.wipe_tower, 0);
  // 2 walls, 5 top / 3 bottom layers, 15 % infill, 12 mm3/s -> roughly 3-6 g and 4-20 min
  assert.ok(r.weight_g > 3 && r.weight_g < 6, `weight ${r.weight_g}`);
  assert.ok(r.time_s > 4 * 60 && r.time_s < 20 * 60, `time ${r.time_s}`);
  // deterministic
  const r2 = estimate({ model: file, process: '0.20 Standard @Snapmaker U1 (0.4 nozzle)', support: false });
  assert.equal(r2.time_s, r.time_s);
  assert.equal(r2.weight_g, r.weight_g);
});

test('scale slices the plate as a uniformly scaled model', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'slicer-test-'));
  const small = path.join(dir, 'small.stl');
  const large = path.join(dir, 'large.stl');
  cubeStl(small, 10);
  cubeStl(large, 20);
  const opts = { process: '0.20 Standard @Snapmaker U1 (0.4 nozzle)', support: false };
  const scaled = estimate({ model: large, ...opts, scale: 0.5 });
  const direct = estimate({ model: small, ...opts });
  assert.equal(scaled.scale, 0.5);
  assert.equal(scaled.layers, direct.layers);
  assert.ok(Math.abs(scaled.weight_g - direct.weight_g) < 0.02, `${scaled.weight_g} vs ${direct.weight_g}`);
  assert.ok(Math.abs(scaled.time_s - direct.time_s) <= 0.01 * direct.time_s, `${scaled.time_s} vs ${direct.time_s}`);
  const larger = estimate({ model: large, ...opts, scale: 1.5 });
  assert.equal(larger.layers, 150);
  assert.ok(larger.weight_g > estimate({ model: large, ...opts }).weight_g);
  assert.throws(() => estimate({ model: large, ...opts, scale: 0 }), /Invalid scale/);
});
