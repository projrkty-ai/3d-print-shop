// Generates the colorful demo shop textures in backend/public/models/textures/ used by the seed
// catalog (served by the backend at /models/textures/…). Deterministic; no dependencies.
// Run: node scripts/generate-demo-textures.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const OUT = new URL('../backend/public/models/textures/', import.meta.url);
const SIZE = 256;

/** Small deterministic PRNG (mulberry32), so regenerated files are identical. */
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((channel, i) => Math.round(channel + (b[i] - channel) * t));

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** RGB PNG from `pixel(x, y) → [r, g, b]`. */
function png(pixel) {
  const rows = Buffer.alloc((SIZE * 3 + 1) * SIZE);
  for (let y = 0; y < SIZE; y++) {
    rows[y * (SIZE * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < SIZE; x++) {
      const [r, g, b] = pixel(x, y);
      rows.set([r, g, b], y * (SIZE * 3 + 1) + 1 + x * 3);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Cream base with scattered stone chips in terracotta, teal, mustard and navy. */
function terrazzo() {
  const rand = random(7);
  const palette = ['#c8553d', '#1f8a8a', '#e0a526', '#2a3d66', '#f28f79'].map(hex);
  const chips = Array.from({ length: 70 }, () => ({
    x: rand() * SIZE, y: rand() * SIZE, rx: 4 + rand() * 12, ry: 3 + rand() * 9,
    angle: rand() * Math.PI, color: palette[Math.floor(rand() * palette.length)],
  }));
  const base = hex('#f3ead8');
  return png((x, y) => {
    for (const chip of chips) {
      // Wrap around the edges so the texture tiles seamlessly.
      const dx = ((x - chip.x + SIZE * 1.5) % SIZE) - SIZE / 2;
      const dy = ((y - chip.y + SIZE * 1.5) % SIZE) - SIZE / 2;
      const u = (dx * Math.cos(chip.angle) + dy * Math.sin(chip.angle)) / chip.rx;
      const v = (-dx * Math.sin(chip.angle) + dy * Math.cos(chip.angle)) / chip.ry;
      if (u * u + v * v <= 1) return chip.color;
    }
    const speckle = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
    return mix(base, [255, 255, 255], Math.abs(speckle) * 0.25);
  });
}

/** Warm wavy bands from gold through coral to violet. */
function sunset() {
  const bands = ['#ffd166', '#f8961e', '#f3722c', '#ef476f', '#9b5de5', '#5a189a'].map(hex);
  return png((x, y) => {
    const wave = y / SIZE + 0.05 * Math.sin((x / SIZE) * Math.PI * 4);
    const position = ((wave % 1) + 1) % 1 * (bands.length - 1);
    const i = Math.floor(position);
    return mix(bands[i], bands[i + 1] ?? bands[i], position - i);
  });
}

/** Blue and white ocean waves. */
function waves() {
  const deep = hex('#0b4f8a');
  const light = hex('#8fd3f4');
  const foam = [250, 252, 255];
  return png((x, y) => {
    const phase = Math.sin((x / SIZE) * Math.PI * 6 + Math.sin((y / SIZE) * Math.PI * 4) * 1.5);
    const band = (Math.sin((y / SIZE) * Math.PI * 10 + phase * 1.8) + 1) / 2;
    const color = mix(deep, light, band);
    return band > 0.93 ? foam : color;
  });
}

mkdirSync(OUT, { recursive: true });
for (const [name, image] of Object.entries({ terrazzo: terrazzo(), sunset: sunset(), waves: waves() })) {
  writeFileSync(new URL(`${name}.png`, OUT), image);
  console.log(`Wrote ${name}.png (${image.length} bytes)`);
}
