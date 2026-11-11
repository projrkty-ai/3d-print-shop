#!/usr/bin/env node
// CLI: estimate print time and filament usage of a 3MF/STL model using OrcaSlicer profiles.
import { estimateFile, loadProfileLibrary, DEFAULT_PROFILES_DIR } from './src/node.mjs';

const HELP = `Usage: node slice.mjs <model.3mf|model.stl> [options]

Options:
  --printer <name>      printer preset, e.g. "Snapmaker U1 (0.4 nozzle)"
  --process <name>      process preset, e.g. "0.20 Standard @Snapmaker U1 (0.4 nozzle)"
                        (the printer is derived from the process when omitted)
  --filament <name>     filament preset (default: best match for the printer)
  --support | --no-support   enable/disable supports (default: as configured)
  --plate <n>           plate of a multi-plate 3MF (default 1)
  --profiles <dir>      profile directory (default: ${DEFAULT_PROFILES_DIR})
  --calibration <file>  calibration file (default: data/calibration.json)
  --no-calibration      use the raw physical model only
  --set <key=value>     override an Orca setting (repeatable), e.g. --set sparse_infill_density=25%
  --scale <factor|%>    scale the plate uniformly, e.g. 0.5 or 150% (default: original size)
  --copies <n>          print n copies of the plate (grid arrangement on the bed)
  --copies-spacing <mm> gap between the copies (default 10)
  --gcode <file>        also write the generated G-code
  --json                print the full result as JSON
  --list                list available printer/process presets
  -h, --help            this help

Without --printer/--process the settings embedded in the 3MF project are used.`;

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`Missing value for ${s}`); return argv[++i]; };
    switch (s) {
      case '--printer': a.printer = next(); break;
      case '--process': a.process = next(); break;
      case '--filament': a.filament = next(); break;
      case '--support': a.support = true; break;
      case '--no-support': a.support = false; break;
      case '--plate': a.plate = parseInt(next(), 10); break;
      case '--profiles': a.profilesDir = next(); break;
      case '--calibration': a.calibration = next(); break;
      case '--no-calibration': a.calibration = false; break;
      case '--gcode': a.gcodePath = next(); break;
      case '--scale': { const v = next(); a.scale = v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v); break; }
      case '--copies': a.copies = parseInt(next(), 10); break;
      case '--copies-spacing': a.copies_spacing = parseFloat(next()); break;
      case '--set': {
        const kv = next();
        const i2 = kv.indexOf('=');
        if (i2 <= 0) throw new Error(`--set expects key=value, got "${kv}"`);
        (a.overrides = a.overrides || {})[kv.slice(0, i2).trim()] = kv.slice(i2 + 1).trim();
        break;
      }
      case '--json': a.json = true; break;
      case '--list': a.list = true; break;
      case '-h': case '--help': a.help = true; break;
      default:
        if (s.startsWith('--')) throw new Error(`Unknown option ${s}`);
        a._.push(s);
    }
  }
  return a;
}

function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); console.error(HELP); process.exit(2); }
  if (args.help) { console.log(HELP); return; }
  if (args.list) {
    const lib = loadProfileLibrary(args.profilesDir || DEFAULT_PROFILES_DIR);
    console.log('Printers:'); for (const n of lib.list('machine').sort()) console.log('  ' + n);
    console.log('Processes:'); for (const n of lib.list('process').sort()) console.log('  ' + n);
    console.log('Filaments:'); for (const n of lib.list('filament').sort()) console.log('  ' + n);
    return;
  }
  if (args._.length !== 1) { console.error(HELP); process.exit(2); }
  let res;
  try {
    res = estimateFile({ model: args._[0], ...args });
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
  if (args.json) {
    const { _diag, ...pub } = res;
    console.log(JSON.stringify(pub, null, 2));
    return;
  }
  console.log(`Model:     ${res.model}`);
  console.log(`Printer:   ${res.printer}`);
  console.log(`Process:   ${res.process}`);
  console.log(`Support:   ${res.support ? 'enabled' : 'disabled'}`);
  console.log(`Time:      ${res.time}  (${res.time_s} s)`);
  console.log(`Filament:  ${res.weight_g.toFixed(2)} g  (${res.filament_length_m.toFixed(2)} m)`);
  for (const x of res.per_extruder) console.log(`  extruder ${x.extruder}: ${x.weight_g.toFixed(2)} g, ${x.length_m.toFixed(2)} m`);
  console.log(`Layers: ${res.layers} (first layer ${res.first_layer_time_s} s), tool changes: ${res.tool_changes}, copies: ${res.copies}, scale: ${res.scale}, calibration: ${res.calibration.source}`);
  const b = res.breakdown;
  console.log(`Weight breakdown (g): model ${b.weight_g.model}, support ${b.weight_g.support}, wipe tower ${b.weight_g.wipe_tower}, custom G-code ${b.weight_g.custom_gcode}`);
  console.log(`Time breakdown (min): model ${(b.time_s.model / 60).toFixed(1)}, support ${(b.time_s.support / 60).toFixed(1)}, wipe tower ${(b.time_s.wipe_tower / 60).toFixed(1)}, tool changes ${(b.time_s.tool_changes / 60).toFixed(1)}, travel/retract ${(b.time_s.travel_retract / 60).toFixed(1)}`);
}

main();
