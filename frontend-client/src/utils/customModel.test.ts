// @vitest-environment jsdom
// 3MF projects are parsed with DOMParser, so these tests need a DOM.
import { File as NodeFile } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readCustomModel } from './customModel';
import { MeshFileError } from './mesh';

const thumbnail = vi.hoisted(() => vi.fn(() => 'data:image/png;base64,AA=='));
vi.mock('./modelThumbnail', () => ({ geometryThumbnail: thumbnail }));

/** jsdom's File has no arrayBuffer(); Node's implements the standard like browsers do. */
const file = (parts: (string | Uint8Array)[], name: string) => new NodeFile(parts, name) as unknown as File;
const fixture = (name: string, as = name) => file([readFileSync(`${import.meta.dirname}/../../fixtures/models/${name}`)], as);

afterEach(() => {
  thumbnail.mockClear();
});

describe('reading a customer model in the browser', () => {
  it('measures an STL and renders its thumbnail', async () => {
    const info = await readCustomModel(fixture('twisted-star-vase.stl'));
    expect(info).toMatchObject({ format: 'stl', plateCount: 1, thumbnail: 'data:image/png;base64,AA==' });
    expect(info.heightMm).toBeGreaterThan(0);
    expect(info.volumeCm3).toBeGreaterThan(0);
    expect(info.triangleCount).toBeGreaterThan(100);
    expect(thumbnail).toHaveBeenCalledTimes(1);
    // Files without colors are a single part for choosing the filament.
    expect(info.parts).toEqual([{ key: 'model', name: 'Model', fileColor: null, share: 1 }]);
  });

  it('lists the color parts of a multi-color model with their share of the surface', async () => {
    const info = await readCustomModel(fixture('tricolor-star-vase.3mf'));
    expect(info.parts.length).toBe(3);
    for (const part of info.parts) {
      expect(part.fileColor).toMatch(/^#[0-9a-f]{6}$/);
      expect(part.share).toBeGreaterThan(0);
    }
    expect(info.parts.reduce((sum, part) => sum + part.share, 0)).toBeCloseTo(1, 9);
  }, 60_000);

  it('measures a multi-plate slicer project as the whole set it prints', async () => {
    const plate = await readCustomModel(fixture('twisted-star-vase.3mf'));
    const project = await readCustomModel(fixture('star-vase-project.3mf'));
    expect(plate.plateCount).toBe(1);
    expect(project.format).toBe('3mf');
    expect(project.plateCount).toBe(2);
    expect(project.plates).toEqual([1, 2]);
    expect(plate.plates).toBeUndefined();
    expect(project.triangleCount).toBeGreaterThan(plate.triangleCount);
  }, 60_000);

  it('still accepts a model when the browser cannot render a thumbnail', async () => {
    thumbnail.mockImplementationOnce(() => {
      throw new Error('No WebGL');
    });
    vi.spyOn(console, 'warn').mockImplementationOnce(() => undefined);
    expect((await readCustomModel(fixture('twisted-star-vase.stl'))).thumbnail).toBeNull();
  });

  it('rejects files whose contents do not match their extension or are not models', async () => {
    await expect(readCustomModel(fixture('twisted-star-vase.stl', 'vase.3mf'))).rejects.toThrow(MeshFileError);
    await expect(readCustomModel(fixture('twisted-star-vase.3mf', 'vase.stl')))
      .rejects.toThrow("The file's contents don't match its .stl extension.");
    await expect(readCustomModel(file(['solid nothing here'], 'empty.stl'))).rejects.toThrow(MeshFileError);
  });
});
