import { t } from '../i18n';
import * as THREE from 'three';
import { strFromU8, type Unzipped } from 'three/examples/jsm/libs/fflate.module.js';
import type { MeshPlate } from '../types';
import { MeshFileError } from './meshFileError';
import { MAX_FILE_PARTS, PART_ATTRIBUTE, type FilePart } from './meshParts';
import { paintedTriangle } from './paintedTriangle';

/**
 * Reader for slicer project 3MF files (Bambu Studio, OrcaSlicer). Unlike plain 3MF they:
 * - keep each object's mesh in its own file (3D/Objects/*.model), referenced from the root
 *   model through components with a `p:path` (3MF production extension) — object ids are
 *   only unique per file, so references must be resolved by path *and* id;
 * - lay out several build plates side by side in one coordinate space;
 * - list the plates and the object instances on each in Metadata/model_settings.config.
 *
 * three's 3MF loader ignores `p:path` and the plate metadata, so it would merge objects
 * with clashing ids and treat all plates as one model.
 */

const PRODUCTION_NS = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';
const SETTINGS_PATH = 'Metadata/model_settings.config';
const MAX_NESTING = 16;

/** A plate as listed to the admin; the thumbnail is a PNG data URL when the project has one. */
export interface ProjectPlate extends MeshPlate {
  thumbnail?: string;
}

interface MeshData {
  vertices: Float32Array;
  triangles: Uint32Array;
  paint: string[];
}

interface ComponentRef {
  path: string;
  objectId: string;
  transform: THREE.Matrix4;
}

interface ObjectDef {
  mesh?: MeshData;
  components: ComponentRef[];
}

interface BuildItem {
  objectId: string;
  /** Position among build items of the same object; slicers call this the instance id. */
  instance: number;
  transform: THREE.Matrix4;
  printable: boolean;
}

/** Projects keep objects in model files below 3D/ (e.g. 3D/Objects/object_1.model). */
export function isSlicerProject(files: Unzipped): boolean {
  return Object.keys(files).some((name) => /^3D\/.+\/[^/]+\.model$/i.test(name)) || SETTINGS_PATH in files;
}

function parseXml(text: string, path: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new MeshFileError(t("The project's {0} is not valid XML.", path));
  }
  return doc;
}

// Elements are matched by local name in any namespace: files use prefixes inconsistently.
const elements = (root: Element | Document, name: string) => Array.from(root.getElementsByTagNameNS('*', name));
const children = (el: Element, name: string) => Array.from(el.children).filter((child) => child.localName === name);

/** 3MF transforms list a 3×4 matrix row by row: m00 m01 m02 m10 m11 m12 m20 m21 m22 tx ty tz. */
function parseTransform(value: string | null): THREE.Matrix4 {
  const matrix = new THREE.Matrix4();
  if (!value) return matrix;
  const transform = value.trim().split(/\s+/).map(Number);
  if (transform.length !== 12 || transform.some((n) => !Number.isFinite(n))) throw new MeshFileError(t("Invalid 3MF transform \"{0}\".", value));
  return matrix.set(transform[0], transform[3], transform[6], transform[9], transform[1], transform[4], transform[7], transform[10], transform[2], transform[5], transform[8], transform[11], 0, 0, 0, 1);
}

function readMesh(meshEl: Element): MeshData {
  const vertexEls = elements(meshEl, 'vertex');
  const vertices = new Float32Array(vertexEls.length * 3);
  vertexEls.forEach((v, i) => {
    vertices[i * 3] = Number(v.getAttribute('x'));
    vertices[i * 3 + 1] = Number(v.getAttribute('y'));
    vertices[i * 3 + 2] = Number(v.getAttribute('z'));
  });
  const triangleEls = elements(meshEl, 'triangle');
  const triangles = new Uint32Array(triangleEls.length * 3);
  triangleEls.forEach((triangle, i) => {
    for (let k = 0; k < 3; k++) {
      const index = Number(triangle.getAttribute(`v${k + 1}`));
      if (!Number.isInteger(index) || index < 0 || index >= vertexEls.length) {
        throw new MeshFileError(t("The project contains a triangle with an invalid vertex reference."));
      }
      triangles[i * 3 + k] = index;
    }
  });
  return {
    vertices,
    triangles,
    paint: triangleEls.map((t) => t.getAttribute('paint_color') || t.getAttribute('mmu_segmentation') || ''),
  };
}

const normalizePath = (path: string) => path.replace(/^\/+/, '');

function readObjects(doc: Document, path: string): Map<string, ObjectDef> {
  const objects = new Map<string, ObjectDef>();
  for (const obj of elements(doc, 'object')) {
    const meshEl = children(obj, 'mesh')[0];
    const componentsEl = children(obj, 'components')[0];
    objects.set(obj.getAttribute('id') ?? '', {
      mesh: meshEl ? readMesh(meshEl) : undefined,
      components: componentsEl
        ? children(componentsEl, 'component').map((c) => ({
            // A component without a path refers to an object in the same file.
            path: normalizePath(c.getAttributeNS(PRODUCTION_NS, 'path') || c.getAttribute('p:path') || path),
            objectId: c.getAttribute('objectid') ?? '',
            transform: parseTransform(c.getAttribute('transform')),
          }))
        : [],
    });
  }
  return objects;
}

function readBuildItems(root: Document): BuildItem[] {
  const instances = new Map<string, number>();
  return elements(root, 'item').map((item) => {
    const objectId = item.getAttribute('objectid') ?? '';
    const instance = instances.get(objectId) ?? 0;
    instances.set(objectId, instance + 1);
    return {
      objectId,
      instance,
      transform: parseTransform(item.getAttribute('transform')),
      // Slicers mark objects the user excluded from printing.
      printable: item.getAttribute('printable') !== '0',
    };
  });
}

const metadata = (el: Element, key: string) =>
  children(el, 'metadata').find((m) => m.getAttribute('key') === key)?.getAttribute('value') ?? null;

const instanceKey = (objectId: string, instance: number | string) => `${objectId}:${instance}`;

interface PlateDef {
  id: number;
  name: string;
  instances: Set<string>;
  thumbnailPath: string | null;
}

function readPlates(files: Unzipped): PlateDef[] {
  const settings = files[SETTINGS_PATH];
  if (!settings) return [];
  const doc = parseXml(strFromU8(settings), SETTINGS_PATH);
  return elements(doc, 'plate').map((plate, i) => {
    const id = Number(metadata(plate, 'plater_id')) || i + 1;
    return {
      id,
      name: metadata(plate, 'plater_name')?.trim() || `Plate ${id}`,
      instances: new Set(
        children(plate, 'model_instance').map((mi) =>
          instanceKey(metadata(mi, 'object_id') ?? '', metadata(mi, 'instance_id') ?? '0'),
        ),
      ),
      thumbnailPath: metadata(plate, 'thumbnail_file'),
    };
  });
}

function pngDataUrl(bytes: Uint8Array | undefined): string | undefined {
  if (!bytes) return undefined;
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(binary)}`;
}

function readFilaments(files: Unzipped): string[] {
  const bytes = files['Metadata/project_settings.config'];
  if (!bytes) return [];
  let settings: unknown;
  try {
    settings = JSON.parse(strFromU8(bytes));
  } catch (cause) {
    throw new MeshFileError(t("The project filament settings are not valid JSON."), { cause });
  }
  if (!settings || typeof settings !== 'object' || !('filament_colour' in settings)) return [];
  const colors: unknown = settings.filament_colour;
  if (!Array.isArray(colors) || !colors.every((c: unknown) => typeof c === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(c))) {
    throw new MeshFileError(t("The project contains an invalid filament color palette."));
  }
  return colors.map((color: string) => color.slice(0, 7).toLowerCase());
}

function readAssignments(files: Unzipped) {
  const assignments = new Map<string, { filament: number; parts: Map<string, number> }>();
  if (!files[SETTINGS_PATH]) return assignments;
  const doc = parseXml(strFromU8(files[SETTINGS_PATH]), SETTINGS_PATH);
  const filament = (el: Element) => {
    const value = metadata(el, 'extruder');
    if (value === null || value === '0') return 0;
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) throw new MeshFileError(t("The project contains an invalid filament assignment."));
    return number;
  };
  for (const object of elements(doc, 'object')) {
    assignments.set(object.getAttribute('id') ?? '', {
      filament: filament(object),
      parts: new Map(children(object, 'part').map((part) => [part.getAttribute('id') ?? '', filament(part)])),
    });
  }
  return assignments;
}

export interface SlicerProjectResult {
  geometry: THREE.BufferGeometry;
  plates: ProjectPlate[];
  /** The plate that `geometry` shows, or null if the project has no plate list. */
  plate: number | null;
}

/**
 * Builds one plate of a slicer project as a single non-indexed geometry (positions only,
 * in file units). Without a plate list, every printable build item is included. When
 * `plate` is missing or unknown, the first plate with objects is used.
 */
export function parseSlicerProject(files: Unzipped, rootPath: string, plate?: number | null): SlicerProjectResult {
  const palette = readFilaments(files);
  const assignments = readAssignments(files);
  const docs = new Map<string, Map<string, ObjectDef>>();
  const objectsIn = (path: string) => {
    let objects = docs.get(path);
    if (!objects) {
      const bytes = files[path];
      if (!bytes) throw new MeshFileError(t("The project refers to {0}, which is missing from the file.", path));
      objects = readObjects(parseXml(strFromU8(bytes), path), path);
      docs.set(path, objects);
    }
    return objects;
  };

  const rootBytes = files[rootPath];
  if (!rootBytes) throw new MeshFileError(t("The project has no 3D model."));
  const buildItems = readBuildItems(parseXml(strFromU8(rootBytes), rootPath)).filter((item) => item.printable);

  const plateDefs = readPlates(files)
    .map((def) => ({ ...def, objectCount: buildItems.filter((b) => def.instances.has(instanceKey(b.objectId, b.instance))).length }))
    .filter((def) => def.objectCount > 0);
  const selected = plateDefs.find((def) => def.id === plate) ?? plateDefs[0];
  const items = selected ? buildItems.filter((b) => selected.instances.has(instanceKey(b.objectId, b.instance))) : buildItems;

  const positions: number[] = [];
  const indices: number[] = [];
  const parts: FilePart[] = [];
  const partByFilament = new Map<number, number>();
  let colored = false;
  const partIndex = (filament: number) => {
    const color = palette[filament - 1];
    if (!color && filament > 0) throw new MeshFileError(t("The project has no color for filament {0}.", filament));
    colored ||= color !== undefined;
    let index = partByFilament.get(filament);
    if (index === undefined) {
      index = parts.length;
      partByFilament.set(filament, index);
      parts.push({
        key: filament ? `filament:${filament}` : 'uncolored',
        name: filament ? `Filament ${filament}` : 'Uncolored',
        color: color ?? '#ffffff',
      });
    }
    return index;
  };
  const append = (
    path: string, objectId: string, matrix: THREE.Matrix4, depth: number,
    filament: number, overrides: Map<string, number>,
  ) => {
    if (depth > MAX_NESTING) throw new MeshFileError(t("The project nests components too deeply (or in a loop)."));
    const def = objectsIn(path).get(objectId);
    if (!def) throw new MeshFileError(t("The project refers to object {0} in {1}, which doesn't exist.", objectId, path));
    if (def.mesh) {
      const { vertices, triangles, paint } = def.mesh;
      const base = overrides.get(objectId) || filament || (palette.length ? 1 : 0);
      const emit = (triangle: [THREE.Vector3, THREE.Vector3, THREE.Vector3], painted: number) => {
        const index = partIndex(painted || base);
        for (const vertex of triangle) {
          positions.push(vertex.x, vertex.y, vertex.z);
          indices.push(index);
        }
      };
      for (let t = 0; t < triangles.length / 3; t++) {
        const vertex = (k: number) => new THREE.Vector3().fromArray(vertices, triangles[t * 3 + k] * 3).applyMatrix4(matrix);
        const triangle: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [vertex(0), vertex(1), vertex(2)];
        if (paint[t]) paintedTriangle(triangle, paint[t], emit);
        else emit(triangle, 0);
      }
    }
    for (const component of def.components) {
      append(component.path, component.objectId, matrix.clone().multiply(component.transform), depth + 1, filament, overrides);
    }
  };
  for (const item of items) {
    const assignment = assignments.get(item.objectId);
    append(rootPath, item.objectId, item.transform, 0, assignment?.filament ?? 0, assignment?.parts ?? new Map());
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  if (colored && parts.length <= MAX_FILE_PARTS) {
    geometry.setAttribute(PART_ATTRIBUTE, new THREE.BufferAttribute(new Uint8Array(indices), 1));
    geometry.userData.parts = parts;
  } else if (colored) {
    geometry.userData.ignoredColorCount = parts.length;
  }
  return {
    geometry,
    plates: plateDefs.map(({ id, name, objectCount, thumbnailPath }) => {
      const thumbnail = thumbnailPath ? pngDataUrl(files[normalizePath(thumbnailPath)]) : undefined;
      return { id, name, objectCount, ...(thumbnail && { thumbnail }) };
    }),
    plate: selected?.id ?? null,
  };
}
