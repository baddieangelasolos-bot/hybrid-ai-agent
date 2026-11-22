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

/** Gradient tile with a four-point spark and a small satellite. `maskable` = full-bleed with a safe zone. */
export function renderIcon(size: number, maskable: boolean): Buffer {
  const px = new Uint8Array(size * size * 4);
  const cornerR = maskable ? 0 : size * 0.22;
  const scale = maskable ? 0.74 : 1;
  const SS = 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = (x + (sx + 0.5) / SS) / size;
          const fy = (y + (sy + 0.5) / SS) / size;
          // rounded-rect mask
          const dx = Math.max(Math.abs(fx - 0.5) * size - (size / 2 - cornerR), 0);
          const dy = Math.max(Math.abs(fy - 0.5) * size - (size / 2 - cornerR), 0);
          const inside = cornerR === 0 ? 1 : 1 - smooth(cornerR - 0.7, cornerR + 0.7, Math.hypot(dx, dy));
          if (inside <= 0) continue;
          // diagonal gradient + soft highlight
          const t = (fx + fy) / 2;
          let cr = 52 + (138 - 52) * t, cg = 84 + (92 - 84) * t, cb = 255 + (246 - 255) * t;
          const hl = Math.max(0, 1 - Math.hypot(fx - 0.28, fy - 0.2) / 0.7) * 0.28;
          cr += (255 - cr) * hl; cg += (255 - cg) * hl; cb += (255 - cb) * hl;
          // spark (astroid)
          const u = ((fx - 0.5) / scale) * 2, v = ((fy - 0.52) / scale) * 2;
          const f = Math.pow(Math.pow(Math.abs(u), 2 / 3) + Math.pow(Math.abs(v), 2 / 3), 1.5);
          const star = 1 - smooth(0.5, 0.5 + 2.4 / (size * scale), f);
          const glow = Math.exp(-Math.pow(Math.max(f - 0.5, 0) * 3.2, 1.2)) * 0.35;
          // satellite
          const sd = Math.hypot((fx - 0.5) / scale - 0.27, (fy - 0.5) / scale + 0.27);
          const dot = 1 - smooth(0.05, 0.05 + 1.2 / (size * scale), sd);
          const light = Math.min(1, Math.max(star, dot * 0.95) + glow * (1 - star));
          cr += (255 - cr) * light; cg += (255 - cg) * light; cb += (255 - cb) * light;
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
