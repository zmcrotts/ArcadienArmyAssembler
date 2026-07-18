"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function auxiliaryPaths(auxiliarySources) {
  return Object.values(auxiliarySources || {}).flatMap(asArray).filter(Boolean);
}

function visitFiles(targetPath, files, missing) {
  if (!fs.existsSync(targetPath)) {
    missing.push(path.resolve(targetPath));
    return;
  }

  const stats = fs.statSync(targetPath);
  if (stats.isFile()) {
    files.push(path.resolve(targetPath));
    return;
  }

  if (!stats.isDirectory()) return;
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    visitFiles(path.join(targetPath, entry.name), files, missing);
  }
}

function relativeIdentity(filePath, root = ROOT) {
  const relative = path.relative(root, filePath);
  return (relative && !relative.startsWith(".."))
    ? relative.replace(/\\/g, "/")
    : path.resolve(filePath).replace(/\\/g, "/");
}

function sourceFingerprint(source, options = {}) {
  if (!source?.sourcePath) throw new Error("A ruleset sourcePath is required to calculate a fingerprint.");
  const root = path.resolve(options.root || ROOT);
  const files = [];
  const missing = [];

  visitFiles(source.sourcePath, files, missing);
  for (const auxiliaryPath of auxiliaryPaths(source.auxiliarySources)) {
    visitFiles(auxiliaryPath, files, missing);
  }

  const uniqueFiles = [...new Set(files)].sort((left, right) =>
    relativeIdentity(left, root).localeCompare(relativeIdentity(right, root))
  );
  const uniqueMissing = [...new Set(missing)].sort((left, right) =>
    relativeIdentity(left, root).localeCompare(relativeIdentity(right, root))
  );
  const hash = crypto.createHash("sha256");

  for (const filePath of uniqueFiles) {
    const identity = relativeIdentity(filePath, root);
    const contents = fs.readFileSync(filePath);
    hash.update(`file\0${identity}\0${contents.length}\0`, "utf8");
    hash.update(contents);
    hash.update("\0", "utf8");
  }
  for (const missingPath of uniqueMissing) {
    hash.update(`missing\0${relativeIdentity(missingPath, root)}\0`, "utf8");
  }

  return {
    algorithm: "sha256",
    value: hash.digest("hex"),
    fileCount: uniqueFiles.length,
    missing: uniqueMissing.map(filePath => relativeIdentity(filePath, root))
  };
}

module.exports = { sourceFingerprint };
