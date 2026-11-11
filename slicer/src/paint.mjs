// Multi-material painting (Orca/Bambu "paint_color", Prusa "slic3rpe:mmu_segmentation"):
//  - decoding of the TriangleSelector bitstream into colored sub-triangles
//  - per-layer color segmentation of the slices (approximation of libslic3r
//    MultiMaterialSegmentation: every point of a slice gets the color of the nearest painted
//    contour segment — a Voronoi partition computed on a fine raster — plus projection of painted
//    top/bottom surfaces through the shell thickness).
import { SCALE, unionEx, intersectionEx, diffEx, exsToPaths, simplifyExs, area, exArea } from './geom.mjs';

const HEX = (ch) => {
  const c = ch.charCodeAt(0);
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 65 && c <= 70) return c - 55;
  if (c >= 97 && c <= 102) return c - 87;
  return 0;
};

/**
 * Decode one triangle's paint string into leaf triangles.
 * @param str hex string as stored in the 3MF
 * @param A,B,C triangle vertices [x,y,z] in the triangle's own vertex order
 * @returns [{ p: [A,B,C], state }]
 */
export function decodePaint(str, A, B, C) {
  if (!str) return [{ p: [A, B, C], state: 0 }];
  // bitstream: characters from the end, each nibble LSB first
  const bits = [];
  for (let i = str.length - 1; i >= 0; i--) {
    const d = HEX(str[i]);
    for (let k = 0; k < 4; k++) bits.push((d >> k) & 1);
  }
  let ib = 0;
  const nibble = () => { let n = 0; for (let k = 0; k < 4; k++) n |= (bits[ib++] || 0) << k; return n; };
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const leaves = [];
  // recursive descent mirroring TriangleSelector::deserialize (children stored in reverse order)
  const visit = (tri, depth) => {
    if (ib >= bits.length || depth > 24) { leaves.push({ p: tri, state: 0 }); return; }
    const code = nibble();
    const sides = code & 3;
    if (sides === 0) {
      const state = (code & 12) === 12 ? nibble() + 3 : code >> 2;
      leaves.push({ p: tri, state });
      return;
    }
    const special = code >> 2;
    const v = [tri[special % 3], tri[(special + 1) % 3], tri[(special + 2) % 3]];
    let children;
    if (sides === 1) {
      const m12 = mid(v[1], v[2]);
      children = [[v[0], v[1], m12], [m12, v[2], v[0]]];
    } else if (sides === 2) {
      const m01 = mid(v[0], v[1]), m20 = mid(v[2], v[0]);
      children = [[v[0], m01, m20], [m01, v[1], m20], [v[1], v[2], m20]];
    } else {
      const m01 = mid(v[0], v[1]), m12 = mid(v[1], v[2]), m20 = mid(v[2], v[0]);
      children = [[v[0], m01, m20], [m01, v[1], m12], [m12, v[2], m20], [m01, m12, m20]];
    }
    for (let k = children.length - 1; k >= 0; k--) visit(children[k], depth + 1);
  };
  visit([A, B, C], 0);
  return leaves;
}

/** true when any painted state != 0 exists */
export function hasPaint(vol) {
  return !!(vol.paint && vol.paint.some((s) => s && s !== '0' && s !== ''));
}

/** Build leaf triangles for the painted facets of a volume (world coordinates). */
export function paintLeaves(vol) {
  const V = vol.mesh.vertices, F = vol.mesh.paintOrder || vol.mesh.indices;
  const out = [];
  vol.paint.forEach((s, t) => {
    if (!s) return;
    const P = (i) => [V[3 * i], V[3 * i + 1], V[3 * i + 2]];
    const leaves = decodePaint(s, P(F[3 * t]), P(F[3 * t + 1]), P(F[3 * t + 2]));
    for (const l of leaves) out.push({ ...l, tri: t });
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
function planeSegment(p, z) {
  // intersection of a triangle with the plane z (2D segment) or null
  const pts = [];
  for (let k = 0; k < 3; k++) {
    const a = p[k], b = p[(k + 1) % 3];
    const da = a[2] - z, db = b[2] - z;
    if ((da > 0) !== (db > 0)) {
      const t = da / (da - db);
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return pts.length === 2 ? pts : null;
}

function normalZ(p) {
  const ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1], uz = p[1][2] - p[0][2];
  const vx = p[2][0] - p[0][0], vy = p[2][1] - p[0][1], vz = p[2][2] - p[0][2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return nz / l;
}

/**
 * Compute per-layer color regions for one painted volume.
 * @param vol volume { mesh, paint }
 * @param layers [{ sliceZ, bottom, top }]
 * @param slices per-layer ExPolygons of the volume
 * @param opts { topThickness, bottomThickness, maxState, cell }
 * @returns array (per layer) of null | Map(state -> ExPolygons) with state >= 1 regions (state 0 = rest)
 */
export function segmentLayers(vol, layers, slices, opts = {}) {
  const leaves = paintLeaves(vol).filter((l) => l.state > 0 && l.state <= (opts.maxState || 16));
  if (!leaves.length) return layers.map(() => null);
  const V = vol.mesh.vertices, F = vol.mesh.indices;
  const nT = F.length / 3;
  const painted = new Set(leaves.map((l) => l.tri));
  // all painted leaves (incl. state 0 pieces of painted triangles) for side seeds
  const allLeaves = paintLeaves(vol);
  const leafZ = allLeaves.map((l) => [Math.min(l.p[0][2], l.p[1][2], l.p[2][2]), Math.max(l.p[0][2], l.p[1][2], l.p[2][2])]);
  const triZ = new Float64Array(nT * 2);
  for (let t = 0; t < nT; t++) {
    const za = V[3 * F[3 * t] + 2], zb = V[3 * F[3 * t + 1] + 2], zc = V[3 * F[3 * t + 2] + 2];
    triZ[2 * t] = Math.min(za, zb, zc); triZ[2 * t + 1] = Math.max(za, zb, zc);
  }
  // top / bottom painted areas
  const tops = [], bots = [];
  for (const l of leaves) {
    const nz = normalZ(l.p);
    if (Math.abs(nz) < 0.05) continue;
    const poly = l.p.map((q) => ({ X: q[0] * SCALE, Y: q[1] * SCALE }));
    const z = nz > 0 ? Math.max(l.p[0][2], l.p[1][2], l.p[2][2]) : Math.min(l.p[0][2], l.p[1][2], l.p[2][2]);
    (nz > 0 ? tops : bots).push({ poly, z, state: l.state });
  }
  const topT = opts.topThickness || 0, botT = opts.bottomThickness || 0;
  const paintedZmin = Math.min(...leafZ.map((z) => z[0])) - botT, paintedZmax = Math.max(...leafZ.map((z) => z[1])) + topT;

  // one raster cell size for the whole object (<= 4e5 cells on the largest layer)
  let bw = 0, bh = 0;
  for (const exs of slices) {
    if (!exs || !exs.length) continue;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const e of exs) for (const q of e.contour) { if (q.X < x1) x1 = q.X; if (q.X > x2) x2 = q.X; if (q.Y < y1) y1 = q.Y; if (q.Y > y2) y2 = q.Y; }
    bw = Math.max(bw, (x2 - x1) / SCALE); bh = Math.max(bh, (y2 - y1) / SCALE);
  }
  let cell = opts.cell || 0.15;
  while ((bw / cell + 3) * (bh / cell + 3) > 4e5) cell *= 1.25;
  const out = [];
  for (let li = 0; li < layers.length; li++) {
    const L = layers[li];
    const ex = slices[li];
    if (!ex || !ex.length || L.sliceZ < paintedZmin || L.sliceZ > paintedZmax) { out.push(null); continue; }
    const z = L.sliceZ;
    // colored seed segments
    const segs = [];
    let anyColor = false;
    allLeaves.forEach((l, k) => {
      if (leafZ[k][0] > z || leafZ[k][1] < z) return;
      const s = planeSegment(l.p, z);
      if (!s) return;
      segs.push({ s, state: l.state });
      if (l.state > 0) anyColor = true;
    });
    // projected top / bottom areas: a painted top surface at z colors the layers below it within
    // the top shell thickness, a painted bottom surface the layers above it
    const tb = [];
    for (const t of tops) if (L.top <= t.z + 1e-6 && L.top > t.z - topT + 1e-6) tb.push(t);
    for (const b of bots) if (L.bottom >= b.z - 1e-6 && L.bottom < b.z + botT - 1e-6) tb.push(b);
    if (!anyColor && !tb.length) { out.push(null); continue; }
    for (let t = 0; t < nT; t++) {
      if (painted.has(t) || triZ[2 * t] > z || triZ[2 * t + 1] < z) continue;
      // unpainted triangles seed the default color (painted ones are covered by their leaves)
      if (vol.paint[t]) continue;
      const p = [0, 1, 2].map((k) => { const i = F[3 * t + k]; return [V[3 * i], V[3 * i + 1], V[3 * i + 2]]; });
      const s = planeSegment(p, z);
      if (s) segs.push({ s, state: 0 });
    }
    const regions = voronoiRegions(ex, segs, cell, tb);
    const m = new Map();
    for (const [state, r] of regions) if (state > 0 && r.length) m.set(state, r);
    out.push(m.size ? m : null);
  }
  return out;
}

/** Call fn(cellIndex) for raster cells whose centre lies inside the triangle. */
function rasterTriangle(p, x0, y0, g, W, H, fn) {
  const ys = p.map((q) => q.Y);
  const iy0 = Math.max(0, Math.ceil((Math.min(...ys) - y0) / g - 0.5)), iy1 = Math.min(H - 1, Math.floor((Math.max(...ys) - y0) / g - 0.5));
  for (let iy = iy0; iy <= iy1; iy++) {
    const cy = y0 + (iy + 0.5) * g;
    let xa = Infinity, xb = -Infinity;
    for (let k = 0; k < 3; k++) {
      const a = p[k], b = p[(k + 1) % 3];
      if ((a.Y > cy) === (b.Y > cy)) continue;
      const x = a.X + (b.X - a.X) * (cy - a.Y) / (b.Y - a.Y);
      if (x < xa) xa = x; if (x > xb) xb = x;
    }
    if (xa > xb) continue;
    const ix0 = Math.max(0, Math.ceil((xa - x0) / g - 0.5)), ix1 = Math.min(W - 1, Math.floor((xb - x0) / g - 0.5));
    for (let ix = ix0; ix <= ix1; ix++) fn(iy * W + ix);
  }
}

/**
 * Voronoi partition of the slice by nearest colored boundary segment (dead-reckoning distance
 * transform on a raster). Returns Map(state -> ExPolygons) including state 0.
 */
function voronoiRegions(exs, segs, cellMM, tb = []) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of exs) for (const q of e.contour) { if (q.X < minX) minX = q.X; if (q.X > maxX) maxX = q.X; if (q.Y < minY) minY = q.Y; if (q.Y > maxY) maxY = q.Y; }
  const g = cellMM * SCALE;
  // grid aligned to a fixed origin for all layers: identical geometry gives identical region
  // borders from layer to layer (no jitter that would create vertical-shell slivers)
  const x0 = Math.floor(minX / g - 1) * g, y0 = Math.floor(minY / g - 1) * g;
  const W = Math.ceil((maxX - x0) / g) + 2, H = Math.ceil((maxY - y0) / g) + 2;
  const N = W * H;
  const dist = new Float64Array(N).fill(Infinity);
  const sx = new Float64Array(N), sy = new Float64Array(N);
  const lab = new Int16Array(N).fill(-1);
  // Distance bias favouring "radial" contour segments (side walls of raised lettering / ribs):
  // at reflex contour corners shared by two colours Orca gives the corner region to the raised
  // patch, which then extends to the medial axis. Tangential segments get a small penalty.
  const ccx = (minX + maxX) / 2, ccy = (minY + maxY) / 2;
  const bias = new Float64Array(N);
  // seeds
  segs.forEach(({ s, state }) => {
    const ax = s[0][0] * SCALE, ay = s[0][1] * SCALE, bx = s[1][0] * SCALE, by = s[1][1] * SCALE;
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(len / (0.5 * g)));
    const mx = (ax + bx) / 2 - ccx, my = (ay + by) / 2 - ccy, ml = Math.hypot(mx, my) || 1;
    const radial = len > 0 ? Math.abs(((bx - ax) * mx + (by - ay) * my) / (len * ml)) : 0;
    const b = 0.01 * SCALE * (1 - radial);
    for (let k = 0; k <= n; k++) {
      const px = ax + (bx - ax) * k / n, py = ay + (by - ay) * k / n;
      const ix = Math.floor((px - x0) / g), iy = Math.floor((py - y0) / g);
      if (ix < 0 || iy < 0 || ix >= W || iy >= H) continue;
      const c = iy * W + ix;
      const cx = x0 + (ix + 0.5) * g, cy = y0 + (iy + 0.5) * g;
      const d = Math.hypot(cx - px, cy - py) + b;
      if (d < dist[c]) { dist[c] = d; sx[c] = px; sy[c] = py; lab[c] = state; bias[c] = b; }
    }
  });
  // two-pass dead-reckoning propagation (8-neighbourhood)
  const fwd = [-W - 1, -W, -W + 1, -1], bwd = [1, W - 1, W, W + 1];
  const pass = (order, offs) => {
    for (let k = 0; k < N; k++) {
      const c = order > 0 ? k : N - 1 - k;
      const ix = c % W, iy = (c - ix) / W;
      const cx = x0 + (ix + 0.5) * g, cy = y0 + (iy + 0.5) * g;
      let best = dist[c];
      for (let j = 0; j < 4; j++) {
        const n = c + offs[j];
        if (n < 0 || n >= N || lab[n] < 0) continue;
        const nx = n % W;
        if (nx - ix > 1 || ix - nx > 1) continue; // row wrap
        const ddx = cx - sx[n], ddy = cy - sy[n];
        const d = Math.sqrt(ddx * ddx + ddy * ddy) + bias[n];
        if (d < best) { best = d; dist[c] = d; sx[c] = sx[n]; sy[c] = sy[n]; lab[c] = lab[n]; bias[c] = bias[n]; }
      }
    }
  };
  for (let it = 0; it < 2; it++) { pass(1, fwd); pass(-1, bwd); }
  // projected top/bottom painted triangles override the Voronoi labels
  for (const t of tb) rasterTriangle(t.poly, x0, y0, g, W, H, (c) => { lab[c] = t.state; });
  // majority filter (removes isolated cells / slivers from finely subdivided paint borders)
  const lab2 = new Int16Array(lab);
  for (let iy = 1; iy < H - 1; iy++) for (let ix = 1; ix < W - 1; ix++) {
    const c = iy * W + ix;
    const me = lab[c];
    let same = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (lab[c + dy * W + dx] === me) same++;
    if (same >= 4) continue;
    // minority cell: take the most frequent neighbour label
    let bl = me, bc = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const l = lab[c + dy * W + dx];
      let k = 0;
      for (let ey = -1; ey <= 1; ey++) for (let ex = -1; ex <= 1; ex++) if (lab[c + ey * W + ex] === l) k++;
      if (k > bc) { bc = k; bl = l; }
    }
    if (bc >= 5) lab2[c] = bl;
  }
  const states = new Set();
  for (let c = 0; c < N; c++) if (lab2[c] > 0) states.add(lab2[c]);
  const res = new Map();
  const colored = [];
  for (const st of states) {
    const loops = traceMask((ix, iy) => ix >= 0 && iy >= 0 && ix < W && iy < H && lab2[iy * W + ix] === st, W, H)
      .map((lp) => lp.map(([vx, vy]) => ({ X: Math.round(x0 + vx * g), Y: Math.round(y0 + vy * g) })));
    if (!loops.length) continue;
    // smooth the raster staircase and drop specks
    let r = simplifyExs(unionEx(loops), 1.5 * g);
    r = intersectionEx(exs, exsToPaths(r)).filter((e) => exArea(e) > 0.3 * SCALE * SCALE);
    if (r.length) { res.set(st, r); colored.push(...exsToPaths(r)); }
  }
  res.set(0, colored.length ? diffEx(exs, colored) : exs);
  return res;
}

/**
 * Trace the boundary of a binary cell mask into closed loops of grid vertices (cells on the left:
 * outer loops CCW, holes CW).
 */
function traceMask(inside, W, H) {
  const next = new Map(); // start vertex key -> [end vertex keys]
  const key = (x, y) => y * (W + 2) + x;
  const add = (x1, y1, x2, y2) => { const k = key(x1, y1); const a = next.get(k); const e = key(x2, y2); if (a) a.push(e); else next.set(k, [e]); };
  for (let iy = 0; iy < H; iy++) for (let ix = 0; ix < W; ix++) {
    if (!inside(ix, iy)) continue;
    if (!inside(ix, iy - 1)) add(ix, iy, ix + 1, iy);
    if (!inside(ix + 1, iy)) add(ix + 1, iy, ix + 1, iy + 1);
    if (!inside(ix, iy + 1)) add(ix + 1, iy + 1, ix, iy + 1);
    if (!inside(ix - 1, iy)) add(ix, iy + 1, ix, iy);
  }
  const loops = [];
  const xy = (k) => [k % (W + 2), Math.floor(k / (W + 2))];
  for (const [k0] of next) {
    while (next.get(k0) && next.get(k0).length) {
      const pts = [];
      let prev = k0, cur = next.get(k0).pop();
      pts.push(xy(k0));
      let guard = 0;
      while (cur !== k0 && guard++ < 4 * W * H) {
        pts.push(xy(cur));
        const outs = next.get(cur);
        if (!outs || !outs.length) break;
        let pick = outs.length - 1;
        if (outs.length > 1) {
          // at a diagonal touch prefer the left turn (keeps loops separate)
          const [px, py] = xy(prev), [cx, cy] = xy(cur);
          const dx = cx - px, dy = cy - py;
          for (let i = 0; i < outs.length; i++) { const [nx, ny] = xy(outs[i]); const ex = nx - cx, ey = ny - cy; if (dx * ey - dy * ex > 0) { pick = i; break; } }
        }
        prev = cur;
        cur = outs.splice(pick, 1)[0];
      }
      // drop collinear points
      const clean = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[(i + pts.length - 1) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
        if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) clean.push(b);
      }
      if (clean.length >= 3) loops.push(clean);
    }
  }
  return loops;
}

/** Length of the same-colour run each seed segment belongs to (segments chained by endpoints). */
export function colourRunLengths(segs) {
  const n = segs.length;
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const byPt = new Map();
  const key = (p) => Math.round(p[0] * 1e4) + ',' + Math.round(p[1] * 1e4);
  segs.forEach((sg, i) => {
    for (const p of sg.s) {
      const k = key(p);
      const other = byPt.get(k);
      if (other === undefined) { byPt.set(k, [i]); continue; }
      for (const j of other) if (segs[j].state === sg.state) { const a = find(i), b = find(j); if (a !== b) parent[a] = b; }
      other.push(i);
    }
  });
  const sum = new Float64Array(n);
  const lens = segs.map((sg) => Math.hypot(sg.s[1][0] - sg.s[0][0], sg.s[1][1] - sg.s[0][1]));
  for (let i = 0; i < n; i++) sum[find(i)] += lens[i];
  return lens.map((_, i) => sum[find(i)]);
}
