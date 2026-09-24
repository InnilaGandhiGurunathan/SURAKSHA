#!/usr/bin/env node
/**
 * SURAKSHA brand asset generator.
 *
 * Produces the PWA icons and the store screenshots that `vite.config.ts` and the
 * web manifest reference:
 *
 *   apps/web/public/icons/logo.svg
 *   apps/web/public/icons/icon-192.png
 *   apps/web/public/icons/icon-512.png
 *   apps/web/public/icons/maskable-192.png
 *   apps/web/public/icons/maskable-512.png
 *   apps/web/public/screenshots/home-mobile.png
 *   apps/web/public/screenshots/home-desktop.png
 *
 * Everything is rendered here, from vectors, with no image dependencies: Node's
 * `zlib` is enough to write a PNG once the pixels are known. That keeps the
 * repository self-contained — `npm run assets` regenerates the whole set on any
 * machine, and the shield geometry below is the same geometry as
 * `src/components/Shield.tsx`, so the icon can never drift from the in-app mark.
 *
 * The screenshots are illustrative renders of the real dashboard layout (the
 * same panels, in the same order), not photographs of a device.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'apps', 'web', 'public');

/* -------------------------------- colours -------------------------------- */

const NAVY = [6, 21, 48];
const NAVY_CARD = [10, 31, 68];
const TEAL = [13, 148, 136];
const TEAL_LIGHT = [45, 212, 191];
const TEAL_DARK = [15, 118, 110];
const WHITE = [255, 255, 255];
const RED = [239, 68, 68];
const AMBER = [245, 158, 11];
const SLATE = [148, 163, 184];
const EMERALD = [16, 185, 129];

/* ----------------------------- small helpers ----------------------------- */

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const mix = (a, b, t) => a.map((channel, index) => Math.round(channel + (b[index] - channel) * clamp01(t)));

/** A colour with alpha, as used by the compositor. */
const rgba = ([r, g, b], alpha = 1) => [r, g, b, clamp01(alpha)];

/**
 * A tiny RGBA canvas. Shapes are added with a coverage function and composited
 * with supersampling, which is all the antialiasing these flat vectors need.
 */
class Canvas {
  constructor(width, height, background = [0, 0, 0, 0]) {
    this.width = width;
    this.height = height;
    this.data = new Float64Array(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
      this.data[i * 4] = background[0];
      this.data[i * 4 + 1] = background[1];
      this.data[i * 4 + 2] = background[2];
      this.data[i * 4 + 3] = background[3] ?? 0;
    }
  }

  /** Composite `shade(x, y)` wherever `inside(x, y)` is true. */
  paint(inside, shade, { samples = 3 } = {}) {
    const step = 1 / samples;
    const offset = step / 2;
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        let hits = 0;
        for (let sy = 0; sy < samples; sy += 1) {
          for (let sx = 0; sx < samples; sx += 1) {
            if (inside(x + offset + sx * step, y + offset + sy * step)) hits += 1;
          }
        }
        if (hits === 0) continue;
        const coverage = hits / (samples * samples);
        const colour = shade(x + 0.5, y + 0.5);
        const alpha = (colour[3] ?? 1) * coverage;
        if (alpha <= 0) continue;
        const index = (y * this.width + x) * 4;
        const dstA = this.data[index + 3];
        const outA = alpha + dstA * (1 - alpha);
        for (let channel = 0; channel < 3; channel += 1) {
          const src = colour[channel];
          const dst = this.data[index + channel];
          this.data[index + channel] = outA === 0 ? 0 : (src * alpha + dst * dstA * (1 - alpha)) / outA;
        }
        this.data[index + 3] = outA;
      }
    }
    return this;
  }

  toRgbaBuffer() {
    const buffer = Buffer.alloc(this.width * this.height * 4);
    for (let i = 0; i < this.width * this.height; i += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        const value = this.data[i * 4 + channel];
        // Flatten onto the brand navy so no viewer ever sees a black fringe.
        const alpha = this.data[i * 4 + 3];
        const flattened = value * alpha + NAVY[channel] * (1 - alpha);
        buffer[i * 4 + channel] = Math.max(0, Math.min(255, Math.round(flattened)));
      }
      buffer[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(this.data[i * 4 + 3] * 255)));
    }
    return buffer;
  }
}

/* --------------------------------- shapes -------------------------------- */

const roundRect = (x, y, width, height, radius) => {
  const rx = Math.min(radius, width / 2);
  const ry = Math.min(radius, height / 2);
  return (px, py) => {
    if (px < x || px > x + width || py < y || py > y + height) return false;
    const dx = px < x + rx ? x + rx - px : px > x + width - rx ? px - (x + width - rx) : 0;
    const dy = py < y + ry ? y + ry - py : py > y + height - ry ? py - (y + height - ry) : 0;
    if (dx === 0 || dy === 0) return true;
    return dx * dx + dy * dy <= rx * ry;
  };
};

const circle = (cx, cy, r) => (px, py) => (px - cx) ** 2 + (py - cy) ** 2 <= r * r;

const ring = (cx, cy, inner, outer) => (px, py) => {
  const distance = Math.hypot(px - cx, py - cy);
  return distance <= outer && distance >= inner;
};

const capsule = (x1, y1, x2, y2, width) => {
  const half = width / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy || 1;
  return (px, py) => {
    const t = clamp01(((px - x1) * dx + (py - y1) * dy) / lengthSq);
    const cx = x1 + t * dx;
    const cy = y1 + t * dy;
    return (px - cx) ** 2 + (py - cy) ** 2 <= half * half;
  };
};

/** Cubic bézier sampling (used to turn the shield path into a polygon). */
function cubicPoints(x0, y0, x1, y1, x2, y2, x3, y3, steps = 48) {
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt ** 3 * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t ** 3 * x3;
    const y = mt ** 3 * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t ** 3 * y3;
    points.push([x, y]);
  }
  return points;
}

const polygon = (points) => {
  const edges = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    return [point[0], point[1], next[0], next[1]];
  });
  return (px, py) => {
    let inside = false;
    for (const [x1, y1, x2, y2] of edges) {
      if (y1 > py !== y2 > py) {
        const x = x1 + ((py - y1) * (x2 - x1)) / (y2 - y1);
        if (px < x) inside = !inside;
      }
    }
    return inside;
  };
};

/* ------------------------- the SURAKSHA shield mark ----------------------- */

/**
 * Outer shield, straight out of `Shield.tsx`:
 *   M48 6 14 19 v30 c0 20.4 14.2 37.7 34 43 19.8-5.3 34-22.6 34-43 V19 L48 6 Z
 */
const shieldPolygon = polygon([
  [48, 6],
  [14, 19],
  [14, 49],
  ...cubicPoints(14, 49, 14, 69.4, 28.2, 86.7, 48, 92),
  ...cubicPoints(48, 92, 67.8, 86.7, 82, 69.4, 82, 49),
  [82, 19],
]);

/** Inner shield outline: M48 14 21 24.4 v24.6 c0 16.4 11.2 30.4 27 35.1 15.8-4.7 27-18.7 27-35.1 V24.4 L48 14 Z */
const innerShieldPolygon = polygon([
  [48, 14],
  [21, 24.4],
  [21, 49],
  ...cubicPoints(21, 49, 21, 65.4, 32.2, 79.4, 48, 84.1),
  ...cubicPoints(48, 84.1, 63.8, 79.4, 75, 65.4, 75, 49),
  [75, 24.4],
  [48, 14],
]);

const innerCentre = [48, 49];
const shrinkAbout = (inside, factor) => (px, py) =>
  inside(innerCentre[0] + (px - innerCentre[0]) * factor, innerCentre[1] + (py - innerCentre[1]) * factor);

const gradientAt = (px, py) => {
  const t = clamp01((px / 96) * 0.45 + (py / 96) * 0.55);
  return t < 0.55 ? mix(NAVY, TEAL, t / 0.55) : mix(TEAL, TEAL_DARK, (t - 0.55) / 0.45);
};

/**
 * Draws the mark at `size` inside a `box` (in canvas pixels, 96-unit space
 * mapped through). `detailed` adds the inner shield outline, which is invisible
 * at 192 px and noise at 512 px in a dark bar, so it is tuned by the caller.
 */
function drawMark(canvas, { x, y, size, detailed = true }) {
  const scale = size / 96;
  const map = ([vx, vy]) => [x + vx * scale, y + vy * scale];
  const toLocal = (px, py) => [(px - x) / scale, (py - y) / scale];
  const wrap = (inside) => (px, py) => {
    const [lx, ly] = toLocal(px, py);
    return inside(lx, ly);
  };

  // Body with the navy → teal diagonal gradient.
  canvas.paint(
    wrap(shieldPolygon),
    (px, py) => {
      const [lx, ly] = toLocal(px, py);
      return [...gradientAt(lx, ly), 1];
    },
    { samples: 4 },
  );

  if (detailed) {
    canvas.paint(wrap(innerShieldPolygon), () => rgba(WHITE, 0.12), { samples: 2 });
    const ringInside = wrap((px, py) => innerShieldPolygon(px, py) && !shrinkAbout(innerShieldPolygon, 1.12)(px, py));
    canvas.paint(ringInside, () => rgba(WHITE, 0.45), { samples: 2 });
  }

  // The check mark: 31 48.5 → 43 60.5 → 65 38, 7 units wide with round caps.
  const stroke = 7 * scale;
  const check = (() => {
    const [ax, ay] = map([31, 48.5]);
    const [bx, by] = map([43, 60.5]);
    const [cx, cy] = map([65, 38]);
    const first = capsule(ax, ay, bx, by, stroke);
    const second = capsule(bx, by, cx, cy, stroke);
    return (px, py) => first(px, py) || second(px, py);
  })();
  canvas.paint(check, () => rgba(WHITE, 1), { samples: 4 });

  // The alert dot: r 7 at (72, 26) in red, outlined in white.
  const [dotX, dotY] = map([72, 26]);
  const dotRadius = 7 * scale;
  canvas.paint(ring(dotX, dotY, dotRadius, dotRadius + 2.5 * scale), () => rgba(WHITE, 1), { samples: 3 });
  canvas.paint(circle(dotX, dotY, dotRadius), () => rgba(RED, 1), { samples: 4 });
}

/* --------------------------------- text ---------------------------------- */

/** 5x7 bitmap glyphs — enough to label the rendered screens honestly. */
const FONT = {
  A: '01110 10001 10001 11111 10001 10001 10001',
  B: '11110 10001 11110 10001 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110',
  D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 11110 10000 10000 10000 11111',
  F: '11111 10000 11110 10000 10000 10000 10000',
  G: '01110 10001 10000 10111 10001 10001 01111',
  H: '10001 10001 11111 10001 10001 10001 10001',
  I: '11111 00100 00100 00100 00100 00100 11111',
  J: '00111 00010 00010 00010 10010 10010 01100',
  K: '10001 10010 11100 10100 10010 10010 10001',
  L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001',
  N: '10001 11001 10101 10011 10001 10001 10001',
  O: '01110 10001 10001 10001 10001 10001 01110',
  P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101',
  R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110',
  T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110',
  V: '10001 10001 10001 10001 10001 01010 00100',
  W: '10001 10001 10001 10101 10101 11011 10001',
  X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100',
  Z: '11111 00001 00010 00100 01000 10000 11111',
  0: '01110 10001 10011 10101 11001 10001 01110',
  1: '00100 01100 00100 00100 00100 00100 01110',
  2: '01110 10001 00001 00110 01000 10000 11111',
  3: '11110 00001 00001 01110 00001 00001 11110',
  4: '00010 00110 01010 10010 11111 00010 00010',
  5: '11111 10000 11110 00001 00001 10001 01110',
  6: '00110 01000 10000 11110 10001 10001 01110',
  7: '11111 00001 00010 00100 01000 01000 01000',
  8: '01110 10001 10001 01110 10001 10001 01110',
  9: '01110 10001 10001 01111 00001 00010 01100',
  ':': '00000 00100 00100 00000 00100 00100 00000',
  '.': '00000 00000 00000 00000 00000 01100 01100',
  '-': '00000 00000 00000 11111 00000 00000 00000',
  '/': '00001 00010 00010 00100 01000 01000 10000',
  '+': '00000 00100 00100 11111 00100 00100 00000',
  '!': '00100 00100 00100 00100 00100 00000 00100',
  ' ': '00000 00000 00000 00000 00000 00000 00000',
};

const glyphFor = (character) => FONT[character] ?? FONT[character?.toUpperCase()] ?? FONT[' '];

function textWidth(text, scale, tracking = 1) {
  return text.length * (5 * scale + tracking * scale) - tracking * scale;
}

function drawText(canvas, { x, y, text, scale, colour, tracking = 1 }) {
  let cursor = x;
  for (const character of text) {
    const glyph = glyphFor(character);
    glyph.split(' ').forEach((row, rowIndex) => {
      row.split('').forEach((cell, columnIndex) => {
        if (cell !== '1') return;
        const px = cursor + columnIndex * scale;
        const py = y + rowIndex * scale;
        canvas.paint(roundRect(px, py, scale, scale, 0), () => rgba(colour, 1), { samples: 1 });
      });
    });
    cursor += 5 * scale + tracking * scale;
  }
}

/* ------------------------------ PNG encoding ------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[i] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const payload = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(payload), 0);
  return Buffer.concat([length, payload, crc]);
}

function encodePng(canvas) {
  const width = canvas.width;
  const height = canvas.height;
  const rgba = canvas.toRgbaBuffer();
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* --------------------------- app icon rendering --------------------------- */

function renderIcon(size, { maskable = false } = {}) {
  const canvas = new Canvas(size, size, rgba(maskable ? NAVY : NAVY, 1));
  const radius = maskable ? 0 : size * 0.22;

  if (!maskable) {
    canvas.paint(roundRect(0, 0, size, size, radius), () => rgba(NAVY, 1), { samples: 3 });
    // A soft teal glow behind the mark, so the icon reads on both light and dark
    // home screens without relying on a border.
    canvas.paint(circle(size * 0.5, size * 0.46, size * 0.46), () => rgba(TEAL_DARK, 0.28), { samples: 2 });
  }

  // Maskable icons keep the mark inside the 80% safe zone; plain icons may use more.
  const markSize = size * (maskable ? 0.56 : 0.68);
  drawMark(canvas, {
    x: (size - markSize) / 2,
    y: (size - markSize) / 2 + size * (maskable ? 0 : 0.01),
    size: markSize,
    detailed: size >= 512,
  });

  return canvas;
}

/* ---------------------------- screenshot rendering ------------------------ */

function tintedCard(canvas, rect, alpha = 1) {
  canvas.paint(roundRect(rect.x, rect.y, rect.width, rect.height, rect.radius ?? 16), () => rgba(NAVY_CARD, alpha), { samples: 2 });
}

function renderMobileScreenshot() {
  const width = 720;
  const height = 1560;
  const canvas = new Canvas(width, height, rgba([4, 13, 33], 1));
  const pad = 40;

  // Status bar + app header
  drawText(canvas, { x: pad, y: 34, text: '9:41', scale: 3, colour: SLATE });
  canvas.paint(circle(width - pad - 12, 46, 9), () => rgba(SLATE, 0.9), { samples: 3 });
  canvas.paint(circle(width - pad - 48, 46, 9), () => rgba(SLATE, 0.55), { samples: 3 });

  drawMark(canvas, { x: pad, y: 96, size: 64, detailed: false });
  drawText(canvas, { x: pad + 84, y: 102, text: 'SURAKSHA', scale: 5, colour: WHITE, tracking: 2 });
  drawText(canvas, { x: pad + 84, y: 138, text: 'YOUR SAFETY, OUR PRIORITY', scale: 2, colour: TEAL_LIGHT, tracking: 1 });

  // Connectivity + GPS tile row
  const tileY = 190;
  const tileWidth = (width - pad * 3) / 2;
  tintedCard(canvas, { x: pad, y: tileY, width: tileWidth, height: 132 });
  tintedCard(canvas, { x: pad * 2 + tileWidth, y: tileY, width: tileWidth, height: 132 });
  drawText(canvas, { x: pad + 22, y: tileY + 26, text: 'OFFLINE READY', scale: 2, colour: TEAL_LIGHT });
  drawText(canvas, { x: pad + 22, y: tileY + 60, text: 'CACHED', scale: 4, colour: WHITE });
  canvas.paint(circle(pad + 34, tileY + 106, 9), () => rgba(EMERALD, 1), { samples: 3 });
  drawText(canvas, { x: pad + 54, y: tileY + 98, text: 'NO INTERNET NEEDED', scale: 2, colour: SLATE });

  const rightX = pad * 2 + tileWidth;
  drawText(canvas, { x: rightX + 22, y: tileY + 26, text: 'GPS FIX', scale: 2, colour: TEAL_LIGHT });
  drawText(canvas, { x: rightX + 22, y: tileY + 60, text: '12 M', scale: 4, colour: WHITE });
  canvas.paint(ring(rightX + 34, tileY + 106, 4, 9), () => rgba(EMERALD, 1), { samples: 3 });
  drawText(canvas, { x: rightX + 54, y: tileY + 98, text: 'ACCURATE', scale: 2, colour: SLATE });

  // Active journey card with a route strip
  const journeyY = tileY + 168;
  tintedCard(canvas, { x: pad, y: journeyY, width: width - pad * 2, height: 430 });
  drawText(canvas, { x: pad + 24, y: journeyY + 26, text: 'ACTIVE JOURNEY', scale: 2, colour: TEAL_LIGHT });
  drawText(canvas, { x: pad + 24, y: journeyY + 58, text: 'MG ROAD - HEBBAL', scale: 4, colour: WHITE });
  drawText(canvas, { x: pad + 24, y: journeyY + 100, text: 'ETA 22:40  -  6 KM LEFT', scale: 2, colour: SLATE });

  // Route strip: corridor, progress, checkpoint markers
  const stripY = journeyY + 170;
  canvas.paint(roundRect(pad + 24, stripY, width - pad * 2 - 48, 120, 18), () => rgba([8, 24, 54], 1), { samples: 2 });
  const route = [
    [pad + 64, stripY + 82],
    [pad + 150, stripY + 46],
    [pad + 250, stripY + 60],
    [pad + 360, stripY + 34],
    [pad + 470, stripY + 48],
    [pad + 580, stripY + 30],
  ];
  for (let i = 1; i < route.length; i += 1) {
    const complete = i <= 3;
    canvas.paint(capsule(route[i - 1][0], route[i - 1][1], route[i][0], route[i][1], 8), () => rgba(complete ? EMERALD : SLATE, complete ? 1 : 0.35), { samples: 3 });
  }
  canvas.paint(circle(route[0][0], route[0][1], 13), () => rgba(WHITE, 1), { samples: 3 });
  canvas.paint(circle(route[3][0], route[3][1], 11), () => rgba(AMBER, 1), { samples: 3 });
  canvas.paint(ring(route[3][0], route[3][1], 11, 18), () => rgba(AMBER, 0.35), { samples: 2 });
  canvas.paint(circle(route[route.length - 1][0], route[route.length - 1][1], 13), () => rgba(RED, 1), { samples: 3 });

  drawText(canvas, { x: pad + 24, y: stripY + 140, text: 'CHECKPOINT 1 MET - NEXT IN 8 MIN', scale: 2, colour: EMERALD });
  drawText(canvas, { x: pad + 24, y: stripY + 166, text: 'RISK 10 - LOW (HEURISTIC)', scale: 2, colour: SLATE });

  // SOS button
  const sosY = journeyY + 372;
  canvas.paint(circle(width / 2, sosY + 20, 74), () => rgba(RED, 1), { samples: 4 });
  canvas.paint(ring(width / 2, sosY + 20, 74, 82), () => rgba(RED, 0.25), { samples: 3 });
  drawText(canvas, { x: width / 2 - textWidth('SOS', 7, 2) / 2, y: sosY - 8, text: 'SOS', scale: 7, colour: WHITE, tracking: 2 });
  drawText(canvas, { x: width / 2 - textWidth('HOLD 1.5 S - SILENT MODE AVAILABLE', 2, 1) / 2, y: sosY + 112, text: 'HOLD 1.5 S - SILENT MODE AVAILABLE', scale: 2, colour: SLATE });

  // Bottom navigation
  const navY = height - 118;
  canvas.paint(roundRect(pad, navY, width - pad * 2, 96, 28), () => rgba(NAVY_CARD, 1), { samples: 2 });
  const labels = ['HOME', 'JOURNEYS', 'REPORT', 'INBOX', 'SETTINGS'];
  labels.forEach((label, index) => {
    const slot = (width - pad * 2) / labels.length;
    const cx = pad + slot * index + slot / 2;
    canvas.paint(roundRect(cx - 16, navY + 22, 32, 26, 8), () => rgba(index === 0 ? TEAL : SLATE, index === 0 ? 1 : 0.5), { samples: 2 });
    drawText(canvas, {
      x: cx - textWidth(label, 2, 1) / 2,
      y: navY + 60,
      text: label,
      scale: 2,
      colour: index === 0 ? TEAL_LIGHT : SLATE,
    });
  });

  return canvas;
}

function renderDesktopScreenshot() {
  const width = 1440;
  const height = 900;
  const canvas = new Canvas(width, height, rgba([4, 13, 33], 1));

  // Sidebar
  canvas.paint(roundRect(0, 0, 300, height, 0), () => rgba(NAVY_CARD, 1), { samples: 2 });
  drawMark(canvas, { x: 36, y: 40, size: 56, detailed: false });
  drawText(canvas, { x: 108, y: 48, text: 'SURAKSHA', scale: 4, colour: WHITE, tracking: 2 });
  drawText(canvas, { x: 108, y: 80, text: 'SAFETY DASHBOARD', scale: 2, colour: TEAL_LIGHT });
  const navItems = ['OVERVIEW', 'JOURNEYS', 'GUARDIANS', 'REPORTS', 'COMMUNITY', 'TIMELINE', 'SETTINGS'];
  navItems.forEach((label, index) => {
    const y = 160 + index * 62;
    if (index === 1) canvas.paint(roundRect(20, y - 14, 260, 48, 14), () => rgba(TEAL, 0.18), { samples: 2 });
    canvas.paint(roundRect(36, y - 4, 20, 18, 6), () => rgba(index === 1 ? TEAL_LIGHT : SLATE, index === 1 ? 1 : 0.5), { samples: 2 });
    drawText(canvas, { x: 72, y, text: label, scale: 2.6, colour: index === 1 ? WHITE : SLATE });
  });

  // Header
  drawText(canvas, { x: 340, y: 46, text: 'GUARDIAN MODE - EVALUATING ON DEVICE', scale: 3, colour: WHITE });
  drawText(canvas, { x: 340, y: 84, text: 'OFFLINE READY - LAST SYNC 4 MIN AGO', scale: 2, colour: TEAL_LIGHT });
  canvas.paint(roundRect(width - 300, 40, 120, 44, 22), () => rgba(EMERALD, 0.18), { samples: 2 });
  drawText(canvas, { x: width - 282, y: 56, text: 'OFFLINE OK', scale: 2, colour: EMERALD });
  canvas.paint(roundRect(width - 160, 40, 120, 44, 22), () => rgba(RED, 0.9), { samples: 2 });
  drawText(canvas, { x: width - 138, y: 56, text: 'SOS', scale: 2.6, colour: WHITE });

  // Status tiles
  const tiles = [
    { label: 'RISK INDICATOR', value: '25 / 100', note: 'MEDIUM - HEURISTIC', colour: AMBER },
    { label: 'ROUTE PROGRESS', value: '62 PERCENT', note: '2 OF 3 CHECKPOINTS', colour: EMERALD },
    { label: 'DELAY', value: '4 MIN', note: 'WITHIN THE WINDOW', colour: WHITE },
    { label: 'CONTACTS READY', value: '2 OF 3', note: 'QUEUED LOCALLY', colour: TEAL_LIGHT },
  ];
  tiles.forEach((tile, index) => {
    const x = 340 + index * 268;
    tintedCard(canvas, { x, y: 130, width: 244, height: 150 });
    drawText(canvas, { x: x + 20, y: 156, text: tile.label, scale: 2, colour: SLATE });
    drawText(canvas, { x: x + 20, y: 190, text: tile.value, scale: 3.4, colour: tile.colour });
    drawText(canvas, { x: x + 20, y: 236, text: tile.note, scale: 2, colour: SLATE });
  });

  // Map panel
  const map = { x: 340, y: 306, width: 720, height: 400 };
  tintedCard(canvas, { ...map, radius: 20 });
  const points = [
    [map.x + 80, map.y + 300],
    [map.x + 200, map.y + 210],
    [map.x + 330, map.y + 250],
    [map.x + 450, map.y + 150],
    [map.x + 570, map.y + 190],
    [map.x + 650, map.y + 90],
  ];
  for (let i = 1; i < points.length; i += 1) {
    canvas.paint(capsule(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], 10), () => rgba(i <= 3 ? EMERALD : SLATE, i <= 3 ? 1 : 0.4), { samples: 3 });
  }
  canvas.paint(circle(points[0][0], points[0][1], 14), () => rgba(WHITE, 1), { samples: 3 });
  canvas.paint(circle(points[3][0], points[3][1], 16), () => rgba(AMBER, 1), { samples: 3 });
  canvas.paint(ring(points[3][0], points[3][1], 16, 26), () => rgba(AMBER, 0.3), { samples: 2 });
  canvas.paint(circle(points[4][0], points[4][1], 12), () => rgba(TEAL_LIGHT, 1), { samples: 3 });
  canvas.paint(circle(points[points.length - 1][0], points[points.length - 1][1], 14), () => rgba(RED, 1), { samples: 3 });
  drawText(canvas, { x: map.x + 24, y: map.y + map.height - 46, text: 'OFFLINE TILES - Z11-16 CACHED', scale: 2, colour: SLATE });

  // Right column: alerts and check-in
  tintedCard(canvas, { x: 1084, y: 306, width: 320, height: 240 });
  drawText(canvas, { x: 1108, y: 332, text: 'CHECK-IN', scale: 2, colour: TEAL_LIGHT });
  drawText(canvas, { x: 1108, y: 366, text: 'ARE YOU SAFE?', scale: 3, colour: WHITE });
  drawText(canvas, { x: 1108, y: 408, text: 'NOBODY HAS BEEN CONTACTED', scale: 2, colour: SLATE });
  canvas.paint(roundRect(1108, 440, 130, 44, 14), () => rgba(EMERALD, 0.9), { samples: 2 });
  drawText(canvas, { x: 1134, y: 456, text: 'IM SAFE', scale: 2.4, colour: [4, 13, 33] });
  canvas.paint(roundRect(1252, 440, 130, 44, 14), () => rgba(RED, 0.85), { samples: 2 });
  drawText(canvas, { x: 1272, y: 456, text: 'NEED HELP', scale: 2.4, colour: WHITE });

  tintedCard(canvas, { x: 1084, y: 566, width: 320, height: 140 });
  drawText(canvas, { x: 1108, y: 592, text: 'TIMELINE', scale: 2, colour: TEAL_LIGHT });
  const timeline = ['JOURNEY STARTED 22:04', 'CHECKPOINT 1 MET 22:14', 'DEVIATION NOTED 22:31'];
  timeline.forEach((line, index) => {
    canvas.paint(circle(1116, 626 + index * 26, 5), () => rgba(index === 2 ? AMBER : EMERALD, 1), { samples: 3 });
    drawText(canvas, { x: 1132, y: 618 + index * 26, text: line, scale: 2, colour: SLATE });
  });

  return canvas;
}

/* --------------------------------- output -------------------------------- */

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="SURAKSHA shield">
  <title>SURAKSHA</title>
  <defs>
    <linearGradient id="surakshaLogoGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0A1F44" />
      <stop offset="55%" stop-color="#0D9488" />
      <stop offset="100%" stop-color="#0F766E" />
    </linearGradient>
  </defs>
  <path d="M48 6 14 19v30c0 20.4 14.2 37.7 34 43 19.8-5.3 34-22.6 34-43V19L48 6Z" fill="url(#surakshaLogoGrad)" />
  <path d="M48 14 21 24.4v24.6c0 16.4 11.2 30.4 27 35.1 15.8-4.7 27-18.7 27-35.1V24.4L48 14Z" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.45)" stroke-width="2.5" />
  <path d="M31 48.5 43 60.5 65 38" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" />
  <circle cx="72" cy="26" r="7" fill="#EF4444" stroke="#ffffff" stroke-width="2.5" />
</svg>
`;

function write(relativePath, data) {
  const target = join(publicDir, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
  const size = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
  console.log(`  ${relativePath.padEnd(38)} ${(size / 1024).toFixed(1)} kB`);
}

console.log('SURAKSHA — generating brand assets into apps/web/public');

write(join('icons', 'logo.svg'), LOGO_SVG);
for (const size of [192, 512]) {
  write(join('icons', `icon-${size}.png`), encodePng(renderIcon(size)));
}
for (const size of [192, 512]) {
  write(join('icons', `maskable-${size}.png`), encodePng(renderIcon(size, { maskable: true })));
}
write(join('screenshots', 'home-mobile.png'), encodePng(renderMobileScreenshot()));
write(join('screenshots', 'home-desktop.png'), encodePng(renderDesktopScreenshot()));

console.log('Done. These files are referenced by vite.config.ts and the web manifest.');
