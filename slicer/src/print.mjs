// Print orchestration: objects, tool ordering, wipe tower, layer-by-layer G-code generation,
// custom G-code, time estimation and filament accounting.
import { toNum, toBool } from './config.mjs';
import { SCALE, exsToPaths, offset, offsetEx, JT, bbox, area } from './geom.mjs';
import { PrintObject } from './printobject.mjs';
import { WipeTower } from './wipetower.mjs';
import { GCodeGen } from './gcode.mjs';
import { evalTemplate } from './template.mjs';
import { computeAutoBrimWidth, makeBrim } from './brim.mjs';
import { generateSupport } from './support.mjs';
import { regionFlows } from './flow.mjs';


export class Print {
  constructor(model, cfg, opts = {}) {
    this.model = model;
    this.cfg = cfg;
    this.opts = opts;
    this.cal = { toolchange_extra_time: 0, tower_extra_lines: 0, support_time_factor: 1, support_weight_factor: 1, ...(opts.calibration || {}) };
    this.objects = model.objects.map((o, i) => new PrintObject(o, cfg, i));
    this.log = opts.log || (() => {});
    this.progress = opts.onProgress || (() => {});
  }

  process() {
    const t0 = Date.now();
    const n = this.objects.length;
    this.objects.forEach((o, i) => o.process((stage, f) => this.progress(stage, 0.7 * (i + f) / n)));
    this.log(`objects processed in ${Date.now() - t0} ms`);
    const t1 = Date.now();
    this.progress('support', 0.7);
    for (const o of this.objects) {
      let on = this.opts.support ?? toBool(o.cfg.get('enable_support'));
      if (o.overrides && o.overrides.enable_support !== undefined && this.opts.support === undefined) on = toBool(o.overrides.enable_support);
      if (toBool(o.cfg.get('spiral_mode'))) on = false;
      if (on) generateSupport(o, o.cfg);
    }
    this.log(`support generated in ${Date.now() - t1} ms`);
    this.progress('tower', 0.72);
    this.makeBrims();
    this.makeSkirt();
    this.toolOrdering();
    this.makeWipeTower();
    return this;
  }

  // ------------------------------------------------------------------ brim
  makeBrims() {
    const cfg = this.cfg;
    const type = String(cfg.get('brim_type') || 'auto_brim');
    for (const o of this.objects) {
      o.brim = [];
      if (type === 'no_brim' || !o.layers.length) continue;
      let width = cfg.num('brim_width') || 0;
      if (type === 'auto_brim') width = computeAutoBrimWidth(o, cfg);
      if (!(width > 0)) continue;
      o.brimWidth = width;
      o.brim = makeBrim(o, cfg, width);
    }
  }

  // ------------------------------------------------------------------ skirt
  makeSkirt() {
    const cfg = this.cfg;
    this.skirt = [];
    const loops = Math.round(cfg.num('skirt_loops') || 0);
    if (loops <= 0) return;
    const pts = [];
    for (const o of this.objects) {
      if (!o.layers.length) continue;
      const grow = (o.brimWidth || 0) + (cfg.num('brim_object_gap') || 0);
      for (const sh of o.instances) for (const p of offset(o.layers[0].lslices, grow * SCALE)) for (const q of p) pts.push({ X: q.X + Math.round(sh.x * SCALE), Y: q.Y + Math.round(sh.y * SCALE) });
    }
    if (pts.length < 3) return;
    const hull = convexHull(pts);
    const L0 = this.objects[0].layers[0];
    const fl = regionFlows(cfg, 0, L0.height, true).perimeter;
    const dist = cfg.num('skirt_distance') || 2;
    for (let i = 0; i < loops; i++) {
      for (const p of offset([hull], (dist + fl.spacing * (i + 0.5)) * SCALE, JT.round)) this.skirt.push({ role: 'brim', pts: p, closed: true, mm3: fl.mm3PerMm, width: fl.width, height: fl.height });
    }
    this.skirtHeight = Math.max(1, Math.round(cfg.num('skirt_height') || 1));
  }

  // ------------------------------------------------------------------ tool ordering
  toolOrdering() {
    // collect all print_z
    const zs = new Map();
    for (const o of this.objects) {
      for (const L of o.layers) {
        const key = Math.round(L.printZ * 1e5);
        if (!zs.has(key)) zs.set(key, { z: L.printZ, h: L.height, items: [], extruders: new Set() });
        const e = zs.get(key);
        e.h = Math.max(e.h, L.height);
        for (const shift of o.instances) e.items.push({ obj: o, layer: L, shift });
        for (const r of L.regions) if ((r.perimeters && r.perimeters.length) || (r.fills && r.fills.length)) e.extruders.add(r.ext);
        if (L.support && L.support.paths.length && !(L.regions.length)) e.extruders.add(o.extruder);
      }

    }
    const layers = [...zs.values()].sort((a, b) => a.z - b.z);
    // first layer order: extruders ordered by decreasing minimal island area (BBS generate_first_layer_tool_order)
    if (!layers.length) { this.layers = []; return; }
    const L0 = layers[0];
    const minArea = new Map();
    const w0 = toNum(this.cfg.get('initial_layer_line_width'), this.cfg.num('nozzle_diameter', 0)) || 0.5;
    for (const it of L0.items) {
      if (!it.layer) continue;
      for (const r of it.layer.regions) {
        for (const ex of r.slices) {
          if (!offsetEx([ex], -0.2 * w0 * SCALE).length) continue;
          const a = area(ex.contour);
          if (!minArea.has(r.ext) || a < minArea.get(r.ext)) minArea.set(r.ext, a);
        }
      }
    }
    let order0 = [...minArea.keys()].sort((a, b) => minArea.get(b) - minArea.get(a));
    for (const e of [...L0.extruders].sort((a, b) => a - b)) if (!order0.includes(e)) order0.push(e);
    order0 = order0.filter((e) => L0.extruders.has(e));
    L0.order = order0;
    let last = order0[order0.length - 1];
    for (let i = 1; i < layers.length; i++) {
      const ex = [...layers[i].extruders].sort((a, b) => a - b);
      if (!ex.length) { layers[i].order = [last]; continue; }
      const k = ex.indexOf(last);
      if (k > 0) { ex.splice(k, 1); ex.unshift(last); }
      layers[i].order = ex;
      last = ex[ex.length - 1];
    }
    this.layers = layers;
    this.allExtruders = [...new Set(layers.flatMap((l) => l.order))].sort((a, b) => a - b);
  }

  // ------------------------------------------------------------------ wipe tower
  makeWipeTower() {
    const cfg = this.cfg;
    this.tower = null;
    const enabled = toBool(cfg.get('enable_prime_tower'));
    if (!enabled || this.allExtruders.length < 2) return;
    // the tower position is stored per plate in the project (3MF); fall back to the config value
    const proj = this.model.projectConfig || {};
    const pick = (k) => toNum([].concat(proj[k] ?? cfg.raw(k))[0]);
    const x = pick('wipe_tower_x');
    const y = pick('wipe_tower_y');
    const wt = new WipeTower(cfg, { x, y, count: Math.max(...this.allExtruders) + 1, extraLines: this.cal.tower_extra_lines });
    // ToolOrdering::collect_extruder_statistics(prime_multi_material=true): the first printing
    // extruder is moved to the end of the list of all extruders.
    const firstPrinting = this.layers[0].order[0];
    const allEx = this.allExtruders.filter((e) => e !== firstPrinting).concat([firstPrinting]);
    let current = allEx[allEx.length - 1];
    // last layer with a tool change
    let lastTc = -1;
    {
      let cur = current;
      this.layers.forEach((L, i) => { for (const e of L.order) if (e !== cur) { lastTc = i; cur = e; } });
    }
    for (let i = 0; i <= lastTc; i++) {
      const L = this.layers[i];
      const first = i === 0;
      wt.planToolchange(L.z, L.h, current, current, 0);
      for (const e of L.order) {
        if ((first && e === allEx[allEx.length - 1]) || e !== current) {
          const vol = this.purgeVolume(current, e);
          wt.planToolchange(L.z, L.h, current, e, vol);
          current = e;
        }
      }
    }
    this.towerLayers = wt.generate();
    this.tower = wt;
    // map by z
    this.towerByZ = new Map();
    for (const tl of this.towerLayers) this.towerByZ.set(Math.round(tl.z * 1e5), tl);
  }

  purgeVolume(from, to) {
    const cfg = this.cfg;
    const semm = toBool(cfg.get('single_extruder_multi_material'));
    const minPurge = cfg.filNum('filament_minimal_purge_on_wipe_tower', to) || 15;
    if (semm) {
      const m = [].concat(cfg.raw('flush_volumes_matrix') || []).map(Number);
      const n = Math.round(Math.sqrt(m.length));
      let v = n ? m[from * n + to] : 0;
      const mult = toNum([].concat(cfg.raw('flush_multiplier') || [1])[0]) || 1;
      return Math.max(v * mult, minPurge);
    }
    // multi-tool printers: Orca purges prime_volume on the tower for each tool change
    const pv = cfg.num('prime_volume');
    return Math.max(pv > 0 ? pv : 0, minPurge);
  }

  // ------------------------------------------------------------------ G-code
  export(opts = {}) {
    const cfg = this.cfg;
    const gen = new GCodeGen(cfg, { emitText: !!opts.gcode });
    this.gen = gen;
    const nExt = cfg.nExtruders;
    const firstLayerOrder = this.layers.length ? this.layers[0].order : [0];
    const initialExt = firstLayerOrder[0] ?? 0;
    const vars = this.templateVars({ initialExt });
    // ---- start gcode
    gen.tag('start');
    this.runCustomGcode(gen, cfg.get('machine_start_gcode') || '', { ...vars, layer_num: -1, layer_z: 0 }, { initial: true });
    if (gen.ext !== initialExt) { this.doToolChangeCommand(gen, initialExt); }
    const filStart = cfg.fil('filament_start_gcode', initialExt);
    if (filStart) this.runCustomGcode(gen, filStart, vars, {});
    this.printing = true;
    // ---- layers
    const towerOn = !!this.tower;
    let maxLayerZ = 0;
    for (let li = 0; li < this.layers.length; li++) {
      const L = this.layers[li];
      if (li % 8 === 0) this.progress('gcode', 0.75 + 0.25 * li / this.layers.length);
      gen.firstLayer = li === 0;
      gen.est.curLayer = li; // GCodeProcessor: moves before the first layer change count as layer 1
      maxLayerZ = L.z;
      // layer change
      gen.line(`;LAYER_CHANGE\n;Z:${+L.z.toFixed(3)}\n;HEIGHT:${+L.h.toFixed(3)}`);
      gen.lastTypeComment = null;
      gen.tag('layerchange');
      if (li > 0 && toBool(cfg.get('retract_when_changing_layer', gen.e()))) {
        gen.retract(false);
        // Orca forces a spiral lift at layer changes when z_hop_types is Auto Lift
        const zt = String(cfg.get('z_hop_types', gen.e()) || 'Normal Lift');
        gen.lift(zt === 'Normal Lift' ? 'normal' : zt === 'Slope Lift' ? 'slope' : 'spiral');
      }
      this.runCustomGcode(gen, cfg.get('before_layer_change_gcode') || '', { ...vars, layer_num: li, layer_z: L.z, max_layer_z: maxLayerZ }, {});
      gen.setLayerZ(L.z);
      this.runCustomGcode(gen, cfg.get('layer_change_gcode') || '', { ...vars, layer_num: li, layer_z: L.z, max_layer_z: maxLayerZ }, {});
      const tl = towerOn ? this.towerByZ.get(Math.round(L.z * 1e5)) : null;
      let tcIdx = 0;
      const order = L.order || [];
      // skirt (first layers, current tool)
      if (this.skirt && this.skirt.length && li < this.skirtHeight) {
        for (const p of orderPaths(this.skirt, gen.pos)) {
          gen.setAccel(this.accelFor(p, li === 0));
          gen.extrude(p.pts.map(toMM), p.mm3, li === 0 ? cfg.num('initial_layer_speed') : (cfg.num('skirt_speed') || cfg.num('initial_layer_speed')), 'brim', { closed: true });
        }
      }
      // sparse tower layer (no tool change): printed first
      if (tl && tl.blocks.length && tl.blocks[0].kind === 'finish') {
        this.printTowerBlock(gen, tl.blocks[0], L, li);
        tcIdx = 1;
      }
      for (let k = 0; k < order.length; k++) {
        const e = order[k];
        if (e !== gen.ext) {
          if (tl && tcIdx < tl.blocks.length && tl.blocks[tcIdx].kind === 'toolchange') {
            this.printTowerBlock(gen, tl.blocks[tcIdx], L, li, { maxLayerZ });
            tcIdx++;
          } else {
            this.toolChange(gen, e, L, li, maxLayerZ);
          }
        }
        // objects with this extruder
        this.printExtruderLayer(gen, L, e, li);
      }
    }
    // ---- end
    gen.retract(false);
    gen.tag('end');
    this.runCustomGcode(gen, cfg.fil('filament_end_gcode', gen.e()) || '', { ...vars, layer_num: this.layers.length - 1, max_layer_z: maxLayerZ }, {});
    this.runCustomGcode(gen, cfg.get('machine_end_gcode') || '', { ...vars, layer_num: this.layers.length - 1, max_layer_z: maxLayerZ }, {});
    this.printing = false;
    const time = gen.est.finish();
    return { gen, time };
  }

  templateVars({ initialExt }) {
    const cfg = this.cfg;
    const n = cfg.nExtruders;
    const arr = (k, fil = false) => Array.from({ length: n }, (_, i) => { const v = fil ? cfg.fil(k, i) : cfg.get(k, i); const x = toNum(v); return isNaN(x) ? v : x; });
    const bedType = String(cfg.get('curr_bed_type') || 'Textured PEI Plate');
    const bedKey = { 'High Temp Plate': 'hot_plate_temp', 'Textured PEI Plate': 'textured_plate_temp', 'Cool Plate': 'cool_plate_temp', 'Engineering Plate': 'eng_plate_temp' }[bedType] || 'hot_plate_temp';
    const used = new Set(this.allExtruders || [0]);
    return {
      initial_extruder: initialExt, initial_tool: initialExt, current_extruder: initialExt,
      nozzle_temperature: arr('nozzle_temperature', true), nozzle_temperature_initial_layer: arr('nozzle_temperature_initial_layer', true),
      temperature: arr('nozzle_temperature', true), first_layer_temperature: arr('nozzle_temperature_initial_layer', true),
      filament_type: Array.from({ length: n }, (_, i) => String(cfg.fil('filament_type', i) || 'PLA')),
      bed_temperature_initial_layer_single: toNum(cfg.fil(bedKey + '_initial_layer', initialExt)) || 60,
      bed_temperature: toNum(cfg.fil(bedKey, initialExt)) || 60,
      curr_bed_type: bedType, travel_speed: cfg.num('travel_speed'), print_sequence: String(cfg.get('print_sequence') || 'by layer'),
      max_print_height: cfg.num('printable_height'), z_offset: cfg.num('z_offset') || 0,
      total_layer_count: this.layers.length, min_vitrification_temperature: Math.min(...Array.from({ length: n }, (_, i) => toNum(cfg.fil('temperature_vitrification', i)) || 45)),
      is_extruder_used: Array.from({ length: n }, (_, i) => used.has(i)),
      nozzle_volume_type: Array.from({ length: n }, () => 0), filament_map: Array.from({ length: n }, (_, i) => i + 1),
      adaptive_bed_mesh_min: [0, 0], adaptive_bed_mesh_max: [0, 0], bed_mesh_probe_count: [3, 3], bed_mesh_algo: 'bicubic',
      outer_wall_volumetric_speed: 0, filament_max_volumetric_speed: arr('filament_max_volumetric_speed', true),
      position: [0, 0, 0],
      retract_length: arr('retraction_length'), retraction_length: arr('retraction_length'),
      filament_multitool_ramming: Array.from({ length: n }, (_, i) => toBool(cfg.fil('filament_multitool_ramming', i))),
      idle_temperature: Array.from({ length: n }, (_, i) => toNum(cfg.fil('idle_temperature', i)) || 0),
      standby_temperature_delta: cfg.num('standby_temperature_delta') || 0,
      first_layer_bed_temperature: Array.from({ length: n }, (_, i) => toNum(cfg.fil(bedKey + '_initial_layer', i)) || 60),
      e_retracted: Array.from({ length: n }, () => 0),
    };
  }

  /** Run custom G-code: template expansion + G-code interpretation for time and filament. */
  runCustomGcode(gen, src, vars, { initial = false } = {}) {
    if (!src) return { vars };
    const pos = [gen.pos.x, gen.pos.y, gen.pos.z];
    const r = evalTemplate(src, { ...vars, position: pos });
    this.interpretGcode(gen, r.text, { initial });
    return r;
  }

  interpretGcode(gen, text, { initial = false } = {}) {
    const lines = text.split('\n');
    const emitting = !!gen.text;
    const savedText = gen.text;
    if (gen.relXYZ === undefined) gen.relXYZ = false;
    if (gen.relE === undefined) gen.relE = true;
    for (let raw of lines) {
      if (emitting && raw.trim()) savedText.push(raw);
      const line = raw.replace(/;.*$/, '').trim();
      if (!line) continue;
      gen.text = null; // moves of custom G-code are already emitted verbatim
      try { this.interpretLine(gen, line); } finally { gen.text = savedText; }
    }
  }

  interpretLine(gen, line) {
    {
      const cmd = line.split(/\s+/)[0].toUpperCase();
      const params = {};
      for (const m of line.matchAll(/\s([XYZEFSPT])(-?[0-9]*\.?[0-9]+)/gi)) params[m[1].toUpperCase()] = parseFloat(m[2]);
      if (cmd === 'G90') { gen.relXYZ = false; return; }
      if (cmd === 'G91') { gen.relXYZ = true; return; }
      if (cmd === 'M82') { gen.relE = false; return; }
      if (cmd === 'M83') { gen.relE = true; return; }
      if (cmd === 'G92') { if (params.E !== undefined) gen.eAbsPos = params.E; return; }
      if (cmd === 'G0' || cmd === 'G1') {
        if (params.F) gen.customFeed = params.F / 60;
        const f = gen.customFeed || gen.cfg.num('travel_speed');
        let x = gen.pos.x, y = gen.pos.y, z = gen.pos.z;
        if (params.X !== undefined) x = gen.relXYZ ? x + params.X : params.X;
        if (params.Y !== undefined) y = gen.relXYZ ? y + params.Y : params.Y;
        if (params.Z !== undefined) z = gen.relXYZ ? z + params.Z : params.Z;
        let de = 0;
        if (params.E !== undefined) {
          if (gen.relE) de = params.E;
          else { de = params.E - (gen.eAbsPos || 0); gen.eAbsPos = params.E; }
        }
        const type = de !== 0 && (x !== gen.pos.x || y !== gen.pos.y || z !== gen.pos.z) ? 'extrude' : de !== 0 ? 'retract' : 'travel';
        gen.rawMove(x, y, z, de, f, type);
        if (de > 0 && type === 'extrude') {
          const vol = de * gen.filArea();
          gen.usedVolume[gen.e()] += vol;
          gen.usedByRole.custom = (gen.usedByRole.custom || 0) + vol;
        }
        return;
      }
      if (cmd === 'G4') { const t = (params.S || 0) + (params.P || 0) / 1000; if (t > 0) gen.dwell(t); return; }
      if (cmd === 'M204') { if (params.S) gen.setAccel(params.S); return; }
      if (/^T\d+$/.test(cmd)) { this.doToolChangeCommand(gen, parseInt(cmd.slice(1), 10)); return; }
      if (cmd === 'SET_VELOCITY_LIMIT') { const m = /ACCEL=([0-9.]+)/.exec(line); if (m) gen.setAccel(+m[1]); return; }
      if (cmd === 'G28') return;
    }
  }

  doToolChangeCommand(gen, e) {
    if (gen.ext === e) return;
    const cfg = this.cfg;
    const wasUnset = gen.ext < 0;
    gen.line && gen.line(`T${e}`);
    gen.ext = e;
    let extra = 0;
    // GCodeProcessor starts with extruder 0 selected: a first "T" to another tool counts as a change
    if (!(wasUnset && e === 0)) {
      extra += cfg.num('machine_tool_change_time') || 0;
      extra += cfg.num('machine_load_filament_time') || 0;
      extra += cfg.num('machine_unload_filament_time') || 0;
    }
    if (this.printing) {
      // calibrated extra time per tool change (Orca's estimate contains a per-change overhead that is
      // consistent with re-heating the parked tool; see calibration.json)
      extra += this.cal.toolchange_extra_time || 0;
      gen.toolChangesPrint = (gen.toolChangesPrint || 0) + 1;
    }
    gen.est.sync(extra);
    gen.toolChanges++;
  }

  /** Plain tool change (no wipe tower). */
  toolChange(gen, e, L, li, maxLayerZ) {
    const cfg = this.cfg;
    gen.tag('toolchange');
    gen.retract(true);
    gen.lift('normal');
    this.customToolchange(gen, e, li, maxLayerZ);
    gen.unlift();
  }

  customToolchange(gen, e, li, maxLayerZ) {
    const cfg = this.cfg;
    const src = cfg.get('change_filament_gcode') || '';
    const prev = gen.ext;
    const vars = { ...this.templateVars({ initialExt: this.layers[0].order[0] }), previous_extruder: prev, next_extruder: e, layer_num: li, layer_z: gen.layerZ, max_layer_z: maxLayerZ, toolchange_z: gen.layerZ };
    const filEnd = cfg.fil('filament_end_gcode', prev);
    if (filEnd) this.runCustomGcode(gen, filEnd, vars, {});
    let r = { vars: { position: [gen.pos.x, gen.pos.y, gen.pos.z] } };
    let changed = false;
    if (src) {
      const before = gen.toolChanges;
      r = this.runCustomGcode(gen, src, vars, {});
      changed = gen.ext === e;
    }
    if (gen.ext !== e) this.doToolChangeCommand(gen, e);
    const filStart = cfg.fil('filament_start_gcode', e);
    if (filStart) this.runCustomGcode(gen, filStart, vars, {});
    return r;
  }

  printTowerBlock(gen, block, L, li, { maxLayerZ = 0 } = {}) {
    const tw = this.tower;
    const ox = tw.pos.x + (tw.ribOffset || 0), oy = tw.pos.y + (tw.ribOffset || 0);
    const ops = block.writer.ops;
    const cfg = this.cfg;
    // travel to the tower start
    let first = ops.find((o) => o.t === 'travel' || o.t === 'ext' || o.t === 'pos');
    if (first) {
      gen.tag('travel');
      gen.travelTo(ox + first.x, oy + first.y, { role: 'tower', force: true });
      gen.unlift();
      gen.unretract();
    }
    const runOps = (ops2, tagName) => {
      for (const op of ops2) {
        if (op.t === 'pos') { continue; }
        if (op.t === 'travel') { gen.tag(tagName); gen.setTravelAccel(gen.travelAccel()); gen.rawMove(ox + op.x, oy + op.y, gen.pos.z, 0, op.f / 60, 'travel'); continue; }
        if (op.t === 'retract') { gen.tag(tagName); gen.rawMove(gen.pos.x, gen.pos.y, gen.pos.z, op.e, op.f / 60, 'retract'); continue; }
        if (op.t === 'ext') {
          gen.setAccel(this.towerAccel(gen));
          gen.extrudeRawE(ox + op.x, oy + op.y, op.e, op.f / 60, tagName);
          gen.wipePath = [{ x: gen.pos.x, y: gen.pos.y }];
          gen.lastRole = 'tower';
          continue;
        }
        if (op.t === 'toolchange') {
          gen.tag('toolchange');
          // GCode::set_extruder(): tool change retraction + lift, custom G-code, T, then back to the tower
          gen.retract(true);
          gen.lift('normal');
          const r = this.customToolchange(gen, op.to, li, maxLayerZ);
          // travel back to where the wipe tower thinks we are and lower to the layer
          gen.tag('toolchange');
          gen.rawMove(ox + op.x, oy + op.y, gen.pos.z, 0, cfg.num('travel_speed'), 'travel');
          gen.lifted = 0;
          if (Math.abs(gen.pos.z - gen.layerZ) > 1e-9) gen.rawMove(gen.pos.x, gen.pos.y, gen.layerZ, 0, gen.zSpeed(), 'travel');
          gen.unretract();
          gen.line('; CP TOOLCHANGE WIPE');
          continue;
        }
      }
    };
    if (block.kind === 'toolchange') gen.line('; CP TOOLCHANGE UNLOAD');
    runOps(ops, block.kind === 'finish' ? 'towerFinish' : 'tower');
    if (block.kind === 'toolchange') gen.line('; CP TOOLCHANGE END');
    if (block.finish) {
      const fops = block.finish.ops;
      const f0 = fops.find((o) => o.t === 'travel' || o.t === 'ext' || o.t === 'pos');
      if (f0) { gen.tag('towerFinish'); gen.rawMove(ox + f0.x, oy + f0.y, gen.pos.z, 0, cfg.num('travel_speed'), 'travel'); }
      runOps(fops, 'towerFinish');
    }
    gen.lastRole = 'tower';
  }

  towerAccel(gen) {
    const cfg = this.cfg;
    if (gen.firstLayer) return cfg.num('initial_layer_acceleration') || cfg.num('default_acceleration');
    return cfg.num('default_acceleration');
  }

  // ------------------------------------------------------------------ object extrusions
  printExtruderLayer(gen, L, e, li) {
    const items = L.items.filter((it) => (it.layer && it.layer.regions.some((r) => r.ext === e)) || (it.support && it.support.ext === e));
    // object ordering: nearest first
    const remaining = items.slice();
    while (remaining.length) {
      let bi = 0, bd = Infinity;
      remaining.forEach((it, i) => {
        const c = it.obj.center || (it.obj.center = objectCenter(it.obj));
        const sh = it.shift || { x: 0, y: 0 };
        const d = Math.hypot(c.x + sh.x - gen.pos.x, c.y + sh.y - gen.pos.y);
        if (d < bd) { bd = d; bi = i; }
      });
      const it = remaining.splice(bi, 1)[0];
      if (it.shift) gen.setOrigin(it.shift.x, it.shift.y);
      if (it.support) this.printSupportLayer(gen, it.obj, it.support, li);
      if (it.layer) this.printObjectLayer(gen, it.obj, it.layer, e, li);
      gen.setOrigin(0, 0);
    }
  }

  printSupportLayer(gen, obj, SL, li) {
    const islands = SL.islands || [];
    for (const p of orderPaths(SL.paths, gen.pos)) {
      const speed = this.speedFor(p, li === 0, gen.e(), obj.cfg);
      gen.setAccel(this.accelFor(p, li === 0, obj.cfg));
      // GCode::needs_retraction(): no retraction for travels inside one support island
      const s0 = toMM(p.pts[0]);
      const a = { X: Math.round(gen.pos.x * SCALE), Y: Math.round(gen.pos.y * SCALE) };
      gen.supportIslandTravel = islands.some((ex) => pointInEx(a, ex) && pointInEx(p.pts[0], ex)) && segInside(gen.pos, s0, islands);
      gen.extrude(p.pts.map(toMM), p.mm3, speed, p.role, { closed: p.closed });
      gen.supportIslandTravel = false;
    }
  }

  printObjectLayer(gen, obj, layer, e, li) {
    const first = li === 0;
    const regs = layer.regions.filter((r) => r.ext === e);
    // brim first on the first layer
    if (first && obj.brim && obj.brim.length && e === obj.extruder) {
      for (const p of orderPaths(obj.brim, gen.pos)) {
        gen.setAccel(this.accelFor(p, true, obj.cfg));
        gen.extrude(p.pts.map(toMM), p.mm3, this.speedFor(p, true, e, obj.cfg), 'brim', { closed: p.closed });
      }
    }
    // support of the object layer (if printed with this extruder)
    if (layer.support && layer.support.paths.length && layer.support.ext === e) this.printSupportLayer(gen, obj, layer.support, li);
    for (const reg of regs) {
      const internal = (reg.typed ? reg.typed.internal : []);
      const islands = reg.slices;
      // group paths by island
      const groups = islands.map(() => ({ per: [], fill: [] }));
      const islandOf = (p) => {
        if (p.island !== undefined) return p.island;
        const pt = p.pts[0];
        for (let i = 0; i < islands.length; i++) if (pointInEx(pt, islands[i])) return (p.island = i);
        return (p.island = nearestIsland(pt, islands));
      };
      for (const p of reg.perimeters) groups[islandOf(p)]?.per.push(p);
      for (const p of reg.fills) groups[islandOf(p)]?.fill.push(p);
      const isInternal = (a, b) => internal.length && segInside(a, b, internal);
      const order = orderIslands(groups, islands, gen.pos);
      for (const gi of order) {
        const g = groups[gi];
        // perimeters: inner first then outer for each loop set
        const per = orderPerimeters(g.per, gen.pos, String(obj.cfg.get('seam_position') || 'aligned'), String(obj.cfg.get('wall_sequence') || '').startsWith('outer'));
        for (const p of per) {
          const pts = p.pts; // start point chosen by orderPerimeters (seam)
          gen.setAccel(this.accelFor(p, first, obj.cfg));
          gen.extrude(pts.map(toMM), p.mm3, this.speedFor(p, first, e, obj.cfg), p.role === 'external' && p.overhang === 'bridge' ? 'overhang' : p.role, { closed: p.closed });
        }
        for (const p of orderPaths(g.fill, gen.pos)) {
          const start = p.closed ? rotateToNearest(p.pts, gen.pos) : p.pts;
          const s0 = toMM(start[0]);
          if (Math.hypot(s0.x - gen.pos.x, s0.y - gen.pos.y) > 1e-6) {
            gen.travelTo(s0.x, s0.y, { role: p.role, insideInfill: isInternal(gen.pos, s0) });
          }
          gen.setAccel(this.accelFor(p, first, obj.cfg));
          gen.extrude(start.map(toMM), p.mm3, this.speedFor(p, first, e, obj.cfg), p.role, { closed: p.closed });
        }
      }
    }
  }

  speedFor(p, first, e, cfg = this.cfg) {
    let s;
    const infillRoles = ['sparse', 'solid', 'top', 'bottom', 'bridge', 'internalBridge'];
    if (first) {
      s = infillRoles.includes(p.role) ? cfg.num('initial_layer_infill_speed', e) : cfg.num('initial_layer_speed', e);
    } else {
      switch (p.role) {
        case 'external': s = cfg.num('outer_wall_speed', e); break;
        case 'perimeter': s = cfg.num('inner_wall_speed', e); break;
        case 'sparse': s = cfg.num('sparse_infill_speed', e); break;
        case 'solid': s = cfg.num('internal_solid_infill_speed', e); break;
        case 'top': s = cfg.num('top_surface_speed', e); break;
        case 'bottom': s = cfg.num('internal_solid_infill_speed', e); break;
        case 'bridge': s = cfg.num('bridge_speed', e); break;
        case 'internalBridge': s = toNum(cfg.get('internal_bridge_speed', e), cfg.num('bridge_speed', e)); break;
        case 'support': s = cfg.num('support_speed', e); break;
        case 'supportInterface': s = toNum(cfg.get('support_interface_speed', e), cfg.num('support_speed', e)); break;
        case 'gapfill': s = cfg.num('gap_infill_speed', e); break;
        case 'brim': s = cfg.num('initial_layer_speed', e); break;
        default: s = cfg.num('outer_wall_speed', e);
      }
      if ((p.role === 'external' || p.role === 'perimeter') && p.overhang && toBool(cfg.get('enable_overhang_speed', e))) {
        if (p.overhang === 'bridge') s = cfg.num('bridge_speed', e);
        else {
          const key = ['', 'overhang_1_4_speed', 'overhang_2_4_speed', 'overhang_3_4_speed', 'overhang_4_4_speed'][Math.min(4, p.overhang)];
          const v = toNum(cfg.get(key, e), s);
          if (v > 0) s = v;
        }
      }
    }
    const maxVol = cfg.filNum('filament_max_volumetric_speed', e);
    // Orca limits by the real volumetric flow (flow ratio included in mm3_per_mm)
    const fr = cfg.filNum('filament_flow_ratio', e) || 1;
    if (maxVol > 0 && p.mm3 > 0) s = Math.min(s, maxVol / (p.mm3 * fr));
    return s;
  }

  accelFor(p, first, cfg = this.cfg) {
    const def = cfg.num('default_acceleration');
    if (first) return cfg.num('initial_layer_acceleration') || def;
    const rel = (k, base) => { const v = toNum(cfg.get(k), base); return v > 0 ? v : base; };
    switch (p.role) {
      case 'external': return p.overhang === 'bridge' ? rel('bridge_acceleration', rel('outer_wall_acceleration', def)) : rel('outer_wall_acceleration', def);
      case 'perimeter': return rel('inner_wall_acceleration', def);
      case 'top': return rel('top_surface_acceleration', def);
      case 'sparse': return rel('sparse_infill_acceleration', def);
      case 'solid': case 'bottom': return rel('internal_solid_infill_acceleration', def);
      case 'bridge': case 'internalBridge': return rel('bridge_acceleration', rel('outer_wall_acceleration', def));
      default: return def;
    }
  }

  // ------------------------------------------------------------------ results
  stats() {
    const gen = this.gen;
    const cfg = this.cfg;
    const supRoles = ['support', 'supportInterface'];
    // support factor per extruder: scale support volume
    const supVolByExt = gen.supportVolumeByExt || [];
    let grams = 0;
    const perExtruder = gen.usedVolume.map((v, e) => {
      const dens = cfg.filNum('filament_density', e) || 1.24;
      const vv = v + ((this.cal.support_weight_factor ?? 1) - 1) * (supVolByExt[e] || 0);
      const g = vv * dens / 1000;
      grams += g;
      const fd = cfg.filNum('filament_diameter', e) || 1.75;
      return { extruder: e + 1, volume_mm3: vv, grams: g, length_m: vv / (Math.PI / 4 * fd * fd) / 1000 };
    });
    const supTime = supRoles.reduce((s, k) => s + (gen.est.byTag[k] || 0), 0);
    let supportIslands = 0;
    for (const o of this.objects) for (const L of o.layers) if (L.support && L.support.islands) supportIslands += L.support.islands.length;
    // CoolingBuffer ("slow down for better layer cooling"): layers faster than
    // slow_down_layer_time are slowed down (extrusions only, not below slow_down_min_speed)
    let cooling = 0;
    gen.layerNominal.forEach((t, li) => {
      // CoolingBuffer compares the nominal layer time (length / feedrate of all moves)
      const le = gen.layerExtrusion[li];
      if (!le || !(t > 0)) return;
      let target = 0, vmin = Infinity;
      for (const e of le.ext) {
        if (!toBool(cfg.fil('slow_down_for_layer_cooling', e))) continue;
        target = Math.max(target, cfg.filNum('slow_down_layer_time', e) || 0);
        vmin = Math.min(vmin, cfg.filNum('slow_down_min_speed', e) || 10);
      }
      if (!(target > t)) return;
      const maxExtra = Math.max(0, le.len / vmin - le.t);
      cooling += Math.min(target - t, maxExtra);
    });
    this.coolingTime = cooling;
    const time = gen.est.time + cooling + ((this.cal.support_time_factor ?? 1) - 1) * supTime + (this.cal.support_island_time ?? 0) * supportIslands;
    this.supportIslands = supportIslands;
    return { grams, time, perExtruder, byRole: gen.usedByRole, timeByTag: gen.est.byTag, toolChanges: gen.toolChangesPrint || 0 };
  }
}

// ---------------------------------------------------------------------------------------------
const toMM = (p) => ({ x: p.X / SCALE, y: p.Y / SCALE });

function objectCenter(o) {
  const L = o.layers[0];
  if (!L) return { x: 0, y: 0 };
  const b = bbox(exsToPaths(L.lslices));
  return { x: (b.minX + b.maxX) / 2 / SCALE, y: (b.minY + b.maxY) / 2 / SCALE };
}

function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].X, yi = poly[i].Y, xj = poly[j].X, yj = poly[j].Y;
    if ((yi > pt.Y) !== (yj > pt.Y) && pt.X < ((xj - xi) * (pt.Y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function pointInEx(pt, ex) {
  if (!pointInPoly(pt, ex.contour)) return false;
  for (const h of ex.holes) if (pointInPoly(pt, h)) return false;
  return true;
}
function nearestIsland(pt, islands) {
  let best = 0, bd = Infinity;
  islands.forEach((ex, i) => { for (const q of ex.contour) { const d = (q.X - pt.X) ** 2 + (q.Y - pt.Y) ** 2; if (d < bd) { bd = d; best = i; } } });
  return best;
}
function segInside(a, b, exs) {
  const pts = [0, 0.25, 0.5, 0.75, 1].map((t) => ({ X: Math.round((a.x + (b.x - a.x) * t) * SCALE), Y: Math.round((a.y + (b.y - a.y) * t) * SCALE) }));
  return pts.every((p) => exs.some((ex) => pointInEx(p, ex)));
}

function startPointMM(p) { return toMM(p.pts[0]); }
function endPointMM(p) { return toMM(p.pts[p.closed ? 0 : p.pts.length - 1]); }

function orderIslands(groups, islands, pos) {
  const idx = groups.map((g, i) => i).filter((i) => groups[i].per.length || groups[i].fill.length);
  const out = [];
  let cur = pos;
  while (idx.length) {
    let bi = 0, bd = Infinity;
    idx.forEach((i, k) => {
      const c = islands[i].contour;
      for (let j = 0; j < c.length; j += Math.max(1, Math.floor(c.length / 16))) {
        const d = Math.hypot(c[j].X / SCALE - cur.x, c[j].Y / SCALE - cur.y);
        if (d < bd) { bd = d; bi = k; }
      }
    });
    const i = idx.splice(bi, 1)[0];
    out.push(i);
    const c = islands[i].contour[0];
    cur = { x: c.X / SCALE, y: c.Y / SCALE };
  }
  return out;
}

/**
 * Perimeter ordering (wall_sequence inner/outer): every outer loop is printed right after the
 * inner loops nested in it (Arachne region order), groups are chained nearest-first and loops
 * start at the seam (seam_position). Open thin walls follow.
 */
export function orderPerimeters(per, pos, seamMode = "aligned", outerFirst = false) {
  // loops split by the overhang classifier are regrouped into composite loops
  const comp = new Map();
  const closed = [];
  const open = [];
  for (const p of per) {
    if (p.closed) { closed.push(p); continue; }
    if (p.splitFrom) {
      let c = comp.get(p.splitFrom);
      if (!c) { c = { ...p.splitFrom, closed: true, pieces: [] }; comp.set(p.splitFrom, c); closed.push(c); }
      c.pieces.push(p);
      continue;
    }
    open.push(p);
  }
  const emit = (p, startPt) => {
    if (!p.pieces) return [p];
    // split the piece containing the vertex nearest to startPt and start there
    let k = 0, j = 0, bd = Infinity;
    p.pieces.forEach((q, i) => q.pts.forEach((a, jj) => { const d = (a.X / SCALE - startPt.x) ** 2 + (a.Y / SCALE - startPt.y) ** 2; if (d < bd) { bd = d; k = i; j = jj; } }));
    const pc = p.pieces[k];
    const head = pc.pts.slice(0, j + 1), tail = pc.pts.slice(j);
    const seq = [];
    if (tail.length >= 2) seq.push({ ...pc, pts: tail });
    for (let i = 1; i < p.pieces.length; i++) seq.push(p.pieces[(k + i) % p.pieces.length]);
    if (head.length >= 2) seq.push({ ...pc, pts: head });
    return seq;
  };
  const outers = closed.filter((p) => (p.loopIndex ?? 0) === 0);
  const groups = outers.map((o) => ({ outer: o, inner: [] }));
  const loose = [];
  for (const p of closed) {
    if ((p.loopIndex ?? 0) === 0) continue;
    if (!groups.length) { loose.push(p); continue; }
    const q = p.pts[0];
    let bi = 0, bd = Infinity;
    groups.forEach((g, i) => {
      const pts = g.outer.pts;
      const step = Math.max(1, Math.floor(pts.length / 64));
      for (let j = 0; j < pts.length; j += step) { const d = (pts[j].X - q.X) ** 2 + (pts[j].Y - q.Y) ** 2; if (d < bd) { bd = d; bi = i; } }
    });
    groups[bi].inner.push(p);
  }
  const out = [];
  let cur = pos;
  for (const g of groups) g.seam = seamIndex(g.outer.pts, seamMode, cur);
  const rem = groups.slice();
  while (rem.length) {
    let bi = 0, bd = Infinity;
    rem.forEach((g, i) => {
      const s = seamMode === 'nearest' ? nearestPt(g.outer.pts, cur) : g.outer.pts[g.seam];
      const d = Math.hypot(s.X / SCALE - cur.x, s.Y / SCALE - cur.y);
      if (d < bd) { bd = d; bi = i; }
    });
    const g = rem.splice(bi, 1)[0];
    const si = seamMode === 'nearest' ? nearestIdx(g.outer.pts, cur) : g.seam;
    const sp = g.outer.pts[si];
    const seamMM = { x: sp.X / SCALE, y: sp.Y / SCALE };
    const inner = g.inner.slice().sort((a, b) => (b.loopIndex ?? 0) - (a.loopIndex ?? 0));
    const outerLoop = g.outer.pieces ? emit(g.outer, seamMM) : [{ ...g.outer, pts: g.outer.pts.slice(si).concat(g.outer.pts.slice(0, si)) }];
    const innerLoops = inner.map((p) => (p.pieces ? emit(p, seamMM) : [{ ...p, pts: rotateToNearest(p.pts, seamMM) }]));
    const seq = outerFirst ? [outerLoop, ...innerLoops.reverse()] : [...innerLoops, outerLoop];
    for (const l of seq) for (const p of l) out.push(p);
    cur = seamMM;
  }
  for (const p of orderPaths(loose.concat(open), cur)) out.push(p);
  return out;
}

function nearestIdx(pts, pos) {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < pts.length; i++) { const d = (pts[i].X / SCALE - pos.x) ** 2 + (pts[i].Y / SCALE - pos.y) ** 2; if (d < bd) { bd = d; bi = i; } }
  return bi;
}
function nearestPt(pts, pos) { return pts[nearestIdx(pts, pos)]; }

/**
 * Seam vertex of a closed loop. "aligned"/"back"-like heuristics of Orca's SeamPlacer: prefer the
 * sharpest concave corner (hidden seam); on smooth loops use a fixed direction so that seams are
 * aligned from layer to layer (Orca places them consistently; the direction only affects travel
 * statistics).
 */
function seamIndex(pts, mode, pos) {
  const n = pts.length;
  if (n < 3) return 0;
  if (mode === 'nearest') return nearestIdx(pts, pos);
  if (mode === 'back') { let bi = 0; for (let i = 1; i < n; i++) if (pts[i].Y > pts[bi].Y) bi = i; return bi; }
  if (mode === 'random') {
    let h = 0;
    for (let i = 0; i < n; i += Math.max(1, n >> 3)) h = (h * 31 + (pts[i].X ^ pts[i].Y)) | 0;
    return Math.abs(h) % n;
  }
  // orientation sign: contours CCW (area > 0), holes CW
  let a2 = 0;
  for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a2 += p.X * q.Y - q.X * p.Y; }
  const orient = a2 >= 0 ? 1 : -1;
  let best = -1, bestAng = 0.6; // ~35 degrees minimal concavity
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n], c = pts[i], q = pts[(i + 1) % n];
    const ax = c.X - p.X, ay = c.Y - p.Y, bx = q.X - c.X, by = q.Y - c.Y;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 0.05 * SCALE || lb < 0.05 * SCALE) continue;
    const turn = Math.atan2(ax * by - ay * bx, ax * bx + ay * by) * orient; // >0 convex, <0 concave
    if (-turn > bestAng) { bestAng = -turn; best = i; }
  }
  if (best >= 0) return best;
  // smooth loop: extreme point in the front-right direction
  let bi = 0, bv = -Infinity;
  for (let i = 0; i < n; i++) { const v = pts[i].X - pts[i].Y; if (v > bv) { bv = v; bi = i; } }
  return bi;
}

/** Greedy nearest-neighbour ordering; open paths may be reversed; closed loops keep geometry. */
function orderPaths(paths, pos) {
  const rem = paths.slice();
  const out = [];
  let cur = pos;
  while (rem.length) {
    let bi = 0, bd = Infinity, rev = false;
    for (let i = 0; i < rem.length; i++) {
      const p = rem[i];
      if (p.closed) {
        // distance to nearest vertex (sampled)
        const n = p.pts.length;
        const step = Math.max(1, Math.floor(n / 24));
        for (let j = 0; j < n; j += step) { const d = Math.hypot(p.pts[j].X / SCALE - cur.x, p.pts[j].Y / SCALE - cur.y); if (d < bd) { bd = d; bi = i; rev = false; } }
      } else {
        const a = p.pts[0], b = p.pts[p.pts.length - 1];
        const da = Math.hypot(a.X / SCALE - cur.x, a.Y / SCALE - cur.y);
        const db = Math.hypot(b.X / SCALE - cur.x, b.Y / SCALE - cur.y);
        if (da < bd) { bd = da; bi = i; rev = false; }
        if (db < bd) { bd = db; bi = i; rev = true; }
      }
    }
    let p = rem.splice(bi, 1)[0];
    if (rev) p = { ...p, pts: p.pts.slice().reverse() };
    if (p.closed) p = { ...p, pts: rotateToNearest(p.pts, cur) };
    out.push(p);
    cur = endPointMM(p);
  }
  return out;
}

function rotateToNearest(pts, pos) {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < pts.length; i++) { const d = (pts[i].X / SCALE - pos.x) ** 2 + (pts[i].Y / SCALE - pos.y) ** 2; if (d < bd) { bd = d; bi = i; } }
  if (bi === 0) return pts;
  return pts.slice(bi).concat(pts.slice(0, bi));
}

function convexHull(points) {
  const p = points.map((q) => [q.X, q.Y]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1)).map(([X, Y]) => ({ X, Y }));
}
