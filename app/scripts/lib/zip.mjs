// Minimal store-only ZIP writer (no dependencies). Deterministic order; no compression.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function walk(dir, base = dir, filter = () => true) {
  const out = [];
  for (const f of readdirSync(dir).sort()) {
    const p = path.join(dir, f);
    const rel = path.relative(base, p).split(path.sep).join('/');
    if (!filter(rel)) continue;
    if (statSync(p).isDirectory()) out.push(...walk(p, base, filter));
    else out.push(rel);
  }
  return out;
}
/** files: array of [zipPath, absPath] */
export function zipFiles(files, outFile) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const dosTime = 0, dosDate = (2026 - 1980) << 9 | (10 << 5) | 1;
  for (const [name, abs] of files) {
    const data = readFileSync(abs);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  writeFileSync(outFile, Buffer.concat([...locals, cd, end]));
}
export async function zipDir(dir, outFile, { prefix = '', filter = () => true } = {}) {
  zipFiles(walk(dir, dir, filter).map((rel) => [prefix + rel, path.join(dir, rel)]), outFile);
}
export { walk };
