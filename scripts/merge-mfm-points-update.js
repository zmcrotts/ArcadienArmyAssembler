#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_TARGET = path.join(ROOT, "data", "manual-rules", "wh40k-11e-mfm-points.json");

function normalize(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function unitKey(change) {
  return [normalize(change.faction), normalize(change.unitName)].join("|");
}

function wargearKey(change) {
  return [unitKey(change), normalize(change.label).replace(/^(?:per\s+|\d+\s+)/, "")].join("|");
}

function enhancementKey(change) {
  return [
    normalize(change.faction),
    normalize(change.detachmentName),
    normalize(change.enhancementName).replace(/\s+upgrade$/, "")
  ].join("|");
}

function sortKey(change) {
  return [
    change.kind,
    change.faction,
    change.detachmentName || "",
    change.unitName || "",
    change.costBand || "",
    change.enhancementName || "",
    change.label || "",
    String(change.points).padStart(6, "0")
  ].join("|");
}

function mergeMfmPoints(base, update) {
  if (!Array.isArray(update?.changes) || !update.version) {
    throw new Error("The update must contain a version and changes array.");
  }

  const replacementUnits = new Set(update.changes.filter(item => item.kind === "unit").map(unitKey));
  const replacementWargear = new Set(update.changes.filter(item => item.kind === "wargear").map(wargearKey));
  const replacementEnhancements = new Set(update.changes.filter(item => item.kind === "enhancement").map(enhancementKey));

  const retained = (base.changes || []).filter(change => {
    if (change.kind === "unit") return !replacementUnits.has(unitKey(change));
    if (change.kind === "wargear") return !replacementWargear.has(wargearKey(change));
    if (change.kind === "enhancement") return !replacementEnhancements.has(enhancementKey(change));
    return true;
  });

  return {
    ...base,
    schemaVersion: base.schemaVersion || 1,
    source: "https://mfm.warhammer-community.com/en",
    version: update.version,
    generatedAt: update.generatedAt || (base.version === update.version ? base.generatedAt : new Date().toISOString()),
    changes: [...retained, ...update.changes].sort((left, right) => sortKey(left).localeCompare(sortKey(right)))
  };
}

function main() {
  const updatePath = process.argv[2] ? path.resolve(process.argv[2]) : null;
  const targetPath = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_TARGET;
  if (!updatePath) {
    throw new Error("Usage: node scripts/merge-mfm-points-update.js <flagged-update.json> [target.json]");
  }

  const base = JSON.parse(fs.readFileSync(targetPath, "utf8"));
  const update = JSON.parse(fs.readFileSync(updatePath, "utf8"));
  const merged = mergeMfmPoints(base, update);
  fs.writeFileSync(targetPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");

  const counts = Object.fromEntries(["unit", "wargear", "enhancement"].map(kind => [
    kind,
    update.changes.filter(item => item.kind === kind).length
  ]));
  process.stdout.write(`${JSON.stringify({ version: merged.version, total: merged.changes.length, applied: update.changes.length, ...counts }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { mergeMfmPoints };
