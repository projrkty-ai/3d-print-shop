// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { strToU8, zipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadModelBuffer } from '../api/client';

const renderer = vi.hoisted(() => ({
  create: vi.fn(),
  render: vi.fn<(scene: THREE.Scene, camera: THREE.PerspectiveCamera) => void>(),
  encode: vi.fn<() => string>(),
  dispose: vi.fn(),
  loseContext: vi.fn(),
  clearLists: vi.fn(),
}));

vi.mock('../api/client', () => ({ loadModelBuffer: vi.fn() }));
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  return {
    ...actual,
    WebGLRenderer: class {
      constructor() { renderer.create(); }
      domElement = { toDataURL: renderer.encode };
      renderLists = { dispose: renderer.clearLists };
      setPixelRatio() {}
      setSize() {}
      render = renderer.render;
      dispose = renderer.dispose;
      forceContextLoss = renderer.loseContext;
    },
  };
});

const file = (name: string) => Uint8Array.from(readFileSync(`${import.meta.dirname}/../../fixtures/models/${name}`)).buffer;
const options = { url: '/models/demo.stl', plate: null, color: '#d33a2c' };
const png = 'data:image/png;base64,dGh1bWJuYWls';

function twoPlateProject() {
  const mesh = '<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh>';
  const files = {
    '_rels/.rels': '<Relationships><Relationship Target="/3D/3dmodel.model"/></Relationships>',
    '3D/3dmodel.model': `<model><resources><object id="1">${mesh}</object><object id="2">${mesh}</object></resources><build><item objectid="1"/><item objectid="2"/></build></model>`,
    'Metadata/model_settings.config': `<config>${[1, 2].map((id) =>
      `<plate><metadata key="plater_id" value="${id}"/><model_instance><metadata key="object_id" value="${id}"/><metadata key="instance_id" value="0"/></model_instance></plate>`,
    ).join('')}</config>`,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, xml]) => [name, strToU8(xml, true)]))).buffer;
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.clearAllMocks();
  renderer.create.mockReset();
  renderer.render.mockReset();
  renderer.encode.mockReset().mockReturnValue(png);
  vi.mocked(loadModelBuffer).mockReset().mockResolvedValue(file('twisted-star-vase.stl'));
});

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
});

describe('real model thumbnails', () => {
  it('renders the real STL in the default filament color and frames the entire model', async () => {
    const { modelThumbnail } = await import('./modelThumbnail');
    const geometryDisposed = vi.fn();
    const materialDisposed = vi.fn();
    renderer.render.mockImplementation((scene, camera) => {
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld();
      const meshes = scene.children.filter((object): object is THREE.Mesh => object instanceof THREE.Mesh);
      expect(meshes).toHaveLength(1);
      const mesh = meshes[0];
      expect(mesh.geometry.getAttribute('position').count).toBe(5824 * 3);
      mesh.geometry.addEventListener('dispose', geometryDisposed);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        expect(material).toHaveProperty('color', new THREE.Color(options.color));
        material.addEventListener('dispose', materialDisposed);
      }
      const bounds = new THREE.Box3().setFromObject(mesh);
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) {
            const ndc = new THREE.Vector3(x, y, z).project(camera);
            expect(Math.abs(ndc.x)).toBeLessThan(1);
            expect(Math.abs(ndc.y)).toBeLessThan(1);
          }
        }
      }
    });
    await expect(modelThumbnail(options)).resolves.toBe(png);
    expect(geometryDisposed).toHaveBeenCalledOnce();
    expect(materialDisposed).toHaveBeenCalled();
    expect(renderer.clearLists).toHaveBeenCalledOnce();
    expect(renderer.dispose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(renderer.loseContext).toHaveBeenCalledOnce();
  });

  it('retains colors from the real 3MF instead of flattening them to one filament', async () => {
    vi.mocked(loadModelBuffer).mockResolvedValue(file('tricolor-star-vase.3mf'));
    const { modelThumbnail } = await import('./modelThumbnail');
    const colors = new Set<string>();
    renderer.render.mockImplementation((scene) => {
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (material instanceof THREE.MeshStandardMaterial) colors.add(`#${material.color.getHexString()}`);
        }
      });
    });
    await modelThumbnail({ ...options, url: '/models/color.3mf' });
    expect(colors).toEqual(new Set(['#2b2b2e', '#1f8a8a', '#c9a227']));
  });

  it('includes every selected plate and invalidates cached images when plates or filament change', async () => {
    vi.mocked(loadModelBuffer).mockResolvedValue(twoPlateProject());
    const { modelThumbnail } = await import('./modelThumbnail');
    const counts: number[] = [];
    renderer.render.mockImplementation((scene) => scene.traverse((object) => {
      if (object instanceof THREE.Mesh) counts.push(object.geometry.getAttribute('position').count / 3);
    }));
    const project = { ...options, url: '/models/project.3mf', plate: 1 };
    await modelThumbnail({ ...project, plates: [1] });
    await modelThumbnail({ ...project, plates: [1, 2] });
    await modelThumbnail({ ...project, plates: [2], color: '#000000' });
    expect(counts).toEqual([1, 2, 1]);
    expect(renderer.create).toHaveBeenCalledOnce();
  });

  it('shares in-flight and completed renders between repeated catalog/admin requests', async () => {
    const { modelThumbnail } = await import('./modelThumbnail');
    const first = modelThumbnail(options);
    const second = modelThumbnail({ ...options });
    expect(second).toBe(first);
    await Promise.all([first, second]);
    await modelThumbnail(options);
    expect(loadModelBuffer).toHaveBeenCalledOnce();
    expect(renderer.render).toHaveBeenCalledOnce();
  });

  it('bounds the cache rather than retaining every product forever', async () => {
    const triangle = new TextEncoder().encode('solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid x');
    vi.mocked(loadModelBuffer).mockResolvedValue(triangle.buffer);
    const { modelThumbnail } = await import('./modelThumbnail');
    for (let i = 0; i < 49; i++) await modelThumbnail({ ...options, url: `/models/${i}.stl` });
    await modelThumbnail({ ...options, url: '/models/0.stl' });
    expect(loadModelBuffer).toHaveBeenCalledTimes(50);
    expect(renderer.create).toHaveBeenCalledOnce();
  });

  it('propagates failures and permits a later retry instead of caching a fake success', async () => {
    vi.mocked(loadModelBuffer).mockRejectedValueOnce(new Error('Model is missing.'));
    const { modelThumbnail } = await import('./modelThumbnail');
    await expect(modelThumbnail(options)).rejects.toThrow('Model is missing.');
    await expect(modelThumbnail(options)).resolves.toBe(png);
    expect(loadModelBuffer).toHaveBeenCalledTimes(2);
  });

  it('reports unavailable WebGL and still disposes after rendering failures', async () => {
    const { modelThumbnail } = await import('./modelThumbnail');
    renderer.create.mockImplementationOnce(() => { throw new Error('WebGL unavailable.'); });
    await expect(modelThumbnail(options)).rejects.toThrow('WebGL unavailable.');
    renderer.encode.mockReturnValueOnce('data:,');
    await expect(modelThumbnail(options)).rejects.toThrow('could not create a model thumbnail');
    expect(renderer.clearLists).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000);
    expect(renderer.loseContext).toHaveBeenCalledOnce();
  });
});
