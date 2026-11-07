import { t } from '../i18n';
import * as THREE from 'three';
import { loadModelBuffer } from '../api/client';
import type { DecorationLayout, PreviewShape } from '../types';
import { DecoratedSurface, loadPicture } from './decoratedSurface';
import { extrudedTextGeometry, type ExtrudedTextPlacement } from './extrudedText';
import { parseMeshFile, prepareMeshForPreview, type PreparedMesh, type SurfaceSpec } from './mesh';
import { SHAPES } from './previewShapes';

export interface ThumbnailOptions {
  url: string;
  plate: number | null;
  plates?: number[];
  color: string;
}

const WIDTH = 480;
const HEIGHT = 360;
const MAX_CACHED_THUMBNAILS = 48;
const cache = new Map<string, Promise<string>>();
let renderer: THREE.WebGLRenderer | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function thumbnailRenderer() {
  if (idleTimer) clearTimeout(idleTimer);
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(1);
    renderer.setSize(WIDTH, HEIGHT);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
  }
  return renderer;
}

/**
 * Lights `object` like the live preview and photographs it from `direction`, framed by its
 * bounding sphere. Releases the shared renderer's lists; disposing the object is up to the caller.
 */
function photograph(object: THREE.Object3D, direction: THREE.Vector3, width = WIDTH, height = HEIGHT): string {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#eef1f5');
  try {
    const sphere = new THREE.Box3().setFromObject(object).getBoundingSphere(new THREE.Sphere());
    if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) throw new Error(t("The model has no measurable geometry for a thumbnail."));
    object.position.sub(sphere.center);
    scene.add(object);
    scene.add(new THREE.HemisphereLight('#ffffff', '#b9c1cc', 1.4));
    const key = new THREE.DirectionalLight('#ffffff', 2);
    key.position.set(3, 5, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight('#ffffff', 0.9);
    fill.position.set(-4, 2, 4);
    scene.add(fill);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    // Fit the sphere inside the narrower of the vertical and horizontal fields of view.
    const halfFov = Math.min(THREE.MathUtils.degToRad(camera.fov / 2), Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
    const distance = sphere.radius / Math.sin(halfFov) * 1.1;
    camera.position.copy(direction).normalize().multiplyScalar(distance);
    camera.lookAt(0, 0, 0);
    const webgl = thumbnailRenderer();
    webgl.setSize(width, height);
    webgl.render(scene, camera);
    const image = webgl.domElement.toDataURL('image/png');
    if (image === 'data:,') throw new Error(t("The browser could not create a model thumbnail."));
    return image;
  } finally {
    renderer?.renderLists.dispose();
    // One shared off-screen context serves a batch of cards, then releases its GPU resources.
    if (renderer) {
      idleTimer = setTimeout(() => {
        renderer?.dispose();
        renderer?.forceContextLoss();
        renderer = undefined;
      }, 1000);
    }
  }
}

function renderThumbnail({ geometry, parts, surface }: PreparedMesh, color: string): string {
  const materials = (surface.slotParts ?? [0]).map((index) => new THREE.MeshStandardMaterial({
    color: parts[index]?.color ?? color,
    roughness: 0.55,
    metalness: 0.05,
    side: THREE.DoubleSide,
  }));
  try {
    return photograph(new THREE.Mesh(geometry, materials), new THREE.Vector3(3, 2, 4));
  } finally {
    geometry.dispose();
    materials.forEach((material) => material.dispose());
  }
}

async function generateThumbnail({ url, plate, plates, color }: ThumbnailOptions) {
  const data = await loadModelBuffer(url);
  const raw = parseMeshFile(data, { plate, plates });
  let prepared: PreparedMesh;
  try {
    prepared = prepareMeshForPreview(raw);
  } finally {
    raw.dispose();
  }
  return renderThumbnail(prepared, color);
}

/**
 * Thumbnail of geometry already parsed in the browser, e.g. a customer's own file before upload,
 * in `color` or, for multi-color files, `partColors` by part key. The caller keeps ownership of `raw`.
 * Throws without WebGL.
 */
export function geometryThumbnail(raw: THREE.BufferGeometry, color: string, partColors?: Record<string, string>): string {
  const prepared = prepareMeshForPreview(raw);
  const parts = prepared.parts.map((part) => ({ ...part, color: partColors?.[part.key] ?? part.color }));
  return renderThumbnail({ ...prepared, parts }, color);
}

/** Cached PNGs, not live canvases: catalog size never determines the number of WebGL contexts. */
export function modelThumbnail(options: ThumbnailOptions): Promise<string> {
  const key = JSON.stringify([options.url, options.plate, options.plates, options.color]);
  const cached = cache.get(key);
  if (cached) return cached;
  if (cache.size >= MAX_CACHED_THUMBNAILS) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  const pending = generateThumbnail(options);
  cache.set(key, pending);
  void pending.catch(() => {
    if (cache.get(key) === pending) cache.delete(key);
  });
  return pending;
}

/** One configured surface: a plate of a set, or the whole print. */
export interface ConfiguredSurface {
  /** Plate of a slicer project; null renders the product's model (or built-in shape) as a whole. */
  plate: number | null;
  /** Filament of single-color prints. */
  color: string;
  /** Part key → color for multi-color files; unlisted parts keep their color from the file. */
  partColors: Record<string, string>;
  engravingText: string;
  engravingFont: string;
  engravingColor: string | null;
  /** Customer picture (data URL) or resolved shop texture URL. */
  textureUrl: string | null;
  layout?: DecorationLayout;
  /** Raised 3D lettering with the ordered text and size. */
  extrudedText?: ExtrudedTextPlacement | null;
  /** Largest original dimension in mm, so the plates of a set keep their relative sizes. */
  sizeMm?: number;
}

export interface ConfiguredModel {
  shape: PreviewShape;
  mesh: { url: string; plate: number | null; plates?: number[] } | null;
  surfaces: ConfiguredSurface[];
}

const CONFIGURED_SIZE = 360;
/** Almost head-on and slightly above the front, where engraving and texture are centered. */
const FRONT_VIEW = new THREE.Vector3(0.1, 0.3, 1);

async function generateConfiguredThumbnail({ shape, mesh, surfaces }: ConfiguredModel): Promise<string> {
  const [data, pictures] = await Promise.all([
    mesh ? loadModelBuffer(mesh.url) : Promise.resolve(null),
    Promise.all(surfaces.map((surface) => (surface.textureUrl ? loadPicture(surface.textureUrl) : null))),
  ]);
  // Engraving fonts must be ready before their text is painted onto the canvas.
  await document.fonts?.ready;
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  try {
    const largest = Math.max(...surfaces.map((surface) => surface.sizeMm ?? 0));
    let nextX = 0;
    surfaces.forEach((surface, i) => {
      let geometry: THREE.BufferGeometry;
      let spec: SurfaceSpec;
      let colors = [surface.color];
      if (data && mesh) {
        const raw = parseMeshFile(data, surface.plate === null ? { plate: mesh.plate, plates: mesh.plates } : { plate: surface.plate });
        let prepared: PreparedMesh;
        try {
          prepared = prepareMeshForPreview(raw);
        } finally {
          raw.dispose();
        }
        ({ geometry, surface: spec } = prepared);
        if (prepared.parts.length > 0) colors = prepared.parts.map((part) => surface.partColors[part.key] ?? part.color);
      } else {
        spec = SHAPES[shape];
        geometry = SHAPES[shape].createGeometry();
      }
      disposables.push(geometry);
      const decorated = new DecoratedSurface(spec);
      disposables.push(decorated);
      decorated.setColors(colors);
      decorated.setEngravingColor(surface.engravingColor);
      decorated.paint({ image: pictures[i], text: surface.engravingText, font: surface.engravingFont, layout: surface.layout });
      const object = new THREE.Mesh(geometry, spec.slots ? decorated.materials : decorated.materials[0]);
      if (surface.extrudedText) {
        geometry.computeBoundingBox();
        const letteringGeometry = extrudedTextGeometry(surface.extrudedText, geometry.boundingBox!);
        if (letteringGeometry) {
          const material = new THREE.MeshStandardMaterial({ color: colors[0], roughness: 0.55, metalness: 0.05 });
          disposables.push(letteringGeometry, material);
          object.add(new THREE.Mesh(letteringGeometry, material));
        }
      }
      object.rotation.y = spec.rotationY;
      object.scale.setScalar(largest > 0 && surface.sizeMm ? surface.sizeMm / largest : 1);
      // Stand the plates of a set side by side on one ground line.
      object.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(object);
      object.position.set(nextX - box.min.x, -box.min.y, 0);
      nextX += box.max.x - box.min.x + 0.15;
      group.add(object);
    });
    return photograph(group, FRONT_VIEW, CONFIGURED_SIZE, CONFIGURED_SIZE);
  } finally {
    disposables.forEach((item) => item.dispose());
  }
}

/** Short, stable cache key: configurations can contain whole picture data URLs. */
function hashKey(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

/** PNG of a configured print with its colors, engraving and picture texture, as in the live preview. */
export function configuredThumbnail(model: ConfiguredModel): Promise<string> {
  const key = `configured:${hashKey(JSON.stringify(model))}`;
  const cached = cache.get(key);
  if (cached) return cached;
  if (cache.size >= MAX_CACHED_THUMBNAILS) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  const pending = generateConfiguredThumbnail(model);
  cache.set(key, pending);
  void pending.catch(() => {
    if (cache.get(key) === pending) cache.delete(key);
  });
  return pending;
}
