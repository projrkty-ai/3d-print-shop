import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePaint } from '../src/paint.mjs';

const A = [0, 0, 0], B = [10, 0, 0], C = [0, 10, 0];
const area = (p) => Math.abs((p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1])) / 2;

test('TriangleSelector leaf states (Orca paint_color)', () => {
  assert.deepEqual(decodePaint('4', A, B, C).map((l) => l.state), [1]);
  assert.deepEqual(decodePaint('8', A, B, C).map((l) => l.state), [2]);
  assert.deepEqual(decodePaint('0C', A, B, C).map((l) => l.state), [3]);
  assert.deepEqual(decodePaint('1C', A, B, C).map((l) => l.state), [4]);
  assert.deepEqual(decodePaint(null, A, B, C).map((l) => l.state), [0]);
});

test('split triangles: children cover the parent exactly', () => {
  for (const s of ['00400200200602003', '044440A2404464056040060A644440A2404464056040060A2034443', '4040020060A000300040020060203404464052040060640900A20404464052040060640900AA040020060633']) {
    const leaves = decodePaint(s, A, B, C);
    assert.ok(leaves.length > 3);
    const total = leaves.reduce((t, l) => t + area(l.p), 0);
    assert.ok(Math.abs(total - area([A, B, C])) < 1e-9, `${s}: ${total}`);
    assert.ok(leaves.some((l) => l.state > 0));
  }
});
