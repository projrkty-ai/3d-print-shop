// @vitest-environment jsdom
// Slicer projects are parsed with DOMParser, so these tests need a DOM.
import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { describe, expect, it } from 'vitest';
import { analyzeMesh, MeshFileError, PART_ATTRIBUTE, parse3mf, parseMeshFile, prepareMeshForPreview } from './mesh';

/** Latin-1 mode makes fflate allocate the bytes itself (see mesh3mf.test.ts for why that matters under jsdom). */
const bytes = (text: string) => strToU8(text, true);

const CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const PRODUCTION = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';

function boxMesh(w: number, d: number, h: number): string {
  const v = [[0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0], [0, 0, h], [w, 0, h], [w, d, h], [0, d, h]];
  const t = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7], [1, 2, 6], [1, 6, 5]];
  return `<mesh><vertices>${v.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join('')}</vertices>
    <triangles>${t.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join('')}</triangles></mesh>`;
}

/** An object file as Bambu Studio writes it: the mesh object always has id 1. */
const objectFile = (mesh: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="${CORE}" xmlns:p="${PRODUCTION}" requiredextensions="p">
    <resources><object id="1" type="model">${mesh}</object></resources><build/></model>`;

const translate = (x: number, y = 0, z = 0) => `1 0 0 0 1 0 0 0 1 ${x} ${y} ${z}`;

interface ProjectOptions {
  unit?: string;
  /** Root objects: id → [object file, component transform?]. */
  objects?: Record<string, [string, string?]>;
  /** Build items: [objectid, transform, printable?]. */
  items?: [string, string, boolean?][];
  /** Plates: [id, name, [objectId, instanceId][]]; null for a project without a plate list. */
  plates?: [number, string, [string, number][]][] | null;
  files?: Record<string, Uint8Array>;
}

/**
 * Default project: a 10 mm cube on plate 1, and two 30×20×10 boxes on plate 2 placed
 * 300 mm to the side — each box in its own object file, both files using object id 1.
 */
function project({
  unit = 'millimeter',
  objects = { '2': ['/3D/Objects/cube.model'], '4': ['/3D/Objects/box.model'] },
  items = [
    ['2', translate(100, 100)],
    ['4', translate(400, 100)],
    ['4', translate(450, 100)],
  ],
  plates = [
    [1, 'Cube', [['2', 0]]],
    [2, 'Two boxes', [['4', 0], ['4', 1]]],
  ],
  files = {},
}: ProjectOptions = {}): ArrayBuffer {
  const rootObjects = Object.entries(objects)
    .map(([id, [path, transform]]) =>
      `<object id="${id}" type="model"><components><component p:path="${path}" objectid="1"${transform ? ` transform="${transform}"` : ''}/></components></object>`,
    )
    .join('');
  const build = items
    .map(([id, transform, printable]) => `<item objectid="${id}" transform="${transform}"${printable === false ? ' printable="0"' : ''}/>`)
    .join('');
  const settings = plates
    ? `<?xml version="1.0" encoding="UTF-8"?><config>${plates
        .map(
          ([id, name, instances]) => `<plate>
            <metadata key="plater_id" value="${id}"/><metadata key="plater_name" value="${name}"/>
            <metadata key="thumbnail_file" value="Metadata/plate_${id}.png"/>
            ${instances.map(([objectId, instance]) => `<model_instance><metadata key="object_id" value="${objectId}"/><metadata key="instance_id" value="${instance}"/></model_instance>`).join('')}
          </plate>`,
        )
        .join('')}</config>`
    : null;
  const zipped = zipSync({
    '[Content_Types].xml': bytes('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    '_rels/.rels': bytes(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
    ),
    '3D/3dmodel.model': bytes(
      `<?xml version="1.0" encoding="UTF-8"?><model unit="${unit}" xmlns="${CORE}" xmlns:p="${PRODUCTION}" requiredextensions="p">
        <resources>${rootObjects}</resources><build>${build}</build></model>`,
    ),
    '3D/Objects/cube.model': bytes(objectFile(boxMesh(10, 10, 10))),
    '3D/Objects/box.model': bytes(objectFile(boxMesh(30, 20, 10))),
    ...(settings && { 'Metadata/model_settings.config': bytes(settings) }),
    'Metadata/plate_1.png': bytes('\x89PNG fake'),
    ...files,
  });
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

describe('slicer projects', () => {
  it('combines selected plates, summing volume without treating the preview layout as print dimensions', () => {
    const geometry = parse3mf(project(), { plates: [1, 2] });
    const analysis = analyzeMesh(geometry);
    expect(analysis).toMatchObject({ widthMm: 80, depthMm: 20, heightMm: 10, volumeCm3: 13, triangleCount: 36 });
    expect(analysis.plates[0].model).toEqual({ widthMm: 10, depthMm: 10, heightMm: 10, volumeCm3: 1 });
    expect(analysis.plates[1].model).toEqual({ widthMm: 80, depthMm: 20, heightMm: 10, volumeCm3: 12 });
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.max.x - geometry.boundingBox!.min.x).toBe(100);
    expect(analyzeMesh(parse3mf(project(), { plates: [2] })).volumeCm3).toBe(12);
    geometry.dispose();
  });

  it.each([{ plates: [] }, { plates: [1, 1] }, { plates: [1, 99] }])('rejects invalid plate sets $plates instead of silently substituting another plate', ({ plates }) => {
    expect(() => parse3mf(project(), { plates })).toThrow(MeshFileError);
  });

  it('lists the plates and builds the first one by default', () => {
    const analysis = analyzeMesh(parse3mf(project()));
    expect(analysis).toMatchObject({ widthMm: 10, depthMm: 10, heightMm: 10, volumeCm3: 1, triangleCount: 12, plate: 1, parts: [] });
    expect(analysis.plates).toEqual([
      { id: 1, name: 'Cube', objectCount: 1, thumbnail: `data:image/png;base64,${btoa('\x89PNG fake')}` },
      { id: 2, name: 'Two boxes', objectCount: 2 },
    ]);
  });

  describe('slicer filament colors', () => {
    const palette = { 'Metadata/project_settings.config': bytes(JSON.stringify({ filament_colour: ['#FF0000', '#0088FFFF', '#00ff00'] })) };
    const painted = (paint: string) => bytes(objectFile(boxMesh(10, 10, 10).replace('<triangle ', `<triangle paint_color="${paint}" `)));

    it('reads paint and the default filament, keeping parts in the prepared customer preview', () => {
      const geometry = parse3mf(project({
        files: { ...palette, '3D/Objects/cube.model': painted('8') },
      }));
      const analysis = analyzeMesh(geometry);
      expect(analysis.parts).toEqual([
        { key: 'filament:2', name: 'Filament 2', color: '#0088ff' },
        { key: 'filament:1', name: 'Filament 1', color: '#ff0000' },
      ]);
      const prepared = prepareMeshForPreview(geometry);
      expect(prepared.parts).toEqual(analysis.parts);
      expect(prepared.surface.slotParts).toEqual(expect.arrayContaining([0, 1]));
      geometry.dispose();
      prepared.geometry.dispose();
    });

    it('renders painted sub-triangles rather than assigning one color to an entire face', () => {
      const geometry = parse3mf(project({ files: { ...palette, '3D/Objects/cube.model': painted('481') } }));
      expect(analyzeMesh(geometry)).toMatchObject({ volumeCm3: 1, triangleCount: 13 });
      const attributes = geometry.getAttribute(PART_ATTRIBUTE);
      expect(attributes.getX(0)).not.toBe(attributes.getX(3));
      geometry.dispose();
    });

    it('uses object and part extruder assignments, with unpainted state inheriting the part color', () => {
      const settings = bytes(`<config>
        <object id="2"><metadata key="extruder" value="2"/><part id="1"><metadata key="extruder" value="3"/></part></object>
      </config>`);
      const geometry = parse3mf(project({
        plates: null,
        items: [['2', translate(0)]],
        files: { ...palette, 'Metadata/model_settings.config': settings, '3D/Objects/cube.model': painted('0') },
      }));
      expect(analyzeMesh(geometry).parts).toEqual([{ key: 'filament:3', name: 'Filament 3', color: '#00ff00' }]);
      geometry.dispose();
    });

    it('keeps stable filament keys and maps geometry correctly across plates with different local part orders', () => {
      const geometry = parse3mf(project({
        files: { ...palette, '3D/Objects/cube.model': painted('8') },
      }), { plates: [2, 1] });
      expect(analyzeMesh(geometry).parts.map((part) => part.key)).toEqual(['filament:1', 'filament:2']);
      const attribute = geometry.getAttribute(PART_ATTRIBUTE);
      expect(attribute.getX(0)).toBe(0);
      expect(attribute.getX(72)).toBe(1);
      geometry.dispose();
    });

    it('reports missing palettes, invalid JSON and malformed paint', () => {
      expect(() => parse3mf(project({ files: { '3D/Objects/cube.model': painted('8') } }))).toThrow('no color for filament 2');
      expect(() => parse3mf(project({ files: { 'Metadata/project_settings.config': bytes('{bad') } }))).toThrow('not valid JSON');
      expect(() => parse3mf(project({ files: { ...palette, '3D/Objects/cube.model': painted('C') } }))).toThrow('incomplete color painting');
    });
  });

  it('builds only the chosen plate, resolving objects by file even when ids clash', () => {
    // Both object files use id 1; plate 2 must get the 30×20 boxes, not the cube.
    const analysis = analyzeMesh(parseMeshFile(project(), { plate: 2 }));
    expect(analysis).toMatchObject({ widthMm: 80, depthMm: 20, heightMm: 10, volumeCm3: 12, triangleCount: 24, plate: 2 });
  });

  it('falls back to the first plate for an unknown plate id', () => {
    expect(analyzeMesh(parse3mf(project(), { plate: 99 })).plate).toBe(1);
  });

  it('leaves out objects excluded from printing, and plates left empty by that', () => {
    const file = project({
      items: [
        ['2', translate(100, 100)],
        ['2', translate(200, 100), false],
        ['4', translate(400, 100), false],
      ],
      plates: [
        [1, 'Cube', [['2', 0], ['2', 1]]],
        [2, 'Excluded', [['4', 0]]],
      ],
    });
    const analysis = analyzeMesh(parse3mf(file));
    expect(analysis.plates.map((p) => [p.name, p.objectCount])).toEqual([['Cube', 1]]);
    expect(analysis.widthMm).toBe(10);
  });

  it('applies component and build transforms together', () => {
    const file = project({
      objects: { '2': ['/3D/Objects/cube.model', '2 0 0 0 2 0 0 0 2 0 0 0'] },
      items: [['2', '1 0 0 0 1 0 0 0 3 0 0 0']],
      plates: [[1, 'Scaled', [['2', 0]]]],
    });
    expect(analyzeMesh(parse3mf(file))).toMatchObject({ widthMm: 20, depthMm: 20, heightMm: 60 });
  });

  it('includes every printable object when the project has no plate list', () => {
    const analysis = analyzeMesh(parse3mf(project({ plates: null })));
    expect(analysis).toMatchObject({ plates: [], plate: null, triangleCount: 36 });
  });

  it('converts the project unit to millimeters', () => {
    expect(analyzeMesh(parse3mf(project({ unit: 'centimeter' }))).widthMm).toBe(100);
  });

  it('explains missing object files', () => {
    const file = project({ objects: { '2': ['/3D/Objects/missing.model'] }, plates: [[1, 'Cube', [['2', 0]]]] });
    expect(() => parse3mf(file)).toThrow(MeshFileError);
    expect(() => parse3mf(file)).toThrow('The project refers to 3D/Objects/missing.model, which is missing from the file.');
  });
});

describe('bundled demo project', () => {
  const file = () => {
    const bytes = readFileSync(`${import.meta.dirname}/../../fixtures/models/star-vase-project.3mf`);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  };

  it('has a full-size vase on plate 1 and two 60% vases on plate 2', () => {
    const plate1 = analyzeMesh(parseMeshFile(file()));
    expect(plate1).toMatchObject({ widthMm: 95.9, depthMm: 95.9, heightMm: 180, volumeCm3: 119.6, plate: 1 });
    expect(plate1.plates).toEqual([
      { id: 1, name: 'Vase', objectCount: 1 },
      { id: 2, name: 'Mini vases', objectCount: 2 },
    ]);

    const plate2 = analyzeMesh(parseMeshFile(file(), { plate: 2 }));
    // 60% vases (0.6 × 95.92 ≈ 57.6 mm wide) placed 60 mm apart; volume scales with 0.6³ per vase.
    expect(plate2).toMatchObject({ widthMm: 117.6, depthMm: 57.6, heightMm: 108, triangleCount: 2 * 5824 });
    expect(plate2.volumeCm3).toBeCloseTo(2 * 119.6 * 0.216, 0);
  }, 60_000); // jsdom's XML parser is far slower than a browser's on this 420 KB mesh
});
