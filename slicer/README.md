# PrintForge slicer estimator

Slices a 3MF/STL model with **OrcaSlicer profiles** (the JSON presets in [`../profiles`](../profiles))
and reports the **print time** and the **filament used** (grams, metres, per extruder). It is meant for
quoting/pricing: no OrcaSlicer installation is needed.

It re-implements the parts of the OrcaSlicer/libslic3r pipeline that determine time and material
(slicing, walls, shells, infill, supports, brim/skirt, multi-material painting, multi-tool wipe tower,
tool changes, custom G-code, travel/retraction/z-hop) and runs the moves through a port of Orca's
G-code time estimator. A small calibration file aligns the few parts of Orca's behaviour that cannot be
derived from the profiles with reference results (see *Accuracy* and *Calibration*).

The engine (`src/`) is **platform neutral**: the same code runs in Node.js (CLI, calibration tool,
backend use) and in browsers / Web Workers (the admin app's *Slicer test* tab, see
[`../frontend-admin`](../frontend-admin/README.md)). Only `src/node.mjs`, `src/parallel.mjs` and
`src/worker.mjs` use Node APIs.

## Quick start

Requires Node 20+ (tested with Node 22).

```bash
cd slicer
npm ci
node slice.mjs ../profiles/SliceTest.3mf --process "0.20 Standard @Snapmaker U1 (0.4 nozzle)"
node slice.mjs references/podstawa-painted/model.3mf                # settings saved in the 3MF project
node slice.mjs model.stl --process "0.40 Standard @Snapmaker U1 (0.8 nozzle)" --copies 9
```

On Windows use `node slice.mjs ..\profiles\SliceTest.3mf --process "..."`.

```
Model:     model.3mf
Printer:   Snapmaker U1 (0.4 nozzle)
Process:   0.20 Standard @Snapmaker U1 (0.4 nozzle)
Support:   disabled
Time:      1h28m  (5320 s)
Filament:  36.89 g  (12.37 m)
  extruder 1: 14.61 g, 4.90 m
  extruder 2: 21.32 g, 7.15 m
  extruder 3: 0.95 g, 0.32 m
Layers: 191 (first layer 196 s), tool changes: 115, copies: 1, calibration: profile
Weight breakdown (g): model 26.24, support 0, wipe tower 10.61, custom G-code 0.04
Time breakdown (min): model 39.0, support 0.0, wipe tower 25.9, tool changes 13.1, travel/retract 10.3
```

### Options

| Option | Meaning |
|---|---|
| `--printer <name>` | printer preset, e.g. `"Snapmaker U1 (0.4 nozzle)"` (its default process is used if `--process` is missing) |
| `--process <name>` | process preset; the printer is derived from the preset's `compatible_printers` when `--printer` is omitted |
| `--filament <name>` | filament preset (default: the preset made for the printer, else `Generic PLA @System`) |
| `--support` / `--no-support` | enable/disable supports (default: as configured) |
| `--set key=value` | override any Orca option, repeatable, e.g. `--set sparse_infill_density=25% --set wall_loops=3` |
| `--scale <factor\|%>` | slice the plate uniformly scaled, e.g. `0.5` or `150%` (default: original size); objects keep their arrangement around the plate centre and stay on the bed |
| `--copies <n>` | print n copies of the plate (grid arrangement around the bed centre) |
| `--copies-spacing <mm>` | gap between the copies (default 10 mm) |
| `--plate <n>` | plate of a multi-plate Bambu/Orca project (default 1) |
| `--profiles <dir>` | profile directory (default `../profiles`) |
| `--calibration <file>` / `--no-calibration` | use another calibration file / the raw physical model |
| `--gcode <file>` | also write the generated G-code (for inspection/visualisation) |
| `--json` | machine-readable output |
| `--list` | list the available presets |

Without `--printer`/`--process`, the settings embedded in the 3MF project (`Metadata/project_settings.config`)
are used, i.e. the project is sliced as it was saved in Orca.

### API

Node.js (file paths, profile directory and calibration file handled for you):

```js
import { estimateFile } from './slicer/src/node.mjs';

const r = estimateFile({
  model: 'order-123.3mf',                      // path to .3mf or .stl
  process: '0.20 Standard @Snapmaker U1 (0.4 nozzle)',
  support: true,
  copies: 2,                                   // optional
  scale: 1.5,                                  // optional, uniform scale (1 = original size)
  overrides: { sparse_infill_density: '20%' }, // optional
});
// r.time_s, r.time ("2h22m"), r.weight_g, r.filament_length_m, r.per_extruder[], r.tool_changes,
// r.layers, r.first_layer_time_s, r.copies, r.scale,
// r.breakdown.weight_g.{model,support,wipe_tower,custom_gcode}, r.breakdown.time_s.{...}
```

Platform neutral (browser, Web Worker, any JS runtime) — the caller provides the bytes, the presets and
the calibration object; types are in `src/index.d.mts`:

```js
import { estimate, loadModelBytes, ProfileLibrary } from './slicer/src/index.mjs';

const r = estimate({
  model: loadModelBytes(new Uint8Array(buffer), 'part.3mf'),
  library: new ProfileLibrary(presets),      // array of Orca preset JSON objects
  process: '0.20 Standard @Snapmaker U1 (0.4 nozzle)',
  calibration,                                // contents of data/calibration.json (or null)
  onProgress: (stage, fraction) => {},        // optional
  gcode: false,                               // true: r.gcode holds the generated G-code
});
```

`estimate()` is synchronous and CPU bound (1 s for a small part, 5–30 s for typical models, ~2 min for
a 0.1 mm painted multi-colour print); run it in a worker/child process (see `src/worker.mjs`,
`src/parallel.mjs`, or the admin app's Web Worker).

## Accuracy

`npm run verify` re-slices all reference prints listed in [`references/references.json`](references/references.json)
(33 OrcaSlicer 2.3 results: 4 models × 6 profiles, with/without supports) and compares them with Orca.
Orca displays truncated minutes (`1h28m` = 88:00–88:59), so time errors are measured against the middle
of the displayed minute.

| Reference | Content |
|---|---|
| `SliceTest` (`profiles/SliceTest.3mf`) | 5 objects, 4 colours (multi-part), 169–683 tool changes, supports |
| `podstawa-1` | single-colour round base with a star, 32 min – 3 h |
| `podstawa-9` | 9 copies of `podstawa-1` (instance positions from the Orca G-code), 5 h – 27 h |
| `podstawa-painted` | `podstawa-1` painted with 3 filaments (MMU segmentation), 58–227 tool changes |

Result with the calibration (`data/calibration.json`):

| Reference | Profile | Support | Time Orca | Time script | Error | Filament Orca | Filament script | Error |
|---|---|---|---|---|---|---|---|---|
| SliceTest | 0.10 Standard (0.2 nozzle) | no | 6h53m | 6h55m | +0.55% | 41.80 g | 41.84 g | +0.10% |
| SliceTest | 0.10 Standard (0.2 nozzle) | yes | 7h06m | 7h4m | -0.45% | 42.48 g | 42.21 g | -0.64% |
| SliceTest | 0.20 Standard (0.4 nozzle) | no | 2h16m | 2h16m | +0.17% | 37.48 g | 38.10 g | +1.65% |
| SliceTest | 0.20 Standard (0.4 nozzle) | yes | 2h22m | 2h21m | -1.05% | 38.35 g | 38.71 g | +0.94% |
| SliceTest | 0.20 Standard (0.4+0.6 nozzle) | no | 1h34m | 1h36m | +1.76% | 40.02 g | 39.52 g | -1.25% |
| SliceTest | 0.20 Standard (0.4+0.6 nozzle) | yes | 1h40m | 1h40m | -0.10% | 40.90 g | 40.11 g | -1.93% |
| SliceTest | 0.20 Standard (0.6 nozzle) | no | 2h06m | 2h7m | +1.17% | 40.80 g | 41.25 g | +1.10% |
| SliceTest | 0.20 Standard (0.6 nozzle) | yes | 2h11m | 2h11m | +0.10% | 41.98 g | 41.99 g | +0.02% |
| SliceTest | 0.30 Standard (0.6 nozzle) | no | 1h39m | 1h39m | +0.25% | 42.15 g | 42.31 g | +0.38% |
| SliceTest | 0.30 Standard (0.6 nozzle) | yes | 1h42m | 1h42m | -0.11% | 43.36 g | 43.10 g | -0.60% |
| SliceTest | 0.40 Standard (0.8 nozzle) | no | 1h24m | 1h24m | -0.08% | 46.44 g | 46.37 g | -0.15% |
| SliceTest | 0.40 Standard (0.8 nozzle) | yes | 1h26m | 1h26m | +0.13% | 47.46 g | 47.33 g | -0.27% |
| podstawa-1 | 0.10 Standard (0.2 nozzle) | no | 2h45m | 2h46m | +0.62% | 22.05 g | 22.11 g | +0.27% |
| podstawa-1 | 0.10 Standard (0.2 nozzle) | yes | 2h59m | 3h1m | +1.12% | 22.80 g | 22.92 g | +0.53% |
| podstawa-1 | 0.20 Standard (0.4 nozzle) | no | 37m | 37m | -0.83% | 23.41 g | 23.40 g | -0.04% |
| podstawa-1 | 0.20 Standard (0.4+0.6 nozzle) | no | 38m | 37m | -2.20% | 23.46 g | 23.35 g | -0.47% |
| podstawa-1 | 0.20 Standard (0.6 nozzle) | no | 34m | 34m | +1.15% | 25.09 g | 25.04 g | -0.20% |
| podstawa-1 | 0.30 Standard (0.6 nozzle) | no | 32m | 32m | -0.03% | 25.72 g | 25.67 g | -0.19% |
| podstawa-1 | 0.40 Standard (0.8 nozzle) | no | 35m | 35m | +0.12% | 29.73 g | 29.80 g | +0.24% |
| podstawa-9 | 0.10 Standard (0.2 nozzle) | no | 24h42m | 1d0h55m | +0.86% | 198.12 g | 198.61 g | +0.25% |
| podstawa-9 | 0.10 Standard (0.2 nozzle) | yes | 26h49m | 1d2h40m | -0.57% | 204.83 g | 205.94 g | +0.54% |
| podstawa-9 | 0.20 Standard (0.4 nozzle) | no | 5h33m | 5h30m | -1.04% | 210.31 g | 210.28 g | -0.01% |
| podstawa-9 | 0.20 Standard (0.4+0.6 nozzle) | no | 5h46m | 5h39m | -1.99% | 210.71 g | 209.68 g | -0.49% |
| podstawa-9 | 0.20 Standard (0.6 nozzle) | no | 5h04m | 5h6m | +0.68% | 225.48 g | 224.96 g | -0.23% |
| podstawa-9 | 0.30 Standard (0.6 nozzle) | no | 4h53m | 4h53m | -0.15% | 231.16 g | 230.63 g | -0.23% |
| podstawa-9 | 0.40 Standard (0.8 nozzle) | no | 5h15m | 5h15m | -0.04% | 267.18 g | 267.81 g | +0.24% |
| podstawa-painted | 0.10 Standard (0.2 nozzle) | no | 5h05m | 5h7m | +0.58% | 34.98 g | 35.41 g | +1.23% |
| podstawa-painted | 0.10 Standard (0.2 nozzle) | yes | 5h20m | 5h17m | -0.79% | 35.76 g | 35.93 g | +0.48% |
| podstawa-painted | 0.20 Standard (0.4 nozzle) | no | 1h28m | 1h27m | -0.83% | 36.84 g | 36.89 g | +0.14% |
| podstawa-painted | 0.20 Standard (0.4+0.6 nozzle) | no | 1h15m | 1h14m | -1.02% | 37.68 g | 38.26 g | +1.54% |
| podstawa-painted | 0.20 Standard (0.6 nozzle) | no | 1h21m | 1h21m | -0.55% | 40.00 g | 40.15 g | +0.37% |
| podstawa-painted | 0.30 Standard (0.6 nozzle) | no | 1h10m | 1h10m | -0.26% | 41.48 g | 41.78 g | +0.72% |
| podstawa-painted | 0.40 Standard (0.8 nozzle) | no | 1h08m | 1h8m | -0.07% | 47.69 g | 48.39 g | +1.47% |

Within ±1 %: time 24/33, filament 26/33; largest deviations: time 2.20 %, filament 1.93 %. With the global fallback values only (as used for presets without reference data): time ≤ 3.03 %, filament ≤ 1.68 %.

How to read it:

- Single-colour prints (`podstawa-1`, `podstawa-9`) do not use the tool-change calibration at all; they
  are a direct check of the physical model. The largest deviation is the `0.4+0.6 nozzle` printer
  (≈ −2 % time, see *Limitations*).
- The tool-change parameters are fitted per profile on `SliceTest` and `podstawa-painted` together
  (2 values for 4 numbers per profile); the residual shows how well one set of values fits both.
- The estimator itself was validated on Orca's own G-code files (same moves, same settings): it
  reproduces Orca's time within +0.03 % (painted, 0.4), +0.1 % (9 copies, 0.8), +0.45 % (single,
  0.4) and +0.96 % (painted with supports, 0.2 nozzle).
- The generated paths were compared feature by feature with the Orca G-code of `podstawa` (walls,
  sparse/solid infill, bridges, top/bottom, support, wipe tower, retractions): the main features agree
  within 1–4 %, the wipe tower within 1 %.

## How it works

Pipeline (`src/`), following OrcaSlicer/libslic3r where its behaviour is known:

1. **Input** (`model.mjs`, `zip.mjs`): 3MF (plain and Bambu/Orca projects: components, transforms,
   plates, per-object extruder and per-object setting overrides, **painting** `paint_color` /
   `slic3rpe:mmu_segmentation`, 3MF core colour `basematerials` mapped to filaments) or STL.
   Objects are dropped on the bed; copies/instances share one sliced object.
2. **Profiles** (`config.mjs`): system presets with `inherits` chains, printer + process + filament
   merge, per-extruder and per-extruder-variant values, Orca defaults (`orca_defaults.mjs`).
3. **Slicing** (`meshslice.mjs`, `printobject.mjs`): Orca's layer series, `slice_closing_radius`,
   elephant-foot compensation, Clipper 6.4.2 polygon maths (same library as libslic3r).
4. **Multi-material painting** (`paint.mjs`): decoding of the TriangleSelector bitstream, per-layer
   colour regions as a Voronoi partition by the nearest painted contour segment (raster distance
   transform), projection of painted top/bottom surfaces through the shell thickness; every colour
   region gets its own walls/infill/extruder.
5. **Walls**: Arachne-like walls (outer/inner spacing, variable-width filling of thin parts),
   inner/outer ordering per island, seams (aligned: concave corners first), `only_one_wall_top`,
   overhang classification in Orca's 4 degrees + bridge speed.
6. **Surfaces and infill** (`fill.mjs`): top/bottom detection, `ensure_vertical_shell_thickness`
   (libslic3r `discover_vertical_shells` incl. the "holes" rule and regularisation),
   `minimum_sparse_infill_area`, internal bridges, narrow solid areas as concentric fill,
   monotonic solid fill, Orca 2.3 CrossHatch (line pitch, transform-layer schedule and honeycomb
   geometry measured on Orca output) with `connect_infill` anchors.
7. **Support** (`support.mjs`): organic tree support approximation (threshold angle, z/xy distances,
   interface layers, avoidance areas with branch moves limited by the branch angle, merging, resting
   on the model when the bed cannot be reached, trunk brim).
8. **Brim / skirt** (`brim.mjs`): Bambu "auto brim" width rule, brim loops, skirt.
9. **Multi-tool** (`wipetower.mjs`, `print.mjs`): tool ordering, Orca's "type 2" wipe tower
   (PrusaSlicer WipeTower: purge planning, `prime_volume`, multi-tool ramming incl. completion of the
   ramming line, line-by-line speed ramp, "save on last wipe", square rib-wall tower of constant depth
   as in Orca 2.3, Snapmaker's nozzle-cleaning moves after each tool change, brim), tool-change
   G-code sequence.
10. **G-code generation** (`gcode.mjs`): speeds incl. first layer/overhangs/volumetric limit (flow
    ratio included, as Orca), per-feature accelerations (Klipper `SET_VELOCITY_LIMIT`), travel with
    Orca's retraction rules, wipe on retract, normal/lazy/spiral z-hop (spiral at layer changes),
    custom start/layer/tool-change/end G-code evaluated by a PlaceholderParser-compatible template
    engine (`template.mjs`).
11. **Time** (`estimator.mjs`): port of Orca's `GCodeProcessor` time machine (per-axis limits,
    jerk-limited junctions, trapezoids, look-ahead queue, `machine_tool_change_time`), plus the
    layer-cooling slowdown of layers faster than `slow_down_layer_time`.
    Filament = extruded volume × filament density.

`src/gcodeanalyze.mjs` runs the same estimator over an existing G-code file (per-feature lengths,
grams and times) — useful to compare the engine with Orca G-code.

## Calibration

Everything in `data/calibration.json` is fitted by `calibrate.mjs`; nothing else in the model is tuned.

| Parameter | Meaning | Fitted value |
|---|---|---|
| `toolchange_extra_time` | seconds added per tool change: Orca's estimate contains per-change time not explained by the simulated moves (the painted print has ~20 % more retractions/travels between colour regions than the simulation) | per profile |
| `tower_extra_lines` | wipe-tower purge lines added (or removed, when negative) per tool change | per profile |
| `support_island_time` | seconds per support island and layer (travel/retraction of separate branches) | global |
| `support_weight_factor` | multiplier on support material | global |

Profiles without reference data use the global fallback (mean tool-change time, purge lines linear in
`wipe_tower_extra_spacing`). Prints without tool changes only use the support parameters.

| Profile | `toolchange_extra_time` | `tower_extra_lines` |
|---|---|---|
| 0.10 Standard @Snapmaker U1 (0.2 nozzle) | 1.31 s | +0.69 |
| 0.20 Standard @Snapmaker U1 (0.4 nozzle) | 1.24 s | -0.56 |
| 0.20 Standard @Snapmaker U1 (0.4+0.6 nozzle) | 1.95 s | -0.89 |
| 0.20 Standard @Snapmaker U1 (0.6 nozzle) | 2.12 s | -0.67 |
| 0.30 Standard @Snapmaker U1 (0.6 nozzle) | 1.85 s | +0.47 |
| 0.40 Standard @Snapmaker U1 (0.8 nozzle) | 0.84 s | +0.35 |
| *global fallback* | 1.55 s | -0.71 +6.04·(extra_spacing−1) |

Support: `support_island_time` = 0.128 s, `support_weight_factor` = 1.215.

### Re-calibrating / adding references

```bash
node calibrate.mjs                 # fit + verify all references (~15 min on 4 cores)
npm run verify                     # verify only
```

A reference is a model plus a table in the format of `profiles/SliceTestTimes.txt`
(`<process preset> | <time without support> | <g without support> | <time with support> | <g with support>`),
listed in `references/references.json` with optional estimate options (e.g. `instances` for copies at
given positions, as used for `podstawa-9`). Add a model sliced in Orca with the profiles you use in
production and re-run `node calibrate.mjs`.

## Browser build (admin and storefront apps)

`npm run sync-frontend` copies the platform-neutral engine, a bundle of the presets
(`profiles.json`) and `data/calibration.json` into `../frontend-admin/src/slicer/engine/` and
`../frontend-client/src/slicer/engine/` (each app keeps its own copy; apps never import each other
at runtime; `--target <dir>` writes one other directory). The storefront slices customers' models
for their price estimates. Run it after changing the engine, the profiles or the calibration, then
run both apps' tests and builds.

## Limitations

- Not implemented: ironing, raft, adaptive/variable layer height, sequential ("by object") printing,
  fuzzy skin, modifiers/support enforcers/blockers, arc fitting. Infill patterns other than
  CrossHatch/rectilinear are approximated.
- Walls use an Arachne-like model, not Arachne itself; tree supports and the MMU segmentation are
  approximations (painted borders are computed on a 0.15 mm raster).
- Deviations seen in the reference data: the `0.4+0.6 nozzle` printer is ≈ 2 % fast on single-colour
  prints (no Orca G-code of this printer was available to find the cause); `SliceTest` with the
  0.2 mm-layer profiles deviates by up to ±2 % in filament (most likely the vertical-shell rings of its
  cone/sphere, which could not be checked without its G-code). A G-code file of these cases would allow
  fixing them.
- The layer-cooling slowdown (`slow_down_layer_time`, Orca's CoolingBuffer) is modelled as the missing
  nominal layer time; it only matters for small parts (e.g. +50 % on a 10 mm cube) and none of the
  reference prints exercises it.
- Single-extruder multi-material printers (AMS style) use the flush matrix on the wipe tower but were
  not verified; Bambu printers' purge chute is not modelled.
- The generated G-code is a faithful list of the simulated moves and custom G-code, meant for
  inspection in a G-code viewer, not for printing.

## Development

```bash
npm test                # unit tests (estimator, templates, profiles, slicing, painting, copies, a reference print)
npm run verify          # accuracy table against all references (~8 min)
npm run sync-frontend   # refresh the admin and storefront engine copies
```
