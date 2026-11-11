// Polygon geometry helpers on top of ClipperLib 6.4.2 (same library generation as libslic3r).
// Coordinates are integers, 1 unit = 1/SCALE mm.
import ClipperLib from 'clipper-lib';

export const SCALE = 1e5;
export const sc = (mm) => Math.round(mm * SCALE);
export const unsc = (v) => v / SCALE;
export const SCALED_EPSILON = 10; // 0.1 micron
const C = ClipperLib;
const PT_SUBJ = C.PolyType.ptSubject, PT_CLIP = C.PolyType.ptClip;
const FT_NZ = C.PolyFillType.pftNonZero, FT_POS = C.PolyFillType.pftPositive, FT_EO = C.PolyFillType.pftEvenOdd;
export const JT = { miter: C.JoinType.jtMiter, round: C.JoinType.jtRound, square: C.JoinType.jtSquare };
const ET_CLOSED = C.EndType.etClosedPolygon;
const DEFAULT_MITER = 3;

// ---------- basic path ops ----------
export function area(p) {
  let a = 0;
  const n = p.length;
  for (let i = 0, j = n - 1; i < n; j = i++) a += (p[j].X + p[i].X) * (p[j].Y - p[i].Y);
  return -a * 0.5;
}
export const areaMm2 = (p) => area(p) / (SCALE * SCALE);
export function pathLength(p, closed = true) {
  let l = 0;
  for (let i = 1; i < p.length; i++) l += Math.hypot(p[i].X - p[i - 1].X, p[i].Y - p[i - 1].Y);
  if (closed && p.length > 1) l += Math.hypot(p[0].X - p[p.length - 1].X, p[0].Y - p[p.length - 1].Y);
  return l;
}
export function reversePath(p) { return p.slice().reverse(); }
export function bbox(paths) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of paths) for (const q of p) {
    if (q.X < minX) minX = q.X; if (q.X > maxX) maxX = q.X;
    if (q.Y < minY) minY = q.Y; if (q.Y > maxY) maxY = q.Y;
  }
  return { minX, minY, maxX, maxY };
}

// ---------- ExPolygon ----------
// { contour: Path (CCW, positive area), holes: [Path (CW)] }
export const exToPaths = (ex) => [ex.contour, ...ex.holes];
export const exsToPaths = (exs) => { const o = []; for (const e of exs) { o.push(e.contour); for (const h of e.holes) o.push(h); } return o; };
export const exArea = (ex) => { let a = area(ex.contour); for (const h of ex.holes) a += area(h); return a; };
export const exsArea = (exs) => exs.reduce((s, e) => s + exArea(e), 0);
export const exsAreaMm2 = (exs) => exsArea(exs) / (SCALE * SCALE);
export const pathsArea = (ps) => ps.reduce((s, p) => s + area(p), 0);

function polyTreeToExPolygons(tree) {
  const out = [];
  const addOuter = (node) => {
    const ex = { contour: node.Contour(), holes: [] };
    for (const h of node.Childs()) {
      ex.holes.push(h.Contour());
      for (const o of h.Childs()) addOuter(o);
    }
    out.push(ex);
  };
  for (const n of tree.Childs()) addOuter(n);
  return out;
}

function runClipper(type, subj, clip, fill = FT_NZ, asEx = false, subjFill = undefined) {
  const c = new C.Clipper();
  c.StrictlySimple = false;
  if (subj.length) c.AddPaths(subj, PT_SUBJ, true);
  if (clip && clip.length) c.AddPaths(clip, PT_CLIP, true);
  if (asEx) {
    const tree = new C.PolyTree();
    c.Execute(type, tree, subjFill ?? fill, fill);
    return polyTreeToExPolygons(tree);
  }
  const sol = [];
  c.Execute(type, sol, subjFill ?? fill, fill);
  return sol;
}

const toPaths = (x) => (x.length && x[0].contour ? exsToPaths(x) : x);

export const union = (a, b = []) => runClipper(C.ClipType.ctUnion, toPaths(a).concat(toPaths(b)), null, FT_NZ);
export const unionEx = (a, b = []) => runClipper(C.ClipType.ctUnion, toPaths(a).concat(toPaths(b)), null, FT_NZ, true);
export const unionPosEx = (a) => runClipper(C.ClipType.ctUnion, toPaths(a), null, FT_POS, true);
export const unionPos = (a) => runClipper(C.ClipType.ctUnion, toPaths(a), null, FT_POS);
export const diff = (a, b) => runClipper(C.ClipType.ctDifference, toPaths(a), toPaths(b), FT_NZ);
export const diffEx = (a, b) => runClipper(C.ClipType.ctDifference, toPaths(a), toPaths(b), FT_NZ, true);
export const intersection = (a, b) => runClipper(C.ClipType.ctIntersection, toPaths(a), toPaths(b), FT_NZ);
export const intersectionEx = (a, b) => runClipper(C.ClipType.ctIntersection, toPaths(a), toPaths(b), FT_NZ, true);
export const xorEx = (a, b) => runClipper(C.ClipType.ctXor, toPaths(a), toPaths(b), FT_NZ, true);

// Offsetting (ClipperOffset). Positive delta grows.
function rawOffset(paths, delta, join = JT.miter, miter = DEFAULT_MITER) {
  const co = new C.ClipperOffset(miter, 0.25 * SCALE * 0.005 /* arc tolerance ~1.25 micron */);
  co.ArcTolerance = Math.max(1, Math.abs(delta) * 0.005);
  co.AddPaths(paths, join, ET_CLOSED);
  const sol = [];
  co.Execute(sol, delta);
  return sol;
}
export function offset(x, delta, join = JT.miter, miter = DEFAULT_MITER) {
  const paths = toPaths(x);
  if (!paths.length) return [];
  if (delta === 0) return union(paths);
  return rawOffset(paths, delta, join, miter);
}
export function offsetEx(x, delta, join = JT.miter, miter = DEFAULT_MITER) {
  const r = offset(x, delta, join, miter);
  return r.length ? unionEx(r) : [];
}
export function offset2Ex(x, d1, d2, join = JT.miter, miter = DEFAULT_MITER) {
  return offsetEx(offset(x, d1, join, miter), d2, join, miter);
}
export function offset2(x, d1, d2, join = JT.miter, miter = DEFAULT_MITER) {
  return offset(offset(x, d1, join, miter), d2, join, miter);
}
export const openingEx = (x, d, join = JT.miter) => offset2Ex(x, -d, d, join);
export const closingEx = (x, d, join = JT.miter) => offset2Ex(x, d, -d, join);
export const opening = (x, d, join = JT.miter) => offset2(x, -d, d, join);
export const closing = (x, d, join = JT.miter) => offset2(x, d, -d, join);

// Offset each ExPolygon separately and keep expolygon structure.
export function shrinkEx(x, d, join = JT.miter) { return offsetEx(x, -d, join); }

// ---------- polylines ----------
/** Clip open polylines (arrays of points) by polygons. Returns polylines inside. */
export function clipPolylines(polylines, polygons, inside = true) {
  if (!polylines.length) return [];
  const clip = toPaths(polygons);
  if (!clip.length) return inside ? [] : polylines.map((p) => p.slice());
  const c = new C.Clipper();
  c.AddPaths(polylines, PT_SUBJ, false);
  c.AddPaths(clip, PT_CLIP, true);
  const tree = new C.PolyTree();
  c.Execute(inside ? C.ClipType.ctIntersection : C.ClipType.ctDifference, tree, FT_NZ, FT_NZ);
  return C.Clipper.OpenPathsFromPolyTree(tree);
}

export function polylineLength(p) {
  let l = 0;
  for (let i = 1; i < p.length; i++) l += Math.hypot(p[i].X - p[i - 1].X, p[i].Y - p[i - 1].Y);
  return l;
}

// Douglas-Peucker simplification of a closed polygon / open polyline.
export function simplifyPolyline(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = -1, idx = -1;
    const ax = pts[a].X, ay = pts[a].Y, bx = pts[b].X, by = pts[b].Y;
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      let d;
      const px = pts[i].X - ax, py = pts[i].Y - ay;
      if (l2 === 0) d = px * px + py * py;
      else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / l2));
        const qx = px - t * dx, qy = py - t * dy;
        d = qx * qx + qy * qy;
      }
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol2) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}
export function simplifyPolygon(poly, tol) {
  if (poly.length < 4) return poly.slice();
  // split at the farthest point from the first to make DP on closed loops stable
  let far = 0, fd = -1;
  for (let i = 1; i < poly.length; i++) {
    const d = (poly[i].X - poly[0].X) ** 2 + (poly[i].Y - poly[0].Y) ** 2;
    if (d > fd) { fd = d; far = i; }
  }
  const a = simplifyPolyline(poly.slice(0, far + 1), tol);
  const b = simplifyPolyline(poly.slice(far).concat([poly[0]]), tol);
  const out = a.slice(0, -1).concat(b.slice(0, -1));
  return out.length >= 3 ? out : poly.slice();
}
export function simplifyExs(exs, tol) {
  if (tol <= 0) return exs;
  const paths = [];
  for (const e of exs) {
    const c = simplifyPolygon(e.contour, tol);
    if (c.length >= 3 && Math.abs(area(c)) > 0) paths.push(c);
    for (const h of e.holes) { const hh = simplifyPolygon(h, tol); if (hh.length >= 3) paths.push(hh); }
  }
  return unionEx(paths);
}

export function pointInPolygon(pt, poly) {
  return C.Clipper.PointInPolygon(pt, poly) !== 0;
}
export function pointInExPolygon(pt, ex) {
  if (!pointInPolygon(pt, ex.contour)) return false;
  for (const h of ex.holes) if (C.Clipper.PointInPolygon(pt, h) === 1) return false;
  return true;
}

export function dist(a, b) { return Math.hypot(a.X - b.X, a.Y - b.Y); }

export function rotatePoints(pts, angle, cx = 0, cy = 0) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return pts.map((p) => ({ X: Math.round(cx + (p.X - cx) * c - (p.Y - cy) * s), Y: Math.round(cy + (p.X - cx) * s + (p.Y - cy) * c) }));
}

export function circle(cx, cy, r, n = 32) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; pts.push({ X: Math.round(cx + r * Math.cos(a)), Y: Math.round(cy + r * Math.sin(a)) }); }
  return pts;
}

export { ClipperLib };
