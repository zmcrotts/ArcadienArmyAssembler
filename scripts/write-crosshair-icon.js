"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function createCrosshairPng(size = 256) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const center = (size - 1) / 2;
  const ringRadius = size * 0.31;
  const ringWidth = size * 0.035;
  const lineWidth = size * 0.035;
  const gap = size * 0.08;
  const color = [30, 36, 48, 255];

  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x - center;
      const dy = y - center;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const onRing = Math.abs(distance - ringRadius) <= ringWidth;
      const onVertical = Math.abs(dx) <= lineWidth && Math.abs(dy) >= gap && Math.abs(dy) <= ringRadius + ringWidth;
      const onHorizontal = Math.abs(dy) <= lineWidth && Math.abs(dx) >= gap && Math.abs(dx) <= ringRadius + ringWidth;
      const onCenter = distance <= size * 0.025;
      const offset = rowStart + 1 + (x * 4);

      if (onRing || onVertical || onHorizontal || onCenter) {
        raw[offset] = color[0];
        raw[offset + 1] = color[1];
        raw[offset + 2] = color[2];
        raw[offset + 3] = color[3];
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function createIco(png) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = 0;
  header[7] = 0;
  header[8] = 0;
  header[9] = 0;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

function ensureCrosshairIcon(targetPath = path.join(__dirname, "..", "build", "crosshair.ico")) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, createIco(createCrosshairPng()));
  return targetPath;
}

function ensureCrosshairPng(targetPath = path.join(__dirname, "..", "build", "crosshair.png")) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, createCrosshairPng());
  return targetPath;
}

if (require.main === module) {
  const targetPath = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
  const written = ensureCrosshairIcon(targetPath);
  const pngWritten = targetPath ? ensureCrosshairPng(targetPath.replace(/\.[^.]+$/, ".png")) : ensureCrosshairPng();
  console.log(`Wrote ${written}`);
  console.log(`Wrote ${pngWritten}`);
}

module.exports = { createCrosshairPng, ensureCrosshairIcon, ensureCrosshairPng };
