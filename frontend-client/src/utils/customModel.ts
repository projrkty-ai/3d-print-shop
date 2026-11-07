import { t } from '../i18n';
import * as THREE from 'three';
import { CUSTOM_MODEL_COLOR } from '../config';
import type { Dimensions, MeshFormat } from '../types';
import { analyzeMesh, detectMeshFormat, MeshFileError, parseMeshFile, PART_ATTRIBUTE, type FilePart, type MeshAnalysis } from './mesh';
import { SINGLE_PART_KEY, type ModelColors, type ModelPart } from './printOptions';

/** What the storefront can tell about a customer's own model before it is sent. */
export interface CustomModelInfo extends Dimensions {
  format: MeshFormat;
  volumeCm3: number;
  triangleCount: number;
  /** Printable plates of a slicer project; 1 for plain STL/3MF models. */
  plateCount: number;
  /** Ids of the printable plates when a slicer project has several; shown side by side in 3D. */
  plates?: number[];
  /** PNG data URL, or null when the browser can't render one (e.g. no WebGL). */
  thumbnail: string | null;
  /** Color parts, each printed in its own filament; one `model` part for single-color files. */
  parts: ModelPart[];
}

/** Renders the model again in the customer's filament colors; null without WebGL. */
export async function coloredThumbnail(file: File, info: CustomModelInfo, colors: ModelColors): Promise<string | null> {
  const geometry = parseMeshFile(await file.arrayBuffer(), info.plates ? { plates: info.plates } : { fileName: file.name });
  try {
    const { geometryThumbnail } = await import('./modelThumbnail');
    return geometryThumbnail(geometry, colors.color, colors.partColors);
  } catch (err) {
    console.warn('Could not render a thumbnail of the uploaded model', err);
    return null;
  } finally {
    geometry.dispose();
  }
}

/**
 * Each color part's share of the model's surface area: a proxy for its share of the material,
 * since painted regions of one shell have no volume of their own. Equal shares without geometry.
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

/**
 * The parts customers choose filaments for. Files without (usable) colors are one `model` part;
 * a single-material 3MF keeps its part key, which the 3D preview colors by.
 */
function modelParts(geometry: THREE.BufferGeometry, analysis: MeshAnalysis): ModelPart[] {
  if (analysis.parts.length === 0) return [{ key: SINGLE_PART_KEY, name: t("Model"), fileColor: null, share: 1 }];
  if (analysis.parts.length === 1) {
    const [part] = analysis.parts;
    return [{ key: part.key, name: part.name, fileColor: part.color, share: 1 }];
  }
  const shares = partShares(geometry, analysis.parts);
  return analysis.parts.map((part, i) => ({ key: part.key, name: part.name, fileColor: part.color, share: shares[i] }));
}

export const MODEL_EXTENSION = /\.(stl|3mf)$/i;

/**
 * Reads a model in the browser: checks that it really is the STL/3MF its name says, measures it
 * (a multi-plate project as the whole set) and renders a thumbnail. Throws `MeshFileError` for
 * files the shop could not print from.
 */
export async function readCustomModel(file: File): Promise<CustomModelInfo> {
  const extension = MODEL_EXTENSION.exec(file.name)?.[1]?.toLowerCase();
  const data = await file.arrayBuffer();
  const format = detectMeshFormat(data);
  if (extension && extension !== format) {
    throw new MeshFileError(t("The file's contents don't match its .{value0} extension.", { value0: extension }));
  }
  const geometries: THREE.BufferGeometry[] = [];
  try {
    let geometry = parseMeshFile(data, { fileName: file.name });
    geometries.push(geometry);
    let analysis: MeshAnalysis = analyzeMesh(geometry);
    const plates = analysis.plates.filter((plate) => plate.objectCount > 0).map((plate) => plate.id);
    let plateSet: number[] | undefined;
    if (plates.length > 1) {
      // Slicer projects: everything on every plate gets printed, so measure and show the whole set.
      try {
        const set = parseMeshFile(data, { plates });
        geometries.push(set);
        analysis = analyzeMesh(set);
        geometry = set;
        plateSet = plates;
      } catch (err) {
        if (!(err instanceof MeshFileError)) throw err;
      }
    }
    let thumbnail: string | null = null;
    try {
      const { geometryThumbnail } = await import('./modelThumbnail');
      thumbnail = geometryThumbnail(geometry, CUSTOM_MODEL_COLOR);
    } catch (err) {
      console.warn('Could not render a thumbnail of the uploaded model', err);
    }
    return {
      format,
      widthMm: analysis.widthMm,
      depthMm: analysis.depthMm,
      heightMm: analysis.heightMm,
      volumeCm3: analysis.volumeCm3,
      triangleCount: analysis.triangleCount,
      plateCount: Math.max(1, plates.length),
      ...(plateSet && { plates: plateSet }),
      thumbnail,
      parts: modelParts(geometry, analysis),
    };
  } finally {
    geometries.forEach((geometry) => geometry.dispose());
  }
}
