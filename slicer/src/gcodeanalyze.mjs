// Analyse an Orca/Bambu/Prusa G-code file: per-feature extrusion statistics and a time estimate
// of the file's moves with the same time estimator used by the slicer (for validation).
import { TimeEstimator } from './estimator.mjs';

const num = (v) => (v === undefined ? undefined : parseFloat(v));

/** Parse the "; key = value" config block that Orca appends to the G-code. */
export function parseGcodeConfig(text) {
  const cfg = {};
  const start = text.lastIndexOf('; CONFIG_BLOCK_START');
  if (start < 0) return cfg;
  const block = text.slice(start, text.indexOf('; CONFIG_BLOCK_END', start));
  for (const line of block.split('\n')) {
    const m = /^; ([A-Za-z0-9_]+) = (.*)$/.exec(line);
    if (m) cfg[m[1]] = m[2];
  }
  return cfg;
}

export function parseGcodeHeader(text) {
  const h = {};
  const grab = (re) => { const m = re.exec(text); return m ? m[1] : undefined; };
  h.estimated_time = grab(/; estimated printing time \(normal mode\) = ([^\n]+)/);
  h.total_filament_g = num(grab(/; total filament used \[g\] = ([0-9.]+)/));
  h.filament_g = (grab(/; filament used \[g\] = ([^\n]+)/) || '').split(',').map((s) => +s);
  h.filament_mm = (grab(/; filament used \[mm\] = ([^\n]+)/) || '').split(',').map((s) => +s);
  h.layers = num(grab(/; total layers count = ([0-9]+)/));
  h.filament_changes = num(grab(/; total filament change = ([0-9]+)/));
  return h;
}

export function timeStringToSeconds(s) {
  if (!s) return NaN;
  let t = 0;
  for (const [, v, u] of s.matchAll(/(\d+)\s*([dhms])/g)) t += (+v) * { d: 86400, h: 3600, m: 60, s: 1 }[u];
  return t;
}

const first = (v) => parseFloat(String(v).split(',')[0]);

/**
 * Analyse G-code text.
 * @param text G-code
 * @param opts { toolChangeTime, extraToolChangeTime, limits (override) }
 */
export function analyzeGcode(text, opts = {}) {
  const cfg = parseGcodeConfig(text);
  const header = parseGcodeHeader(text);
  const limits = opts.limits || {
    maxFeed: ['machine_max_speed_x', 'machine_max_speed_y', 'machine_max_speed_z', 'machine_max_speed_e'].map((k) => first(cfg[k] ?? 500)),
    maxAcc: ['machine_max_acceleration_x', 'machine_max_acceleration_y', 'machine_max_acceleration_z', 'machine_max_acceleration_e'].map((k) => first(cfg[k] ?? 5000)),
    maxJerk: ['machine_max_jerk_x', 'machine_max_jerk_y', 'machine_max_jerk_z', 'machine_max_jerk_e'].map((k) => first(cfg[k] ?? 10)),
    maxAccExtruding: first(cfg.machine_max_acceleration_extruding ?? 5000),
    maxAccRetracting: first(cfg.machine_max_acceleration_retracting ?? 5000),
    maxAccTravel: first(cfg.machine_max_acceleration_travel ?? cfg.machine_max_acceleration_extruding ?? 5000),
    minExtrudingRate: first(cfg.machine_min_extruding_rate ?? 0),
    minTravelRate: first(cfg.machine_min_travel_rate ?? 0),
    defaultAcc: first(cfg.default_acceleration ?? 1500),
  };
  const est = new TimeEstimator(limits);
  const toolChangeTime = opts.toolChangeTime ?? first(cfg.machine_tool_change_time ?? 0);
  const diam = (cfg.filament_diameter || '1.75').split(',').map(Number);
  const dens = (cfg.filament_density || '1.24').split(',').map(Number);
  const stats = { byType: {}, travels: 0, travelLen: 0, retractions: 0, toolChanges: 0, layers: 0, zMoves: 0, lines: 0 };
  let x = 0, y = 0, z = 0, eAbs = 0, relE = true, relXYZ = false, feed = 0, tool = 0, type = 'Custom';
  let layer = 0;
  const layerTimes = [];
  const byTypeTime = {};
  let seenLayer = false;
  const lines = text.split('\n');
  for (let raw of lines) {
    if (raw.startsWith(';TYPE:')) { type = raw.slice(6).trim(); est.setTag(type); continue; }
    if (raw.startsWith(';LAYER_CHANGE') || raw.startsWith('; CHANGE_LAYER')) { if (seenLayer) layer++; seenLayer = true; est.curLayer = layer; stats.layers++; continue; }
    const sc = raw.indexOf(';');
    const line = (sc >= 0 ? raw.slice(0, sc) : raw).trim();
    if (!line) continue;
    stats.lines++;
    const cmd = line.split(/\s+/)[0].toUpperCase();
    if (cmd === 'G1' || cmd === 'G0') {
      let nx = x, ny = y, nz = z, de = 0;
      for (const m of line.matchAll(/([XYZEF])(-?[0-9]*\.?[0-9]+)/g)) {
        const v = parseFloat(m[2]);
        switch (m[1]) {
          case 'X': nx = relXYZ ? x + v : v; break;
          case 'Y': ny = relXYZ ? y + v : v; break;
          case 'Z': nz = relXYZ ? z + v : v; break;
          case 'E': if (relE) de = v; else { de = v - eAbs; eAbs = v; } break;
          case 'F': feed = v / 60; break;
        }
      }
      const dx = nx - x, dy = ny - y, dz = nz - z;
      if (dx === 0 && dy === 0 && dz === 0 && de === 0) continue;
      const xy = Math.hypot(dx, dy);
      let mtype;
      if (de > 0 && (dx !== 0 || dy !== 0)) mtype = 'extrude';
      else if (de !== 0 && dx === 0 && dy === 0 && dz === 0) mtype = 'retract';
      else if (de < 0) mtype = 'wipe';
      else mtype = 'travel';
      est.move([dx, dy, dz, de], feed, mtype === 'travel' ? 'travel' : mtype === 'retract' ? 'retract' : 'extrude');
      if (mtype === 'extrude') {
        const s = stats.byType[type] || (stats.byType[type] = { length: 0, e: 0, volume: 0, grams: 0 });
        const area = Math.PI / 4 * (diam[tool] || diam[0]) ** 2;
        s.length += xy; s.e += de; s.volume += de * area; s.grams += de * area * (dens[tool] || dens[0]) / 1000;
      } else if (mtype === 'travel') {
        if (xy > 0) { stats.travels++; stats.travelLen += xy; }
        if (dz !== 0) stats.zMoves++;
      } else if (mtype === 'retract' && de < 0) stats.retractions++;
      x = nx; y = ny; z = nz;
      continue;
    }
    if (cmd === 'M73' && opts.m73) { const r = /R(\d+)/.exec(line); if (r) opts.m73.push({ R: +r[1], t: est.time, layer, type }); continue; }
    if (cmd === 'G90') { relXYZ = false; continue; }
    if (cmd === 'G91') { relXYZ = true; continue; }
    if (cmd === 'M82') { relE = false; continue; }
    if (cmd === 'M83') { relE = true; continue; }
    if (cmd === 'G92') { const m = /E(-?[0-9.]+)/.exec(line); if (m) eAbs = +m[1]; continue; }
    if (cmd === 'G4') { const s = /S([0-9.]+)/.exec(line), p = /P([0-9.]+)/.exec(line); est.sync((s ? +s[1] : 0) + (p ? +p[1] / 1000 : 0)); continue; }
    if (cmd === 'M204') { const m = /S([0-9.]+)/.exec(line); if (m) est.setAcceleration(+m[1]); const t = /T([0-9.]+)/.exec(line); if (t) est.setTravelAcceleration(+t[1]); continue; }
    if (cmd === 'SET_VELOCITY_LIMIT') {
      const a = /\sACCEL=([0-9.]+)/.exec(line); if (a) est.setKlipperAccel(+a[1]);
      const j = /SQUARE_CORNER_VELOCITY=([0-9.]+)/.exec(line); if (j) { limits.maxJerk[0] = limits.maxJerk[1] = +j[1]; }
      continue;
    }
    if (/^T\d+$/.test(cmd)) {
      const t = +cmd.slice(1);
      if (t !== tool) { stats.toolChanges++; est.sync(toolChangeTime + (opts.extraToolChangeTime || 0)); tool = t; }
      continue;
    }
  }
  const time = est.finish();
  let grams = 0;
  for (const s of Object.values(stats.byType)) grams += s.grams;
  return { cfg, header, stats, time, grams, timeByType: est.byTag, layerTimes: est.layerTimes };
}
