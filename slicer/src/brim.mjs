// Brim generation incl. Bambu/Orca "auto brim" width heuristic (per first-layer island).
import { SCALE, offset, bbox, JT } from './geom.mjs';
import { regionFlows } from './flow.mjs';

function inertia(poly) {
  // second moments of area about the centroid (mm^4), poly in scaled units
  let A = 0, cx = 0, cy = 0, Ixx = 0, Iyy = 0;
  const n = poly.length;
  const pts = poly.map((p) => [p.X / SCALE, p.Y / SCALE]);
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % n];
    const c = x0 * y1 - x1 * y0;
    A += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
    Ixx += (y0 * y0 + y0 * y1 + y1 * y1) * c;
    Iyy += (x0 * x0 + x0 * x1 + x1 * x1) * c;
  }
  A /= 2;
  if (Math.abs(A) < 1e-12) return { A: 0, Ixx: 0, Iyy: 0 };
  cx /= 6 * A; cy /= 6 * A;
  Ixx = Ixx / 12 - A * cy * cy;
  Iyy = Iyy / 12 - A * cx * cx;
  return { A: Math.abs(A), Ixx: Math.abs(Ixx), Iyy: Math.abs(Iyy) };
}

export function computeAutoBrimWidth(obj, cfg) {
  const L0 = obj.layers[0];
  if (!L0) return 0;
  const height = obj.height;
  const e = obj.extruder;
  const speeds = ['inner_wall_speed', 'outer_wall_speed', 'sparse_infill_speed', 'internal_solid_infill_speed', 'top_surface_speed', 'support_speed', 'gap_infill_speed'].map((k) => cfg.num(k, e)).filter((v) => v > 0);
  const maxSpeed = speeds.length ? Math.max(...speeds) : 250;
  const type = String(cfg.fil('filament_type', e) || 'PLA');
  const adhesion = type === 'PETG' || type === 'PCTG' ? 2 : type === 'TPU' ? 0.5 : 1;
  let best = 0;
  for (const ex of L0.lslices) {
    const b = bbox([ex.contour]);
    const bx = (b.maxX - b.minX) / SCALE, by = (b.maxY - b.minY) / SCALE;
    const I = inertia(ex.contour);
    if (!(I.Ixx > 0 && I.Iyy > 0)) continue;
    const thermalLength = 0.5 * Math.hypot(bx, by);
    const heightToArea = Math.max(height / I.Ixx * by, height / I.Iyy * bx) * height / 1920;
    const thermalRef = type === 'ABS' ? 100 : type === 'PC' ? 40 : type === 'TPU' ? 1000 : 200;
    let w = adhesion * Math.min(Math.min(Math.max(heightToArea * maxSpeed, thermalLength * 8 / thermalRef * Math.min(height, 30) / 30), 18), 1.5 * thermalLength);
    if (w < 5 && w < 1.5 * thermalLength - 1e-9) w = 0;
    if (w > 18) w = 18;
    best = Math.max(best, w);
  }
  return best;
}

/** Brim loops around the first layer islands of an object. */
export function makeBrim(obj, cfg, width) {
  const L0 = obj.layers[0];
  const fl = regionFlows(cfg, obj.extruder, L0.height, true);
  const flow = fl.perimeter.withWidth(fl.perimeter.width);
  const spacing = flow.spacing;
  const gap = cfg.num('brim_object_gap') || 0;
  const n = Math.floor(width / spacing + 1e-9);
  const paths = [];
  const islands = L0.lslices;
  for (let i = n - 1; i >= 0; i--) {
    const loops = offset(islands, (gap + spacing * (i + 0.5)) * SCALE, JT.round);
    for (const p of loops) paths.push({ role: 'brim', pts: p, closed: true, mm3: flow.mm3PerMm, width: flow.width, height: flow.height });
  }
  return paths;
}
