// Model loading: 3MF (plain + Bambu/Orca project flavour) and STL (binary / ASCII).
// Platform neutral: loaders take the file content (Uint8Array/ArrayBuffer); see node.mjs for
// file-system helpers.
import { readZip } from './zip.mjs';

/** A mesh: Float64Array vertices (xyz...), Uint32Array indices (abc...). */

function parseAttrs(s) {
  const out = {};
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = m[2];
  return out;
}

function identity() { return [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]; }

function parseTransform(str) {
  if (!str) return identity();
  const v = str.trim().split(/\s+/).map(Number);
  if (v.length !== 12 || v.some((x) => !Number.isFinite(x))) return identity();
  return v;
}

// 3MF transforms are row-vector matrices: p' = p * M. Stored "m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32".
function mulTransform(a, b) {
  // returns a then b  (p * A * B)
  const A = (r, c) => (r < 3 ? a[r * 3 + c] : a[9 + c]);
  const B = (r, c) => (r < 3 ? b[r * 3 + c] : b[9 + c]);
  const out = new Array(12);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 3; c++) {
      let s = r === 3 ? B(3, c) : 0;
      for (let k = 0; k < 3; k++) s += A(r, k) * B(k, c);
      out[(r < 3 ? r * 3 : 9) + c] = s;
    }
  }
  return out;
}

function applyTransform(vertices, t) {
  const out = new Float64Array(vertices.length);
  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2];
    out[i] = x * t[0] + y * t[3] + z * t[6] + t[9];
    out[i + 1] = x * t[1] + y * t[4] + z * t[7] + t[10];
    out[i + 2] = x * t[2] + y * t[5] + z * t[8] + t[11];
  }
  return out;
}

function determinant(t) {
  return t[0] * (t[4] * t[8] - t[5] * t[7]) - t[1] * (t[3] * t[8] - t[5] * t[6]) + t[2] * (t[3] * t[7] - t[4] * t[6]);
}

/** TriangleSelector encoding of an unsplit triangle with the given state (filament). */
function paintLeafCode(state) {
  if (state <= 0) return null;
  if (state < 3) return (state << 2).toString(16).toUpperCase();
  return (state - 3).toString(16).toUpperCase() + 'C';
}

function parseMeshXml(xml) {
  // returns map objectId -> { mesh?, components? , type }
  const objects = new Map();
  // 3MF core colour groups (<basematerials>): per-triangle materials are mapped to filaments
  // (material index i -> filament i + 1), like OrcaSlicer's colour import of plain 3MF files
  const materialGroups = new Set();
  for (const bm of xml.matchAll(/<basematerials\b([^>]*)>/g)) { const a = parseAttrs(bm[1]); if (a.id) materialGroups.add(a.id); }
  const objRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
  let m;
  while ((m = objRe.exec(xml))) {
    const attrs = parseAttrs(m[1]);
    const body = m[2];
    const entry = { id: attrs.id, type: attrs.type || 'model', name: attrs.name };
    const objMaterial = attrs.pid && materialGroups.has(attrs.pid) && attrs.pindex !== undefined ? +attrs.pindex : null;
    if (objMaterial !== null) entry.materialExtruder = objMaterial + 1;
    const vStart = body.indexOf('<vertices');
    if (vStart >= 0) {
      const verts = [];
      const vre = /<vertex\b([^>]*)\/?>/g;
      const vEnd = body.indexOf('</vertices>');
      vre.lastIndex = vStart;
      let vm;
      while ((vm = vre.exec(body)) && (vEnd < 0 || vm.index < vEnd)) {
        const a = vm[1];
        const x = /\bx\s*=\s*"([^"]*)"/.exec(a), y = /\by\s*=\s*"([^"]*)"/.exec(a), z = /\bz\s*=\s*"([^"]*)"/.exec(a);
        verts.push(+x[1], +y[1], +z[1]);
      }
      const tris = [];
      const paint = [];
      let painted = false;
      const tre = /<triangle\b([^>]*)\/?>/g;
      let tm;
      tre.lastIndex = body.indexOf('<triangles');
      while ((tm = tre.exec(body))) {
        const a = tm[1];
        const v1 = /\bv1\s*=\s*"(\d+)"/.exec(a), v2 = /\bv2\s*=\s*"(\d+)"/.exec(a), v3 = /\bv3\s*=\s*"(\d+)"/.exec(a);
        tris.push(+v1[1], +v2[1], +v3[1]);
        // multi-material painting: Bambu/Orca "paint_color", Prusa "slic3rpe:mmu_segmentation"
        const pc = /\b(?:paint_color|slic3rpe:mmu_segmentation)\s*=\s*"([0-9A-Fa-f]*)"/.exec(a);
        if (pc && pc[1]) { paint[tris.length / 3 - 1] = pc[1].toUpperCase(); painted = true; }
        else if (materialGroups.size) {
          const tp = /\bpid\s*=\s*"([^"]*)"/.exec(a), t1 = /\bp1\s*=\s*"(\d+)"/.exec(a);
          const idx = tp && materialGroups.has(tp[1]) && t1 ? +t1[1] : objMaterial;
          if (idx !== null && idx !== objMaterial) { paint[tris.length / 3 - 1] = paintLeafCode(idx + 1); painted = true; }
        }
      }
      entry.mesh = { vertices: Float64Array.from(verts), indices: Uint32Array.from(tris) };
      if (painted) { paint.length = tris.length / 3; entry.mesh.paint = Array.from(paint, (s) => s || null); }
    }
    const comps = [];
    const cre = /<component\b([^>]*)\/?>/g;
    let cm;
    while ((cm = cre.exec(body))) {
      const a = parseAttrs(cm[1]);
      comps.push({ objectId: a.objectid, path: a['p:path'] || null, transform: parseTransform(a.transform) });
    }
    if (comps.length) entry.components = comps;
    objects.set(attrs.id, entry);
  }
  return objects;
}

function parseModelSettings(xml) {
  // Bambu/Orca Metadata/model_settings.config
  const result = { objects: new Map(), plates: [] };
  if (!xml) return result;
  const objRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
  let m;
  while ((m = objRe.exec(xml))) {
    const attrs = parseAttrs(m[1]);
    const body = m[2];
    const obj = { id: attrs.id, settings: {}, parts: new Map() };
    // object level metadata (outside of <part>)
    const bodyNoParts = body.replace(/<part\b[\s\S]*?<\/part>/g, '');
    const mdRe = /<metadata\b([^>]*)\/?>/g;
    let md;
    while ((md = mdRe.exec(bodyNoParts))) {
      const a = parseAttrs(md[1]);
      if (a.key !== undefined) obj.settings[a.key] = a.value;
    }
    const partRe = /<part\b([^>]*)>([\s\S]*?)<\/part>/g;
    let pm;
    while ((pm = partRe.exec(body))) {
      const pa = parseAttrs(pm[1]);
      const part = { id: pa.id, subtype: pa.subtype || 'normal_part', settings: {} };
      const pmdRe = /<metadata\b([^>]*)\/?>/g;
      let pmd;
      while ((pmd = pmdRe.exec(pm[2]))) {
        const a = parseAttrs(pmd[1]);
        if (a.key !== undefined) part.settings[a.key] = a.value;
      }
      obj.parts.set(pa.id, part);
    }
    result.objects.set(attrs.id, obj);
  }
  const plateRe = /<plate>([\s\S]*?)<\/plate>/g;
  while ((m = plateRe.exec(xml))) {
    const body = m[1];
    const plate = { settings: {}, instances: [] };
    const instRe = /<model_instance>([\s\S]*?)<\/model_instance>/g;
    let im;
    while ((im = instRe.exec(body))) {
      const inst = {};
      const r = /<metadata\b([^>]*)\/?>/g;
      let mm;
      while ((mm = r.exec(im[1]))) { const a = parseAttrs(mm[1]); inst[a.key] = a.value; }
      plate.instances.push(inst);
    }
    const noInst = body.replace(/<model_instance>[\s\S]*?<\/model_instance>/g, '');
    const r = /<metadata\b([^>]*)\/?>/g;
    let mm;
    while ((mm = r.exec(noInst))) { const a = parseAttrs(mm[1]); plate.settings[a.key] = a.value; }
    result.plates.push(plate);
  }
  return result;
}

/**
 * Load a 3MF. Returns { objects: [{name, extruder(1-based), settings, volumes:[{mesh, extruder, subtype}] }], projectConfig }
 * Meshes are in world (bed) coordinates.
 */
export function load3mf(bytes, { plate = 1 } = {}) {
  const zip = readZip(bytes);
  const rootRels = zip.readText('_rels/.rels') || '';
  let rootPath = '3D/3dmodel.model';
  const relm = /Target="([^"]+\.model)"/i.exec(rootRels);
  if (relm) rootPath = relm[1].replace(/^\//, '');
  const rootXml = zip.readText(rootPath);
  if (!rootXml) throw new Error('3MF: root model not found');
  const unitM = /<model\b[^>]*\bunit\s*=\s*"(\w+)"/.exec(rootXml);
  const unitScale = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 }[unitM ? unitM[1] : 'millimeter'] ?? 1;
  const cache = new Map();
  const getObjects = (p) => {
    const key = (p || rootPath).replace(/^\//, '');
    if (!cache.has(key)) {
      const xml = key === rootPath ? rootXml : zip.readText(key);
      if (!xml) throw new Error(`3MF: missing model part ${key}`);
      cache.set(key, parseMeshXml(xml));
    }
    return cache.get(key);
  };
  const settings = parseModelSettings(zip.readText('Metadata/model_settings.config'));
  let projectConfig = null;
  const pc = zip.readText('Metadata/project_settings.config');
  if (pc) { try { projectConfig = JSON.parse(pc); } catch { projectConfig = null; } }

  // plate filtering
  let allowed = null;
  if (settings.plates.length) {
    const pl = settings.plates.find((p) => +p.settings.plater_id === plate) || settings.plates[plate - 1];
    if (pl) allowed = new Set(pl.instances.map((i) => `${i.object_id}#${i.instance_id ?? 0}`));
  }

  const buildRe = /<item\b([^>]*)\/?>/g;
  const buildBody = (/<build\b[^>]*>([\s\S]*?)<\/build>/.exec(rootXml) || [, ''])[1];
  const rootObjects = getObjects(rootPath);
  const out = [];
  const instanceCounter = new Map();
  let bm;
  while ((bm = buildRe.exec(buildBody))) {
    const a = parseAttrs(bm[1]);
    const inst = instanceCounter.get(a.objectid) || 0;
    instanceCounter.set(a.objectid, inst + 1);
    if (a.printable === '0') continue;
    if (allowed && !allowed.has(`${a.objectid}#${inst}`)) continue;
    const itemT = parseTransform(a.transform);
    const objSettings = settings.objects.get(a.objectid);
    const rootObj = rootObjects.get(a.objectid);
    const objExtruder = objSettings && objSettings.settings.extruder ? +objSettings.settings.extruder : (rootObj && rootObj.materialExtruder) || 1;
    const volumes = [];
    const visit = (objs, id, t, depth) => {
      const o = objs.get(id);
      if (!o) throw new Error(`3MF: object ${id} not found`);
      if (o.mesh) {
        const part = objSettings ? objSettings.parts.get(id) : null;
        const subtype = part ? part.subtype : 'normal_part';
        const extr = part && part.settings.extruder && +part.settings.extruder > 0 ? +part.settings.extruder : objExtruder;
        let verts = applyTransform(o.mesh.vertices, t);
        if (unitScale !== 1) verts = verts.map((v) => v * unitScale);
        let indices = o.mesh.indices;
        const paintOrder = o.mesh.paint ? indices : undefined; // paint data refers to the original vertex order
        if (determinant(t) < 0) {
          indices = Uint32Array.from(indices);
          for (let i = 0; i < indices.length; i += 3) { const tmp = indices[i + 1]; indices[i + 1] = indices[i + 2]; indices[i + 2] = tmp; }
        }
        const vol = { mesh: { vertices: verts, indices, paintOrder }, extruder: extr, subtype, settings: part ? part.settings : {} };
        if (o.mesh.paint) vol.paint = o.mesh.paint;
        volumes.push(vol);
      }
      if (o.components && depth < 16) {
        for (const c of o.components) {
          const objs2 = c.path ? getObjects(c.path) : objs;
          visit(objs2, c.objectId, mulTransform(c.transform, t), depth + 1);
        }
      }
    };
    visit(rootObjects, a.objectid, itemT, 0);
    const name = (objSettings && objSettings.settings.name) || rootObjects.get(a.objectid)?.name || `object ${a.objectid}`;
    out.push({ id: a.objectid, name, extruder: objExtruder, settings: objSettings ? objSettings.settings : {}, volumes });
  }
  return {
    objects: out,
    projectConfig,
    plates: settings.plates.map((p, i) => ({ id: +(p.settings.plater_id || i + 1), name: p.settings.plater_name || '', instances: p.instances.length })),
  };
}

export function loadStl(bytes, name = 'model.stl') {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let verts = [];
  const head = new TextDecoder().decode(buf.subarray(0, Math.min(buf.length, 512)));
  const binaryLenOk = buf.length >= 84 && 84 + dv.getUint32(80, true) * 50 === buf.length;
  const isAscii = head.startsWith('solid') && !binaryLenOk && (buf.length < 84 || /facet|endsolid/.test(new TextDecoder().decode(buf.subarray(0, Math.min(buf.length, 4096)))));
  if (!isAscii) {
    if (buf.length < 84) throw new Error('STL: file too short');
    const n = dv.getUint32(80, true);
    if (84 + n * 50 > buf.length) throw new Error('STL: truncated binary file');
    verts = new Float64Array(n * 9);
    for (let i = 0; i < n; i++) {
      const o = 84 + i * 50 + 12;
      for (let k = 0; k < 9; k++) verts[i * 9 + k] = dv.getFloat32(o + k * 4, true);
    }
  } else {
    const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
    const s = new TextDecoder().decode(buf);
    let m;
    const v = [];
    while ((m = re.exec(s))) v.push(+m[1], +m[2], +m[3]);
    verts = Float64Array.from(v);
  }
  if (!verts.length) throw new Error('STL: the file contains no triangles');
  // weld vertices
  const map = new Map();
  const vout = [];
  const idx = new Uint32Array(verts.length / 3);
  for (let i = 0; i < verts.length; i += 3) {
    const key = `${verts[i]},${verts[i + 1]},${verts[i + 2]}`;
    let id = map.get(key);
    if (id === undefined) { id = vout.length / 3; map.set(key, id); vout.push(verts[i], verts[i + 1], verts[i + 2]); }
    idx[i / 3] = id;
  }
  const mesh = { vertices: Float64Array.from(vout), indices: idx };
  return { objects: [{ id: '1', name: String(name).split(/[\\/]/).pop(), extruder: 1, settings: {}, volumes: [{ mesh, extruder: 1, subtype: 'normal_part', settings: {} }] }], projectConfig: null };
}

/** Load a model from its bytes; the format is taken from the file name (.3mf / .stl). */
export function loadModelBytes(bytes, name, opts = {}) {
  const ext = (/\.[^.\\/]+$/.exec(String(name)) || [''])[0].toLowerCase();
  if (ext === '.3mf') return load3mf(bytes, opts);
  if (ext === '.stl') return loadStl(bytes, name);
  throw new Error(`Unsupported model format: ${ext || name}`);
}

export function meshBounds(mesh) {
  const v = mesh.vertices;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 3) {
    for (let k = 0; k < 3; k++) { if (v[i + k] < min[k]) min[k] = v[i + k]; if (v[i + k] > max[k]) max[k] = v[i + k]; }
  }
  return { min, max };
}

export function meshVolume(mesh) {
  const v = mesh.vertices, f = mesh.indices;
  let vol = 0;
  for (let i = 0; i < f.length; i += 3) {
    const a = f[i] * 3, b = f[i + 1] * 3, c = f[i + 2] * 3;
    vol += v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) - v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c]) + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c]);
  }
  return vol / 6;
}
