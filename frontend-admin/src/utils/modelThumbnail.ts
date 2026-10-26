import { t } from '../i18n';
import * as THREE from 'three';
import { loadModelBuffer } from '../api/client';
import { parseMeshFile, prepareMeshForPreview, type PreparedMesh } from './mesh';

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

function renderThumbnail({ geometry, parts, surface }: PreparedMesh, color: string): string {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#eef1f5');
  const materials = (surface.slotParts ?? [0]).map((index) => new THREE.MeshStandardMaterial({
    color: parts[index]?.color ?? color,
    roughness: 0.55,
    metalness: 0.05,
    side: THREE.DoubleSide,
  }));
  try {
    const mesh = new THREE.Mesh(geometry, materials);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    mesh.position.copy(geometry.boundingBox!.getCenter(new THREE.Vector3())).negate();
    scene.add(mesh);
    scene.add(new THREE.HemisphereLight('#ffffff', '#b9c1cc', 1.4));
    const key = new THREE.DirectionalLight('#ffffff', 2);
    key.position.set(3, 5, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight('#ffffff', 0.9);
    fill.position.set(-4, 2, 4);
    scene.add(fill);

    const camera = new THREE.PerspectiveCamera(40, WIDTH / HEIGHT, 0.1, 100);
    const radius = geometry.boundingSphere!.radius;
    if (!Number.isFinite(radius) || radius <= 0) throw new Error(t("The model has no measurable geometry for a thumbnail."));
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.15;
    camera.position.set(3, 2, 4).normalize().multiplyScalar(distance);
    camera.lookAt(0, 0, 0);
    const webgl = thumbnailRenderer();
    webgl.render(scene, camera);
    const image = webgl.domElement.toDataURL('image/png');
    if (image === 'data:,') throw new Error(t("The browser could not create a model thumbnail."));
    return image;
  } finally {
    geometry.dispose();
    materials.forEach((material) => material.dispose());
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
