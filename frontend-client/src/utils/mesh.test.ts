import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { analyzeMesh, parseStl, prepareMeshForPreview, MeshFileError } from './mesh';

type Vec = [number, number, number];
type Triangle = [Vec, Vec, Vec];

/** Axis-aligned box from the origin, Z up, with outward-facing triangles. */
function boxTriangles(w: number, d: number, h: number): Triangle[] {
  const p = (x: number, y: number, z: number): Vec => [x * w, y * d, z * h];
  const quad = (a: Vec, b: Vec, c: Vec, e: Vec): Triangle[] => [
    [a, b, c],
    [a, c, e],
  ];
  return [
    ...quad(p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), p(1, 0, 0)), // bottom (-Z)
    ...quad(p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)), // top (+Z)
    ...quad(p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)), // front (-Y)
    ...quad(p(0, 1, 0), p(0, 1, 1), p(1, 1, 1), p(1, 1, 0)), // back (+Y)
    ...quad(p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0)), // left (-X)
    ...quad(p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)), // right (+X)
  ];
}

function binaryStl(triangles: Triangle[]): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((triangle, i) => {
    const offset = 84 + i * 50 + 12; // normals left as zero, as many exporters do
    triangle.flat().forEach((value, k) => view.setFloat32(offset + k * 4, value, true));
  });
  return buffer;
}

function asciiStl(triangles: Triangle[]): ArrayBuffer {
  const facets = triangles
    .map((t) => `facet normal 0 0 0\n outer loop\n${t.map((v) => `  vertex ${v.join(' ')}`).join('\n')}\n endloop\nendfacet`)
    .join('\n');
  return new TextEncoder().encode(`solid test\n${facets}\nendsolid test\n`).buffer as ArrayBuffer;
}

describe('parseStl + analyzeMesh', () => {
  it('reads a binary STL: size per axis (Z up) and enclosed volume', () => {
    const analysis = analyzeMesh(parseStl(binaryStl(boxTriangles(20, 10, 5))));
    expect(analysis).toEqual({ widthMm: 20, depthMm: 10, heightMm: 5, volumeCm3: 1, triangleCount: 12, parts: [], plates: [], plate: null });
  });

  it('reads an ASCII STL', () => {
    expect(analyzeMesh(parseStl(asciiStl(boxTriangles(30, 30, 30))))).toMatchObject({
      widthMm: 30,
      heightMm: 30,
      volumeCm3: 27,
    });
  });

  it('measures volume regardless of position or inverted winding', () => {
    const moved = boxTriangles(20, 10, 5).map((t) => t.map(([x, y, z]) => [x + 100, y - 40, z + 7]) as Triangle);
    const inverted = moved.map(([a, b, c]) => [a, c, b] as Triangle);
    expect(analyzeMesh(parseStl(binaryStl(inverted))).volumeCm3).toBe(1);
  });

  it('reports an open mesh as having no volume', () => {
    const single: Triangle[] = [
      [
        [0, 0, 0],
        [10, 0, 0],
        [0, 10, 0],
      ],
    ];
    expect(analyzeMesh(parseStl(binaryStl(single))).volumeCm3).toBe(0);
  });

  it('rejects files that are not STL', () => {
    const garbage = new TextEncoder().encode('<html>not a model</html>').buffer as ArrayBuffer;
    expect(() => parseStl(garbage)).toThrow(MeshFileError);
    expect(() => parseStl(garbage)).toThrow('This file could not be read as an STL model.');
  });

  it('rejects a well-formed STL with no triangles', () => {
    expect(() => parseStl(binaryStl([]))).toThrow('No triangles found — is this a valid STL file?');
  });

  it('measures the bundled demo model', () => {
    const file = readFileSync(new URL('../../fixtures/models/twisted-star-vase.stl', import.meta.url));
    const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
    expect(analyzeMesh(parseStl(buffer))).toEqual({
      widthMm: 95.9,
      depthMm: 95.9,
      heightMm: 180,
      volumeCm3: 119.6,
      triangleCount: 5824,
      parts: [],
      plates: [],
      plate: null,
    });
  });
});

describe('prepareMeshForPreview', () => {
  const prepare = (triangles: Triangle[]) => prepareMeshForPreview(parseStl(binaryStl(triangles)));

  it('converts Z-up to Y-up, rests on the ground, centers and scales to 2 units', () => {
    const { geometry } = prepare(boxTriangles(20, 10, 40)); // tall along Z
    const size = geometry.boundingBox!.getSize(new THREE.Vector3());
    expect(size.y).toBeCloseTo(2); // height is now Y
    expect(size.x).toBeCloseTo(1);
    expect(size.z).toBeCloseTo(0.5);
    expect(geometry.boundingBox!.min.y).toBeCloseTo(0);
    expect(geometry.boundingBox!.getCenter(new THREE.Vector3()).x).toBeCloseTo(0);
  });

  it('puts side faces in group 0 and tops/bottoms in group 1', () => {
    const { geometry, surface } = prepare(boxTriangles(10, 10, 10));
    expect(geometry.groups).toEqual([
      { start: 0, count: 24, materialIndex: 0 }, // 4 sides × 2 triangles
      { start: 24, count: 12, materialIndex: 1 }, // top + bottom
    ]);
    expect(surface.slots).toEqual(['front', 'plain']);
  });

  it('wraps UVs around the model without triangles spanning the seam', () => {
    const { geometry } = prepare(boxTriangles(10, 10, 10));
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i += 3) {
      const us = [uv.getX(i), uv.getX(i + 1), uv.getX(i + 2)];
      expect(Math.max(...us) - Math.min(...us)).toBeLessThanOrEqual(0.5);
    }
    // v runs from 0 at the bottom to 1 at the top.
    const vs = Array.from({ length: uv.count }, (_, i) => uv.getY(i));
    expect(Math.min(...vs)).toBeCloseTo(0);
    expect(Math.max(...vs)).toBeCloseTo(1);
  });

  it('does not modify the parsed geometry', () => {
    const raw = parseStl(binaryStl(boxTriangles(20, 10, 5)));
    const before = Array.from(raw.getAttribute('position').array);
    prepareMeshForPreview(raw);
    expect(Array.from(raw.getAttribute('position').array)).toEqual(before);
  });
});
