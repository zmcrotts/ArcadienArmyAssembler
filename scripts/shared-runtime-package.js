"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SHARED_RUNTIME_FILES = Object.freeze([
  ["ui/engine-data-manifest.js", "engine-data-manifest.js"],
  ["ui/engine-runtime.js", "engine-runtime.js"],
  ["src/domain/army.js", "domain/army.js"],
  ["src/domain/roster-document.js", "domain/roster-document.js"],
  ["src/domain/roster-share-code.js", "domain/roster-share-code.js"],
  ["node_modules/qrcode-generator/qrcode.js", "vendor/qrcode-generator.js"],
  ["src/domain/roster-qr.js", "domain/roster-qr.js"],
  ["src/domain/sheets.js", "domain/sheets.js"],
  ["data/manual-rules/40k-compactor-skippable-wargear.json", "data/40k-compactor-skippable-wargear.json"]
]);

const SHARED_RUNTIME_DIRECTORIES = Object.freeze([
  ["ui/engine-data", "engine-data"],
  ["ui/assets", "assets"]
]);

function copyFile(projectRoot, outDir, source, target) {
  const from = path.join(projectRoot, source);
  const to = path.join(outDir, target);
  if (!fs.existsSync(from)) throw new Error(`Missing shared runtime file: ${source}`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDirectory(projectRoot, outDir, source, target) {
  const from = path.join(projectRoot, source);
  const to = path.join(outDir, target);
  if (!fs.existsSync(from)) throw new Error(`Missing shared runtime directory: ${source}`);
  fs.cpSync(from, to, { recursive: true });
}

function copySharedRuntime(projectRoot, outDir) {
  for (const [source, target] of SHARED_RUNTIME_FILES) copyFile(projectRoot, outDir, source, target);
  for (const [source, target] of SHARED_RUNTIME_DIRECTORIES) copyDirectory(projectRoot, outDir, source, target);
}

module.exports = {
  SHARED_RUNTIME_DIRECTORIES,
  SHARED_RUNTIME_FILES,
  copySharedRuntime
};
