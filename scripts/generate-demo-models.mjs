// Generates public/models/twisted-star-vase.{stl,3mf}: a closed, watertight vase (Z up, millimeters)
// with an 8-point star cross-section that twists as it rises, plus tricolor-star-vase.3mf: the same
// vase with base, body and rim in different colors (3MF base materials), and star-vase-project.3mf:
// a two-plate slicer project laid out like Bambu Studio / OrcaSlicer save it.
// Run: node scripts/generate-demo-models.mjs
import { writeFileSync } from 'node:fs';
import { strToU8, zipSync } from 'three/examples/jsm/libs/fflate.module.js';

const HEIGHT = 180;
const FLOOR = 2.5; // bottom thickness
const WALL = 2.5;
const POINTS = 8; // star points → 16 vertices per ring
const RINGS = 90;
const TWIST = Math.PI / 4; // 45° over the full height

const radiusAt = (t) => 34 + 16 * Math.sin(Math.PI * (0.15 + 0.85 * t));

function ring(z, inset) {
  const t = z / HEIGHT;
  const r = radiusAt(t);
  const vertices = [];
  for (let k = 0; k < POINTS * 2; k++) {
    const radius = (k % 2 === 0 ? r : r * 0.82) - inset;
    const angle = (k / (POINTS * 2)) * Math.PI * 2 + t * TWIST;
    vertices.push([radius * Math.cos(angle), radius * Math.sin(angle), z]);
  }
  return vertices;
}

const outer = Array.from({ length: RINGS + 1 }, (_, i) => ring((i / RINGS) * HEIGHT, 0));
const inner = Array.from({ length: RINGS + 1 }, (_, i) => ring(FLOOR + (i / RINGS) * (HEIGHT - FLOOR), WALL));
const n = POINTS * 2;
const triangles = [];
const quad = (a, b, c, d) => triangles.push([a, b, c], [a, c, d]);

for (let i = 0; i < RINGS; i++) {
  for (let j = 0; j < n; j++) {
    const k = (j + 1) % n;
    quad(outer[i][j], outer[i][k], outer[i + 1][k], outer[i + 1][j]); // faces outwards
    quad(inner[i][j], inner[i + 1][j], inner[i + 1][k], inner[i][k]); // faces into the cavity
  }
}
for (let j = 0; j < n; j++) {
  const k = (j + 1) % n;
  quad(outer[RINGS][j], outer[RINGS][k], inner[RINGS][k], inner[RINGS][j]); // rim, facing up
  triangles.push([[0, 0, 0], outer[0][k], outer[0][j]]); // base, facing down
  triangles.push([[0, 0, FLOOR], inner[0][j], inner[0][k]]); // inner floor, facing up
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const buffer = Buffer.alloc(84 + triangles.length * 50);
buffer.write('PrintForge demo: twisted star vase', 0, 'ascii');
buffer.writeUInt32LE(triangles.length, 80);
let offset = 84;
let volume = 0;
for (const [a, b, c] of triangles) {
  const normal = cross(sub(b, a), sub(c, a));
  const length = Math.hypot(...normal) || 1;
  for (const value of [...normal.map((v) => v / length), ...a, ...b, ...c]) {
    buffer.writeFloatLE(value, offset);
    offset += 4;
  }
  offset += 2; // attribute byte count
  volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
}

writeFileSync(new URL('../public/models/twisted-star-vase.stl', import.meta.url), buffer);

// 3MF: the same triangles as an indexed mesh in a ZIP package (3MF core spec).
const vertexIndex = new Map();
const vertices = [];
const indexOf = (v) => {
  const key = v.map((n) => n.toFixed(4)).join(' ');
  if (!vertexIndex.has(key)) {
    vertexIndex.set(key, vertices.length);
    vertices.push(v);
  }
  return vertexIndex.get(key);
};
const faces = triangles.map((t) => t.map(indexOf));
const vertexXml = vertices.map(([x, y, z]) => `     <vertex x="${x.toFixed(4)}" y="${y.toFixed(4)}" z="${z.toFixed(4)}"/>`).join('\n');

/** A 3MF model document; `materialOf(triangle)` (optional) picks a base material per triangle. */
function modelXml(title, materials, materialOf) {
  const triangleXml = faces
    .map(([a, b, c], i) => `     <triangle v1="${a}" v2="${b}" v3="${c}"${materials ? ` pid="1" p1="${materialOf(triangles[i])}"` : ''}/>`)
    .join('\n');
  const materialXml = materials
    ? `  <basematerials id="1">\n${materials.map(([name, color]) => `   <base name="${name}" displaycolor="${color}"/>`).join('\n')}\n  </basematerials>\n`
    : '';
  const objectId = materials ? 2 : 1;
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <metadata name="Title">${title}</metadata>
 <resources>
${materialXml}  <object id="${objectId}" type="model" name="${title}"${materials ? ' pid="1" pindex="1"' : ''}>
   <mesh>
    <vertices>
${vertexXml}
    </vertices>
    <triangles>
${triangleXml}
    </triangles>
   </mesh>
  </object>
 </resources>
 <build>
  <item objectid="${objectId}"/>
 </build>
</model>
`;
}
const model = modelXml('Twisted Star Vase');
const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>
`;
const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>
`;
const package3mf = (xml) =>
  zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': strToU8(xml),
  });
const threeMf = package3mf(model);
writeFileSync(new URL('../public/models/twisted-star-vase.3mf', import.meta.url), threeMf);

// Tricolor: triangles are colored by their average height.
const TRICOLOR = [
  ['Base', '#2B2B2E'],
  ['Body', '#1F8A8A'],
  ['Rim', '#C9A227'],
];
const tricolor = package3mf(
  modelXml('Tricolor Star Vase', TRICOLOR, (triangle) => {
    const z = (triangle[0][2] + triangle[1][2] + triangle[2][2]) / 3;
    return z < 18 ? 0 : z > 165 ? 2 : 1;
  }),
);
writeFileSync(new URL('../public/models/tricolor-star-vase.3mf', import.meta.url), tricolor);
const maxR = Math.max(...outer.flat().map(([x, y]) => Math.hypot(x, y)));
// Slicer project: the mesh lives in its own object file (3MF production extension), referenced
// from the root model by path; plates and their object instances are listed in model_settings.config.
const PRODUCTION_NS = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';
const objectModel = modelXml('Twisted Star Vase')
  .replace('<item objectid="1"/>', '')
  .replace(' xmlns="', ` xmlns:p="${PRODUCTION_NS}" requiredextensions="p" xmlns="`);
const PLATE_STRIDE = 307.2; // plates sit side by side: a 256 mm bed plus a 20% gap
const placed = (scale, x, y) => `${scale} 0 0 0 ${scale} 0 0 0 ${scale} ${x} ${y} 0`;
const projectRoot = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="${PRODUCTION_NS}" requiredextensions="p">
 <metadata name="Application">PrintForge demo generator</metadata>
 <resources>
  <object id="2" type="model">
   <components><component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></components>
  </object>
 </resources>
 <build>
  <item objectid="2" transform="${placed(1, 128, 128)}" printable="1"/>
  <item objectid="2" transform="${placed(0.6, PLATE_STRIDE + 98, 128)}" printable="1"/>
  <item objectid="2" transform="${placed(0.6, PLATE_STRIDE + 158, 128)}" printable="1"/>
 </build>
</model>
`;
const instance = (objectId, instanceId) =>
  `   <model_instance>\n    <metadata key="object_id" value="${objectId}"/>\n    <metadata key="instance_id" value="${instanceId}"/>\n   </model_instance>`;
const modelSettings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
 <object id="2">
  <metadata key="name" value="Twisted Star Vase"/>
 </object>
 <plate>
  <metadata key="plater_id" value="1"/>
  <metadata key="plater_name" value="Vase"/>
${instance(2, 0)}
 </plate>
 <plate>
  <metadata key="plater_id" value="2"/>
  <metadata key="plater_name" value="Mini vases"/>
${instance(2, 1)}
${instance(2, 2)}
 </plate>
</config>
`;
const projectRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/Objects/object_1.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>
`;
const slicerProject = zipSync({
  '[Content_Types].xml': strToU8(contentTypes),
  '_rels/.rels': strToU8(rels),
  '3D/3dmodel.model': strToU8(projectRoot),
  '3D/_rels/3dmodel.model.rels': strToU8(projectRels),
  '3D/Objects/object_1.model': strToU8(objectModel),
  'Metadata/model_settings.config': strToU8(modelSettings),
});
writeFileSync(new URL('../public/models/star-vase-project.3mf', import.meta.url), slicerProject);

console.log(`${triangles.length} triangles, solid volume ${(volume / 1000).toFixed(1)} cm³, max radius ${maxR.toFixed(1)} mm`);
console.log(`STL ${buffer.length} bytes, 3MF ${threeMf.length} bytes (${vertices.length} shared vertices), tricolor 3MF ${tricolor.length} bytes, project ${slicerProject.length} bytes`);
