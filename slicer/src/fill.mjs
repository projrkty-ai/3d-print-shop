// Infill pattern generators (rectilinear/monotonic/monotonic-line/crosshatch/concentric) and
// a connect_infill implementation (PrusaSlicer/Orca style anchors).
import { SCALE, offset, offsetEx, unionEx, clipPolylines, exsToPaths, bbox, polylineLength, JT } from './geom.mjs';

const rot = (p, c, s) => ({ X: Math.round(p.X * c - p.Y * s), Y: Math.round(p.X * s + p.Y * c) });
const rotPaths = (paths, ang) => { const c = Math.cos(ang), s = Math.sin(ang); return paths.map((p) => p.map((q) => rot(q, c, s))); };
const rotEx = (exs, ang) => { const c = Math.cos(ang), s = Math.sin(ang); return exs.map((e) => ({ contour: e.contour.map((q) => rot(q, c, s)), holes: e.holes.map((h) => h.map((q) => rot(q, c, s))) })); };

/**
 * Scanline intersections of vertical lines x = xs[i] with polygons (paths in rotated frame).
 * Returns for each x the sorted list of [y0, y1] intervals inside (even-odd crossing rule, which
 * is right for ExPolygons).
 */
function scanIntervals(paths, xs) {
  const res = xs.map(() => []);
  const n = xs.length;
  if (!n) return res;
  const x0 = xs[0];
  const step = n > 1 ? xs[1] - xs[0] : 1;
  for (const p of paths) {
    const m = p.length;
    for (let i = 0; i < m; i++) {
      const a = p[i], b = p[(i + 1) % m];
      if (a.X === b.X) continue;
      const lo = Math.min(a.X, b.X), hi = Math.max(a.X, b.X);
      let k0 = Math.ceil((lo - x0) / step);
      if (k0 < 0) k0 = 0;
      for (let k = k0; k < n; k++) {
        const x = xs[k];
        if (x >= hi) break;
        if (x < lo) continue;
        // half-open rule [lo, hi)
        const t = (x - a.X) / (b.X - a.X);
        res[k].push(a.Y + t * (b.Y - a.Y));
      }
    }
  }
  return res.map((ys) => {
    ys.sort((u, v) => u - v);
    const iv = [];
    for (let i = 0; i + 1 < ys.length; i += 2) if (ys[i + 1] - ys[i] > 0) iv.push([ys[i], ys[i + 1]]);
    return iv;
  });
}

function adjustSolidSpacing(width, distance) {
  // libslic3r Fill::_adjust_solid_spacing
  const n = Math.floor((width - 1) / distance);
  if (n <= 0) return distance;
  const distanceNew = (width - 1) / n;
  const factor = distanceNew / distance;
  return factor > 1.2 ? distance * 1.2 : distanceNew; // expand at most 20%
}

/**
 * Generic line fill (rectilinear family).
 * opts: { spacing (mm, flow spacing), density, angle (rad), connect: 'monotonic'|'none'|'zigzag', solid: bool, align: bool }
 * Returns polylines (array of point arrays) in world frame.
 */
export function fillLines(exs, opts) {
  const { spacing, density = 1, angle = 0, connect = 'monotonic' } = opts;
  const solid = density > 0.9999;
  const sp = spacing * SCALE;
  // Shrink: infill line ends half spacing inside, connections on the 0.05 spacing inset.
  const INFILL_OVERLAP_OVER_SPACING = 0.45;
  const inner = offsetEx(exs, -(0.5 * sp), JT.miter);
  if (!inner.length) return [];
  const outer = offsetEx(exs, -((0.5 - INFILL_OVERLAP_OVER_SPACING) * sp), JT.miter);
  const rin = rotEx(inner, -angle);
  const paths = exsToPaths(rin);
  const bb = bbox(paths);
  let pitch = sp / density;
  let x0;
  if (solid) {
    const src = bbox(exsToPaths(rotEx(exs, -angle)));
    const w = src.maxX - src.minX;
    pitch = adjustSolidSpacing(w, pitch);
    x0 = src.minX + (pitch + 10) / 2;
  } else {
    // align to a global grid so that successive layers line up
    x0 = Math.ceil(bb.minX / pitch) * pitch;
  }
  const xs = [];
  for (let x = x0; x <= bb.maxX; x += pitch) xs.push(x);
  const ivs = scanIntervals(paths, xs);
  // Build segments
  const segs = [];
  for (let k = 0; k < xs.length; k++) {
    for (const [y0, y1] of ivs[k]) segs.push({ k, x: xs[k], y0, y1 });
  }
  if (!segs.length) return [];
  const c = Math.cos(angle), s = Math.sin(angle);
  const toWorld = (x, y) => ({ X: Math.round(x * c - y * s), Y: Math.round(x * s + y * c) });
  const out = [];
  if (connect === 'none') {
    // monotonic lines: separate lines in monotonic order, alternating direction
    let dir = 0;
    for (const sg of segs) {
      const a = toWorld(sg.x, sg.y0), b = toWorld(sg.x, sg.y1);
      out.push(dir ? [b, a] : [a, b]);
      dir ^= 1;
    }
    return out;
  }
  // monotonic/zigzag: connect segment ends of neighbouring scanlines when they are close
  // (short connection along the boundary), otherwise start a new polyline.
  const byK = new Map();
  for (const sg of segs) { if (!byK.has(sg.k)) byK.set(sg.k, []); byK.get(sg.k).push(sg); }
  const used = new Set();
  const maxLink = pitch * 3;
  const order = [...byK.keys()].sort((a, b) => a - b);
  for (const k0 of order) {
    for (const start of byK.get(k0)) {
      if (used.has(start)) continue;
      let cur = start; let up = true; // direction of traversal on current segment
      const pl = [];
      used.add(cur);
      pl.push(toWorld(cur.x, cur.y0), toWorld(cur.x, cur.y1));
      for (;;) {
        const endY = up ? cur.y1 : cur.y0;
        const next = byK.get(cur.k + 1);
        if (!next) break;
        let best = null, bd = Infinity;
        for (const cand of next) {
          if (used.has(cand)) continue;
          const y = up ? cand.y1 : cand.y0;
          const d = Math.abs(y - endY);
          if (d < bd) { bd = d; best = cand; }
        }
        if (!best || Math.hypot(bd, pitch) > maxLink) break;
        used.add(best);
        up = !up;
        const sy = up ? best.y0 : best.y1;
        const ey = up ? best.y1 : best.y0;
        pl.push(toWorld(best.x, sy), toWorld(best.x, ey));
        cur = best;
      }
      out.push(pl);
    }
  }
  return out;
}

// ----------------------------------------------------------------------------------------
// CrossHatch (Orca FillCrossHatch)
function oneCycle(progress, period) {
  const off = progress * (1 / 8) * period;
  return [[0.25 * period - off, off], [0.25 * period + off, off], [0.75 * period - off, -off], [0.75 * period + off, -off]];
}
function transformPattern(progress, direction, gridIn, w, h) {
  let width = w, height = h;
  const grid = gridIn * 2;
  const cyc = oneCycle(progress, grid);
  if (direction < 0) { width = h; height = w; }
  const nCyc = Math.floor(width / grid) + 2;
  const odd = [];
  for (let i = 0; i < nCyc; i++) for (const [x, y] of cyc) odd.push([x + i * grid, y]);
  const nLines = Math.floor(height / grid) + 2;
  const out = [];
  for (let i = 0; i < nLines; i++) out.push(odd.map(([x, y]) => [x, y + grid * i]));
  // even lines: mirrored (facing the odd ones) and shifted by half a line period in y
  for (let i = 0; i < nLines; i++) out.push(odd.map(([x, y]) => [x, -y + grid * i + 0.5 * grid]));
  if (direction < 0) return out.map((pl) => pl.map(([x, y]) => [y, x]));
  return out;
}
function repeatPattern(direction, grid, w, h) {
  let width = w, height = h;
  if (direction < 0) { width = h; height = w; }
  const n = Math.floor(height / grid) + 1;
  const out = [];
  for (let i = 0; i < n; i++) out.push([[0, grid * i], [width, grid * i]]);
  if (direction < 0) return out.map((pl) => pl.map(([x, y]) => [y, x]));
  return out;
}
function crossHatchLayers(z, repeatRatio, grid, w, h) {
  // Schedule fitted to OrcaSlicer 2.3 G-code (0.2 and 0.4 mm layers, different grids): repeat
  // blocks of straight lines alternate direction every period (= 0.4*grid + repeat); between
  // them a transform block 1.2*0.4*grid high, centred at u = rep + trans/2, morphs the lines into
  // a zig-zag (peak progress 1.2) and back into straight lines of the other direction.
  const trans = grid * 0.4;
  const rep = grid * repeatRatio;
  const period = trans + rep;
  const zz = z - rep / 2;
  const k = Math.floor(zz / period);
  const u = zz - k * period;
  const dirA = (k % 2 === 0) ? 1 : -1;
  const d = u - (rep + trans / 2);
  if (Math.abs(d) < 0.6 * trans) {
    const progress = 1.2 - 2 * Math.abs(d) / trans;
    return transformPattern(progress, d < 0 ? dirA : -dirA, grid, w, h);
  }
  return repeatPattern(d < 0 ? dirA : -dirA, grid, w, h);
}

export function fillCrossHatch(exs, { spacing, density, angle = Math.PI / 4, z, anchor, anchorMax }) {
  const sp = spacing * SCALE;
  const shrunk = offsetEx(exs, -0.5 * sp, JT.miter);
  if (!shrunk.length) return [];
  let repeatRatio = 1.0;
  if (density < 0.3) repeatRatio = Math.min(1, Math.max(0.2, 1 - Math.exp(-5 * density)));
  // Orca 2.3 crosshatch line pitch is 8% wider than spacing/density (measured on G-code).
  const grid = Math.round(1.08 * sp / density);
  const out = [];
  for (const ex of shrunk) {
    const rex = rotEx([ex], -angle)[0];
    const bb = bbox([rex.contour]);
    const pat = crossHatchLayers(z * SCALE, repeatRatio, grid, bb.maxX - bb.minX, bb.maxY - bb.minY);
    const pls = pat.map((pl) => pl.map(([x, y]) => ({ X: Math.round(x + bb.minX), Y: Math.round(y + bb.minY) })));
    let clipped = clipPolylines(pls, [rex.contour, ...rex.holes]);
    const minLen = 0.8 * sp;
    clipped = clipped.filter((p) => polylineLength(p) >= minLen);
    if (!clipped.length) continue;
    const connected = connectInfill(clipped, rex, sp, anchor * SCALE, anchorMax * SCALE);
    const back = rotPaths(connected, angle);
    for (const p of back) out.push(p);
  }
  return out;
}

/** Plain rectilinear sparse (global grid aligned) + connect_infill. */
export function fillRectilinearSparse(exs, { spacing, density, angle, anchor, anchorMax, shift = 0 }) {
  const sp = spacing * SCALE;
  const shrunk = offsetEx(exs, -0.5 * sp, JT.miter);
  if (!shrunk.length) return [];
  const pitch = sp / density;
  const out = [];
  for (const ex of shrunk) {
    const rex = rotEx([ex], -angle)[0];
    const bb = bbox([rex.contour]);
    const pls = [];
    const x0 = Math.ceil((bb.minX - shift * SCALE) / pitch) * pitch + shift * SCALE;
    for (let x = x0; x <= bb.maxX; x += pitch) pls.push([{ X: Math.round(x), Y: bb.minY - 10 }, { X: Math.round(x), Y: bb.maxY + 10 }]);
    let clipped = clipPolylines(pls, [rex.contour, ...rex.holes]);
    clipped = clipped.filter((p) => polylineLength(p) >= 0.8 * sp);
    if (!clipped.length) continue;
    const connected = connectInfill(clipped, rex, sp, anchor * SCALE, anchorMax * SCALE);
    for (const p of rotPaths(connected, angle)) out.push(p);
  }
  return out;
}

// ----------------------------------------------------------------------------------------
// connect_infill: connect line ends along the boundary (shortest arcs first, no cycles),
// add anchors to unconnected ends.
export function connectInfill(lines, ex, spacing, anchorLen, anchorMax) {
  const contours = [ex.contour, ...ex.holes];
  // precompute cumulative lengths
  const cs = contours.map((c) => {
    const cum = [0];
    for (let i = 0; i < c.length; i++) {
      const a = c[i], b = c[(i + 1) % c.length];
      cum.push(cum[i] + Math.hypot(b.X - a.X, b.Y - a.Y));
    }
    return { pts: c, cum, len: cum[c.length] };
  });
  // project endpoints
  const eps = [];
  const proj = (p) => {
    let best = null;
    for (let ci = 0; ci < cs.length; ci++) {
      const { pts, cum } = cs[ci];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const dx = b.X - a.X, dy = b.Y - a.Y;
        const l2 = dx * dx + dy * dy;
        let t = l2 > 0 ? ((p.X - a.X) * dx + (p.Y - a.Y) * dy) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        const qx = a.X + t * dx, qy = a.Y + t * dy;
        const d = Math.hypot(p.X - qx, p.Y - qy);
        if (!best || d < best.d) best = { d, ci, seg: i, t, param: cum[i] + t * Math.sqrt(l2) };
      }
    }
    return best;
  };
  lines.forEach((pl, li) => {
    for (const end of [0, 1]) {
      const p = end ? pl[pl.length - 1] : pl[0];
      const pr = proj(p);
      if (pr && pr.d < spacing * 0.6) eps.push({ li, end, ci: pr.ci, param: pr.param, pt: p, used: false });
    }
  });
  // sort per contour
  const per = cs.map(() => []);
  for (const e of eps) per[e.ci].push(e);
  for (const arr of per) arr.sort((a, b) => a.param - b.param);
  // candidate arcs between consecutive endpoints
  const arcs = [];
  per.forEach((arr, ci) => {
    const L = cs[ci].len;
    const n = arr.length;
    if (n < 2) return;
    for (let i = 0; i < n; i++) {
      const a = arr[i], b = arr[(i + 1) % n];
      if (n === 2 && i === 1) { // both arcs between the same two points
        arcs.push({ a: b, b: a, ci, len: (a.param - b.param + L) % L, fwdFrom: b });
        continue;
      }
      const len = ((b.param - a.param) % L + L) % L;
      arcs.push({ a, b, ci, len, fwdFrom: a });
    }
  });
  arcs.sort((x, y) => x.len - y.len);
  // union-find over lines
  const parent = lines.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const arcUsed = new Set();
  const conn = []; // {a,b,arc}
  for (const arc of arcs) {
    if (arc.len > anchorMax) break;
    const { a, b } = arc;
    if (a.used || b.used) continue;
    if (a.li === b.li) continue;
    const ra = find(a.li), rb = find(b.li);
    if (ra === rb) continue;
    parent[ra] = rb;
    a.used = b.used = true;
    a.link = { other: b, arc };
    b.link = { other: a, arc };
    arcUsed.add(arc);
  }
  // anchors for free ends: extend along boundary in the direction away from used arcs,
  // limited by anchorLen and by half distance to the neighbour endpoint.
  per.forEach((arr, ci) => {
    const L = cs[ci].len;
    const n = arr.length;
    for (let i = 0; i < n; i++) {
      const e = arr[i];
      if (e.used) continue;
      const next = arr[(i + 1) % n], prev = arr[(i - 1 + n) % n];
      const dNext = n > 1 ? ((next.param - e.param) % L + L) % L : L;
      const dPrev = n > 1 ? ((e.param - prev.param) % L + L) % L : L;
      // prefer the side whose neighbour is free (shares the arc) less; choose longer available gap
      const availNext = next.used && next.link && next.link.arc.fwdFrom === next ? dNext : (next.used ? dNext : dNext / 2);
      const availPrev = prev.used ? dPrev : dPrev / 2;
      let len, dir;
      if (availNext >= availPrev) { len = Math.min(anchorLen, availNext); dir = 1; } else { len = Math.min(anchorLen, availPrev); dir = -1; }
      if (len > spacing * 0.2) e.anchor = { len, dir };
    }
  });
  // Build polylines: walk chains
  const boundaryPath = (ci, fromParam, len, dir) => {
    const { pts, cum, len: L } = cs[ci];
    const out = [];
    const ptAt = (s) => {
      s = ((s % L) + L) % L;
      let lo = 0, hi = pts.length;
      while (lo < hi - 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
      const a = pts[lo], b = pts[(lo + 1) % pts.length];
      const segL = cum[lo + 1] - cum[lo];
      const t = segL > 0 ? (s - cum[lo]) / segL : 0;
      return { X: Math.round(a.X + (b.X - a.X) * t), Y: Math.round(a.Y + (b.Y - a.Y) * t), idx: lo };
    };
    const start = ptAt(fromParam);
    out.push({ X: start.X, Y: start.Y });
    // add intermediate vertices
    const s0 = fromParam, s1 = fromParam + dir * len;
    const verts = [];
    for (let i = 0; i < pts.length; i++) {
      for (const base of [cum[i] - L, cum[i], cum[i] + L]) {
        if (dir > 0 ? base > s0 && base < s1 : base < s0 && base > s1) verts.push(base);
      }
    }
    verts.sort((a, b) => dir * (a - b));
    for (const v of verts) { const p = ptAt(v); out.push({ X: p.X, Y: p.Y }); }
    const end = ptAt(s1);
    out.push({ X: end.X, Y: end.Y });
    return out;
  };
  const epOf = new Map(); // key li*2+end -> ep
  for (const e of eps) epOf.set(e.li * 2 + e.end, e);
  const visited = new Array(lines.length).fill(false);
  const result = [];
  const chainFrom = (li, enterEnd) => {
    // walk starting from line li entering at enterEnd
    const pl = [];
    let cur = li, inEnd = enterEnd;
    let first = true;
    while (cur !== undefined && !visited[cur]) {
      visited[cur] = true;
      const line = lines[cur];
      const seq = inEnd === 0 ? line : line.slice().reverse();
      if (first) {
        const inEp = epOf.get(cur * 2 + inEnd);
        if (inEp && inEp.anchor) {
          const anc = boundaryPath(inEp.ci, inEp.param, inEp.anchor.len, inEp.anchor.dir).reverse();
          for (const p of anc.slice(0, -1)) pl.push(p);
        }
        first = false;
      }
      for (const p of seq) pl.push(p);
      const outEnd = 1 - inEnd;
      const outEp = epOf.get(cur * 2 + outEnd);
      if (outEp && outEp.link) {
        const { other, arc } = outEp.link;
        // boundary path from outEp to other
        const dir = arc.fwdFrom === outEp ? 1 : -1;
        const bp = boundaryPath(outEp.ci, outEp.param, arc.len, dir);
        for (const p of bp.slice(1, -1)) pl.push(p);
        cur = other.li; inEnd = other.end;
      } else {
        if (outEp && outEp.anchor) {
          const anc = boundaryPath(outEp.ci, outEp.param, outEp.anchor.len, outEp.anchor.dir);
          for (const p of anc.slice(1)) pl.push(p);
        }
        cur = undefined;
      }
    }
    return pl;
  };
  // start chains at ends without link
  for (let li = 0; li < lines.length; li++) {
    if (visited[li]) continue;
    const e0 = epOf.get(li * 2), e1 = epOf.get(li * 2 + 1);
    const l0 = e0 && e0.link, l1 = e1 && e1.link;
    if (l0 && l1) continue; // middle of a chain
    const pl = chainFrom(li, l0 ? 1 : 0);
    if (pl.length >= 2) result.push(pl);
  }
  for (let li = 0; li < lines.length; li++) if (!visited[li]) { const pl = chainFrom(li, 0); if (pl.length >= 2) result.push(pl); }
  return result;
}

// ----------------------------------------------------------------------------------------
/** Concentric fill: loops at spacing intervals (solid spacing adjusted). Returns closed loops. */
export function fillConcentric(exs, { spacing }) {
  const sp = spacing * SCALE;
  const loops = [];
  let cur = offset(exs, -0.5 * sp, JT.miter);
  let guard = 0;
  while (cur.length && guard++ < 1000) {
    const ex = unionEx(cur);
    for (const e of ex) { loops.push(e.contour); for (const h of e.holes) loops.push(h); }
    cur = offset(ex, -sp, JT.miter);
  }
  return loops;
}
