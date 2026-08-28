#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function key(row) {
  return JSON.stringify([
    row.kind, row.factionSlug, row.section, row.context, row.detachmentName,
    row.enhancementName, row.unitName, row.costBand, row.label, Number(row.points)
  ]);
}

function sortKey(row) {
  return [
    row.kind, row.faction, row.section || "", row.context || "", row.detachmentName || "",
    row.enhancementName || "", row.unitName || "", row.costBand || "", row.label || "",
    String(row.points).padStart(6, "0")
  ].join("|");
}

function main() {
  const fullPath = process.argv[2] ? path.resolve(process.argv[2]) : null;
  const reportPath = process.argv[3] ? path.resolve(process.argv[3]) : null;
  const outputPath = process.argv[4] ? path.resolve(process.argv[4]) : null;
  if (!fullPath || !reportPath || !outputPath) {
    throw new Error("Usage: node scripts/build-mfm-full-points.js <mfm-full.json> <reconciliation.json> <output.json>");
  }

  const full = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const pendingKeys = new Set([
    ...(report.unit?.unmatched || []).map(key),
    ...(report.wargear?.unmatchedUnits || []).map(key),
    ...(report.wargear?.unmatchedOptions || []).map(item => key(item.row)),
    ...(report.enhancement?.unmatched || []).map(key),
    ...(report.enhancement?.unmatchedArmies || []).map(key)
  ]);
  const changes = full.rows.filter(row => !pendingKeys.has(key(row))).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const derivedZeroCostChanges = (report.wargear?.extraPaidOptions || []).map(item => ({
    faction: item.unit.faction,
    factionSlug: null,
    sourceUrl: full.source,
    section: null,
    context: null,
    points: 0,
    kind: "wargear",
    unitName: item.unit.name,
    costBand: "WARGEAR OPTIONS",
    label: item.node.name,
    derivedFrom: "Absent from the complete current MFM paid-wargear table"
  }));
  changes.push(...derivedZeroCostChanges);
  changes.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const pendingChanges = full.rows.filter(row => pendingKeys.has(key(row))).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const document = {
    schemaVersion: 2,
    source: full.source,
    version: full.version,
    generatedAt: full.generatedAt,
    reconciliation: {
      mode: "full-table",
      pages: full.pages,
      extractedRows: full.rows.length,
      activeRows: changes.length,
      pendingRows: pendingChanges.length,
      derivedZeroCostRows: derivedZeroCostChanges.length
    },
    conditionalUnitSchedules: [],
    pendingChanges,
    changes
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ version: document.version, activeRows: changes.length, pendingRows: pendingChanges.length }, null, 2)}\n`);
}

if (require.main === module) main();
