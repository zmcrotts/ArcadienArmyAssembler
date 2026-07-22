"use strict";

const fs = require("fs");
const path = require("path");

const {
  collectRulesetSourceIssues,
  DEFAULT_RULESET_SOURCE_ID,
  extractNormalizedRuleset
} = require("../src/rulesets/sources");
const {
  createDefaultRosterEntry,
  getConfiguredProfiles,
  listSelectableOptions,
  validateLoadout
} = require("../src/domain/loadout");
const { calculateEntryPoints } = require("../src/domain/pricing");
const { buildFactionNavigation } = require("../src/domain/factions");
const { sourceFingerprint } = require("./ruleset-source-fingerprint");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "ui", "engine-data-milestone15.js");
const MANIFEST_OUT = path.join(ROOT, "ui", "engine-data-manifest.js");
const FACTION_OUT_DIR = path.join(ROOT, "ui", "engine-data");
const WRITE_RETRY_SIGNAL = new Int32Array(new SharedArrayBuffer(4));
const CORE_RULE_NAMES = new Set([
  "Anti",
  "Assault",
  "Blast",
  "Devastating Wounds",
  "Extra Attacks",
  "Hazardous",
  "Heavy",
  "Ignores Cover",
  "Indirect Fire",
  "Lance",
  "Lethal Hits",
  "Melta",
  "Pistol",
  "Precision",
  "Psychic",
  "Rapid Fire",
  "Sustained Hits",
  "Torrent",
  "Twin-linked"
]);

function summarizeConfigured(unitDefinition, rosterEntry) {
  const configured = getConfiguredProfiles(unitDefinition, rosterEntry);
  const pricing = calculateEntryPoints(unitDefinition, rosterEntry, { allowInvalid: true });

  return {
    points: pricing.points,
    validation: {
      loadout: validateLoadout(unitDefinition, rosterEntry),
      pricing: pricing.validationErrors || []
    },
    configured: {
      weapons: configured.weapons,
      units: configured.units,
      abilities: configured.abilities,
      rules: configured.rules
    }
  };
}

function compactDefinition(definition) {
  return {
    schemaVersion: definition.schemaVersion,
    id: definition.id,
    selectionKey: definition.selectionKey,
    name: definition.name,
    faction: definition.faction,
    source: definition.source,
    categories: definition.categories,
    categoryIds: definition.categoryIds || [],
    keywords: definition.keywords || definition.categories || [],
    conditionalKeywords: definition.conditionalKeywords || [],
    roles: definition.roles,
    rosterRules: definition.rosterRules,
    composition: definition.composition,
    compositionConstraints: definition.compositionConstraints,
    pricing: definition.pricing,
    selectionTree: definition.selectionTree
  };
}

function compactOption(option) {
  return {
    id: option.id,
    definitionId: option.definitionId,
    name: option.name,
    kind: option.kind,
    parentId: option.parentId,
    constraints: option.constraints,
    profiles: option.profiles
  };
}

function factionFileName(faction) {
  return `${String(faction || "faction")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "faction"}.js`;
}

function compactSourceIssue(issue) {
  const compact = { ...issue };
  if (compact.filePath) compact.filePath = path.relative(ROOT, compact.filePath).replace(/\\/g, "/");
  return compact;
}

function writeTextFile(filePath, contents) {
  try {
    if (fs.readFileSync(filePath, "utf8") === contents) return false;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  let lastError = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      fs.writeFileSync(filePath, contents, "utf8");
      return true;
    } catch (error) {
      if (!["EACCES", "EBUSY", "EPERM"].includes(error.code)) throw error;
      lastError = error;
      Atomics.wait(WRITE_RETRY_SIGNAL, 0, 0, 100 * (attempt + 1));
    }
  }
  throw lastError;
}

function readWindowData(filePath) {
  try {
    const contents = fs.readFileSync(filePath, "utf8");
    const assignment = contents.indexOf("=");
    if (assignment < 0) return null;
    return JSON.parse(contents.slice(assignment + 1).trim().replace(/;$/, ""));
  } catch {
    return null;
  }
}

function coreRulesFromSource(sourcePath) {
  const gameSystemPath = path.join(sourcePath, "Warhammer 40,000.json");
  if (!fs.existsSync(gameSystemPath)) return [];
  const document = JSON.parse(fs.readFileSync(gameSystemPath, "utf8"));
  const rules = document?.gameSystem?.sharedRules || [];
  return rules
    .filter(rule => CORE_RULE_NAMES.has(rule?.name) && rule.description)
    .map(rule => ({
      id: rule.id,
      name: rule.name,
      description: rule.description,
      alias: Array.isArray(rule.alias) ? rule.alias : [],
      page: rule.page,
      sourceKind: "core-rule"
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function main() {
  const ruleset = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID);
  const inputFingerprint = sourceFingerprint(ruleset.source);
  const definitions = ruleset.units;
  const armyDefinitions = ruleset.armies;
  const allyDefinitions = ruleset.allies;
  const unresolved = ruleset.unresolved;
  const coreRules = coreRulesFromSource(ruleset.source.sourcePath);

  const factions = {};

  for (const definition of definitions) {
    const entry = createDefaultRosterEntry(definition);
    const options = listSelectableOptions(definition);
    const summary = summarizeConfigured(definition, entry);

    if (!factions[definition.faction]) factions[definition.faction] = [];

    factions[definition.faction].push({
      schemaVersion: 1,
      id: definition.id,
      selectionKey: definition.selectionKey,
      name: definition.name,
      faction: definition.faction,
      source: definition.source,
      keywords: definition.keywords || definition.categories || [],
      conditionalKeywords: definition.conditionalKeywords || [],

      definition: compactDefinition(definition),
      defaultEntry: entry,
      selectableOptions: options.map(compactOption),
      defaultSummary: summary
    });
  }

  for (const units of Object.values(factions)) {
    units.sort((a, b) => a.name.localeCompare(b.name));
  }

  const payload = {
    schemaVersion: 1,
    rulesetId: ruleset.source.id,
    generatedAt: new Date().toISOString(),
    source: path.relative(ROOT, ruleset.source.sourcePath),
    sourceFingerprint: inputFingerprint,
    sourceIssues: collectRulesetSourceIssues(ruleset).map(compactSourceIssue),
    unresolvedCount: unresolved.length,
    coreRules,
    armies: Object.fromEntries(armyDefinitions.map(army => [army.faction, army])),
    factionNavigation: buildFactionNavigation(Object.keys(factions)),
    allies: allyDefinitions,
    factions
  };

  const factionFiles = {};
  let factionDataChanged = false;
  fs.mkdirSync(FACTION_OUT_DIR, { recursive: true });
  const staleFactionFiles = new Set(fs.readdirSync(FACTION_OUT_DIR));
  for (const [faction, units] of Object.entries(factions)) {
    const fileName = factionFileName(faction);
    factionFiles[faction] = `engine-data/${fileName}`;
    staleFactionFiles.delete(fileName);
    factionDataChanged = writeTextFile(
      path.join(FACTION_OUT_DIR, fileName),
      "window.ROSTER_ENGINE_FACTIONS = window.ROSTER_ENGINE_FACTIONS || {};\n"
        + `window.ROSTER_ENGINE_FACTIONS[${JSON.stringify(faction)}] = ${JSON.stringify(units)};\n`
    ) || factionDataChanged;
  }
  for (const fileName of staleFactionFiles) {
    try {
      fs.rmSync(path.join(FACTION_OUT_DIR, fileName), { force: true, maxRetries: 4, retryDelay: 100 });
    } catch {}
  }

  const manifest = {
    schemaVersion: payload.schemaVersion,
    rulesetId: payload.rulesetId,
    generatedAt: payload.generatedAt,
    source: payload.source,
    sourceFingerprint: payload.sourceFingerprint,
    sourceIssues: payload.sourceIssues,
    unresolvedCount: payload.unresolvedCount,
    coreRules: payload.coreRules,
    armies: payload.armies,
    factionNavigation: payload.factionNavigation,
    allies: payload.allies,
    factionFiles,
    factions: {}
  };

  const previousManifest = readWindowData(MANIFEST_OUT);
  if (previousManifest && !factionDataChanged) {
    const previousComparable = { ...previousManifest, generatedAt: null };
    const nextComparable = { ...manifest, generatedAt: null };
    if (JSON.stringify(previousComparable) === JSON.stringify(nextComparable)) {
      payload.generatedAt = previousManifest.generatedAt;
      manifest.generatedAt = previousManifest.generatedAt;
    }
  }

  writeTextFile(
    OUT,
    "window.ROSTER_ENGINE_DATA = " + JSON.stringify(payload) + ";\n"
  );
  writeTextFile(
    MANIFEST_OUT,
    "window.ROSTER_ENGINE_DATA = " + JSON.stringify(manifest) + ";\n"
  );

  const stats = fs.statSync(OUT);
  const manifestStats = fs.statSync(MANIFEST_OUT);

  console.log(`Wrote ${OUT}`);
  console.log(`Wrote ${MANIFEST_OUT}`);
  console.log(`Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Manifest size: ${(manifestStats.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Factions: ${Object.keys(factions).length}`);
  console.log(`Units: ${Object.values(factions).flat().length}`);
  console.log(`Unresolved links: ${unresolved.length}`);
}

main();
