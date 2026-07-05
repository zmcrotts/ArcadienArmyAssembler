"use strict";

const fs = require("fs");
const path = require("path");
const {
  DEFAULT_RULESET_SOURCE_ID,
  extractNormalizedRuleset
} = require("../src/rulesets/sources");
const { calculateEntryPoints } = require("../src/domain/pricing");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "data", "audits");
const DEFINITIONS_OUT = path.join(OUT_DIR, "bsdata-unit-definitions.json");
const AUDIT_OUT = path.join(OUT_DIR, "bsdata-pricing-audit.json");
const REPORT_OUT = path.join(OUT_DIR, "bsdata-pricing-audit.md");

const { source, units: definitions, unresolved } = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID);

const issues = [];
let variableComposition = 0;
let pointModifiers = 0;
let supportedModifiers = 0;

for (const unit of definitions) {
  const variable = unit.composition.some(item =>
    item.min !== null && item.max !== null && item.min !== item.max
  );
  if (variable) variableComposition++;

  pointModifiers += unit.pricing.modifiers.length;
  supportedModifiers += unit.pricing.modifiers.filter(item => item.supported).length;

  const minimumSelections = Object.fromEntries(
    unit.composition.map(item => [item.id, item.defaultCount ?? 0])
  );
  for (const group of unit.compositionConstraints || []) {
    const current = group.selectionIds.reduce((sum, id) => sum + Number(minimumSelections[id] || 0), 0);
    let needed = Math.max(0, Number(group.min || 0) - current);
    const candidates = unit.composition
      .filter(item => group.selectionIds.includes(item.id))
      .sort((a, b) => Number(a.points || 0) - Number(b.points || 0));
    for (const candidate of candidates) {
      if (needed <= 0) break;
      const available = candidate.max === null
        ? needed
        : Math.max(0, candidate.max - Number(minimumSelections[candidate.id] || 0));
      const add = Math.min(needed, available);
      minimumSelections[candidate.id] = Number(minimumSelections[candidate.id] || 0) + add;
      needed -= add;
    }
  }
  const minimumResult = calculateEntryPoints(unit, {
    schemaVersion: 1,
    instanceId: "audit-minimum",
    unitId: unit.id,
    selections: minimumSelections
  }, { allowInvalid: true });
  const minimumPoints = minimumResult.points;
  if (minimumResult.validationErrors.length) {
    issues.push({
      type: "minimum-entry-requires-choice",
      severity: "info",
      selectionKey: unit.selectionKey,
      faction: unit.faction,
      name: unit.name,
      details: minimumResult.validationErrors
    });
  }
  if (minimumPoints === 0) {
    issues.push({
      type: "zero-minimum-points",
      severity: "warning",
      selectionKey: unit.selectionKey,
      faction: unit.faction,
      name: unit.name
    });
  }
  if (unit.composition.length === 0) {
    issues.push({ type: "no-model-composition", selectionKey: unit.selectionKey, faction: unit.faction, name: unit.name });
  }
  if (unit.pricing.unitBase !== null && unit.pricing.linkBase !== null && unit.pricing.unitBase !== unit.pricing.linkBase) {
    issues.push({
      type: "conflicting-unit-and-link-base",
      selectionKey: unit.selectionKey,
      faction: unit.faction,
      name: unit.name,
      unitBase: unit.pricing.unitBase,
      linkBase: unit.pricing.linkBase
    });
  }
  for (const modifier of unit.pricing.modifiers) {
    if (!modifier.supported) {
      issues.push({
        type: "unsupported-point-modifier",
        selectionKey: unit.selectionKey,
        faction: unit.faction,
        name: unit.name,
        modifier
      });
    }
  }
}

for (const item of unresolved) issues.push({ type: "unresolved-entry-link", ...item });

const summary = {
  generatedAt: new Date().toISOString(),
  source: path.relative(ROOT, source.sourcePath),
  overridesApplied: false,
  selectableUnits: definitions.length,
  variableCompositionUnits: variableComposition,
  pointModifiers,
  supportedPointModifiers: supportedModifiers,
  unsupportedPointModifiers: pointModifiers - supportedModifiers,
  allPointModifierShapesInterpreted: pointModifiers === supportedModifiers,
  unresolvedEntryLinks: unresolved.length,
  issueCounts: Object.fromEntries(
    [...new Set(issues.map(issue => issue.type))]
      .sort()
      .map(type => [type, issues.filter(issue => issue.type === type).length])
  )
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const compactDefinitions = definitions.map(({ selectionTree, ...definition }) => definition);
fs.writeFileSync(DEFINITIONS_OUT, JSON.stringify({
  schemaVersion: 1,
  purpose: "pricing-and-composition-audit",
  selectionTreesOmitted: true,
  units: compactDefinitions
}, null, 2));
fs.writeFileSync(AUDIT_OUT, JSON.stringify({ summary, issues }, null, 2));

const warningIssues = issues.filter(issue => issue.severity === "warning");
const infoIssues = issues.filter(issue => issue.severity === "info");
const report = [
  "# BSData Unit Pricing Audit",
  "",
  `Generated: ${summary.generatedAt}`,
  "",
  "This audit reads only the imported BSData `.cat` and `.gst` files. The 11th-edition override workbook and JSON are not loaded.",
  "",
  "## Coverage",
  "",
  `- Selectable unit entries checked: ${summary.selectableUnits}`,
  `- Units with variable model composition: ${summary.variableCompositionUnits}`,
  `- Point modifiers checked: ${summary.pointModifiers}`,
  `- Point modifiers interpreted: ${summary.supportedPointModifiers}`,
  `- Unsupported point modifiers: ${summary.unsupportedPointModifiers}`,
  `- Unresolved entry links: ${summary.unresolvedEntryLinks}`,
  "",
  "## Warnings",
  "",
  ...(warningIssues.length
    ? warningIssues.map(issue => `- ${issue.faction} — ${issue.name}: ${issue.type}`)
    : ["None."]),
  "",
  "## Informational composition choices",
  "",
  "These units have alternative model branches, so a legal default cannot be selected without making a loadout choice. Their model leaves, group limits, and pricing modifiers were still extracted.",
  "",
  ...(infoIssues.length
    ? infoIssues.map(issue => `- ${issue.faction} — ${issue.name}`)
    : ["None."]),
  ""
].join("\n");
fs.writeFileSync(REPORT_OUT, report);

console.log(JSON.stringify(summary, null, 2));
console.log(`Definitions: ${DEFINITIONS_OUT}`);
console.log(`Audit: ${AUDIT_OUT}`);
console.log(`Report: ${REPORT_OUT}`);

if (summary.unsupportedPointModifiers > 0) process.exitCode = 2;
