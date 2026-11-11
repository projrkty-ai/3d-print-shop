import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TimeEstimator } from '../src/estimator.mjs';

const limits = { maxFeed: [500, 500, 20, 30], maxAcc: [20000, 20000, 500, 5000], maxJerk: [10, 10, 3, 2.5], maxAccExtruding: 20000, maxAccRetracting: 5000, maxAccTravel: 20000, defaultAcc: 1000 };

test('single trapezoid move matches the analytic time', () => {
  const t = new TimeEstimator(limits);
  t.setKlipperAccel(1000);
  t.move([100, 0, 0, 0], 100, 'travel');
  // accelerate 10 -> 100 mm/s (4.95 mm, 0.09 s), cruise 90.1 mm, decelerate 0.09 s
  assert.ok(Math.abs(t.finish() - 1.081) < 1e-6);
});

test('collinear split moves cost the same as one move', () => {
  const t = new TimeEstimator(limits);
  t.setKlipperAccel(1000);
  t.move([50, 0, 0, 0], 100, 'travel');
  t.move([50, 0, 0, 0], 100, 'travel');
  assert.ok(Math.abs(t.finish() - 1.081) < 1e-6);
});

test('a 90 degree corner is limited by the jerk', () => {
  const t = new TimeEstimator(limits);
  t.setKlipperAccel(1000);
  t.move([50, 0, 0, 0], 100, 'travel');
  t.move([0, 50, 0, 0], 100, 'travel');
  assert.ok(Math.abs(t.finish() - 1.162) < 1e-6);
});

test('retraction uses the retract acceleration and the E speed limit', () => {
  const t = new TimeEstimator(limits);
  t.move([0, 0, 0, -1.5], 60, 'retract'); // clamped to 30 mm/s
  // 2.5 -> 30 mm/s at 5000 mm/s2, cruise, decelerate: 0.05504 s
  assert.ok(Math.abs(t.finish() - 0.05504) < 1e-4);
});

test('tool change time is added on synchronisation', () => {
  const t = new TimeEstimator(limits);
  t.setKlipperAccel(1000);
  t.move([10, 0, 0, 0], 100, 'travel');
  t.move([10, 0, 0, 0], 100, 'travel');
  const before = 0;
  t.sync(5);
  assert.ok(t.time > 5 + before);
});
