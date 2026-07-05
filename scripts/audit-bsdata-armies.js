"use strict";

const fs = require("fs");
const path = require("path");
const {
  DEFAULT_RULESET_SOURCE_ID,
  extractNormalizedRuleset
} = require("../src/rulesets/sources");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "data", "audits");
const JSON_OUT = path.join(OUT_DIR, "bsdata-army-audit.json");
const MARKDOWN_OUT = path.join(OUT_DIR, "bsdata-army-audit.md");

const ruleset = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID);
const armies = ruleset.armies;
const issues = [];
for (const army of armies) {
  const detachmentIds = new Set(army.detachments.map(item => item.id));
  for (const enhancement of army.enhancements) {
    for (const detachmentId of enhancement.detachmentIds) {
      if (!detachmentIds.has(detachmentId)) issues.push({ faction: army.faction, enhancement: enhancement.name, type: "unknown-detachment" });
    }
    if (!enhancement.eligibleSelectionKeys.length) {
      issues.push({ faction: army.faction, enhancement: enhancement.name, type: "no-eligible-unit" });
    }
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  rulesetId: ruleset.source.id,
  overridesApplied: false,
  armies: armies.length,
  detachments: armies.reduce((sum, army) => sum + army.detachments.length, 0),
  detachmentPointCosts: armies.reduce((sum, army) => sum + army.detachments.filter(item => Number(item.detachmentPoints || 0) > 0).length, 0),
  totalDetachmentPoints: armies.reduce((sum, army) => sum + army.detachments.reduce((count, item) => count + Number(item.detachmentPoints || 0), 0), 0),
  detachmentRules: armies.reduce((sum, army) => sum + army.detachments.reduce((count, item) => count + item.rules.length, 0), 0),
  stratagems: armies.reduce((sum, army) => sum + army.detachments.reduce((count, item) => count + item.stratagems.length, 0), 0),
  enhancements: armies.reduce((sum, army) => sum + army.enhancements.length, 0),
  issues: issues.length
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(JSON_OUT, JSON.stringify({ summary, armies, issues }, null, 2));
fs.writeFileSync(MARKDOWN_OUT, [
  "# BSData Army Audit",
  "",
  `Generated: ${summary.generatedAt}`,
  "",
  "This audit reads BSData only. No 11th-edition overrides are loaded.",
  "",
  `- Armies with detachment data: ${summary.armies}`,
  `- Detachments: ${summary.detachments}`,
  `- Detachments with Detachment Point costs: ${summary.detachmentPointCosts}`,
  `- Total Detachment Points across source: ${summary.totalDetachmentPoints}`,
  `- Detachment rules: ${summary.detachmentRules}`,
  `- Stratagems present in source: ${summary.stratagems}`,
  `- Enhancements: ${summary.enhancements}`,
  `- Extraction issues: ${summary.issues}`,
  ""
].join("\n"));

console.log(JSON.stringify(summary, null, 2));
console.log(`Audit: ${JSON_OUT}`);
console.log(`Report: ${MARKDOWN_OUT}`);
if (issues.length) process.exitCode = 2;
