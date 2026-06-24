import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function createPng(size) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  const center = size / 2;
  const outerRadius = size * 0.295;
  const cornerRadius = size * 0.22;

  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x += 1) {
      const index = y * stride + 1 + x * 4;
      const cornerX = Math.max(cornerRadius - x, 0, x - (size - cornerRadius));
      const cornerY = Math.max(cornerRadius - y, 0, y - (size - cornerRadius));
      const insideRounded = cornerX * cornerX + cornerY * cornerY <= cornerRadius * cornerRadius;
      const dx = x - center;
      const dy = y - center;
      const radius = Math.hypot(dx, dy);

      let r = 232;
      let g = 237;
      let b = 230;
      let a = insideRounded ? 255 : 0;

      if (radius < outerRadius) {
        const envelope = Math.exp(-(dx * dx + dy * dy) / (2 * (size * 0.135) ** 2));
        const rotated = (dx + dy) / Math.sqrt(2);
        const carrier = Math.cos((2 * Math.PI * rotated) / (size * 0.13));
        const value = Math.round(126 + 105 * envelope * carrier);
        r = value;
        g = value + 3;
        b = value;
      }

      if (Math.abs(radius - outerRadius) < size * 0.012) {
        r = 73;
        g = 105;
        b = 84;
      }

      raw[index] = Math.max(0, Math.min(255, r));
      raw[index + 1] = Math.max(0, Math.min(255, g));
      raw[index + 2] = Math.max(0, Math.min(255, b));
      raw[index + 3] = a;
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const [size, name] of [
  [192, "icons/icon-192.png"],
  [512, "icons/icon-512.png"],
  [180, "icons/apple-touch-icon.png"],
]) {
  writeFileSync(name, createPng(size));
}

console.log("Icons generated.");
