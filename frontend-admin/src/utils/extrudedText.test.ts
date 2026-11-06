import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { ExtrudedTextLayout } from '../types';
import { extrudedTextGeometry } from './extrudedText';

// A 100 × 100 × 200 mm model drawn as a 2-unit-tall box centered on the ground: 1 unit = 100 mm.
const bounds = new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 2, 0.5));
const modelMm = { widthMm: 100, depthMm: 100, heightMm: 200 };

const layout = (patch: Partial<ExtrudedTextLayout> = {}): ExtrudedTextLayout => ({
  x: 0, y: -50, z: 100, rotationDeg: 0, tiltDeg: 0, sizeMm: 20, depthMm: 2, lineSpacing: 1.2,
  horizontalAlign: 'center', verticalAlign: 'middle', defaultText: '', ...patch,
});

const box = (geometry: THREE.BufferGeometry) => {
  geometry.computeBoundingBox();
  return geometry.boundingBox!;
};

describe('extruded 3D lettering geometry', () => {
  it('returns nothing for blank text', () => {
    expect(extrudedTextGeometry({ layout: layout(), text: '  \n ', sizeMm: 20, modelMm }, bounds)).toBeNull();
  });

  it('places upright text at the anchor on the front, raised outward by the depth', () => {
    const geometry = extrudedTextGeometry({ layout: layout(), text: 'Hi', sizeMm: 20, modelMm }, bounds)!;
    const frame = box(geometry);
    // Anchor: x 0, front face z = +0.5 (y −50 mm), half height y = 1; letters ~0.2 units, raised +z by 0.02.
    expect((frame.min.x + frame.max.x) / 2).toBeCloseTo(0, 1);
    expect((frame.min.y + frame.max.y) / 2).toBeCloseTo(1, 0);
    expect(frame.min.z).toBeCloseTo(0.5, 5);
    expect(frame.max.z).toBeCloseTo(0.52, 5);
    expect(frame.max.y - frame.min.y).toBeGreaterThan(0.1);
    expect(frame.max.y - frame.min.y).toBeLessThan(0.25);
    geometry.dispose();
  });

  it('faces and extrudes in the configured direction', () => {
    const right = box(extrudedTextGeometry({ layout: layout({ rotationDeg: 90, y: 0, x: 50 }), text: 'Hi', sizeMm: 20, modelMm }, bounds)!);
    expect(right.min.x).toBeCloseTo(0.5, 5); // raised off the right side
    expect(right.max.x).toBeCloseTo(0.52, 5);
    const flat = box(extrudedTextGeometry({ layout: layout({ tiltDeg: 90, y: 0, z: 200 }), text: 'Hi', sizeMm: 20, modelMm }, bounds)!);
    expect(flat.min.y).toBeCloseTo(2, 5); // lying on the top, raised upward
    expect(flat.max.y).toBeCloseTo(2.02, 5);
    expect(flat.max.z - flat.min.z).toBeGreaterThan(0.1); // letters now span the depth axis
  });

  it('aligns the block to the anchor and stacks lines with the configured spacing', () => {
    const at = (patch: Partial<ExtrudedTextLayout>, text = 'Hi') =>
      box(extrudedTextGeometry({ layout: layout(patch), text, sizeMm: 20, modelMm }, bounds)!);
    expect(at({ horizontalAlign: 'left' }).min.x).toBeCloseTo(0, 5);
    expect(at({ horizontalAlign: 'right' }).max.x).toBeCloseTo(0, 5);
    const single = at({});
    const double = at({}, 'Hi\nHo');
    // One extra line of 1.2 × 0.2 units, growing downward from the middle-aligned block.
    expect(single.max.y - double.max.y + (double.min.y - single.min.y)).toBeLessThan(0.05);
    expect(double.max.y - double.min.y - (single.max.y - single.min.y)).toBeCloseTo(0.24, 1);
    // Larger customer size scales the letters.
    const bigger = box(extrudedTextGeometry({ layout: layout(), text: 'Hi', sizeMm: 40, modelMm }, bounds)!);
    expect((bigger.max.x - bigger.min.x) / (single.max.x - single.min.x)).toBeCloseTo(2, 1);
  });
});
