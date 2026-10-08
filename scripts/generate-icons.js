// `npm run icons`: draws Alfred's app and tray icons from the emblem in src/shared/emblem.ts.
// No image-library dependency: the emblem's SVG paths are flattened to polygons, rasterised with
// 4x4 supersampling for smooth edges, and encoded as PNGs with Node's built-in zlib.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------------------------------------------------------------- PNG encoding

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- the emblem

function readEmblem() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'emblem.ts'), 'utf8');
  const viewBox = Number(/EMBLEM_VIEWBOX = (\d+)/.exec(source)[1]);
  const block = /EMBLEM_PATHS[^=]*=\s*\[([\s\S]*?)\];/.exec(source)[1];
  const paths = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  return { viewBox, polygons: paths.map(flatten) };
}

/** SVG path (absolute M/L/Q/C/Z) to a polygon. */
function flatten(d) {
  const tokens = d.match(/[MLQCZ]|-?\d*\.?\d+/g);
  const points = [];
  let i = 0;
  let cur = [0, 0];
  const num = () => Number(tokens[i++]);
  const STEPS = 24;
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === 'M' || cmd === 'L') {
      cur = [num(), num()];
      points.push(cur);
    } else if (cmd === 'Q') {
      const c = [num(), num()];
      const end = [num(), num()];
      for (let s = 1; s <= STEPS; s++) {
        const t = s / STEPS;
        const u = 1 - t;
        points.push([u * u * cur[0] + 2 * u * t * c[0] + t * t * end[0], u * u * cur[1] + 2 * u * t * c[1] + t * t * end[1]]);
      }
      cur = end;
    } else if (cmd === 'C') {
      const c1 = [num(), num()];
      const c2 = [num(), num()];
      const end = [num(), num()];
      for (let s = 1; s <= STEPS; s++) {
        const t = s / STEPS;
        const u = 1 - t;
        const a = u * u * u;
        const b = 3 * u * u * t;
        const c = 3 * u * t * t;
        const e = t * t * t;
        points.push([
          a * cur[0] + b * c1[0] + c * c2[0] + e * end[0],
          a * cur[1] + b * c1[1] + c * c2[1] + e * end[1],
        ]);
      }
      cur = end;
    } else if (cmd !== 'Z') {
      throw new Error(`Unsupported path command ${cmd} in emblem.ts`);
    }
  }
  return points;
}

function insidePolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------- drawing

const SAMPLES = 4;

function canvas(size) {
  return { size, rgba: Buffer.alloc(size * size * 4) };
}

/** Source-over blend of a colour at the given coverage (0-1). */
function blend(img, x, y, color, coverage) {
  if (coverage <= 0) return;
  const idx = (y * img.size + x) * 4;
  const a = (color[3] ?? 1) * coverage;
  const dstA = img.rgba[idx + 3] / 255;
  const outA = a + dstA * (1 - a);
  for (let k = 0; k < 3; k++) {
    const dst = img.rgba[idx + k];
    img.rgba[idx + k] = Math.round((color[k] * a + dst * dstA * (1 - a)) / (outA || 1));
  }
  img.rgba[idx + 3] = Math.round(outA * 255);
}

/** Fills wherever `inside(x, y)` holds, supersampled; `shade(x, y)` may vary the colour. */
function fill(img, inside, shade, bounds = [0, 0, img.size, img.size]) {
  const [x0, y0, x1, y1] = bounds.map((v, k) => (k < 2 ? Math.max(0, Math.floor(v)) : Math.min(img.size, Math.ceil(v))));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          if (inside(x + (sx + 0.5) / SAMPLES, y + (sy + 0.5) / SAMPLES)) hits++;
        }
      }
      if (hits) blend(img, x, y, shade(x + 0.5, y + 0.5), hits / (SAMPLES * SAMPLES));
    }
  }
}

function roundedSquare(size, inset, radius) {
  const c = size / 2;
  const half = size / 2 - inset;
  return (x, y) => {
    const dx = Math.abs(x - c) - (half - radius);
    const dy = Math.abs(y - c) - (half - radius);
    return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius <= 0;
  };
}

function drawEmblem(img, emblem, width, centreY, color) {
  const scale = width / emblem.viewBox;
  const offsetX = (img.size - width) / 2;
  const offsetY = centreY - (emblem.viewBox / 2) * scale;
  const polys = emblem.polygons.map((poly) => poly.map(([x, y]) => [x * scale + offsetX, y * scale + offsetY]));
  const xs = polys.flat().map((p) => p[0]);
  const ys = polys.flat().map((p) => p[1]);
  fill(
    img,
    (x, y) => polys.some((poly) => insidePolygon(x, y, poly)),
    () => color,
    [Math.min(...xs) - 1, Math.min(...ys) - 1, Math.max(...xs) + 1, Math.max(...ys) + 1],
  );
}

const INK_TOP = [24, 26, 32];
const INK_BOTTOM = [6, 7, 10];
const WHITE = [244, 245, 247];

function vertical(size) {
  return (x, y) => {
    const t = y / size;
    return INK_TOP.map((c, k) => Math.round(c + (INK_BOTTOM[k] - c) * t));
  };
}

// App icon: a matte-black tile, a faint searchlight behind the emblem, a hairline silver edge.
function appIcon(emblem, size) {
  const img = canvas(size);
  const tile = roundedSquare(size, size * 0.04, size * 0.2);
  fill(img, tile, vertical(size));
  const glowR = size * 0.42;
  fill(
    img,
    (x, y) => tile(x, y) && Math.hypot(x - size / 2, y - size * 0.47) < glowR,
    (x, y) => [255, 255, 255, 0.07 * (1 - Math.hypot(x - size / 2, y - size * 0.47) / glowR)],
  );
  const inner = roundedSquare(size, size * 0.04 + Math.max(1, size * 0.006), size * 0.2 - size * 0.006);
  fill(img, (x, y) => tile(x, y) && !inner(x, y), () => [200, 204, 212, 0.55]);
  drawEmblem(img, emblem, size * 0.84, size * 0.47, WHITE);
  return img;
}

// Tray icon: legible on light and dark taskbars alike, so the emblem sits on its own dark tile.
function trayIcon(emblem, size) {
  const img = canvas(size);
  fill(img, roundedSquare(size, 0, size * 0.22), vertical(size));
  drawEmblem(img, emblem, size * 0.98, size * 0.48, WHITE);
  return img;
}

const emblem = readEmblem();
const root = path.join(__dirname, '..');
const outputs = [
  [path.join(root, 'build', 'icon.png'), appIcon(emblem, 512)],
  [path.join(root, 'resources', 'tray-icon.png'), trayIcon(emblem, 32)],
  [path.join(root, 'resources', 'tray-icon@2x.png'), trayIcon(emblem, 64)],
];
for (const [file, img] of outputs) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePNG(img.size, img.size, img.rgba));
  console.log(`wrote ${path.relative(root, file)}`);
}
