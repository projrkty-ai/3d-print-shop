// Node.js adapter: file-system helpers around the platform neutral engine (used by the CLI, the
// calibration tool and the tests). Browser builds use index.mjs directly.
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProfileLibrary } from './config.mjs';
import { loadModelBytes } from './model.mjs';
import { estimate } from './index.mjs';
import { parseReferenceText } from './reference.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PROFILES_DIR = path.resolve(HERE, '..', '..', 'profiles');
export const DEFAULT_CALIBRATION_FILE = path.join(HERE, '..', 'data', 'calibration.json');

/** Recursively read every Orca preset (*.json with name + type) below the directories. */
export function readProfiles(dirs) {
  const out = [];
  const scan = (dir) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir)) {
      const p = path.join(dir, e);
      if (statSync(p).isDirectory()) scan(p);
      else if (e.toLowerCase().endsWith('.json')) {
        try {
          const d = JSON.parse(readFileSync(p, 'utf8'));
          if (d && d.name && d.type) out.push({ ...d, __file: p });
        } catch { /* not a preset */ }
      }
    }
  };
  for (const d of [].concat(dirs)) scan(d);
  return out;
}

const libCache = new Map();
export function loadProfileLibrary(dirs = DEFAULT_PROFILES_DIR) {
  const key = [].concat(dirs).join('|');
  if (!libCache.has(key)) libCache.set(key, new ProfileLibrary(readProfiles(dirs)));
  return libCache.get(key);
}

export function loadModel(file, opts = {}) { return loadModelBytes(readFileSync(file), file, opts); }

export function loadCalibration(file = DEFAULT_CALIBRATION_FILE) {
  if (!file || !existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function parseReferenceTable(file) { return parseReferenceText(readFileSync(file, 'utf8')); }

/**
 * estimate() with file paths:
 *   model: path or loaded model, profilesDir, calibration: path | object | false (default file),
 *   gcodePath: write the generated G-code there.
 */
export function estimateFile(o) {
  const model = typeof o.model === 'string' ? loadModel(o.model, { plate: o.plate || 1 }) : o.model;
  const library = o.library || loadProfileLibrary(o.profilesDir || DEFAULT_PROFILES_DIR);
  let calibration = null;
  if (o.calibration !== false) calibration = typeof o.calibration === 'object' && o.calibration ? o.calibration : loadCalibration(o.calibration || undefined);
  const r = estimate({ ...o, model, library, calibration, gcode: !!o.gcodePath, modelName: typeof o.model === 'string' ? path.basename(o.model) : o.modelName });
  if (o.gcodePath) { writeFileSync(o.gcodePath, r.gcode); delete r.gcode; }
  return r;
}
