// G-code generation (moves + optional text) feeding the time estimator and filament accounting.
import { toNum, toBool } from './config.mjs';
import { TimeEstimator } from './estimator.mjs';

const f3 = (v) => (Math.round(v * 1000) / 1000).toString();
const TYPE_NAMES = {
  external: 'Outer wall', perimeter: 'Inner wall', overhang: 'Overhang wall', sparse: 'Sparse infill', solid: 'Internal solid infill',
  top: 'Top surface', bottom: 'Bottom surface', bridge: 'Bridge', internalBridge: 'Internal Bridge', brim: 'Brim',
  support: 'Support', supportInterface: 'Support interface', tower: 'Prime tower', towerFinish: 'Prime tower', gapfill: 'Gap infill',
};
const f5 = (v) => (Math.round(v * 100000) / 100000).toString();

export function machineLimits(cfg, ext = 0) {
  const first = (k) => { const v = cfg.raw(k); return toNum(Array.isArray(v) ? v[0] : v); };
  return {
    maxFeed: [first('machine_max_speed_x'), first('machine_max_speed_y'), first('machine_max_speed_z'), first('machine_max_speed_e')],
    maxAcc: [first('machine_max_acceleration_x'), first('machine_max_acceleration_y'), first('machine_max_acceleration_z'), first('machine_max_acceleration_e')],
    maxJerk: [first('machine_max_jerk_x'), first('machine_max_jerk_y'), first('machine_max_jerk_z'), first('machine_max_jerk_e')],
    maxAccExtruding: first('machine_max_acceleration_extruding'),
    maxAccRetracting: first('machine_max_acceleration_retracting'),
    maxAccTravel: first('machine_max_acceleration_travel') || first('machine_max_acceleration_extruding'),
    minExtrudingRate: first('machine_min_extruding_rate') || 0,
    minTravelRate: first('machine_min_travel_rate') || 0,
    defaultAcc: cfg.num('default_acceleration') || 1500,
  };
}

/**
 * GCodeWriter-like state machine. Positions in mm (world).
 */
export class GCodeGen {
  constructor(cfg, opts = {}) {
    this.cfg = cfg;
    this.text = opts.emitText ? [] : null;
    this.est = new TimeEstimator(machineLimits(cfg));
    this.pos = { x: 0, y: 0, z: 0 };
    // Orca GCode::set_origin(): object instances are printed in their own coordinates shifted by origin
    this.origin = { x: 0, y: 0 };
    this.ext = -1;
    this.retracted = new Array(cfg.nExtruders).fill(0); // current retraction length per extruder
    this.lifted = 0;
    this.feed = 0;
    this.acc = null;
    this.layerZ = 0;
    this.usedVolume = new Array(cfg.nExtruders).fill(0); // mm3 of filament per extruder
    this.usedByRole = {};
    this.wipePath = null;
    this.lastRole = null;
    this.toolChanges = 0;
    this.flavor = String(cfg.get('gcode_flavor') || 'marlin');
    this.layer = null;
    this.firstLayer = true;
    this.stats = { retractions: 0, lifts: 0, travels: 0, travelLen: 0 };
    this.layerExtrusion = [];
    this.layerNominal = [];
  }

  // --------------------------------------------------------------- helpers
  e(k) { return Math.max(0, this.ext); }
  extNum(key) { return this.cfg.num(key, this.e()); }
  filArea() { const d = this.cfg.filNum('filament_diameter', this.filamentOfExt(this.e())) || 1.75; return Math.PI / 4 * d * d; }
  filamentOfExt(e) { return this.extToFil ? this.extToFil[e] ?? e : e; }
  line(s) { if (this.text) this.text.push(s); }
  tag(t) { this.est.setTag(t); }

  setAccel(a) {
    if (!(a > 0)) return;
    a = Math.round(a);
    if (this.acc === a) return;
    this.acc = a;
    if (this.flavor === 'klipper') { this.est.setKlipperAccel(a); this.line(`SET_VELOCITY_LIMIT ACCEL=${a}`); }
    else { this.est.setAcceleration(a); this.line(`M204 S${a}`); }
  }
  setTravelAccel(a) {
    if (!(a > 0)) return;
    a = Math.round(a);
    if (this.flavor === 'klipper') { if (this.acc !== a) { this.acc = a; this.est.setKlipperAccel(a); this.line(`SET_VELOCITY_LIMIT ACCEL=${a}`); } }
    else { this.est.setTravelAcceleration(a); }
  }

  rawMove(x, y, z, de, feedMmS, type) {
    const dx = x - this.pos.x, dy = y - this.pos.y, dz = z - this.pos.z;
    if (dx === 0 && dy === 0 && dz === 0 && de === 0) return;
    this.est.move([dx, dy, dz, de], feedMmS, type);
    // nominal (length / feedrate) time per layer, as CoolingBuffer measures layer times
    if (feedMmS > 0) {
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || Math.abs(de);
      const li = this.est.curLayer;
      this.layerNominal[li] = (this.layerNominal[li] || 0) + d / feedMmS;
    }
    if (this.text) {
      let s = 'G1';
      if (dx !== 0) s += ' X' + f3(x + this.origin.x);
      if (dy !== 0) s += ' Y' + f3(y + this.origin.y);
      if (dz !== 0) s += ' Z' + f3(z);
      if (de !== 0) s += ' E' + f5(de);
      const fm = Math.round(feedMmS * 60);
      if (fm !== this.feed) { s += ' F' + fm; this.feed = fm; }
      this.line(s);
    }
    this.pos = { x, y, z };
  }

  /** Change the coordinate origin keeping the physical position (Orca set_origin). */
  setOrigin(x = 0, y = 0) {
    const dx = this.origin.x - x, dy = this.origin.y - y;
    if (dx === 0 && dy === 0) return;
    this.pos = { x: this.pos.x + dx, y: this.pos.y + dy, z: this.pos.z };
    if (this.wipePath) this.wipePath = this.wipePath.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    this.origin = { x, y };
  }

  // --------------------------------------------------------------- retraction / lift
  retract(toolchange = false) {
    const e = this.e();
    const len = toolchange ? this.cfg.num('retract_length_toolchange', e) : this.cfg.num('retraction_length', e);
    const speed = this.cfg.num('retraction_speed', e);
    const need = len - this.retracted[e];
    if (need <= 1e-9 || !(speed > 0)) return false;
    // wipe while retracting
    const wipe = toBool(this.cfg.get('wipe', e)) && this.wipePath && this.wipePath.length >= 2;
    const wipeDist = this.cfg.num('wipe_distance', e) || 0;
    const beforeWipe = toNum(this.cfg.get('retract_before_wipe', e), 1) || 0; // fraction
    this.tag('retract');
    if (wipe && wipeDist > 0) {
      const pre = need * beforeWipe;
      if (pre > 0) { this.rawMove(this.pos.x, this.pos.y, this.pos.z, -pre, speed, 'retract'); }
      const rest = need - pre;
      const travelSpeed = this.cfg.num('travel_speed', e);
      const ws = toNum(this.cfg.get('wipe_speed'), travelSpeed) || travelSpeed * 0.8;
      // walk back along the wipe path
      let remaining = wipeDist;
      const pts = this.wipePath;
      const segs = [];
      let cur = { x: this.pos.x, y: this.pos.y };
      for (let i = pts.length - 2; i >= 0 && remaining > 1e-6; i--) {
        const p = pts[i];
        const L = Math.hypot(p.x - cur.x, p.y - cur.y);
        if (L <= 0) continue;
        const t = Math.min(1, remaining / L);
        const q = { x: cur.x + (p.x - cur.x) * t, y: cur.y + (p.y - cur.y) * t };
        segs.push({ q, L: L * t });
        remaining -= L * t;
        cur = q;
      }
      const tot = segs.reduce((s, g) => s + g.L, 0);
      if (tot > 0) {
        for (const g of segs) this.rawMove(g.q.x, g.q.y, this.pos.z, -rest * (g.L / tot), ws, 'extrude_wipe');
      } else if (rest > 0) this.rawMove(this.pos.x, this.pos.y, this.pos.z, -rest, speed, 'retract');
    } else {
      this.rawMove(this.pos.x, this.pos.y, this.pos.z, -need, speed, 'retract');
    }
    this.retracted[e] = len;
    this.wipePath = null;
    this.stats.retractions++;
    return true;
  }

  unretract() {
    const e = this.e();
    const r = this.retracted[e];
    if (r <= 1e-9) return;
    let speed = this.cfg.num('deretraction_speed', e);
    if (!(speed > 0)) speed = this.cfg.num('retraction_speed', e);
    this.tag('retract');
    this.rawMove(this.pos.x, this.pos.y, this.pos.z, r, speed, 'retract');
    this.retracted[e] = 0;
  }

  zSpeed() {
    const e = this.e();
    let v = this.cfg.num('travel_speed_z', e);
    if (!(v > 0)) v = this.cfg.num('travel_speed', e);
    return v;
  }

  lift(type = 'normal') {
    const e = this.e();
    const h = this.cfg.num('z_hop', e) || 0;
    if (h <= 0 || this.lifted > 0) return;
    const above = this.cfg.num('retract_lift_above', e) || 0;
    const below = this.cfg.num('retract_lift_below', e) || 0;
    if (this.layerZ < above - 1e-9) return;
    if (below > 0 && this.layerZ > below + 1e-9) return;
    this.lifted = h;
    this.liftType = type;
    this.stats.lifts++;
    if (type === 'normal') { this.tag('travel'); this.rawMove(this.pos.x, this.pos.y, this.layerZ + h, 0, this.zSpeed(), 'travel'); }
    // slope/spiral lift: the Z rise is merged into the following travel
    else if (type === 'spiral') this.pendingSpiral = true;
    else this.pendingSlope = true;
  }

  unlift() {
    if (this.lifted <= 0 && Math.abs(this.pos.z - this.layerZ) < 1e-9) return;
    this.lifted = 0;
    this.pendingSlope = false;
    this.pendingSpiral = false;
    if (Math.abs(this.pos.z - this.layerZ) > 1e-9) { this.tag('travel'); this.rawMove(this.pos.x, this.pos.y, this.layerZ, 0, this.zSpeed(), 'travel'); }
  }

  // --------------------------------------------------------------- travel
  /** Orca GCode::travel_to with needs_retraction logic (simplified). */
  travelTo(x, y, { role = null, insideInfill = false, force = false, tagName = 'travel' } = {}) {
    const e = this.e();
    const dist = Math.hypot(x - this.pos.x, y - this.pos.y);
    if (dist < 1e-6 && !force) return;
    const minTravel = this.cfg.num('retraction_minimum_travel', e) || 0;
    let needsRetract = dist >= minTravel;
    if (needsRetract && !force) {
      const lastIsExtPerim = this.lastRole === 'external';
      if (!lastIsExtPerim) {
        if (role && role !== 'external' && role !== 'perimeter' && insideInfill && toBool(this.cfg.get('reduce_infill_retraction'))) needsRetract = false;
        if ((role === 'support' || role === 'supportInterface') && this.supportIslandTravel) needsRetract = false;
      }
    }
    this.setTravelAccel(this.travelAccel());
    if (needsRetract) {
      this.retract(false);
      const enforce = String(this.cfg.get('retract_lift_enforce', e) || 'All Surfaces');
      const zt = String(this.cfg.get('z_hop_types', e) || 'Normal Lift');
      if (enforce === 'All Surfaces' || (enforce === 'Top Only' && this.onTop) || (enforce === 'Bottom Only' && this.firstLayer)) {
        const type = zt === 'Normal Lift' ? 'normal' : 'slope';
        this.lift(type);
      }
    }
    this.tag(tagName);
    const speed = this.travelSpeed();
    if (this.pendingSpiral && this.lifted > 0) {
      // Orca spiral lift (G2 Z.. I J, linearised into 23 chords by the Snapmaker flavour):
      // a full circle of radius hop / (2*pi*slope) ending at the start point, then the travel.
      const slope = (this.cfg.num('travel_slope', e) || 3) * Math.PI / 180;
      const r = this.lifted / (2 * Math.PI * slope);
      const dx = x - this.pos.x, dy = y - this.pos.y, L = Math.hypot(dx, dy) || 1;
      const cx = this.pos.x - dy / L * r, cy = this.pos.y + dx / L * r;
      const a0 = Math.atan2(this.pos.y - cy, this.pos.x - cx);
      const z0 = this.layerZ, x0 = this.pos.x, y0 = this.pos.y;
      const N = 23;
      for (let i = 1; i <= N; i++) {
        const a = a0 - (2 * Math.PI * i) / N; // clockwise
        const px = i === N ? x0 : cx + r * Math.cos(a), py = i === N ? y0 : cy + r * Math.sin(a);
        this.rawMove(px, py, z0 + this.lifted * i / N, 0, speed, 'travel');
      }
      this.rawMove(x, y, z0 + this.lifted, 0, speed, 'travel');
      this.pendingSpiral = false;
    } else if (this.pendingSlope && this.lifted > 0) {
      // Orca lazy lift: rise along the travel with the configured slope
      const slope = (this.cfg.num('travel_slope', e) || 3) * Math.PI / 180;
      const rampLen = this.lifted / Math.tan(slope);
      const L = Math.hypot(x - this.pos.x, y - this.pos.y);
      const targetZ = this.layerZ + this.lifted;
      if (L > rampLen && rampLen > 0) {
        const t = rampLen / L;
        this.rawMove(this.pos.x + (x - this.pos.x) * t, this.pos.y + (y - this.pos.y) * t, targetZ, 0, speed, 'travel');
        this.rawMove(x, y, targetZ, 0, speed, 'travel');
      } else {
        this.rawMove(x, y, this.layerZ + this.lifted * (rampLen > 0 ? L / rampLen : 1), 0, speed, 'travel');
      }
      this.pendingSlope = false;
    } else {
      this.rawMove(x, y, this.pos.z, 0, speed, 'travel');
    }
    this.stats.travels++;
    this.stats.travelLen += dist;
  }

  travelSpeed() {
    const v = this.cfg.num('travel_speed', this.e());
    if (this.firstLayer) { const f = toNum(this.cfg.get('initial_layer_travel_speed', this.e()), v); if (f > 0) return f; }
    return v;
  }
  travelAccel() {
    const a = this.cfg.num('travel_acceleration', this.e());
    if (this.firstLayer) {
      const v = this.cfg.get('initial_layer_travel_acceleration', this.e());
      const f = toNum(v, a);
      if (f > 0) return f;
    }
    return a;
  }

  // --------------------------------------------------------------- extrusion
  /** Extrude along points (array of {x,y}); mm3PerMm volumetric flow; speed mm/s. */
  extrude(points, mm3PerMm, speed, role, { closed = false, flowRatio = null } = {}) {
    const e = this.e();
    if (!points.length) return;
    const start = points[0];
    if (Math.hypot(start.x - this.pos.x, start.y - this.pos.y) > 1e-6 || this.lifted > 0 || this.retracted[e] > 0) {
      if (Math.hypot(start.x - this.pos.x, start.y - this.pos.y) > 1e-6) this.travelTo(start.x, start.y, { role });
      this.unlift();
      this.unretract();
    }
    const fr = flowRatio ?? this.flowRatio(e);
    const area = this.filArea();
    this.tag(role);
    if (this.text && this.lastTypeComment !== role) { this.line(`;TYPE:${TYPE_NAMES[role] || role}`); this.lastTypeComment = role; }
    const pts = closed ? points.concat([points[0]]) : points;
    let vol = 0;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      const L = Math.hypot(p.x - this.pos.x, p.y - this.pos.y);
      if (L <= 0) continue;
      const v = L * mm3PerMm * fr;
      vol += v;
      this.rawMove(p.x, p.y, this.pos.z, v / area, speed, 'extrude');
      // per-layer extrusion statistics for the cooling slowdown (CoolingBuffer)
      const li = this.est.curLayer;
      const le = this.layerExtrusion[li] || (this.layerExtrusion[li] = { len: 0, t: 0, ext: new Set() });
      le.len += L; le.t += L / speed; le.ext.add(e);
    }
    this.usedVolume[e] += vol;
    this.usedByRole[role] = (this.usedByRole[role] || 0) + vol;
    if (role === 'support' || role === 'supportInterface') { this.supportVolumeByExt = this.supportVolumeByExt || []; this.supportVolumeByExt[e] = (this.supportVolumeByExt[e] || 0) + vol; }
    this.wipePath = pts.map((p) => ({ x: p.x, y: p.y }));
    this.lastRole = role;
  }

  flowRatio(e) { return this.cfg.filNum('filament_flow_ratio', this.filamentOfExt(e)) || 1; }

  /** raw extrusion move with explicit E (filament mm) — used for the wipe tower. */
  extrudeRawE(x, y, eMm, speed, role = 'tower') {
    this.tag(role);
    if (this.text && this.lastTypeComment !== 'tower') { this.line(';TYPE:Prime tower'); this.lastTypeComment = 'tower'; }
    const e = this.e();
    this.rawMove(x, y, this.pos.z, eMm, speed, 'extrude');
    const vol = eMm * this.filArea();
    this.usedVolume[e] += vol;
    this.usedByRole[role] = (this.usedByRole[role] || 0) + vol;
  }

  dwell(t) { this.est.sync(t); }

  setLayerZ(z) { this.layerZ = z; }
}
