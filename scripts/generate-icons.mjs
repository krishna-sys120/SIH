/**
 * Generates PWA icons (192, 512, maskable-512) + favicon.svg for SkillSetu.
 * Zero dependencies: draws the mic mark pixel-by-pixel (anti-aliased SDFs),
 * encodes PNG with zlib from node. Run: node scripts/generate-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "icons");
mkdirSync(outDir, { recursive: true });

const TOP = [0xf9, 0x7f, 0x12]; // saffron-500
const BOT = [0x2b, 0x4d, 0xc4]; // indigoink-600

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (edge, w, d) => clamp01(0.5 + (edge - d) / w); // 1 inside, 0 outside

/** Signed distance helpers (d <= 0 inside). */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

function coverage(px, py, s, k) {
  const x = px / s;
  const y = py / s;
  const aa = 1.5 / s;
  // Microphone body: capsule centered x=0.5, from y=0.26 to y=0.60
  const body = sdRoundRect(x, y, 0.5, 0.43, 0.105, 0.17, 0.105);
  // Cradle arc: ring around (0.5, 0.55), lower half only
  const dx = x - 0.5;
  const dy = y - 0.55;
  const ring = Math.abs(Math.hypot(dx, dy) - 0.175) - 0.042;
  const cradle = Math.max(ring, y - 0.55);
  // Stem + base
  const stem = sdRoundRect(x, y, 0.5, 0.775, 0.022, 0.075, 0.02);
  const base = sdRoundRect(x, y, 0.5, 0.895, 0.115, 0.026, 0.02);
  const mark = Math.min(body, cradle, stem, base);
  const a = smooth(0, aa, mark) * k;
  return a;
}

function drawIcon(size, maskable) {
  const k = maskable ? 0.74 : 0.94; // shrink art into maskable safe zone
  const raw = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const i = (py * size + px) * 4;
      const t = clamp01((px + py) / (2 * size - 2));
      const a = coverage(px + 0.5, py + 0.5, size, k);
      raw[i] = Math.round(TOP[0] + (BOT[0] - TOP[0]) * t);
      raw[i + 1] = Math.round(TOP[1] + (BOT[1] - TOP[1]) * t);
      raw[i + 2] = Math.round(TOP[2] + (BOT[2] - TOP[2]) * t);
      raw[i + 3] = Math.round(a * 255);
    }
  }
  return raw;
}

// ── Minimal PNG encoder (truecolor + alpha, filter 0) ────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(rgba, size) {
  const stride = size * 4;
  const filtered = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    filtered[y * (stride + 1)] = 0;
    rgba.copy(filtered, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(filtered, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const [name, size, maskable] of [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-512-maskable.png", 512, true],
]) {
  writeFileSync(join(outDir, name), encodePng(drawIcon(size, maskable), size));
  console.log("wrote", join("public", "icons", name));
}
console.log("done");
