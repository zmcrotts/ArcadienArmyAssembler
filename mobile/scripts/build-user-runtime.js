"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PROJECT_ROOT = path.resolve(ROOT, "..");
const OUT_DIR = path.join(ROOT, "dist-user");

const FILES = [
  ["ui/styles.css", "styles.css"],
  ["ui/engine-app.js", "engine-app.js"],
  ["ui/engine-runtime.js", "engine-runtime.js"],
  ["ui/catalogue-sections.js", "catalogue-sections.js"],
  ["src/domain/army.js", "domain/army.js"],
  ["src/domain/roster-document.js", "domain/roster-document.js"],
  ["src/domain/sheets.js", "domain/sheets.js"]
];

const PROJECT_FILES = [
  ["ui/engine-data-manifest.js", "engine-data-manifest.js"],
  ["data/manual-rules/40k-compactor-skippable-wargear.json", "data/40k-compactor-skippable-wargear.json"]
];

function copyFile(source, target) {
  const from = path.join(ROOT, source);
  const to = path.join(OUT_DIR, target);
  if (!fs.existsSync(from)) throw new Error(`Missing runtime file: ${source}`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyProjectFile(source, target) {
  const from = path.join(PROJECT_ROOT, source);
  const to = path.join(OUT_DIR, target);
  if (!fs.existsSync(from)) throw new Error(`Missing shared project file: ${source}`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDirectory(source, target) {
  const from = path.join(ROOT, source);
  const to = path.join(OUT_DIR, target);
  if (!fs.existsSync(from)) throw new Error(`Missing runtime directory: ${source}`);
  fs.cpSync(from, to, { recursive: true });
}

function copyProjectDirectory(source, target) {
  const from = path.join(PROJECT_ROOT, source);
  const to = path.join(OUT_DIR, target);
  if (!fs.existsSync(from)) throw new Error(`Missing shared project directory: ${source}`);
  fs.cpSync(from, to, { recursive: true });
}

function buildIndex() {
  const source = path.join(ROOT, "ui", "index.html");
  let html = fs.readFileSync(source, "utf8");

  html = html
    .replace(/<script(?:\s+defer)? src="engine-data-milestone15\.js"><\/script>/, '<script defer src="engine-data-manifest.js"></script>')
    .replace(/<script(?:\s+defer)? src="engine-data-manifest\.js"><\/script>/, '<script defer src="engine-data-manifest.js"></script>')
    .replace(/<script(?:\s+defer)? src="engine-runtime\.js\?v=([^"]+)"><\/script>/, '<script defer src="engine-runtime.js?v=$1"></script>')
    .replace(/<script(?:\s+defer)? src="\.\.\/src\/domain\/army\.js\?v=([^"]+)"><\/script>/, '<script defer src="domain/army.js?v=$1"></script>')
    .replace(/<script(?:\s+defer)? src="\.\.\/src\/domain\/roster-document\.js\?v=([^"]+)"><\/script>/, '<script defer src="domain/roster-document.js?v=$1"></script>')
    .replace(/<script(?:\s+defer)? src="\.\.\/src\/domain\/sheets\.js\?v=([^"]+)"><\/script>/, '<script defer src="domain/sheets.js?v=$1"></script>')
    .replace(/<script(?:\s+defer)? src="catalogue-sections\.js\?v=([^"]+)"><\/script>/, '<script defer src="catalogue-sections.js?v=$1"></script>')
    .replace(/<script(?:\s+defer)? src="engine-app\.js\?v=([^"]+)"><\/script>/, '<script defer src="engine-app.js?v=$1"></script>');

  fs.writeFileSync(path.join(OUT_DIR, "index.html"), html, "utf8");
}

function writeReadme() {
  const readme = [
    "Roster Builder",
    "",
    "This folder is the offline runtime build of the roster builder.",
    "",
    "Use:",
    "- In the desktop app, run Roster Builder from the installed shortcut.",
    "- For a plain browser check, open index.html from this folder.",
    "",
    "Saved rosters:",
    "- In the desktop app, saves live in the app's local Windows data folder.",
    "- The rules data is bundled in engine-data-manifest.js plus engine-data/*.js and does not require internet access.",
    "",
    "Generated files in this folder should not be edited by hand. Rebuild from the project source instead."
  ].join("\r\n");

  fs.writeFileSync(path.join(OUT_DIR, "README.txt"), readme, "utf8");
}

function main() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [source, target] of FILES) copyFile(source, target);
  for (const [source, target] of PROJECT_FILES) copyProjectFile(source, target);
  copyProjectDirectory("ui/engine-data", "engine-data");
  copyProjectDirectory("ui/assets", "assets");
  buildIndex();
  writeReadme();

  const bundle = fs.statSync(path.join(OUT_DIR, "engine-data-manifest.js"));
  console.log(`Built ${OUT_DIR}`);
  console.log(`Runtime manifest: ${(bundle.size / 1024 / 1024).toFixed(2)} MB`);
}

if (require.main === module) main();
