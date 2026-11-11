import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalTemplate } from '../src/template.mjs';

test('legacy placeholders and conditionals', () => {
  const r = evalTemplate('M104 S[temp]\n{if x > 1}BIG{elsif x > 0}SMALL{else}ZERO{endif}', { temp: 215, x: 0.5 });
  assert.equal(r.text, 'M104 S215\nSMALL');
});

test('script blocks with locals, if/else and string output', () => {
  const src = '{\nlocal z = 1.5;\nif layer_num == 0 then\n"A"\nelse\n"G1 Z" + z + " T" + t[next];\nendif\n}';
  assert.equal(evalTemplate(src, { layer_num: 3, t: [10, 20, 30], next: 2 }).text, 'G1 Z1.5 T30');
});

test('ternary operator and out-of-range boolean arrays', () => {
  const r = evalTemplate('X{(a == 0 ? 0 : (a == 1 ? 120 : 300))}{if used[5]} T5{endif}', { a: 1, used: [true, true] });
  assert.equal(r.text, 'X120');
});

test('position assignment is visible to the caller', () => {
  const r = evalTemplate('{position[2] = position[2] + 2.0;}', { position: [1, 2, 3] });
  assert.deepEqual(r.vars.position, [1, 2, 5]);
});
