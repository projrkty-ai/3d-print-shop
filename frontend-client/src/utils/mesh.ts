import { t } from '../i18n';
import * as THREE from 'three';
import { strFromU8, unzipSync, type Unzipped } from 'three/examples/jsm/libs/fflate.module.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import type { Dimensions, MeshFormat, ModelSpec } from '../types';
import { MeshFileError } from './meshFileError';
import { roundMm } from './sizing';
import { isSlicerProject, parseSlicerProject, type ProjectPlate } from './slicerProject';
import { MAX_FILE_PARTS, PART_ATTRIBUTE, type FilePart } from './meshParts';

export { MeshFileError };
export { MAX_FILE_PARTS, PART_ATTRIBUTE, type FilePart } from './meshParts';

export interface MeshAnalysis extends Dimensions {
  /** Volume enclosed by the mesh, in cm³ (exact only for closed, watertight meshes). */
  volumeCm3: number;
  triangleCount: number;
  /** Color parts; empty for single-color files. */
  parts: FilePart[];
  /** Set when the file had colors but too many to offer per-part choices. */
  ignoredColorCount?: number;
  /** Plates of a multi-plate slicer project (with thumbnails when available); empty otherwise. */
  plates: ProjectPlate[];
  /** The plate the geometry shows, or null. */
  plate: number | null;
}

/** Geometry userData written by `parse3mf`. */
interface MeshUserData {
  parts?: FilePart[];
  ignoredColorCount?: number;
  plates?: ProjectPlate[];
  plate?: number | null;
  model?: ModelSpec;
}

/** How the canvas texture (engraving, picture) wraps onto a surface. */
export interface SurfaceSpec {
  /** Material per geometry group, or a single front material when omitted. */
  slots?: ('front' | 'side' | 'plain')[];
  /** Color part of each slot (index into the part colors); all part 0 when omitted. */
  slotParts?: number[];
  /** Turns the mesh so the middle of the UV map (where text is drawn) faces the camera. */
  rotationY: number;
  /** Width / height of the surface the canvas wraps around, in world units. */
  surfaceAspect: number;
  /** Fraction of the canvas width the engraving may occupy. */
  textWidthFraction: number;
  /** Lowest local y coordinate, used to rest the model on the ground. */
  bottomY: number;
  doubleSided?: boolean;
}

export interface PreparedMesh {
  geometry: THREE.BufferGeometry;
  surface: SurfaceSpec;
  /** Color parts from the file, in the order `surface.slotParts` refers to; empty if single-color. */
  parts: FilePart[];
}

/** 3MF files are ZIP archives; everything else is treated as STL (binary or ASCII). */
export function detectMeshFormat(data: ArrayBuffer): MeshFormat {
  const bytes = new Uint8Array(data, 0, Math.min(4, data.byteLength));
  const isZip = bytes.length === 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  return isZip ? '3mf' : 'stl';
}

export interface ParseOptions {
  /** Only improves the error for a .3mf file that isn't a ZIP archive. */
  fileName?: string;
  /** Plate to build from a multi-plate slicer project; the first plate when omitted. */
  plate?: number | null;
  /** Plates included in one product; takes precedence over the legacy `plate`. */
  plates?: number[];
}

/**
 * Parses an STL or 3MF file (detected from its content, not its name) into a single
 * non-indexed geometry in millimeters, Z up, ready for `analyzeMesh` and the preview.
 */
export function parseMeshFile(data: ArrayBuffer, { fileName, plate, plates }: ParseOptions = {}): THREE.BufferGeometry {
  const format = detectMeshFormat(data);
  if (format === 'stl' && fileName && /\.3mf$/i.test(fileName)) {
    throw new MeshFileError(t("This file isn't a valid 3MF archive."));
  }
  return format === '3mf' ? parse3mf(data, { plate, plates }) : parseStl(data);
}

function assertUsableGeometry(geometry: THREE.BufferGeometry, label: string): THREE.BufferGeometry {
  const position = geometry.getAttribute('position');
  if (!position || position.count < 3) {
    geometry.dispose();
    throw new MeshFileError(t("No triangles found — is this a valid {value0} file?", { value0: label }));
  }
  const values = position.array;
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) {
      geometry.dispose();
      throw new MeshFileError(t("The {value0} file contains invalid coordinates.", { value0: label }));
    }
  }
  return geometry;
}

/** Parses binary or ASCII STL. STL has no units; millimeters are assumed, as slicers do. */
export function parseStl(data: ArrayBuffer): THREE.BufferGeometry {
  let geometry: THREE.BufferGeometry;
  try {
    geometry = new STLLoader().parse(data);
  } catch {
    throw new MeshFileError(t("This file could not be read as an STL model."));
  }
  return assertUsableGeometry(geometry, 'STL');
}

/** Millimeters per 3MF model unit (3MF core spec, `unit` attribute of <model>). */
const MM_PER_3MF_UNIT: Record<string, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

/** The archive's main model file, as named in its package relationships. */
function rootModelPath(files: Unzipped): string | undefined {
  const rels = files['_rels/.rels'] ? strFromU8(files['_rels/.rels']) : '';
  return /Target="\/?([^"]+\.model)"/i.exec(rels)?.[1] ?? Object.keys(files).find((name) => /^3D\/[^/]+\.model$/i.test(name));
}

/**
 * Reads the unit of the archive's root model. three's 3MF loader parses the attribute
 * but doesn't apply it, so a model saved in inches would otherwise be 25.4× too small.
 */
function read3mfUnitScale(files: Unzipped, rootPath: string | undefined): number {
  const root = rootPath ? files[rootPath] : undefined;
  if (!root) return 1;
  // The <model> element opens the document; its attributes are within the first few KB.
  const head = strFromU8(root.subarray(0, 64 * 1024));
  const unit = /<model\b[^>]*?\bunit\s*=\s*"([a-z]+)"/i.exec(head)?.[1]?.toLowerCase() ?? 'millimeter';
  const scale = MM_PER_3MF_UNIT[unit];
  if (scale === undefined) throw new MeshFileError(t("Unsupported 3MF unit \"{value0}\".", { value0: unit }));
  return scale;
}

/** Where a loaded mesh's color comes from: a named material, per-vertex colors, or nothing. */
function colorSource(mesh: THREE.Mesh): 'material' | 'vertex' | 'none' {
  const material = mesh.material as THREE.MeshPhongMaterial;
  if (material.vertexColors && mesh.geometry.getAttribute('color')) return 'vertex';
  return material.name === THREE.Loader.DEFAULT_MATERIAL_NAME ? 'none' : 'material';
}

/**
 * Parses a 3MF archive. All build items (with their transforms, and any component
 * transforms) are baked into one geometry. Colors from the file — named materials
 * (basematerials) and color groups — become parts: `userData.parts` lists them and the
 * `partIndex` attribute says which part each triangle belongs to.
 */
export function parse3mf(data: ArrayBuffer, { plate, plates }: ParseOptions = {}): THREE.BufferGeometry {
  let group: THREE.Group;
  let unitScale: number;
  try {
    const files = unzipSync(new Uint8Array(data), {
      filter: (file) => /\.(model|rels|config)$/i.test(file.name) || /^Metadata\/.*\.png$/i.test(file.name),
    });
    const rootPath = rootModelPath(files);
    unitScale = read3mfUnitScale(files, rootPath);
    if (rootPath && isSlicerProject(files)) {
      return plates ? buildPlateSet(files, rootPath, unitScale, plates) : buildSlicerProject(files, rootPath, unitScale, plate);
    }
    group = new ThreeMFLoader().parse(data);
  } catch (err) {
    if (err instanceof MeshFileError) throw err;
    throw new MeshFileError(t("This file could not be read as a 3MF model."), { cause: err });
  }

  group.updateMatrixWorld(true);
  const chunks: { positions: ArrayLike<number>; partIndices: number[] }[] = [];
  const parts: FilePart[] = [];
  const partByKey = new Map<string, number>();
  const color = new THREE.Color();
  let colored = false;

  const partIndexFor = (key: string, name: string, hex: string) => {
    let index = partByKey.get(key);
    if (index === undefined) {
      index = parts.length;
      partByKey.set(key, index);
      parts.push({ key, name, color: hex });
    }
    return index;
  };

  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    const triangleCount = geometry.getAttribute('position').count / 3;
    const source = colorSource(mesh);
    const partIndices: number[] = [];

    if (source === 'vertex') {
      // Color groups: one part per distinct color (a gradient triangle takes its first vertex's color).
      colored = true;
      const colors = geometry.getAttribute('color');
      for (let triangle = 0; triangle < triangleCount; triangle++) {
        const hex = `#${color.fromBufferAttribute(colors, triangle * 3).getHexString()}`;
        partIndices.push(partIndexFor(`color:${hex}`, t("Color {value0}", { value0: hex.toUpperCase() }), hex));
      }
    } else {
      const material = mesh.material as THREE.MeshPhongMaterial;
      let index: number;
      if (source === 'material') {
        colored = true;
        const hex = `#${material.color.getHexString()}`;
        index = partIndexFor(`material:${material.name}:${hex}`, material.name || t("Material {value0}", { value0: hex.toUpperCase() }), hex);
      } else {
        index = partIndexFor('uncolored', t("Uncolored"), '#ffffff');
      }
      for (let t = 0; t < triangleCount; t++) partIndices.push(index);
    }

    chunks.push({ positions: geometry.getAttribute('position').array, partIndices });
    geometry.dispose();
  });
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => m.dispose());
  });

  if (chunks.length === 0) throw new MeshFileError(t("No printable objects found in this 3MF file."));

  const positions = new Float32Array(chunks.reduce((n, c) => n + c.positions.length, 0));
  const partIndex = new Uint8Array(positions.length / 3);
  let offset = 0;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.positions.length; i++) positions[offset + i] = chunk.positions[i] * unitScale;
    chunk.partIndices.forEach((index, t) => partIndex.fill(index, offset / 3 + t * 3, offset / 3 + t * 3 + 3));
    offset += chunk.positions.length;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const userData: MeshUserData = {};
  if (colored && parts.length <= MAX_FILE_PARTS) {
    geometry.setAttribute(PART_ATTRIBUTE, new THREE.BufferAttribute(partIndex, 1));
    userData.parts = parts;
  } else if (colored) {
    userData.ignoredColorCount = parts.length;
  }
  geometry.userData = userData;
  return assertUsableGeometry(geometry, '3MF');
}

/** One plate of a slicer project, in millimeters, including slicer filament painting. */
function buildSlicerProject(files: Unzipped, rootPath: string, unitScale: number, plate?: number | null) {
  const project = parseSlicerProject(files, rootPath, plate);
  const { geometry } = project;
  if (geometry.getAttribute('position').count === 0) {
    throw new MeshFileError(t("No printable objects found in this project."));
  }
  if (unitScale !== 1) geometry.scale(unitScale, unitScale, unitScale);
  Object.assign(geometry.userData, { plates: project.plates, plate: project.plate } satisfies MeshUserData);
  return assertUsableGeometry(geometry, '3MF');
}

function buildPlateSet(files: Unzipped, rootPath: string, unitScale: number, ids: number[]) {
  if (ids.length === 0 || new Set(ids).size !== ids.length) throw new MeshFileError(t("Choose at least one distinct project plate."));
  const geometries: THREE.BufferGeometry[] = [];
  try {
    const analyses = ids.map((id) => {
      const geometry = buildSlicerProject(files, rootPath, unitScale, id);
      geometries.push(geometry);
      const analysis = analyzeMesh(geometry);
      if (analysis.plate !== id) throw new MeshFileError(t("Plate {value0} is not printable or does not exist in the project.", { value0: id }));
      return analysis;
    });
    const parts: FilePart[] = [];
    const positions: number[] = [];
    const partIndices: number[] = [];
    let offset = 0;
    geometries.forEach((geometry, i) => {
      const analysis = analyses[i];
      const localParts = analysis.parts.length ? analysis.parts : [{ key: 'uncolored', name: t("Uncolored"), color: '#ffffff' }];
      const mapping = localParts.map((part) => {
        let index = parts.findIndex((p) => p.key === part.key);
        if (index < 0) { index = parts.length; parts.push(part); }
        return index;
      });
      const pos = geometry.getAttribute('position');
      const part = geometry.getAttribute(PART_ATTRIBUTE);
      geometry.computeBoundingBox();
      const min = geometry.boundingBox!.min;
      for (let v = 0; v < pos.count; v++) {
        positions.push(pos.getX(v) - min.x + offset, pos.getY(v) - min.y, pos.getZ(v) - min.z);
        partIndices.push(mapping[part?.getX(v) ?? 0]);
      }
      offset += analysis.widthMm + 10;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    const colored = analyses.some((a) => a.parts.length > 0);
    if (colored && parts.length <= MAX_FILE_PARTS && !analyses.some((a) => a.ignoredColorCount)) {
      geometry.setAttribute(PART_ATTRIBUTE, new THREE.BufferAttribute(new Uint8Array(partIndices), 1));
      geometry.userData.parts = parts;
    } else if (colored || analyses.some((a) => a.ignoredColorCount)) {
      geometry.userData.ignoredColorCount = Math.max(parts.length, ...analyses.map((a) => a.ignoredColorCount ?? 0));
    }
    const model: ModelSpec = {
      widthMm: Math.max(...analyses.map((a) => a.widthMm)),
      depthMm: Math.max(...analyses.map((a) => a.depthMm)),
      heightMm: Math.max(...analyses.map((a) => a.heightMm)),
      volumeCm3: Math.round(analyses.reduce((sum, a) => sum + a.volumeCm3, 0) * 10) / 10,
    };
    geometry.userData.model = model;
    geometry.userData.plates = analyses[0].plates.map((p) => {
      const analysis = analyses.find((a) => a.plate === p.id);
      if (!analysis) return p;
      const { widthMm, depthMm, heightMm, volumeCm3 } = analysis;
      return {
        ...p, model: { widthMm, depthMm, heightMm, volumeCm3 },
        parts: analysis.parts.map(({ key, name, color }) => ({ key, name, fileColor: color })),
      };
    });
    geometry.userData.plate = ids[0];
    return geometry;
  } finally {
    geometries.forEach((geometry) => geometry.dispose());
  }
}

/** Iterates triangles as vertex index triples, for indexed and non-indexed geometry alike. */
function forEachTriangle(geometry: THREE.BufferGeometry, fn: (a: number, b: number, c: number) => void) {
  const index = geometry.getIndex();
  const count = index ? index.count : geometry.getAttribute('position').count;
  for (let i = 0; i + 2 < count; i += 3) {
    if (index) fn(index.getX(i), index.getX(i + 1), index.getX(i + 2));
    else fn(i, i + 1, i + 2);
  }
}

/** Size along each axis (STL and 3MF are Z-up: X = width, Y = depth, Z = height) and enclosed volume. */
export function analyzeMesh(geometry: THREE.BufferGeometry): MeshAnalysis {
  geometry.computeBoundingBox();
  const size = geometry.boundingBox!.getSize(new THREE.Vector3());
  const position = geometry.getAttribute('position');
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let signedVolume = 0;
  let triangleCount = 0;
  // Sum of signed tetrahedra from the origin to each face (divergence theorem).
  forEachTriangle(geometry, (ia, ib, ic) => {
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);
    signedVolume += a.dot(b.cross(c)) / 6;
    triangleCount++;
  });
  const { parts = [], ignoredColorCount, plates = [], plate = null, model } = geometry.userData as MeshUserData;
  return {
    widthMm: roundMm(size.x),
    depthMm: roundMm(size.y),
    heightMm: roundMm(size.z),
    // Absolute value: files with inward-facing triangles would otherwise come out negative.
    volumeCm3: Math.round(Math.abs(signedVolume) / 100) / 10,
    ...model,
    triangleCount,
    parts,
    ...(ignoredColorCount !== undefined && { ignoredColorCount }),
    plates,
    plate,
  };
}

/** Faces steeper than this (|normal.y|) count as tops/bottoms and get no engraving or texture. */
const CAP_NORMAL_Y = 0.75;
/** Largest dimension of the model in preview world units, matching the built-in shapes. */
const PREVIEW_SIZE = 2;

/**
 * Turns a parsed STL/3MF into preview geometry: Z-up → Y-up, centered on the ground, scaled
 * to the preview size, with cylindrical UVs so engraving and textures wrap around the
 * sides. Triangles are grouped by color part, and within a part into sides (engraving and
 * texture) and tops/bottoms (plain). The input is not modified.
 */
export function prepareMeshForPreview(source: THREE.BufferGeometry): PreparedMesh {
  const g = source.index ? source.toNonIndexed() : source.clone();
  const parts = (source.userData as MeshUserData).parts ?? [];
  const partAttribute = parts.length > 0 ? g.getAttribute(PART_ATTRIBUTE) : undefined;
  g.deleteAttribute('normal'); // File normals are often missing or wrong; recompute below.
  g.deleteAttribute('color');
  // Printers use Z-up with the front at -Y; rotating -90° about X gives Y-up with the front facing +Z (the camera).
  g.rotateX(-Math.PI / 2);
  g.computeBoundingBox();
  const box = g.boundingBox!;
  const center = box.getCenter(new THREE.Vector3());
  g.translate(-center.x, -box.min.y, -center.z);
  const size = box.getSize(new THREE.Vector3());
  const scale = PREVIEW_SIZE / Math.max(size.x, size.y, size.z);
  g.scale(scale, scale, scale);
  g.computeVertexNormals(); // non-indexed → flat face normals

  const width = size.x * scale;
  const depth = size.z * scale;
  const height = size.y * scale || 1;
  const pos = g.getAttribute('position').array as Float32Array;
  const nrm = g.getAttribute('normal').array as Float32Array;
  const triangleCount = pos.length / 9;

  // First pass: bucket each triangle by (part, side/cap) so every bucket can be written
  // contiguously in the second pass and become one geometry group.
  const bucketCount = Math.max(1, parts.length) * 2;
  const bucketOf = new Uint8Array(triangleCount);
  const bucketSizes = new Array<number>(bucketCount).fill(0);
  for (let t = 0; t < triangleCount; t++) {
    const part = partAttribute ? partAttribute.getX(t * 3) : 0;
    const cap = Math.abs(nrm[t * 9 + 1]) > CAP_NORMAL_Y ? 1 : 0;
    bucketOf[t] = part * 2 + cap;
    bucketSizes[bucketOf[t]]++;
  }
  const bucketStart = new Array<number>(bucketCount).fill(0);
  for (let b = 1; b < bucketCount; b++) bucketStart[b] = bucketStart[b - 1] + bucketSizes[b - 1];
  const nextInBucket = [...bucketStart];

  const positions = new Float32Array(pos.length);
  const normals = new Float32Array(nrm.length);
  const uvs = new Float32Array(triangleCount * 6);
  const us = [0, 0, 0];
  for (let t = 0; t < triangleCount; t++) {
    const slot = nextInBucket[bucketOf[t]]++;
    positions.set(pos.subarray(t * 9, t * 9 + 9), slot * 9);
    normals.set(nrm.subarray(t * 9, t * 9 + 9), slot * 9);
    for (let k = 0; k < 3; k++) {
      // u = 0.5 straight ahead (+Z), increasing to the right, so text reads left to right.
      us[k] = Math.atan2(pos[t * 9 + k * 3], pos[t * 9 + k * 3 + 2]) / (2 * Math.PI) + 0.5;
    }
    // A triangle straddling the seam at the back would otherwise stretch across the whole texture.
    const straddlesSeam = Math.max(us[0], us[1], us[2]) - Math.min(us[0], us[1], us[2]) > 0.5;
    for (let k = 0; k < 3; k++) {
      uvs[slot * 6 + k * 2] = straddlesSeam && us[k] < 0.5 ? us[k] + 1 : us[k];
      uvs[slot * 6 + k * 2 + 1] = pos[t * 9 + k * 3 + 1] / height;
    }
  }
  g.dispose();

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  const slots: NonNullable<SurfaceSpec['slots']> = [];
  const slotParts: number[] = [];
  for (let b = 0; b < bucketCount; b++) {
    if (bucketSizes[b] === 0) continue;
    geometry.addGroup(bucketStart[b] * 3, bucketSizes[b] * 3, slots.length);
    slots.push(b % 2 === 0 ? 'front' : 'plain');
    slotParts.push(Math.floor(b / 2));
  }
  geometry.computeBoundingBox();

  return {
    geometry,
    parts,
    surface: {
      slots,
      slotParts,
      rotationY: 0,
      // Approximate the wrapped surface as an elliptical cylinder around the model.
      surfaceAspect: (Math.PI * ((width + depth) / 2)) / height,
      textWidthFraction: 0.28,
      bottomY: 0,
      // Downloaded models often have inconsistent winding; render both sides so nothing disappears.
      doubleSided: true,
    },
  };
}
