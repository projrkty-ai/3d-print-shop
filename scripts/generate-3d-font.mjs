// Generates the 3D-lettering font used by both frontends: a three.js typeface JSON subset of
// DejaVu Sans (digits, basic punctuation and Latin letters incl. European accents), written to
// frontend-*/src/fonts/ together with the font license. The output is committed; rerun only to
// change the subset. No dependencies; reads the system TTF (or the path given as an argument).
// Run: node scripts/generate-3d-font.mjs [path/to/DejaVuSans.ttf]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = process.argv[2] ?? '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const LICENSE = '/usr/share/doc/fonts-dejavu-core/copyright';

/** Keep in sync with EXTRUDED_TEXT_ALLOWED in the applications. */
function charset() {
  const chars = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?\'&-#@:+'];
  for (let code = 0xc0; code <= 0x17f; code++) {
    if (code !== 0xd7 && code !== 0xf7) chars.push(String.fromCharCode(code)); // skip × and ÷
  }
  return chars;
}

const data = new DataView(readFileSync(SOURCE).buffer);
const u8 = (at) => data.getUint8(at);
const u16 = (at) => data.getUint16(at);
const i16 = (at) => data.getInt16(at);
const u32 = (at) => data.getUint32(at);

// Table directory.
const tables = {};
for (let i = 0; i < u16(4); i++) {
  const at = 12 + i * 16;
  tables[String.fromCharCode(u8(at), u8(at + 1), u8(at + 2), u8(at + 3))] = u32(at + 8);
}
for (const required of ['head', 'maxp', 'cmap', 'loca', 'glyf', 'hhea', 'hmtx']) {
  if (!(required in tables)) throw new Error(`${SOURCE} has no ${required} table; a plain TrueType font is required.`);
}

const unitsPerEm = u16(tables.head + 18);
const longLoca = i16(tables.head + 50) === 1;
const numGlyphs = u16(tables.maxp + 4);
const numberOfHMetrics = u16(tables.hhea + 34);

/** Character → glyph index (cmap format 4, Windows Unicode BMP). */
function glyphIndex(code) {
  const cmap = tables.cmap;
  let table;
  for (let i = 0; i < u16(cmap + 2); i++) {
    const platform = u16(cmap + 4 + i * 8);
    const candidate = cmap + u32(cmap + 8 + i * 8);
    // Any Unicode subtable in format 4 (segment mapping, BMP) will do.
    if ((platform === 3 || platform === 0) && u16(candidate) === 4) table = candidate;
  }
  if (table === undefined) throw new Error('No Unicode BMP cmap (format 4) found.');
  const segCount = u16(table + 6) / 2;
  for (let seg = 0; seg < segCount; seg++) {
    const end = u16(table + 14 + seg * 2);
    if (code > end) continue;
    const start = u16(table + 16 + segCount * 2 + seg * 2);
    if (code < start) return 0;
    const idDeltaAt = table + 16 + segCount * 4 + seg * 2;
    const idRangeOffsetAt = table + 16 + segCount * 6 + seg * 2;
    const idRangeOffset = u16(idRangeOffsetAt);
    if (idRangeOffset === 0) return (code + i16(idDeltaAt)) & 0xffff;
    const glyphAt = idRangeOffsetAt + idRangeOffset + (code - start) * 2;
    const glyph = u16(glyphAt);
    return glyph === 0 ? 0 : (glyph + i16(idDeltaAt)) & 0xffff;
  }
  return 0;
}

function advanceWidth(glyph) {
  return u16(tables.hmtx + Math.min(glyph, numberOfHMetrics - 1) * 4);
}

const glyphOffset = (glyph) =>
  longLoca ? u32(tables.loca + glyph * 4) : u16(tables.loca + glyph * 2) * 2;

/** Points of a glyph's contours (TrueType quadratic outlines), composites resolved recursively. */
function glyphContours(glyph, depth = 0) {
  if (depth > 5) throw new Error('Composite glyphs nested too deeply.');
  const from = glyphOffset(glyph);
  if (from === glyphOffset(glyph + 1)) return []; // empty glyph (e.g. space)
  const at = tables.glyf + from;
  const contourCount = i16(at);
  if (contourCount >= 0) return simpleGlyph(at, contourCount);

  // Composite: accented letters are a base glyph plus combining marks, each possibly transformed.
  const contours = [];
  let cursor = at + 10;
  for (;;) {
    const flags = u16(cursor);
    const component = u16(cursor + 2);
    cursor += 4;
    if (!(flags & 0x0002)) throw new Error('Point-matching composite glyphs are not supported.');
    let dx;
    let dy;
    if (flags & 0x0001) {
      dx = i16(cursor); dy = i16(cursor + 2); cursor += 4;
    } else {
      dx = (u8(cursor) << 24) >> 24; dy = (u8(cursor + 1) << 24) >> 24; cursor += 2;
    }
    let [a, b, c, d] = [1, 0, 0, 1];
    const f2dot14 = (value) => ((value << 16) >> 16) / 16384;
    if (flags & 0x0008) {
      a = d = f2dot14(u16(cursor)); cursor += 2;
    } else if (flags & 0x0040) {
      a = f2dot14(u16(cursor)); d = f2dot14(u16(cursor + 2)); cursor += 4;
    } else if (flags & 0x0080) {
      a = f2dot14(u16(cursor)); b = f2dot14(u16(cursor + 2)); c = f2dot14(u16(cursor + 4)); d = f2dot14(u16(cursor + 6)); cursor += 8;
    }
    for (const contour of glyphContours(component, depth + 1)) {
      contours.push(contour.map((p) => ({ x: a * p.x + c * p.y + dx, y: b * p.x + d * p.y + dy, on: p.on })));
    }
    if (!(flags & 0x0020)) return contours;
  }
}

function simpleGlyph(at, contourCount) {
  const ends = Array.from({ length: contourCount }, (_, i) => u16(at + 10 + i * 2));
  const pointCount = ends[contourCount - 1] + 1;
  let cursor = at + 10 + contourCount * 2;
  cursor += 2 + u16(cursor); // instructions

  const flags = [];
  while (flags.length < pointCount) {
    const flag = u8(cursor++);
    flags.push(flag);
    if (flag & 0x08) for (let r = u8(cursor++); r > 0; r--) flags.push(flag);
  }
  const coordinates = (shortBit, sameBit) => {
    const values = [];
    let value = 0;
    for (const flag of flags) {
      if (flag & shortBit) value += (flag & sameBit ? 1 : -1) * u8(cursor++);
      else if (!(flag & sameBit)) {
        value += i16(cursor); cursor += 2;
      }
      values.push(value);
    }
    return values;
  };
  const xs = coordinates(0x02, 0x10);
  const ys = coordinates(0x04, 0x20);

  const contours = [];
  let start = 0;
  for (const end of ends) {
    contours.push(Array.from({ length: end - start + 1 }, (_, i) => ({
      x: xs[start + i], y: ys[start + i], on: (flags[start + i] & 0x01) !== 0,
    })));
    start = end + 1;
  }
  return contours;
}

/** One contour → typeface outline commands (m/l/q), inserting implied on-curve midpoints. */
function contourCommands(contour) {
  const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, on: true });
  let points = [...contour];
  const firstOn = points.findIndex((p) => p.on);
  if (firstOn === -1) points = [mid(points[0], points[points.length - 1]), ...points];
  else points = [...points.slice(firstOn), ...points.slice(0, firstOn)];

  const rounded = (value) => String(Math.round(value));
  const commands = ['m', rounded(points[0].x), rounded(points[0].y)];
  let control = null;
  const emit = (point) => {
    if (control) commands.push('q', rounded(point.x), rounded(point.y), rounded(control.x), rounded(control.y));
    else commands.push('l', rounded(point.x), rounded(point.y));
    control = null;
  };
  for (const point of [...points.slice(1), points[0]]) {
    if (point.on) emit(point);
    else if (control) {
      emit(mid(control, point));
      control = point;
    } else control = point;
  }
  return commands;
}

const glyphs = {};
for (const char of charset()) {
  const glyph = glyphIndex(char.charCodeAt(0));
  if (glyph === 0 && char !== '\u0000') throw new Error(`${SOURCE} has no glyph for "${char}".`);
  glyphs[char] = {
    ha: advanceWidth(glyph),
    o: glyphContours(glyph).map(contourCommands).flat().join(' '),
  };
}

const font = {
  glyphs,
  familyName: 'DejaVu Sans (PrintForge 3D lettering subset)',
  ascender: i16(tables.hhea + 4),
  descender: i16(tables.hhea + 6),
  underlinePosition: tables.post ? i16(tables.post + 8) : -100,
  underlineThickness: tables.post ? i16(tables.post + 10) : 50,
  boundingBox: {
    xMin: i16(tables.head + 36), yMin: i16(tables.head + 38), xMax: i16(tables.head + 40), yMax: i16(tables.head + 42),
  },
  resolution: unitsPerEm,
  original_font_information: {
    format: 0,
    copyright: 'DejaVu Sans — Copyright (c) 2003 Bitstream, Inc.; DejaVu changes are in public domain. See lettering-font-license.txt.',
  },
};

const json = JSON.stringify(font);
let license = `Subset of DejaVu Sans (https://dejavu-fonts.github.io/), generated by scripts/generate-3d-font.mjs.\n\n`;
try {
  license += readFileSync(LICENSE, 'utf8');
} catch {
  license += 'See https://dejavu-fonts.github.io/License.html for the Bitstream Vera / DejaVu license.';
}
for (const app of ['frontend-client', 'frontend-admin']) {
  const out = fileURLToPath(new URL(`../${app}/src/fonts/`, import.meta.url));
  writeFileSync(`${out}lettering.typeface.json`, json);
  writeFileSync(`${out}lettering-font-license.txt`, license);
  console.log(`Wrote ${app}/src/fonts/lettering.typeface.json (${Math.round(json.length / 1024)} kB, ${Object.keys(glyphs).length} glyphs)`);
}
