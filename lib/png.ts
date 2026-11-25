import { deflateSync } from 'node:zlib';

/** Tiny dependency-free PNG encoder + procedural app icon (no binary files in the repo). */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const PALETTE: [number, number, number][] = [
  [34, 211, 238],
  [99, 102, 241],
  [217, 70, 239],
];

/** Cyclic cyan > indigo > fuchsia gradient around the centre (an angular gradient). */
function ringColor(angle: number): [number, number, number] {
  const t = (((angle + Math.PI) / (2 * Math.PI)) % 1) * 3;
  const i = Math.floor(t) % 3;
  const f = t - Math.floor(t);
  const a = PALETTE[i];
  const b = PALETTE[(i + 1) % 3];
  const e = f * f * (3 - 2 * f);
  return [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e];
}

const HEX_R = 0.3; // hexagon circumradius, in icon-half units (0.5 = icon edge)
const APO = HEX_R * Math.cos(Math.PI / 6);
const NORMALS = [-60, 0, 60, 120, 180, 240].map((d) => [Math.cos((d * Math.PI) / 180), Math.sin((d * Math.PI) / 180)] as const);
const NODES = [-90, 30, 150].map((d) => [HEX_R * Math.cos((d * Math.PI) / 180), HEX_R * Math.sin((d * Math.PI) / 180)] as const);

/**
 * App icon: dark navy radial tile, neon hexagon ring with an angular cyan/indigo/fuchsia gradient,
 * glowing nodes on three vertices and a white four-point spark. `maskable` = full-bleed with a safe zone.
 */
export function renderIcon(size: number, maskable: boolean): Buffer {
  const px = new Uint8Array(size * size * 4);
  const cornerR = maskable ? 0 : size * 0.22;
  const scale = maskable ? 0.72 : 1;
  const SS = 2;
  const aa = 1.4 / (size * scale);
  const ringW = 0.042;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = (x + (sx + 0.5) / SS) / size;
          const fy = (y + (sy + 0.5) / SS) / size;
          const dx = Math.max(Math.abs(fx - 0.5) * size - (size / 2 - cornerR), 0);
          const dy = Math.max(Math.abs(fy - 0.5) * size - (size / 2 - cornerR), 0);
          const inside = cornerR === 0 ? 1 : 1 - smooth(cornerR - 0.7, cornerR + 0.7, Math.hypot(dx, dy));
          if (inside <= 0) continue;

          // navy radial background
          const rd = Math.hypot(fx - 0.5, fy - 0.46) / 0.75;
          const k = smooth(0, 1, rd);
          let cr = 29 + (5 - 29) * k, cg = 40 + (7 - 40) * k, cb = 102 + (15 - 102) * k;

          const u = (fx - 0.5) / scale;
          const v = (fy - 0.5) / scale;

          // hexagon ring
          let plane = -1;
          for (const [nx, ny] of NORMALS) plane = Math.max(plane, u * nx + v * ny);
          const sd = Math.abs(plane - APO);
          const [rr, rg, rb] = ringColor(Math.atan2(v, u));
          const ring = 1 - smooth(ringW / 2 - aa, ringW / 2 + aa, sd);
          const glow = Math.exp(-Math.max(sd - ringW / 2, 0) / 0.035) * 0.5;
          cr += (rr - cr) * Math.min(1, glow); cg += (rg - cg) * Math.min(1, glow); cb += (rb - cb) * Math.min(1, glow);
          cr += (rr - cr) * ring; cg += (rg - cg) * ring; cb += (rb - cb) * ring;

          // vertex nodes
          for (const [nx, ny] of NODES) {
            const d = Math.hypot(u - nx, v - ny);
            const halo = Math.exp(-d / 0.03) * 0.45;
            const dot = 1 - smooth(0.026, 0.026 + aa, d);
            cr += (150 - cr) * halo; cg += (240 - cg) * halo; cb += (255 - cb) * halo;
            cr += (255 - cr) * dot; cg += (255 - cg) * dot; cb += (255 - cb) * dot;
          }

          // spark (astroid, concave four-point star)
          const su = u / 0.19, sv = v / 0.19;
          const f = Math.pow(Math.pow(Math.abs(su), 2 / 3) + Math.pow(Math.abs(sv), 2 / 3), 1.5);
          const star = 1 - smooth(1, 1 + aa / 0.19 * 2.2, f);
          const sglow = Math.exp(-Math.max(f - 1, 0) * 2.2) * 0.5;
          cr += (255 - cr) * Math.min(1, sglow * (1 - star) + star); cg += (255 - cg) * Math.min(1, sglow * (1 - star) + star); cb += (255 - cb) * Math.min(1, sglow * (1 - star) + star);

          r += cr * inside; g += cg * inside; b += cb * inside; a += inside;
        }
      }
      const i = (y * size + x) * 4;
      const n = SS * SS;
      px[i] = a > 0 ? r / a : 0;
      px[i + 1] = a > 0 ? g / a : 0;
      px[i + 2] = a > 0 ? b / a : 0;
      px[i + 3] = Math.round((a / n) * 255);
    }
  }
  return encodePng(size, size, px);
}
