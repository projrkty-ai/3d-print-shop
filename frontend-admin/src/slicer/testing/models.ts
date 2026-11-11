import { strToU8, zipSync } from 'fflate';

const CUBE_VERTICES = (s: number) => [[0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0], [0, 0, s], [s, 0, s], [s, s, s], [0, s, s]];
const CUBE_TRIANGLES = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];

/** Binary STL of an axis-aligned cube (test fixture). */
export function cubeStl(size = 20): ArrayBuffer {
  const v = CUBE_VERTICES(size);
  const buf = new ArrayBuffer(84 + CUBE_TRIANGLES.length * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, CUBE_TRIANGLES.length, true);
  CUBE_TRIANGLES.forEach((t, i) => {
    const o = 84 + i * 50;
    t.forEach((vi, k) => v[vi].forEach((c, a) => dv.setFloat32(o + 12 + k * 12 + a * 4, c, true)));
  });
  return buf;
}

/** 3MF cube whose top face uses the second colour of a <basematerials> group. */
export function twoColourCube3mf(size = 20, offset = 125): ArrayBuffer {
  const v = CUBE_VERTICES(size);
  const top = new Set([2, 3]);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <basematerials id="1"><base name="A" displaycolor="#FF0000"/><base name="B" displaycolor="#0000FF"/></basematerials>
  <object id="2" type="model" pid="1" pindex="0"><mesh><vertices>
${v.map(([x, y, z]) => `   <vertex x="${x + offset}" y="${y + offset}" z="${z}"/>`).join('\n')}
  </vertices><triangles>
${CUBE_TRIANGLES.map(([a, b, c], i) => `   <triangle v1="${a}" v2="${b}" v3="${c}"${top.has(i) ? ' pid="1" p1="1"' : ''}/>`).join('\n')}
  </triangles></mesh></object>
 </resources>
 <build><item objectid="2"/></build>
</model>`;
  const zip = zipSync({
    '3D/3dmodel.model': strToU8(xml),
    '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
  });
  return zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer;
}
