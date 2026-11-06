import * as THREE from 'three';
import { Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import typeface from '../fonts/lettering.typeface.json';
import type { Dimensions, ExtrudedTextLayout } from '../types';
import { engravingLines } from './engraving';

/** The bundled 3D lettering font (a DejaVu Sans subset; see fonts/lettering-font-license.txt). */
let font: Font | undefined;
const letteringFont = () => (font ??= new Font(typeface as unknown as ConstructorParameters<typeof Font>[0]));

export interface ExtrudedTextPlacement {
  layout: ExtrudedTextLayout;
  text: string;
  /** Customer-chosen font size in millimeters (at the model's original size). */
  sizeMm: number;
  /** Original model size, mapping the layout's millimeters onto the drawn geometry. */
  modelMm: Dimensions;
}

/**
 * Raised 3D lettering as geometry in the model's preview coordinates: placed at the shop's anchor
 * (millimeters from the center of the model's footprint), facing `rotationDeg`/`tiltDeg`, aligned
 * around the anchor. Scales and moves with the model. Null when the text is empty.
 */
export function extrudedTextGeometry(
  { layout, text, sizeMm, modelMm }: ExtrudedTextPlacement,
  /** Bounding box of the model's drawn geometry. */
  bounds: THREE.Box3,
): THREE.BufferGeometry | null {
  const lines = engravingLines(text);
  if (lines.length === 0) return null;
  const boundsSize = bounds.getSize(new THREE.Vector3());
  // Preview units per millimeter; for model files these are identical on every axis.
  const units = new THREE.Vector3(
    boundsSize.x / (modelMm.widthMm || 1),
    boundsSize.y / (modelMm.heightMm || 1),
    boundsSize.z / (modelMm.depthMm || 1),
  );
  const size = sizeMm * units.y;
  if (!(size > 0)) return null;
  const lineHeight = layout.lineSpacing * size;
  const blockHeight = size + (lines.length - 1) * lineHeight;
  const firstBaseline =
    layout.verticalAlign === 'top' ? -size : layout.verticalAlign === 'bottom' ? blockHeight - size : blockHeight / 2 - size;

  const geometries = lines.flatMap((line, index) => {
    const shapes = letteringFont().generateShapes(line, size);
    if (shapes.length === 0) return []; // blank spacing line
    const geometry = new THREE.ExtrudeGeometry(shapes, {
      depth: layout.depthMm * units.y,
      bevelEnabled: false,
      curveSegments: 4,
    });
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const shift =
      layout.horizontalAlign === 'left' ? -box.min.x : layout.horizontalAlign === 'right' ? -box.max.x : -(box.min.x + box.max.x) / 2;
    geometry.translate(shift, firstBaseline - index * lineHeight, 0);
    return [geometry];
  });
  if (geometries.length === 0) return null;
  const merged = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries);
  if (geometries.length > 1) geometries.forEach((geometry) => geometry.dispose());

  // Anchor: X right, Y toward the back (printer) → −Z in the preview, Z up → Y.
  const anchor = new THREE.Vector3(
    (bounds.min.x + bounds.max.x) / 2 + layout.x * units.x,
    bounds.min.y + layout.z * units.y,
    (bounds.min.z + bounds.max.z) / 2 - layout.y * units.z,
  );
  const matrix = new THREE.Matrix4()
    .makeRotationY(THREE.MathUtils.degToRad(layout.rotationDeg))
    .multiply(new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(-layout.tiltDeg)))
    .setPosition(anchor);
  merged.applyMatrix4(matrix);
  return merged;
}
