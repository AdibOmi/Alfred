// One-off generator for Alfred's app + tray icons (no image-library dependency).
// Encodes raw RGBA pixel buffers as minimal PNGs using Node's built-in zlib.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
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
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function mix(base, tint, amount) {
  return base.map((c, i) => Math.round(c + (tint[i] - c) * amount));
}

// Bat-signal style icon: near-black rounded square, periwinkle-lavender circular spotlight,
// dark bat silhouette (body + wings + ears) punched out of the circle.
function drawAppIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const navy = [6, 6, 10, 255];
  const blue = [163, 178, 240, 255];
  const cx = size / 2;
  const cy = size / 2;
  const spotlightR = size * 0.4;
  const cornerR = size * 0.18;

  const inRoundedSquare = (x, y) => {
    const pad = size * 0.04;
    const halfW = size / 2 - pad;
    const dx = Math.abs(x - cx) - (halfW - cornerR);
    const dy = Math.abs(y - cy) - (halfW - cornerR);
    const qx = Math.max(dx, 0);
    const qy = Math.max(dy, 0);
    const dist = Math.sqrt(qx * qx + qy * qy) + Math.min(Math.max(dx, dy), 0) - cornerR;
    return dist <= 0;
  };

  const inBat = (nx, ny) => {
    // nx, ny normalized to [-1, 1] around center
    const bodyEllipse = (nx / 0.09) ** 2 + (ny / 0.22) ** 2 <= 1;
    const earL = ny < -0.12 && ny > -0.32 && nx > -0.11 && nx < -0.02 && Math.abs(nx + 0.06) < (ny + 0.32) * 0.35 + 0.02;
    const earR = ny < -0.12 && ny > -0.32 && nx < 0.11 && nx > 0.02 && Math.abs(nx - 0.06) < (ny + 0.32) * 0.35 + 0.02;
    const wingSpan = 0.62;
    const inWing = (sign) => {
      const wx = nx * sign;
      if (wx < 0.03 || wx > wingSpan) return false;
      const t = (wx - 0.03) / (wingSpan - 0.03);
      const topEdge = -0.02 - t * 0.34 + Math.sin(t * Math.PI * 3) * 0.05 * (1 - t);
      const bottomEdge = 0.05 + t * 0.42;
      return ny > topEdge && ny < bottomEdge;
    };
    return bodyEllipse || earL || earR || inWing(1) || inWing(-1);
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      let color = navy;
      if (inRoundedSquare(x, y)) {
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= spotlightR) {
          const glow = Math.max(0, 1 - dist / spotlightR);
          color = mix(navy, blue, 0.55 + glow * 0.45);
          const nx = dx / size;
          const ny = dy / size;
          if (inBat(nx, ny)) color = navy;
        } else {
          color = navy;
        }
      } else {
        rgba[idx] = 0;
        rgba[idx + 1] = 0;
        rgba[idx + 2] = 0;
        rgba[idx + 3] = 0;
        continue;
      }
      rgba[idx] = color[0];
      rgba[idx + 1] = color[1];
      rgba[idx + 2] = color[2];
      rgba[idx + 3] = 255;
    }
  }
  return rgba;
}

// Small tray icon: simple glowing periwinkle-lavender dot on a transparent field, legible at 16-32px.
function drawTrayIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const blue = [163, 178, 240];
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.34;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= r) {
        rgba[idx] = blue[0];
        rgba[idx + 1] = blue[1];
        rgba[idx + 2] = blue[2];
        rgba[idx + 3] = 255;
      } else if (dist <= r + size * 0.06) {
        const fade = 1 - (dist - r) / (size * 0.06);
        rgba[idx] = blue[0];
        rgba[idx + 1] = blue[1];
        rgba[idx + 2] = blue[2];
        rgba[idx + 3] = Math.round(255 * fade * 0.5);
      } else {
        rgba[idx + 3] = 0;
      }
    }
  }
  return rgba;
}

const buildDir = path.join(__dirname, '..', 'build');
const resourcesDir = path.join(__dirname, '..', 'resources');
fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(resourcesDir, { recursive: true });

fs.writeFileSync(path.join(buildDir, 'icon.png'), encodePNG(512, 512, drawAppIcon(512)));
fs.writeFileSync(path.join(resourcesDir, 'tray-icon.png'), encodePNG(32, 32, drawTrayIcon(32)));
fs.writeFileSync(path.join(resourcesDir, 'tray-icon@2x.png'), encodePNG(64, 64, drawTrayIcon(64)));

console.log('Generated build/icon.png, resources/tray-icon.png, resources/tray-icon@2x.png');
