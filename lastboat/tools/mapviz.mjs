// 맵을 위에서 본 그림(PNG)으로: node tools/mapviz.mjs [출력.png] [surface|subway]
import fs from 'fs';
import zlib from 'zlib';
import { buildMap } from '../public/js/shared/map.js';
import { NavGrid } from '../public/js/shared/nav.js';

const out = process.argv[2] || 'map.png';
const part = process.argv[3] || 'surface';
const map = buildMap();
const nav = new NavGrid(map);
const [z0, z1] = part === 'subway' ? [388, 462] : [-4, 244];
const [x0, x1] = part === 'subway' ? [140, 360] : [-4, 364];
const S = 4;
const W = (x1 - x0) * S;
const H = (z1 - z0) * S;
const img = Buffer.alloc(W * H * 3);
const put = (px, pz, [r, g, b]) => {
  if (px < 0 || pz < 0 || px >= W || pz >= H) return;
  const o = (pz * W + px) * 3;
  img[o] = r; img[o + 1] = g; img[o + 2] = b;
};
for (let pz = 0; pz < H; pz++) {
  for (let px = 0; px < W; px++) {
    const x = x0 + px / S;
    const z = z0 + pz / S;
    const k = nav.idx(x, z);
    let c = [40, 44, 52];
    if (k >= 0) {
      if (nav.move[k] && nav.sight[k]) c = [120, 120, 130];
      else if (nav.move[k]) c = [90, 110, 150];
      else if (nav.sight[k]) c = [140, 90, 90];
      else c = [22, 24, 28];
    }
    put(px, pz, c);
  }
}
const dot = (x, z, col, r = 2) => {
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) put(Math.round((x - x0) * S) + dx, Math.round((z - z0) * S) + dz, col);
};
for (const d of map.doors) dot(d.x, d.z, d.locked ? [255, 60, 60] : [255, 200, 60], 3);
for (const it of map.items) for (const s of it.spots) dot(s[0], s[1], it.type === 'key' ? [255, 255, 0] : it.type === 'medkit' ? [80, 255, 80] : it.type === 'ammo' ? [80, 200, 255] : [255, 120, 255], 2);
for (const i of map.interacts) dot(i.x, i.z, [255, 255, 255], 3);
for (const g of map.groups) dot(g.x, g.z, [200, 40, 40], 1);
for (const p of map.portals) dot((p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2, [0, 255, 200], 4);
for (const [x, z] of map.starts) dot(x, z, [0, 255, 0], 4);
for (const l of map.lamps) dot(l.x, l.z, [255, 220, 150], 1);
// PNG
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  img.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`${out} ${W}x${H}  colliders=${map.colliders.length} visuals=${map.visuals.length} lamps=${map.lamps.length} lights=${map.lights.length} items=${map.items.length} zombieGroups=${map.groups.length} (${map.groups.reduce((a, g) => a + g.n, 0)})`);
