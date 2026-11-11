#!/usr/bin/env node
// Fit the calibration parameters against reference OrcaSlicer results and write data/calibration.json.
//
//   node calibrate.mjs [--references references/references.json] [--iterations 2] [--verify-only]
//
// The manifest lists reference models with tables of Orca times/weights (format of
// profiles/SliceTestTimes.txt) and optional estimate options (e.g. instance positions).
//
// Parameters (see src/calibration.mjs):
//   per profile: toolchange_extra_time [s]  time per tool change not covered by the physical model
//                tower_extra_lines    [-]  extra wipe-tower purge lines per tool change
//   global:      support_island_time  [s]  per support island and layer (travel/retract overhead)
//                support_weight_factor     multiplier on support material
// A global model (mean time per tool change, lines linear in wipe_tower_extra_spacing) is stored
// as the fallback for profiles without reference data.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runParallel } from './src/parallel.mjs';
import { loadProfileLibrary, DEFAULT_PROFILES_DIR, DEFAULT_CALIBRATION_FILE } from './src/node.mjs';
import { parseReferenceText } from './src/reference.mjs';
import { profileKey } from './src/calibration.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function args() {
  const a = { iterations: 2, concurrency: undefined };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '--references') a.references = v[++i];
    else if (v[i] === '--out') a.out = v[++i];
    else if (v[i] === '--profiles') a.profilesDir = v[++i];
    else if (v[i] === '--iterations') a.iterations = +v[++i];
    else if (v[i] === '--concurrency') a.concurrency = +v[++i];
    else if (v[i] === '--verify-only') a.verifyOnly = true;
    else { console.error(`Unknown argument ${v[i]}`); process.exit(2); }
  }
  a.references = path.resolve(a.references || path.join(HERE, 'references', 'references.json'));
  a.out = path.resolve(a.out || DEFAULT_CALIBRATION_FILE);
  a.profilesDir = path.resolve(a.profilesDir || DEFAULT_PROFILES_DIR);
  return a;
}

const fmt = (s) => `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
function linfit(xs, ys) {
  const mx = mean(xs), my = mean(ys);
  let sxx = 0, sxy = 0;
  for (let i = 0; i < xs.length; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  const b = sxx > 1e-12 ? sxy / sxx : 0;
  return { a: my - b * mx, b };
}
/** Orca truncates displayed minutes: the reference time lies in [t, t + resolution). */
const tRefOf = (row) => row.time_s + (row.time_resolution_s ?? 60) / 2;

function loadRows(manifestFile) {
  const man = JSON.parse(readFileSync(manifestFile, 'utf8'));
  const dir = path.dirname(manifestFile);
  const rows = [];
  for (const ref of man.references) {
    const table = parseReferenceText(readFileSync(path.resolve(dir, ref.table), 'utf8'));
    for (const r of table) rows.push({ ...r, ref: ref.name, model: path.resolve(dir, ref.model), options: ref.options || {} });
  }
  return rows;
}

async function main() {
  const a = args();
  const rows = loadRows(a.references);
  if (!rows.length) throw new Error(`No reference rows in ${a.references}`);
  const lib = loadProfileLibrary(a.profilesDir);
  const printerOf = (proc) => {
    const p = lib.resolve(proc);
    const printer = (p.compatible_printers || [])[0];
    if (!printer) throw new Error(`Cannot determine printer for ${proc}`);
    return printer;
  };
  for (const r of rows) { r.printer = printerOf(r.process); r.key = profileKey(r.printer, r.process); }
  const keys = [...new Set(rows.map((r) => r.key))];
  const job = (r, calibration) => ({ model: r.model, printer: r.printer, process: r.process, support: r.support, profilesDir: a.profilesDir, calibration, ...r.options });
  const log = (s) => process.stderr.write(s + '\n');
  const run = (cal) => runParallel(rows.map((r) => job(r, cal)), { concurrency: a.concurrency });

  let cal;
  if (!a.verifyOnly) {
    const par = Object.fromEntries(keys.map((k) => [k, { toolchange_extra_time: 0, tower_extra_lines: 0 }]));
    let g = { support_island_time: 0, support_weight_factor: 1 };
    for (let it = 0; it < a.iterations; it++) {
      const c = { version: 2, global: { support_time_factor: 1, ...g }, profiles: par };
      log(`iteration ${it + 1}/${a.iterations}: slicing ${rows.length} reference configurations...`);
      const res = await run(c);
      res.forEach((r, i) => { if (r.error) throw new Error(`${rows[i].ref} ${rows[i].process}: ${r.error}`); });
      // Linearised model around the current parameters:
      //   T = T0 + dTau * TC + dLines * TC * lineTime + dKappa * islands
      //   W = W0 + dLines * TC * lineWeight + dKw * supportWeight
      // 1) per profile (tau, lines) by least squares on relative errors of all its rows
      for (const k of keys) {
        let A = [[0, 0], [0, 0]], b = [0, 0];
        rows.forEach((row, i) => {
          if (row.key !== k) return;
          const r = res[i], d = r._diag, tc = r.tool_changes;
          if (!tc) return;
          const lt = d.tower_purge_lines ? d.tower_purge_time_s / d.tower_purge_lines : 0;
          const lw = d.tower_purge_lines ? d.tower_purge_weight_g / d.tower_purge_lines : 0;
          const tRef = tRefOf(row), wRef = row.weight_g;
          // time equation: (tc * dTau + tc*lt * dLines) / tRef = (tRef - T) / tRef
          const tRow = [tc / tRef, tc * lt / tRef], tY = (tRef - r.time_s) / tRef;
          // weight equation (weighted x2: weights are the more precise reference)
          const wRow = [0, 2 * tc * lw / wRef], wY = 2 * (wRef - r.weight_g) / wRef;
          for (const [rr, y] of [[tRow, tY], [wRow, wY]]) {
            for (let p = 0; p < 2; p++) { b[p] += rr[p] * y; for (let q = 0; q < 2; q++) A[p][q] += rr[p] * rr[q]; }
          }
        });
        const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
        if (Math.abs(det) < 1e-18) continue;
        const dTau = (b[0] * A[1][1] - b[1] * A[0][1]) / det;
        const dLines = (A[0][0] * b[1] - A[1][0] * b[0]) / det;
        par[k].toolchange_extra_time += dTau;
        par[k].tower_extra_lines += dLines;
      }
      // 2) global support parameters from the support rows (after the per-profile update)
      let sw1 = 0, sw2 = 0, k1 = 0, k2 = 0;
      rows.forEach((row, i) => {
        if (!row.support) return;
        const r = res[i], d = r._diag, tc = r.tool_changes;
        const lt = d.tower_purge_lines ? d.tower_purge_time_s / d.tower_purge_lines : 0;
        const lw = d.tower_purge_lines ? d.tower_purge_weight_g / d.tower_purge_lines : 0;
        const upd = (par[row.key] && tc) ? par[row.key] : null;
        const tPred = r.time_s + (upd ? tc * (upd.toolchange_extra_time - r.calibration.toolchange_extra_time) + tc * lt * (upd.tower_extra_lines - r.calibration.tower_extra_lines) : 0);
        const wPred = r.weight_g + (upd ? tc * lw * (upd.tower_extra_lines - r.calibration.tower_extra_lines) : 0);
        const S = d.support_weight_raw_g, I = d.support_islands;
        const tRef = tRefOf(row);
        sw1 += (row.weight_g - wPred) * S / row.weight_g ** 2; sw2 += S * S / row.weight_g ** 2;
        k1 += (tRef - tPred) * I / tRef ** 2; k2 += I * I / tRef ** 2;
      });
      if (sw2 > 0) g.support_weight_factor += sw1 / sw2;
      if (k2 > 0) g.support_island_time = Math.max(0, g.support_island_time + k1 / k2);
      for (const k of keys) log(`  ${k}: tau ${par[k].toolchange_extra_time.toFixed(3)} s, lines ${par[k].tower_extra_lines.toFixed(3)}`);
      log(`  support: island time ${g.support_island_time.toFixed(3)} s, weight factor ${g.support_weight_factor.toFixed(4)}`);
    }
    // global fallback model from the calibrated profiles
    const calibrated = keys.filter((k) => rows.some((r) => r.key === k && r.ref));
    const esOf = (k) => {
      const r = rows.find((x) => x.key === k);
      const proc = lib.resolve(r.process);
      return parseFloat(proc.wipe_tower_extra_spacing ?? '100%') / (String(proc.wipe_tower_extra_spacing ?? '100%').includes('%') ? 100 : 1) || 1;
    };
    const lf = linfit(calibrated.map(esOf), calibrated.map((k) => par[k].tower_extra_lines));
    cal = {
      version: 2,
      description: 'Calibration of the physical slicing model against OrcaSlicer reference results. Generated by calibrate.mjs.',
      reference: { manifest: path.relative(HERE, a.references), rows: rows.length, generated: new Date().toISOString() },
      global: {
        toolchange_extra_time: +mean(calibrated.map((k) => par[k].toolchange_extra_time)).toFixed(3),
        tower_extra_lines: { base: +(lf.a + lf.b).toFixed(4), per_extra_spacing: +lf.b.toFixed(4) },
        support_time_factor: 1,
        support_island_time: +g.support_island_time.toFixed(4),
        support_weight_factor: +g.support_weight_factor.toFixed(4),
      },
      profiles: Object.fromEntries(keys.map((k) => [k, {
        toolchange_extra_time: +par[k].toolchange_extra_time.toFixed(3),
        tower_extra_lines: +par[k].tower_extra_lines.toFixed(4),
      }])),
    };
    writeFileSync(a.out, JSON.stringify(cal, null, 2) + '\n');
    log(`wrote ${a.out}`);
  } else {
    cal = JSON.parse(readFileSync(a.out, 'utf8'));
  }
  // verification: profile-specific and global-only calibration
  log('verifying...');
  const globalOnly = { ...cal, profiles: {} };
  const [resP, resG] = [await run(cal), await run(globalOnly)];
  const table = (res, title) => {
    console.log(`\n${title}`);
    console.log('reference         profile                                       support  time (ref)          err    | weight (ref)            err');
    let maxT = 0, maxW = 0;
    rows.forEach((row, i) => {
      const r = res[i];
      if (r.error) { console.log(`${row.ref} ${row.process}: ${r.error}`); return; }
      const tMid = tRefOf(row);
      const tErr = (r.time_s - tMid) / tMid * 100, wErr = (r.weight_g - row.weight_g) / row.weight_g * 100;
      maxT = Math.max(maxT, Math.abs(tErr)); maxW = Math.max(maxW, Math.abs(wErr));
      console.log(`${row.ref.padEnd(17)} ${row.process.padEnd(46)} ${row.support ? 'yes' : 'no '}  ${r.time.padEnd(8)} (${fmt(row.time_s).padEnd(7)})  ${(tErr >= 0 ? '+' : '') + tErr.toFixed(2)}% | ${r.weight_g.toFixed(2).padStart(7)} g (${row.weight_g.toFixed(2).padStart(7)} g)  ${(wErr >= 0 ? '+' : '') + wErr.toFixed(2)}%`);
    });
    console.log(`max |error|: time ${maxT.toFixed(2)}%, weight ${maxW.toFixed(2)}%  (time against the middle of Orca's truncated minute)`);
  };
  table(resP, 'Calibrated (profile-specific values):');
  table(resG, 'Global calibration only (fallback for profiles without references):');
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
