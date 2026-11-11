import { inflateRawSync } from 'node:zlib';
import { PRINTER_LIMITS } from './domain/printers';
import type { PrinterProfiles } from './domain/types';

/** What an uploaded profile archive contains: its files and the slicer presets among them. */
export type ProfilesSummary = Pick<PrinterProfiles, 'entries' | 'presets'>;

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
/** JSON files larger than this are listed but not read for presets. */
const PRESET_MAX_BYTES = 2 * 1024 * 1024;
/** Inflating stops after this much JSON, so a crafted archive can't keep the server busy. */
const INFLATE_BUDGET_BYTES = 64 * 1024 * 1024;
const PRESET_TYPES = ['machine', 'process', 'filament'] as const;

/** Whether the data starts like a ZIP archive (also OrcaSlicer's .orca_printer bundles). */
export function looksLikeZip(data: Buffer): boolean {
  return data.length >= 22 && data.readUInt32LE(0) === LOCAL_HEADER;
}

interface Entry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

/** The central directory of a ZIP (plain 32-bit archives; ZIP64 is not needed for preset bundles). */
function readCentralDirectory(data: Buffer): Entry[] | null {
  let end = -1;
  for (let at = data.length - 22; at >= Math.max(0, data.length - 65557); at--) {
    if (data.readUInt32LE(at) === END_OF_CENTRAL_DIRECTORY) {
      end = at;
      break;
    }
  }
  if (end < 0) return null;
  const count = data.readUInt16LE(end + 10);
  let at = data.readUInt32LE(end + 16);
  if (count === 0xffff || at === 0xffffffff) return null;
  const entries: Entry[] = [];
  for (let index = 0; index < count; index++) {
    if (at + 46 > data.length || data.readUInt32LE(at) !== CENTRAL_HEADER) return null;
    const nameLength = data.readUInt16LE(at + 28);
    const extraLength = data.readUInt16LE(at + 30);
    const commentLength = data.readUInt16LE(at + 32);
    if (at + 46 + nameLength > data.length) return null;
    entries.push({
      name: data.toString('utf8', at + 46, at + 46 + nameLength),
      method: data.readUInt16LE(at + 10),
      compressedSize: data.readUInt32LE(at + 20),
      size: data.readUInt32LE(at + 24),
      localOffset: data.readUInt32LE(at + 42),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** The contents of a stored or deflated entry, or null for other methods and damaged data. */
function readEntry(data: Buffer, entry: Entry): Buffer | null {
  const { localOffset: at } = entry;
  if (at + 30 > data.length || data.readUInt32LE(at) !== LOCAL_HEADER) return null;
  const start = at + 30 + data.readUInt16LE(at + 26) + data.readUInt16LE(at + 28);
  if (start + entry.compressedSize > data.length) return null;
  const compressed = data.subarray(start, start + entry.compressedSize);
  try {
    if (entry.method === 0) return compressed;
    if (entry.method === 8) return inflateRawSync(compressed, { maxOutputLength: PRESET_MAX_BYTES });
  } catch {
    return null;
  }
  return null;
}

/** The preset's type and name when the JSON looks like an OrcaSlicer/Bambu Studio preset. */
function presetOf(json: Buffer): { type: (typeof PRESET_TYPES)[number]; name: string } | null {
  try {
    const parsed: unknown = JSON.parse(json.toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const { type, name } = parsed as { type?: unknown; name?: unknown };
    if (typeof name !== 'string' || !name.trim()) return null;
    const found = PRESET_TYPES.find((candidate) => candidate === type);
    return found ? { type: found, name: name.trim().slice(0, 200) } : null;
  } catch {
    return null;
  }
}

/**
 * Lists the files of a profile archive and the slicer presets found in its JSON files (presets
 * of OrcaSlicer and Bambu Studio carry `type` and `name`). Returns null when the data is not a
 * readable ZIP, and an empty `entries` list for an archive without files.
 */
export function inspectProfilesZip(data: Buffer): ProfilesSummary | null {
  if (!looksLikeZip(data)) return null;
  const directory = readCentralDirectory(data);
  if (!directory) return null;
  const files = directory.filter((entry) => !entry.name.endsWith('/'));
  const presets = { machine: [] as string[], process: [] as string[], filament: [] as string[] };
  let budget = INFLATE_BUDGET_BYTES;
  for (const entry of files) {
    if (!/\.json$/i.test(entry.name) || entry.size > PRESET_MAX_BYTES) continue;
    budget -= entry.size;
    if (budget < 0) break;
    const contents = readEntry(data, entry);
    const preset = contents && presetOf(contents);
    if (preset && presets[preset.type].length < PRINTER_LIMITS.profilePresets && !presets[preset.type].includes(preset.name)) {
      presets[preset.type].push(preset.name);
    }
  }
  return {
    entries: files.slice(0, PRINTER_LIMITS.profileEntries).map((entry) => ({ name: entry.name.slice(0, 255), sizeBytes: entry.size })),
    presets,
  };
}
