import * as THREE from 'three';
import type { PreviewShape } from '../types';
import type { SurfaceSpec } from './mesh';

/** Built-in preview geometry. Material slots: front = texture + engraving, side = texture only, plain = color only. */
export interface ShapeSpec extends SurfaceSpec {
  createGeometry: () => THREE.BufferGeometry;
}

function vaseGeometry() {
  const points: THREE.Vector2[] = [new THREE.Vector2(0, -1)];
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = 0.45 + 0.38 * Math.sin(Math.PI * Math.min(t * 1.15, 1)) + 0.15 * t ** 4;
    points.push(new THREE.Vector2(r, t * 2 - 1));
  }
  return new THREE.LatheGeometry(points, 96);
}

export const SHAPES: Record<PreviewShape, ShapeSpec> = {
  vase: {
    createGeometry: vaseGeometry,
    rotationY: Math.PI,
    surfaceAspect: 2,
    textWidthFraction: 0.28,
    bottomY: -1,
    doubleSided: true,
  },
  cylinder: {
    createGeometry: () => new THREE.CylinderGeometry(0.75, 0.75, 1.8, 96),
    slots: ['front', 'plain', 'plain'],
    rotationY: Math.PI,
    surfaceAspect: (2 * Math.PI * 0.75) / 1.8,
    textWidthFraction: 0.3,
    bottomY: -0.9,
  },
  box: {
    createGeometry: () => new THREE.BoxGeometry(1.5, 1.5, 1.5),
    // BoxGeometry groups: +x, -x, +y, -y, +z (front), -z
    slots: ['side', 'side', 'plain', 'plain', 'front', 'side'],
    rotationY: -Math.PI / 7,
    surfaceAspect: 1,
    textWidthFraction: 0.8,
    bottomY: -0.75,
  },
  sphere: {
    createGeometry: () => new THREE.SphereGeometry(1, 96, 64),
    rotationY: -Math.PI / 2,
    surfaceAspect: 2,
    textWidthFraction: 0.22,
    bottomY: -1,
  },
};
