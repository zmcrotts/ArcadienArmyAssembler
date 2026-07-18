"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const {
  collectRulesetSourceIssues,
  DEFAULT_RULESET_SOURCE_ID,
  extractNormalizedRuleset,
  getRulesetSource
} = require("../src/rulesets/sources");
const {
  createDefaultRosterEntry,
  getConfiguredProfiles,
  validateLoadout
} = require("../src/domain/loadout");
const { calculateEntryPoints } = require("../src/domain/pricing");
const { sourceFingerprint } = require("./ruleset-source-fingerprint");
const { auditRuntimeParity } = require("./runtime-parity");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "ui", "engine-data-manifest.js");

function finding(code, severity, message, details = {}) {
  return { code, severity, message, ...details };
}

function sample(items, limit = 20) {
  return items.slice(0, limit);
}

function hasNonFiniteNumber(value, seen = new Set()) {
  if (typeof value === "number") return !Number.isFinite(value);
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some(item => hasNonFiniteNumber(item, seen));
  return Object.values(value).some(item => hasNonFiniteNumber(item, seen));
}

function auditNormalizedRuleset(ruleset) {
  const findings = [];
  const units = ruleset?.units || [];
  const armies = ruleset?.armies || [];
  const unitKeys = new Set(units.map(unit => unit.selectionKey));

  for (const issue of collectRulesetSourceIssues(ruleset)) {
    findings.push(finding(
      issue.code || "stratagem-source-issue",
      issue.severity || "error",
      issue.message || "A configured stratagem source has a release-blocking problem.",
      { details: issue }
    ));
  }

  if ((ruleset?.unresolved || []).length) {
    findings.push(finding(
      "unresolved-entry-links",
      "error",
      `${ruleset.unresolved.length} normalized entry link(s) are unresolved.`,
      { count: ruleset.unresolved.length, examples: sample(ruleset.unresolved) }
    ));
  }

  const falseLeaders = units.filter(unit =>
    unit.roles?.leader
    && !unit.roles?.character
    && !unit.rosterRules?.mfmAttachmentRole
  );
  if (falseLeaders.length) {
    findings.push(finding(
      "non-character-leaders",
      "error",
      `${falseLeaders.length} non-Character unit definition(s) are marked as Leaders.`,
      { count: falseLeaders.length, examples: sample(falseLeaders.map(unit => `${unit.faction}: ${unit.name}`)) }
    ));
  }

  const invalidDefaults = [];
  const nonFiniteDefaults = [];
  const zeroPointUnits = [];
  const missingUnitProfiles = [];
  const calculationFailures = [];
  for (const unit of units) {
    try {
      const entry = createDefaultRosterEntry(unit);
      const errors = validateLoadout(unit, entry);
      if (errors.length) invalidDefaults.push({ faction: unit.faction, unit: unit.name, errors });
      if (hasNonFiniteNumber(entry)) nonFiniteDefaults.push(`${unit.faction}: ${unit.name}`);
      const pricing = calculateEntryPoints(unit, entry, { allowInvalid: true });
      if (unit.rosterSelectable !== false && pricing.points === 0) {
        zeroPointUnits.push(`${unit.faction}: ${unit.name}`);
      }
      const profiles = getConfiguredProfiles(unit, entry);
      if (pricing.points > 0 && !(profiles.units || []).length) {
        missingUnitProfiles.push(`${unit.faction}: ${unit.name}`);
      }
    } catch (error) {
      calculationFailures.push({ faction: unit.faction, unit: unit.name, message: error.message });
    }
  }

  if (invalidDefaults.length) findings.push(finding(
    "invalid-default-loadouts",
    "error",
    `${invalidDefaults.length} unit default(s) fail loadout validation.`,
    { count: invalidDefaults.length, examples: sample(invalidDefaults) }
  ));
  if (nonFiniteDefaults.length) findings.push(finding(
    "non-finite-default-values",
    "error",
    `${nonFiniteDefaults.length} unit default(s) contain Infinity or another non-finite number.`,
    { count: nonFiniteDefaults.length, examples: sample(nonFiniteDefaults) }
  ));
  if (zeroPointUnits.length) findings.push(finding(
    "selectable-zero-point-units",
    "error",
    `${zeroPointUnits.length} independently selectable unit definition(s) calculate to zero points.`,
    { count: zeroPointUnits.length, examples: sample(zeroPointUnits) }
  ));
  if (missingUnitProfiles.length) findings.push(finding(
    "missing-configured-unit-profiles",
    "error",
    `${missingUnitProfiles.length} paid unit definition(s) have no configured Unit profile.`,
    { count: missingUnitProfiles.length, examples: sample(missingUnitProfiles) }
  ));
  if (calculationFailures.length) findings.push(finding(
    "default-calculation-failures",
    "error",
    `${calculationFailures.length} unit default(s) could not be generated or calculated.`,
    { count: calculationFailures.length, examples: sample(calculationFailures) }
  ));

  const unsupportedModifiers = units.flatMap(unit => (unit.pricing?.modifiers || [])
    .filter(modifier => modifier.supported === false)
    .map(modifier => ({ faction: unit.faction, unit: unit.name, modifierId: modifier.id }))
  );
  if (unsupportedModifiers.length) findings.push(finding(
    "unsupported-point-modifiers",
    "error",
    `${unsupportedModifiers.length} point modifier(s) are unsupported and would be skipped.`,
    { count: unsupportedModifiers.length, examples: sample(unsupportedModifiers) }
  ));

  const staleArmyKeys = [];
  const unusableEnhancements = [];
  for (const army of armies) {
    for (const key of army.allowedSelectionKeys || []) {
      if (!unitKeys.has(key)) staleArmyKeys.push({ faction: army.faction, selectionKey: key });
    }
    for (const enhancement of army.enhancements || []) {
      const eligibility = enhancement.eligibleSelectionKeys || [];
      const validKeys = eligibility.filter(key => unitKeys.has(key));
      const hasPredicate = Boolean(enhancement.eligibilityPredicate || enhancement.eligiblePredicate);
      if (!validKeys.length && !hasPredicate) {
        unusableEnhancements.push({ faction: army.faction, enhancement: enhancement.name });
      }
    }
  }
  if (staleArmyKeys.length) findings.push(finding(
    "stale-army-selection-keys",
    "error",
    `${staleArmyKeys.length} army selection key(s) do not resolve to retained units.`,
    { count: staleArmyKeys.length, examples: sample(staleArmyKeys) }
  ));
  if (unusableEnhancements.length) findings.push(finding(
    "unusable-enhancements",
    "error",
    `${unusableEnhancements.length} visible enhancement(s) have no eligible retained bearer.`,
    { count: unusableEnhancements.length, examples: sample(unusableEnhancements) }
  ));

  const incompleteDetachments = armies.flatMap(army => (army.detachments || [])
    .filter(detachment => (detachment.stratagems || []).length !== 6)
    .map(detachment => ({
      faction: army.faction,
      detachment: detachment.name,
      stratagems: (detachment.stratagems || []).length
    }))
  );
  if (incompleteDetachments.length) findings.push(finding(
    "unexpected-detachment-stratagem-count",
    "error",
    `${incompleteDetachments.length} detachment instance(s) do not contain exactly six stratagems.`,
    { count: incompleteDetachments.length, examples: sample(incompleteDetachments) }
  ));

  const armiesWithoutRules = armies
    .filter(army => !(army.armyRules || []).length)
    .map(army => army.faction);
  if (armiesWithoutRules.length) findings.push(finding(
    "missing-army-rules",
    "error",
    `${armiesWithoutRules.length} army definition(s) have no Army Rule reference.`,
    { count: armiesWithoutRules.length, examples: sample(armiesWithoutRules) }
  ));

  return findings;
}

function loadGeneratedManifest(manifestPath = MANIFEST_PATH) {
  if (!fs.existsSync(manifestPath)) return null;
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(manifestPath, "utf8"), context, { filename: manifestPath });
  return context.window.ROSTER_ENGINE_DATA || null;
}

function auditGeneratedData(source, manifest = loadGeneratedManifest()) {
  const findings = [];
  const current = sourceFingerprint(source);
  if (current.missing.length) findings.push(finding(
    "missing-configured-source-inputs",
    "error",
    `${current.missing.length} configured ruleset input(s) are missing.`,
    { count: current.missing.length, examples: current.missing }
  ));
  if (!manifest) {
    findings.push(finding("generated-manifest-missing", "error", "The generated engine-data manifest is missing."));
    return findings;
  }
  if (!manifest.sourceFingerprint?.value) {
    findings.push(finding(
      "generated-manifest-unverifiable",
      "error",
      "The generated engine-data manifest predates source fingerprinting and cannot be proven current."
    ));
  } else if (
    manifest.sourceFingerprint.algorithm !== current.algorithm
    || manifest.sourceFingerprint.value !== current.value
  ) {
    findings.push(finding(
      "generated-data-stale",
      "error",
      "Generated engine data does not match the current configured ruleset inputs.",
      { expected: current, actual: manifest.sourceFingerprint }
    ));
  }
  return findings;
}

function readinessReport() {
  const source = getRulesetSource(DEFAULT_RULESET_SOURCE_ID);
  const ruleset = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID);
  const findings = [
    ...auditNormalizedRuleset(ruleset),
    ...auditGeneratedData(source),
    ...auditRuntimeParity()
  ];
  return {
    rulesetId: source.id,
    generatedAt: new Date().toISOString(),
    ready: !findings.some(item => item.severity === "error"),
    errors: findings.filter(item => item.severity === "error").length,
    warnings: findings.filter(item => item.severity === "warning").length,
    findings
  };
}

function printReport(report) {
  console.log(`# Release readiness: ${report.ready ? "READY" : "BLOCKED"}`);
  console.log(`Ruleset: ${report.rulesetId}`);
  console.log(`Errors: ${report.errors}; warnings: ${report.warnings}`);
  for (const item of report.findings) {
    console.log(`- [${item.severity.toUpperCase()}] ${item.code}: ${item.message}`);
    if (item.examples?.length) console.log(`  Examples: ${item.examples.map(value => typeof value === "string" ? value : JSON.stringify(value)).join(" | ")}`);
  }
}

function main() {
  const report = readinessReport();
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  if (process.argv.includes("--strict") && !report.ready) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  auditGeneratedData,
  auditNormalizedRuleset,
  loadGeneratedManifest,
  readinessReport
};
