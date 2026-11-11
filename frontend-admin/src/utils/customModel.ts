import * as THREE from 'three';
import { t } from '../i18n';
import { analyzeMesh, MeshFileError, parseMeshFile, PART_ATTRIBUTE, type FilePart, type MeshAnalysis } from './mesh';
import { geometryThumbnail } from './modelThumbnail';
import { SINGLE_PART_KEY, type ModelPart } from './printEstimate';

/** Neutral filament color for customer models without chosen filaments (older requests). */
export const CUSTOM_MODEL_COLOR = '#9aa6b8';

export interface CustomModelAnalysis {
  analysis: MeshAnalysis;
  /** Printable plates of a slicer project (all of them get printed); undefined for plain models. */
  plates?: number[];
  /** Color parts with their share of the material, as the storefront reported them to the customer. */
  parts: ModelPart[];
  /** PNG data URL of the model as printed, or null when the browser can't render one (no WebGL). */
  thumbnail: string | null;
}

/** Colors to draw the model in: the single color, and per-part overrides by part key. */
export interface ModelColors {
  color: string;
  partColors?: Record<string, string>;
}

/**
 * Each color part's share of the model's surface area: a proxy for its share of the material,
 * since painted regions of one shell have no volume of their own. Equal shares without geometry.
 * Identical to the storefront's calculation, so both show the customer the same estimate.
 */
export function partShares(geometry: THREE.BufferGeometry, parts: FilePart[]): number[] {
  const position = geometry.getAttribute('position');
  const partIndex = geometry.getAttribute(PART_ATTRIBUTE);
  const areas = parts.map(() => 0);
  if (partIndex && parts.length > 1) {
    const index = geometry.getIndex();
    const vertex = (i: number) => (index ? index.getX(i) : i);
    const count = index ? index.count : position.count;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let i = 0; i + 2 < count; i += 3) {
      a.fromBufferAttribute(position, vertex(i));
      b.fromBufferAttribute(position, vertex(i + 1)).sub(a);
      c.fromBufferAttribute(position, vertex(i + 2)).sub(a);
      const part = partIndex.getX(vertex(i));
      if (part < areas.length) areas[part] += b.cross(c).length() / 2;
    }
  }
  const total = areas.reduce((sum, area) => sum + area, 0);
  return total > 0 ? areas.map((area) => area / total) : parts.map(() => 1 / parts.length);
}

/** The parts customers chose filaments for, keyed exactly like the storefront keys them. */
function modelParts(geometry: THREE.BufferGeometry, analysis: MeshAnalysis): ModelPart[] {
  if (analysis.parts.length === 0) return [{ key: SINGLE_PART_KEY, name: t("Model"), fileColor: null, share: 1 }];
  const shares = analysis.parts.length === 1 ? [1] : partShares(geometry, analysis.parts);
  return analysis.parts.map((part, i) => ({ key: part.key, name: part.name, fileColor: part.color, share: shares[i] }));
}

function thumbnailOf(geometry: THREE.BufferGeometry, colors?: ModelColors): string | null {
  try {
    return geometryThumbnail(geometry, colors?.color ?? CUSTOM_MODEL_COLOR, colors?.partColors);
  } catch (err) {
    console.warn('Could not render a thumbnail of the customer model', err);
    return null;
  }
}

/**
 * Measures a customer's STL/3MF as it will be printed — a multi-plate slicer project as the whole
 * set of its non-empty plates, otherwise the model itself — and renders its thumbnail in the
 * chosen filament colors. Throws `MeshFileError` for unreadable files.
 */
export function analyzeCustomModel(data: ArrayBuffer, fileName?: string, colors?: ModelColors): CustomModelAnalysis {
  const geometries: THREE.BufferGeometry[] = [];
  const result = (geometry: THREE.BufferGeometry, plates?: number[]): CustomModelAnalysis => {
    const analysis = analyzeMesh(geometry);
    return { analysis, ...(plates && { plates }), parts: modelParts(geometry, analysis), thumbnail: thumbnailOf(geometry, colors) };
  };
  try {
    const first = parseMeshFile(data, { fileName });
    geometries.push(first);
    const plates = analyzeMesh(first).plates.filter((plate) => plate.objectCount > 0).map((plate) => plate.id);
    if (plates.length <= 1) return result(first);
    try {
      const set = parseMeshFile(data, { plates });
      geometries.push(set);
      return result(set, plates);
    } catch (err) {
      if (!(err instanceof MeshFileError)) throw err;
      return result(first);
    }
  } finally {
    geometries.forEach((geometry) => geometry.dispose());
  }
}
