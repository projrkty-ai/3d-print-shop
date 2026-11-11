// Minimal ZIP reader (stored + deflate) for 3MF containers. Platform neutral: works on
// Uint8Array/ArrayBuffer with a pure JS inflate (fflate), in Node.js and in browsers.
import { inflateSync } from 'fflate';

const td = new TextDecoder('utf-8');

export function readZip(buffer) {
  const buf = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u16 = (o) => dv.getUint16(o, true), u32 = (o) => dv.getUint32(o, true);
  const u64 = (o) => Number(dv.getBigUint64(o, true));
  // Locate End Of Central Directory record.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (u32(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive (EOCD not found)');
  let count = u16(eocd + 10);
  let cdOffset = u32(eocd + 16);
  // ZIP64 support
  if (cdOffset === 0xffffffff || count === 0xffff) {
    const loc = eocd - 20;
    if (loc >= 0 && u32(loc) === 0x07064b50) {
      const z64 = (u64(loc + 8));
      count = (u64(z64 + 32));
      cdOffset = (u64(z64 + 48));
    }
  }
  const files = new Map();
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (u32(p) !== 0x02014b50) throw new Error('Corrupt ZIP central directory');
    const method = u16(p + 10);
    let compSize = u32(p + 20);
    let size = u32(p + 24);
    const nameLen = u16(p + 28);
    const extraLen = u16(p + 30);
    const commentLen = u16(p + 32);
    let localOff = u32(p + 42);
    const name = td.decode(buf.subarray(p + 46, p + 46 + nameLen));
    // ZIP64 extra field
    let e = p + 46 + nameLen;
    const eEnd = e + extraLen;
    while (e + 4 <= eEnd) {
      const id = u16(e), len = u16(e + 2);
      if (id === 1) {
        let q = e + 4;
        if (size === 0xffffffff) { size = (u64(q)); q += 8; }
        if (compSize === 0xffffffff) { compSize = (u64(q)); q += 8; }
        if (localOff === 0xffffffff) { localOff = (u64(q)); q += 8; }
      }
      e += 4 + len;
    }
    files.set(name, { method, compSize, size, localOff });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    names: () => [...files.keys()],
    has: (name) => files.has(normalize(name, files)),
    read(name) {
      const key = normalize(name, files);
      const f = files.get(key);
      if (!f) return null;
      const lo = f.localOff;
      if (u32(lo) !== 0x04034b50) throw new Error('Corrupt ZIP local header');
      const start = lo + 30 + u16(lo + 26) + u16(lo + 28);
      const data = buf.subarray(start, start + f.compSize);
      if (f.method === 0) return data.slice();
      if (f.method === 8) return inflateSync(data, { out: f.size > 0 ? new Uint8Array(f.size) : undefined });
      throw new Error(`Unsupported ZIP compression method ${f.method} for ${name}`);
    },
    readText(name) { const b = this.read(name); return b ? td.decode(b) : null; },
  };
}

function normalize(name, files) {
  let n = name.replace(/^\/+/, '');
  if (files.has(n)) return n;
  const lower = n.toLowerCase();
  for (const k of files.keys()) if (k.toLowerCase() === lower) return k;
  return n;
}
