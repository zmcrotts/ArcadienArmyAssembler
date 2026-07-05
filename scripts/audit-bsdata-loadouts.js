"use strict";

const fs = require("fs");
const path = require("path");
const {
  DEFAULT_RULESET_SOURCE_ID,
  extractNormalizedRuleset
} = require("../src/rulesets/sources");
const {
  createDefaultRosterEntry,
  getConfiguredProfiles,
  listSelectableOptions,
  validateLoadout
} = require("../src/domain/loadout");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "data", "audits");
const JSON_OUT = path.join(OUT_DIR, "bsdata-loadout-audit.json");
const MARKDOWN_OUT = path.join(OUT_DIR, "bsdata-loadout-audit.md");

const { units: definitions } = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID);
const units = [];

for (const definition of definitions) {
  const options = listSelectableOptions(definition);
  const entry = createDefaultRosterEntry(definition, "audit-default");
  const validation = validateLoadout(definition, entry);
  const configured = getConfiguredProfiles(definition, entry);
  units.push({
    selectionKey: definition.selectionKey,
    faction: definition.faction,
    name: definition.name,
    optionCount: options.length,
    defaultSelectionCount: Object.values(entry.selections).filter(value => Number(value) > 0).length,
    configuredWeaponProfiles: configured.weapons.length,
    validation
  });
}

const unitsWithOptions = units.filter(unit => unit.optionCount > 0);
const invalidDefaults = units.filter(unit => unit.validation.length > 0);
const errorTypes = {};
for (const unit of invalidDefaults) {
  for (const error of unit.validation) {
    const key = `${error.type}:${error.name}`;
    errorTypes[key] = (errorTypes[key] || 0) + 1;
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  overridesApplied: false,
  selectableUnits: units.length,
  unitsWithOptions: unitsWithOptions.length,
  totalSelectableOptions: units.reduce((sum, unit) => sum + unit.optionCount, 0),
  validDefaults: units.length - invalidDefaults.length,
  invalidDefaults: invalidDefaults.length,
  defaultCoveragePercent: Number((((units.length - invalidDefaults.length) / units.length) * 100).toFixed(2))
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(JSON_OUT, JSON.stringify({ summary, units, errorTypes }, null, 2));

const markdown = [
  "# BSData Loadout Audit",
  "",
  `Generated: ${summary.generatedAt}`,
  "",
  "The audit reads BSData only. No 11th-edition overrides are loaded.",
  "",
  "## Coverage",
  "",
  `- Selectable units: ${summary.selectableUnits}`,
  `- Units exposing selectable options: ${summary.unitsWithOptions}`,
  `- Resolved selectable options: ${summary.totalSelectableOptions}`,
  `- Legal generated defaults: ${summary.validDefaults}`,
  `- Defaults requiring more interpretation: ${summary.invalidDefaults}`,
  `- Default coverage: ${summary.defaultCoveragePercent}%`,
  "",
  "## Defaults requiring more interpretation",
  "",
  ...(invalidDefaults.length
    ? invalidDefaults.map(unit => `- ${unit.faction} — ${unit.name}: ${unit.validation.length} validation error(s)`)
    : ["None."]),
  ""
].join("\n");
fs.writeFileSync(MARKDOWN_OUT, markdown);

console.log(JSON.stringify(summary, null, 2));
console.log(`Audit: ${JSON_OUT}`);
console.log(`Report: ${MARKDOWN_OUT}`);

if (invalidDefaults.length) process.exitCode = 2;
