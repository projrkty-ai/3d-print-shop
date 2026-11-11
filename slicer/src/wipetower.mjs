// Wipe tower ("type 2", derived from PrusaSlicer WipeTower as used by OrcaSlicer WipeTower2) for
// multi-tool printers. Produces per-layer tool-change blocks made of moves in tower coordinates.
import { toNum, toBool } from './config.mjs';
import { SCALE, offset, union, JT } from './geom.mjs';

const WT_EPSILON = 1e-3;
const EPSILON = 1e-4;
const Width_To_Nozzle_Ratio = 1.25;

const volumeToLength = (volume, lineWidth, layerHeight) => Math.max(0, volume / (layerHeight * (lineWidth - layerHeight * (1 - Math.PI / 4))));
const lengthToVolume = (length, lineWidth, layerHeight) => Math.max(0, length * layerHeight * (lineWidth - layerHeight * (1 - Math.PI / 4)));

function getWipeDepth(volume, layerHeight, pw, extraFlow, extraSpacing, width) {
  let len = volumeToLength(volume, pw, layerHeight) / extraFlow;
  len = Math.max(len, 0);
  return (Math.floor(len / width) + 1) * pw * extraSpacing;
}

class Writer {
  constructor(tower, layerHeight, pw) {
    this.t = tower; this.h = layerHeight; this.pw = pw;
    this.ops = []; this.x = 0; this.y = 0; this.f = 0; this.flow = 0; this.yShift = 0;
  }
  setPos(x, y) { this.x = x; this.y = y; this.ops.push({ t: 'pos', x, y: y + this.yShift }); return this; }
  travel(x, y, f) { if (f) this.f = f; this.x = x; this.y = y; this.ops.push({ t: 'travel', x, y: y + this.yShift, f: f || this.t.travelSpeed * 60 }); return this; }
  extrude(x, y, f, flowOverride) {
    if (f) this.f = f;
    const len = Math.hypot(x - this.x, y - this.y);
    const e = len * (flowOverride ?? this.flow);
    let feed = this.f;
    if (e > 0 && feed > 0 && this.t.maxESpeed > 0) {
      const eSpeed = e / ((len === 0 ? Math.abs(e) : len) / feed * 60);
      feed /= Math.max(1, eSpeed / this.t.maxESpeed);
    }
    this.x = x; this.y = y;
    if (len > 0 || e > 0) this.ops.push({ t: 'ext', x, y: y + this.yShift, e, f: feed, w: this.lineWidth || this.pw });
    return this;
  }
  polygon(pts, f) {
    if (!pts.length) return this;
    // start at the closest point
    let best = 0, bd = Infinity;
    pts.forEach((p, i) => { const d = Math.hypot(p[0] - this.x, p[1] - this.y); if (d < bd) { bd = d; best = i; } });
    this.travel(pts[best][0], pts[best][1]);
    for (let k = 1; k <= pts.length; k++) { const p = pts[(best + k) % pts.length]; this.extrude(p[0], p[1], f); }
    return this;
  }
  rectangle(x0, y0, w, h, f) {
    return this.polygon([[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]], f);
  }
  toolchange(from, to) { this.ops.push({ t: 'toolchange', from, to, x: this.x, y: this.y + this.yShift }); return this; }
  retract(e, f) { this.ops.push({ t: 'retract', e, f }); return this; }
}

export class WipeTower {
  /**
   * @param cfg PrintConfig
   * @param opts {x, y, extruders: list of used extruder ids (0-based), layerZs: [{z, h}], perLayerExtruders: [[ext...]]}
   */
  constructor(cfg, opts) {
    this.cfg = cfg;
    this.pos = { x: opts.x, y: opts.y };
    this.width = cfg.num('prime_tower_width');
    this.brimWidth = cfg.num('prime_tower_brim_width');
    this.semm = toBool(cfg.get('single_extruder_multi_material'));
    this.extraFlow = toNum(cfg.get('wipe_tower_extra_flow'), 1) || 1;
    const extraSp = toNum(cfg.get('wipe_tower_extra_spacing'), 1) || 1;
    this.extraSpacingWipe = extraSp * this.extraFlow;
    this.extraSpacingRamming = extraSp;
    this.bridging = cfg.num('wipe_tower_bridging') || 10;
    this.noSparse = toBool(cfg.get('wipe_tower_no_sparse_layers'));
    this.travelSpeed = cfg.num('travel_speed');
    this.infillSpeed = cfg.num('sparse_infill_speed');
    this.perimeterSpeed = cfg.num('inner_wall_speed');
    this.maxPurgeSpeed = cfg.num('wipe_tower_max_purge_speed') || 90;
    this.firstLayerSpeed = cfg.num('initial_layer_speed') || 30;
    this.wallType = String(cfg.get('wipe_tower_wall_type') || 'rectangle');
    this.ribWidth = cfg.num('wipe_tower_rib_width') || 8;
    this.extraRibLength = cfg.num('wipe_tower_extra_rib_length') || 0;
    const nExt = Math.max(cfg.nExtruders, opts.count || 0);
    this.filpar = [];
    // enable_filament_ramming gates ramming of single-extruder MM printers; multi-tool printers ram
    // when filament_multitool_ramming is set (this matched the reference data best).
    const enableRamming = this.semm ? toBool(cfg.get('enable_filament_ramming')) : true;
    this.extraLines = opts.extraLines || 0; // calibration: extra purge lines per tool change
    // nozzle cleaning dance observed in every tool change of Snapmaker U1 G-code (multi-tool)
    this.nozzleClean = opts.nozzleClean ?? !this.semm;
    this.stats = { purgeLines: 0, purgeLength: 0 };
    for (let i = 0; i < nExt; i++) {
      const fil = i; // filament i is printed by tool i
      const fd = cfg.filNum('filament_diameter', fil) || 1.75;
      const area = Math.PI / 4 * fd * fd;
      const maxVol = cfg.filNum('filament_max_volumetric_speed', fil);
      const nozzle = cfg.num('nozzle_diameter', i);
      const p = {
        area, nozzle,
        maxESpeed: maxVol > 0 ? maxVol / area : 0,
        minimalPurge: cfg.filNum('filament_minimal_purge_on_wipe_tower', fil) || 15,
        multitoolRamming: enableRamming && toBool(cfg.fil('filament_multitool_ramming', fil)),
        rammingLineWidthMult: 2, rammingStepMult: 1,
        rammingSpeed: [cfg.filNum('filament_multitool_ramming_flow', fil) || 10],
        rammingTime: (cfg.filNum('filament_multitool_ramming_volume', fil) || 10) / (cfg.filNum('filament_multitool_ramming_flow', fil) || 10),
      };
      this.filpar.push(p);
      // Prusa/Orca: the perimeter width follows the last configured extruder
      this.pw = nozzle * Width_To_Nozzle_Ratio;
    }
    this.filamentArea = this.filpar[0].area;
    this.plan = [];
    this.yShift = 0;
    this.firstLayerIdx = -1;
    this.leftToRight = true;
    this.currentTool = 0;
    this.numToolChanges = 0;
  }

  maxESpeedOf(tool) { return this.filpar[tool].maxESpeed; }

  // ---------------- planning
  planToolchange(z, h, oldTool, newTool, wipeVolume = 0) {
    if (!this.plan.length || this.plan[this.plan.length - 1].z + WT_EPSILON < z) this.plan.push({ z, h, toolChanges: [], depth: 0 });
    if (this.firstLayerIdx === -1 && (!this.noSparse || oldTool !== newTool || this.plan.length === 1)) this.firstLayerIdx = this.plan.length - 1;
    if (oldTool === newTool) return;
    const tc = { oldTool, newTool, wipeVolume, wipeVolumeTotal: wipeVolume };
    this.computeToolchangeDepth(tc, h);
    this.plan[this.plan.length - 1].toolChanges.push(tc);
  }

  /** WipeTower2::plan_toolchange depth computation for the current tower width. */
  computeToolchangeDepth(tc, h) {
    const pw = this.pw;
    const width = this.width - 3 * pw;
    const fp = this.filpar[tc.oldTool];
    let rammingDepth = 0, firstWipeLine = 0;
    if (this.semm || fp.multitoolRamming) {
      const vol = 0.25 * fp.rammingSpeed.reduce((a, b) => a + b, 0);
      const lengthToExtrude = volumeToLength(this.semm ? vol : fp.rammingSpeed[0] * fp.rammingTime, pw * fp.rammingLineWidthMult, h);
      rammingDepth = (Math.floor(lengthToExtrude / width) + 1) * (pw * fp.rammingLineWidthMult * fp.rammingStepMult) * this.extraSpacingRamming;
      firstWipeLine = -(width * ((lengthToExtrude / width) - Math.floor(lengthToExtrude / width)) - width);
    }
    const firstWipeVolume = lengthToVolume(firstWipeLine, pw * this.extraFlow, h);
    const wipingDepth = getWipeDepth(tc.wipeVolumeTotal - firstWipeVolume, h, pw, this.extraFlow, this.extraSpacingWipe, width);
    Object.assign(tc, { requiredDepth: rammingDepth + wipingDepth, rammingDepth, firstWipeLine, wipeVolume: tc.wipeVolumeTotal });
  }

  toolchangesDepth(layer) { return layer.toolChanges.reduce((s, t) => s + t.requiredDepth, 0); }

  planTower() {
    this.depth = 0;
    for (const l of this.plan) l.depth = 0;
    this.height = this.plan.length ? this.plan[this.plan.length - 1].z : 0;
    for (let li = this.plan.length - 1; li >= 0; li--) {
      const thisDepth = Math.max(this.plan[li].depth, this.toolchangesDepth(this.plan[li]));
      this.plan[li].depth = thisDepth;
      if (thisDepth > this.depth - this.pw) this.depth = thisDepth + this.pw;
      for (let i = li - 1; i >= 0; i--) if (this.plan[i].depth - thisDepth < 2 * this.pw) this.plan[i].depth = thisDepth;
    }
    // Orca (rib wall): the tower keeps its full depth on every layer (measured on Orca 2.3 output)
    if (this.wallType === 'rib' && this.depth > 0) for (const l of this.plan) l.depth = this.depth - this.pw;
  }

  saveOnLastWipe() {
    for (let li = 0; li < this.plan.length; li++) {
      const layer = this.plan[li];
      if (!layer.toolChanges.length) continue;
      const tc = layer.toolChanges[0];
      const width = this.width - 3 * this.pw;
      const finishLen = this.finishLayerLength(li);
      const volumeToSave = lengthToVolume(finishLen, this.pw, layer.h);
      const left = Math.max(this.filpar[tc.newTool].minimalPurge, tc.wipeVolumeTotal - volumeToSave);
      const need = Math.max(0, left - lengthToVolume(tc.firstWipeLine, this.pw * this.extraFlow, layer.h));
      const depthToWipe = getWipeDepth(need, layer.h, this.pw, this.extraFlow, this.extraSpacingWipe, width);
      tc.requiredDepth = tc.rammingDepth + depthToWipe;
      tc.wipeVolume = left;
    }
  }

  /** Extrusion length (in plane) of finish_layer for layer index li (dry run). */
  finishLayerLength(li) {
    const saved = { leftToRight: this.leftToRight };
    const w = this.finishLayer(li, true);
    this.leftToRight = saved.leftToRight;
    let len = 0;
    let x = null, y = null;
    for (const op of w.ops) {
      if (op.t === 'ext' && x !== null) len += Math.hypot(op.x - x, op.y - y);
      if (op.t === 'ext' || op.t === 'travel' || op.t === 'pos') { x = op.x; y = op.y; }
    }
    return len;
  }

  isFirstLayer(li) { return li === this.firstLayerIdx; }

  // ---------------- generation
  generate() {
    if (!this.plan.length) return [];
    this.planTower();
    for (let i = 0; i < 5; i++) { this.saveOnLastWipe(); this.planTower(); }
    if (this.wallType === 'rib' && this.depth > 0) {
      // Orca rib wall: the tower is made (roughly) square keeping its area, then re-planned
      // (measured on Orca 2.3 output: width = sqrt(prime_tower_width * tower depth))
      this.width = Math.sqrt(this.width * this.depth);
      for (const l of this.plan) for (const tc of l.toolChanges) this.computeToolchangeDepth(tc, l.h);
      this.planTower();
      for (let i = 0; i < 5; i++) { this.saveOnLastWipe(); this.planTower(); }
    }
    // Orca get_rib_offset(): with rib walls the configured position is the corner of the ribs'
    // bounding box, the tower box is shifted by the rib protrusion
    this.ribOffset = 0;
    if (this.wallType === 'rib' && this.plan.length) {
      const poly = this.outline(0, { x0: 0, y0: 0, x1: this.width, y1: this.plan[0].depth + this.pw });
      this.ribOffset = Math.max(0, ...poly.map(([x, y]) => Math.max(-x, -y)));
    }
    for (const l of this.plan) if (l.toolChanges.length) { this.currentTool = l.toolChanges[0].oldTool; break; }
    const result = [];
    this.depthTraversed = 0;
    for (let li = 0; li < this.plan.length; li++) {
      const layer = this.plan[li];
      this.layerIdx = li;
      this.depthTraversed = 0;
      this.yShift = layer.depth < this.depth - this.pw ? (this.depth - layer.depth - this.pw) / 2 : 0;
      const blocks = [];
      let finish = null;
      const idx = layer.toolChanges.length ? 0 : -1;
      if (idx === -1) finish = this.finishLayer(li, false);
      for (let i = 0; i < layer.toolChanges.length; i++) {
        blocks.push({ kind: 'toolchange', tool: layer.toolChanges[i].newTool, from: layer.toolChanges[i].oldTool, writer: this.toolChange(li, layer.toolChanges[i]) });
        if (i === idx) { const fw = this.finishLayer(li, false); blocks[i].finish = fw; }
      }
      if (!blocks.length) blocks.push({ kind: 'finish', tool: null, writer: finish });
      result.push({ z: layer.z, h: layer.h, blocks });
    }
    return result;
  }

  extrusionFlow(h) { return h * (this.pw - h * (1 - Math.PI / 4)) / this.filamentArea; }

  toolChange(li, tc) {
    const layer = this.plan[li];
    const pw = this.pw;
    const h = layer.h;
    const w = new Writer(this, h, pw);
    w.flow = this.extrusionFlow(h);
    w.yShift = this.yShift;
    this.maxESpeed = this.filpar[this.currentTool].maxESpeed;
    const cleaning = { x0: pw / 2, y0: pw / 2, x1: this.width - pw / 2, y1: pw / 2 + tc.requiredDepth + this.depthTraversed - 0.5 * pw };
    // ---- unload (ramming)
    const xl = cleaning.x0 + pw, xr = cleaning.x1 - pw;
    const fp = this.filpar[this.currentTool];
    const lineWidth = pw * fp.rammingLineWidthMult;
    const yStep = lineWidth * fp.rammingStepMult * this.extraSpacingRamming;
    const start = { x: xl, y: cleaning.y0 + this.depthTraversed + yStep / 2 };
    this.leftToRight = true;
    const doRamming = this.semm || fp.multitoolRamming;
    if (doRamming) {
      w.travel(start.x, start.y);
      const timeStep = fp.rammingTime;
      const vol = fp.rammingSpeed[0] * timeStep;
      const x = volumeToLength(vol, lineWidth, h);
      const e = vol / this.filamentArea;
      let remaining = xr - xl;
      let eDone = 0;
      // single ramming segment(s)
      let dist = Math.min(x - eDone, remaining);
      let doneX = 0;
      let lastFeed = 0;
      while (doneX < x - 1e-6) {
        dist = Math.min(x - doneX, remaining);
        const actualTime = (dist / x) * timeStep;
        w.lineWidth = lineWidth;
        lastFeed = dist / (actualTime / 60);
        w.extrude(w.x + (this.leftToRight ? 1 : -1) * dist, w.y, lastFeed, e / x);
        w.lineWidth = null;
        doneX += dist;
        remaining -= dist;
        if (remaining < WT_EPSILON) { w.extrude(w.x, w.y + yStep, null, 0); this.leftToRight = !this.leftToRight; remaining = xr - xl; }
      }
      // Orca/Snapmaker: the ramming line is completed to the end of the box at the ramming flow
      if (remaining > WT_EPSILON && remaining < xr - xl - WT_EPSILON) {
        w.lineWidth = lineWidth;
        w.extrude(w.x + (this.leftToRight ? 1 : -1) * remaining, w.y, lastFeed, e / x);
        w.lineWidth = null;
        remaining = 0;
      }
      const pos = { x: w.x, y: w.y + (yStep / this.extraSpacingRamming - pw) / 2 + pw };
      w.travel(pos.x, pos.y, 2400);
    } else {
      w.setPos(start.x, start.y + (yStep / this.extraSpacingRamming - pw) / 2 + pw);
    }
    // ---- change
    w.toolchange(this.currentTool, tc.newTool);
    this.currentTool = tc.newTool;
    this.maxESpeed = this.filpar[this.currentTool].maxESpeed;
    // ---- load (nothing for multi tool); step back
    w.travel(w.x, w.y - pw);
    // ---- wipe
    this.toolchangeWipe(w, li, cleaning, tc.wipeVolume);
    this.numToolChanges++;
    this.depthTraversed += tc.requiredDepth;
    return w;
  }

  toolchangeWipe(w, li, box, wipeVolume) {
    const pw = this.pw;
    const layer = this.plan[li];
    const first = this.isFirstLayer(li);
    const baseFlow = this.extrusionFlow(layer.h);
    w.flow = baseFlow * (first ? 1.18 : 1);
    const xl = box.x0, xr = box.x1;
    // WipeTower2::toolchange_Wipe(): wipe the ordered volume in zig-zag lines, speeding up line by line
    let baseLeft = volumeToLength(wipeVolume, pw, layer.h) / this.extraFlow;
    const dy = (first ? this.extraFlow : this.extraSpacingWipe) * pw;
    // calibration: additional purge lines (allowed to overflow the planned box)
    let extraLeft = first ? 0 : this.extraLines * (xr - xl - 0.75 * pw);
    // a negative calibration removes purge length instead (never below the minimal purge)
    if (extraLeft < 0) {
      const minLen = volumeToLength(this.filpar[this.currentTool].minimalPurge, pw, layer.h) / this.extraFlow;
      baseLeft = Math.max(Math.min(baseLeft, minLen), baseLeft + extraLeft);
      extraLeft = 0;
    }
    const target = first ? this.firstLayerSpeed * 60 : Math.min(this.maxPurgeSpeed * 60, this.infillSpeed * 60);
    let speed = 0.33 * target;
    if ((this.leftToRight ? xr - w.x : w.x - xl) < 2.5 * pw) {
      w.travel(this.leftToRight ? xr - pw : xl + pw, w.y + dy);
      this.leftToRight = !this.leftToRight;
    }
    for (let i = 0; i < 100000; i++) {
      if (i !== 0) {
        if (speed < 0.34 * target) speed = 0.375 * target;
        else if (speed < 0.377 * target) speed = 0.458 * target;
        else if (speed < 0.46 * target) speed = 0.875 * target;
        else speed = Math.min(target, speed + 50);
      }
      const x0 = w.x;
      if (i === 0 && this.nozzleClean) {
        // Snapmaker Orca (U1) multi-tool nozzle cleaning after the tool change: a 3 mm priming
        // stub, retract, a slow square-spiral wipe next to it, return and de-retract
        const d = this.leftToRight ? 1 : -1;
        const ys = w.y, xs = w.x;
        w.extrude(xs + 3 * d, ys, speed);
        w.retract(-1.5, 1800);
        w.travel(xs - 1.5 * d, ys, 600).travel(xs, ys, 240).travel(xs + 0.5 * d, ys, 600);
        let cx = xs + 0.5 * d, cy = ys;
        const steps = [[0, 0.5], [-1, 0], [0, -1], [1.5, 0], [0, 1.5], [-2, 0], [0, -2]];
        for (const [ax, ay] of steps) { cx += ax * d; cy += ay * d; w.travel(cx, cy, 600); }
        w.travel(xs + 3 * d, ys, speed);
        w.retract(1.5, 1800);
      }
      let xEnd = this.leftToRight ? xr - (i % 4 === 0 ? 0 : 1.5 * pw) : xl + (i % 4 === 1 ? 0 : 1.5 * pw);
      // a fractional extra line only extrudes the remaining extra length
      if (baseLeft <= 0 && extraLeft < Math.abs(xEnd - x0)) xEnd = x0 + Math.sign(xEnd - x0) * extraLeft;
      w.extrude(xEnd, w.y, speed);
      const traversed = Math.abs(w.x - x0);
      this.stats.purgeLines++;
      this.stats.purgeLength += traversed;
      const boxFull = w.y + EPSILON > box.y1 - 0.5 * pw;
      if (baseLeft > 0) {
        if (boxFull) { // Prusa: "in case next line would not fit"
          baseLeft = 0;
          if (extraLeft < WT_EPSILON) break;
        } else baseLeft -= traversed;
      } else extraLeft -= traversed;
      if (baseLeft < WT_EPSILON && extraLeft < WT_EPSILON) {
        w.travel(this.leftToRight ? xl + 1.5 * pw : xr - 1.5 * pw, w.y, 7200);
        break;
      }
      if (baseLeft < WT_EPSILON) baseLeft = 0;
      // stepping to the next line:
      w.extrude(w.x + (i % 4 === 0 ? -1 : i % 4 === 1 ? 1 : 0) * 1.5 * pw, w.y + dy);
      this.leftToRight = !this.leftToRight;
    }
    const layerPlan = this.plan[li];
    if (this.currentTool !== layerPlan.toolChanges[layerPlan.toolChanges.length - 1].newTool) this.leftToRight = !this.leftToRight;
    w.flow = baseFlow;
  }

  /** Outline polygon of the tower for a layer (rectangle or rib wall). */
  outline(li, box) {
    const { x0, y0, x1, y1 } = box;
    const rect = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    if (this.wallType !== 'rib') return rect;
    // BBS-style rib wall: union of the box and two diagonal ribs that shrink with height.
    const a = x1 - x0, b = y1 - y0;
    const diag = Math.hypot(a, b);
    const ribLen = diag + this.extraRibLength;
    const z = this.plan[li].z;
    let extra = Math.max(0, ribLen - diag) / 2;
    extra = Math.abs(this.height - z) / Math.max(this.height, 1e-6) * extra;
    const hw = this.ribWidth / 2;
    const rectAlong = (ax, ay, bx, by) => {
      const L = Math.hypot(bx - ax, by - ay);
      const ux = (bx - ax) / L, uy = (by - ay) / L;
      const sx = ax - ux * extra, sy = ay - uy * extra, ex = bx + ux * extra, ey = by + uy * extra;
      const nx = -uy * hw, ny = ux * hw;
      return [[sx + nx, sy + ny], [sx - nx, sy - ny], [ex - nx, ey - ny], [ex + nx, ey + ny]].map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }));
    };
    const r1 = rectAlong(x0, y0, x1, y1), r2 = rectAlong(x1, y0, x0, y1);
    const rr = rect.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }));
    const u = union([rr, fixOrient(r1), fixOrient(r2)]);
    if (!u.length) return rect;
    let best = u[0];
    for (const p of u) if (Math.abs(areaOf(p)) > Math.abs(areaOf(best))) best = p;
    return best.map((p) => [p.X / SCALE, p.Y / SCALE]);
  }

  finishLayer(li, dry) {
    const layer = this.plan[li];
    const pw = this.pw;
    const h = layer.h;
    const w = new Writer(this, h, pw);
    w.flow = this.extrusionFlow(h);
    w.yShift = this.yShift;
    this.maxESpeed = this.filpar[this.currentTool].maxESpeed;
    const first = this.isFirstLayer(li) || (this.numToolChanges <= 1 && this.noSparse);
    const feedrate = first ? Math.min(this.firstLayerSpeed * 60, 5400) : Math.min(60 * this.maxESpeed / w.flow, 5400);
    const tcDepth = this.toolchangesDepth(layer);
    const currentDepth = layer.depth - tcDepth;
    const fill = { x0: pw, y0: layer.depth - (currentDepth - pw), x1: this.width - pw, y1: layer.depth - (currentDepth - pw) + (currentDepth - pw) };
    w.setPos(this.leftToRight ? fill.x1 : fill.x0, fill.y1);
    if (fill.y1 - fill.y0 > pw - WT_EPSILON) w.rectangle(fill.x0, fill.y0, fill.x1 - fill.x0, fill.y1 - fill.y0, feedrate);
    if (w.x > fill.x0 + EPSILON) w.travel(fill.x0, w.y);
    if (w.y > fill.y0 + EPSILON) w.travel(w.x, fill.y0);
    const dy = fill.y1 - fill.y0 - pw;
    let left = fill.x0 + 2 * pw, right = fill.x1 - 2 * pw;
    if (dy > pw) {
      w.travel(fill.x0 + 2 * pw, fill.y0);
      if (first) {
        left -= pw; right += pw;
        let y = fill.y0 + pw;
        const n = Math.floor(dy / pw);
        const spacing = n > 1 ? (dy - pw) / (n - 1) : 0;
        for (let i = 0; i < n; i++) {
          w.extrude(w.x, y, feedrate).extrude(i % 2 ? left : right, y);
          y += spacing;
        }
        w.extrude(w.x, fill.y1);
      } else {
        w.extrude(fill.x0 + 2 * pw, fill.y1, feedrate);
        const n = 1 + Math.floor((right - left) / this.bridging);
        const dx = (right - left) / n;
        for (let i = 1; i <= n; i++) {
          const x = left + dx * i;
          w.travel(x, w.y);
          w.extrude(x, i % 2 ? fill.y0 : fill.y1);
        }
      }
    }
    // outer contour (always)
    const perFeed = first ? this.firstLayerSpeed * 60 : Math.min(this.maxPurgeSpeed * 60, this.perimeterSpeed * 60, 60 * this.maxESpeed / w.flow);
    const wtBox = { x0: 0, y0: 0, x1: this.width, y1: layer.depth + pw };
    // the volume saved on the last wipe is computed with the plain box (ribs excluded; fits Orca 2.3)
    const poly = dry ? [[0, 0], [this.width, 0], [this.width, layer.depth + pw], [0, layer.depth + pw]] : this.outline(li, wtBox);
    w.polygon(poly, perFeed);
    if (first && this.brimWidth > 0) {
      const spacing = pw - h * (1 - Math.PI / 4);
      const loops = Math.floor((this.brimWidth + spacing / 2) / spacing);
      let cur = [poly.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }))];
      if (areaOf(cur[0]) < 0) cur[0].reverse();
      for (let i = 0; i < loops; i++) {
        cur = offset(cur, spacing * SCALE, JT.miter);
        if (!cur.length) break;
        w.polygon(cur[0].map((p) => [p.X / SCALE, p.Y / SCALE]), perFeed);
      }
      this.brimReal = loops * spacing;
    }
    return w;
  }
}

function areaOf(p) { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j].X + p[i].X) * (p[j].Y - p[i].Y); return -a / 2; }
function fixOrient(p) { return areaOf(p) < 0 ? p.slice().reverse() : p; }
