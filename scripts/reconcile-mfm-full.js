#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { createDefaultRosterEntry, setUnitSize } = require("../src/domain/loadout");
const { calculateEntryPoints } = require("../src/domain/pricing");
const { extractNormalizedRuleset } = require("../src/rulesets/sources");
const { canonicalDetachmentName, canonicalEnhancementName, normalizeMfmName } = require("../src/rulesets/mfm-normalization");

const FACTIONS = new Map(Object.entries({
  "adepta-sororitas": "Imperium - Adepta Sororitas",
  "adeptus-custodes": "Imperium - Adeptus Custodes",
  "adeptus-mechanicus": "Imperium - Adeptus Mechanicus",
  aeldari: "Xenos - Aeldari",
  "astra-militarum": "Imperium - Astra Militarum",
  "black-templars": "Imperium - Adeptus Astartes - Black Templars",
  "blood-angels": "Imperium - Adeptus Astartes - Blood Angels",
  "chaos-daemons": "Chaos - Chaos Daemons",
  "chaos-knights": "Chaos - Chaos Knights",
  "chaos-space-marines": "Chaos - Chaos Space Marines",
  "chaos-titan-legions": "Chaos - Titanicus Traitoris",
  "dark-angels": "Imperium - Adeptus Astartes - Dark Angels",
  "death-guard": "Chaos - Death Guard",
  deathwatch: "Imperium - Adeptus Astartes - Deathwatch",
  drukhari: "Xenos - Drukhari",
  "emperors-children": "Chaos - Emperor's Children",
  "genestealer-cults": "Xenos - Genestealer Cults",
  "grey-knights": "Imperium - Grey Knights",
  "imperial-agents": "Imperium - Agents of the Imperium",
  "imperial-knights": "Imperium - Imperial Knights",
  "leagues-of-votann": "Xenos - Leagues of Votann",
  necrons: "Xenos - Necrons",
  orks: "Xenos - Orks",
  "space-marines": "Imperium - Adeptus Astartes - Space Marines",
  "space-wolves": "Imperium - Adeptus Astartes - Space Wolves",
  "tau-empire": "Xenos - T'au Empire",
  "thousand-sons": "Chaos - Thousand Sons",
  "titan-legions": "Imperium - Adeptus Titanicus",
  tyranids: "Xenos - Tyranids",
  "world-eaters": "Chaos - World Eaters"
}));

const SPACE_MARINE_SECTIONS = new Map([
  ["imperial fists", "Imperium - Adeptus Astartes - Imperial Fists"],
  ["iron hands", "Imperium - Adeptus Astartes - Iron Hands"],
  ["raven guard", "Imperium - Adeptus Astartes - Raven Guard"],
  ["salamanders", "Imperium - Adeptus Astartes - Salamanders"],
  ["ultramarines", "Imperium - Adeptus Astartes - Ultramarines"],
  ["white scars", "Imperium - Adeptus Astartes - White Scars"]
]);

const PLAYABLE_FACTIONS = new Set([...FACTIONS.values(), ...SPACE_MARINE_SECTIONS.values()]);

const BORROWED_MFM_SOURCES = new Map([
  ["Xenos - Drukhari", new Set(["Xenos - Aeldari"])],
  ["Chaos - Chaos Daemons", new Set(["Chaos - Chaos Space Marines"])],
  ["Chaos - Chaos Knights", new Set(["Chaos - Chaos Space Marines"])],
  ["Chaos - Chaos Space Marines", new Set(["Chaos - Emperor's Children", "Chaos - World Eaters", "Chaos - Thousand Sons", "Chaos - Death Guard"])],
  ["Chaos - Death Guard", new Set(["Chaos - Chaos Daemons"])],
  ["Chaos - Thousand Sons", new Set(["Chaos - Chaos Daemons"])],
  ["Chaos - World Eaters", new Set(["Chaos - Chaos Daemons"])],
  ["Xenos - Genestealer Cults", new Set(["Imperium - Astra Militarum", "Xenos - Tyranids"])],
  ["Imperium - Imperial Knights", new Set(["Imperium - Adeptus Mechanicus"])]
]);

const UNIT_ALIASES = new Map([
  ["myphitic blight haulers", "myphitic blight hauler"]
]);

function normalize(value) {
  return normalizeMfmName(value);
}

function unitName(value) {
  const name = normalize(value);
  return UNIT_ALIASES.get(name) || name;
}

function targetFaction(row) {
  if (row.factionSlug === "space-marines") {
    return SPACE_MARINE_SECTIONS.get(normalize(row.section)) || FACTIONS.get(row.factionSlug);
  }
  return FACTIONS.get(row.factionSlug);
}

function matchingUnits(units, row, directUnitKeys = new Set()) {
  const faction = targetFaction(row);
  const wanted = unitName(row.unitName);
  const exact = units.filter(unit => unit.faction === faction && unitName(unit.name) === wanted);
  if (row.factionSlug === "space-marines" && faction === FACTIONS.get("space-marines")) {
    return units.filter(unit =>
      String(unit.faction || "").startsWith("Imperium - Adeptus Astartes - ")
      && unitName(unit.name) === wanted
    );
  }
  const borrowed = units.filter(unit =>
    unit.faction !== faction
    && BORROWED_MFM_SOURCES.get(unit.faction)?.has(faction)
    && !directUnitKeys.has(`${unit.faction}\u0000${wanted}`)
    && unitName(unit.name) === wanted
  );
  if (exact.length || borrowed.length) return [...exact, ...borrowed];
  const sameFaction = units.filter(unit => unit.faction === faction);
  const relaxed = sameFaction.filter(unit => {
    const candidate = unitName(unit.name).replace(/ legends$/, "");
    const target = wanted.replace(/ legends$/, "");
    if (candidate === target) return true;
    if (candidate.replace(/s$/, "") === target.replace(/s$/, "")) return true;
    if (row.factionSlug === "chaos-titan-legions" && candidate === target.replace(/^chaos /, "")) return true;
    if (target === "soul grinder" && candidate.endsWith(" soul grinder")) return true;
    return false;
  });
  if (relaxed.length) return relaxed;
  if (row.factionSlug === "space-marines") {
    const chapterMatches = units.filter(unit =>
      String(unit.faction || "").startsWith("Imperium - Adeptus Astartes - ")
      && unit.faction !== FACTIONS.get("space-marines")
      && unitName(unit.name).replace(/ legends$/, "") === wanted.replace(/ legends$/, "")
    );
    if (chapterMatches.length) return chapterMatches;
  }
  return [];
}

function previousCopies(costBand) {
  const band = normalize(costBand);
  if (band === "your 1st unit costs") return 0;
  if (band === "your 2nd unit costs") return 1;
  if (band === "your 1st to 2nd units cost") return 0;
  if (band === "your 3rd unit costs") return 2;
  if (band === "your 1st to 3rd units cost") return 0;
  if (band === "your 4th unit costs") return 3;
  return 0;
}

function modelCount(label) {
  const simple = String(label || "").match(/^(\d+)\s+models?$/i);
  if (simple) return Number(simple[1]);
  const parts = [...String(label || "").matchAll(/(?:^|[,;+])\s*(\d+)\s+[^,;+]+/g)];
  return parts.length ? parts.reduce((sum, match) => sum + Number(match[1]), 0) : null;
}

function evaluateUnitRow(definition, row) {
  const exactMfmRow = (definition.pricing?.mfmRows || []).find(item =>
    normalize(item.context) === normalize(row.context)
    && normalize(item.costBand) === normalize(row.costBand)
    && normalize(item.label) === normalize(row.label)
    && Number(item.points) === Number(row.points)
  );
  if (exactMfmRow) {
    return {
      calculatedUnitPoints: Number(exactMfmRow.points),
      calculatedTotalPoints: Number(exactMfmRow.points),
      appliedBase: { source: exactMfmRow.source, operation: "set", value: Number(exactMfmRow.points) },
      validationErrors: []
    };
  }
  let entry = createDefaultRosterEntry(definition);
  const count = modelCount(row.label);
  if (count !== null) entry = setUnitSize(definition, entry, count);
  entry.context = {
    ...(entry.context || {}),
    previousCopies: previousCopies(row.costBand),
    mfmContext: row.context || null
  };
  const result = calculateEntryPoints(definition, entry, { allowInvalid: true });
  const selectedOptionPoints = result.applied
    .filter(item => item.source === "bsdata-selection-tree")
    .reduce((sum, item) => sum + Number(item.value || 0), 0);
  return {
    calculatedUnitPoints: result.points - selectedOptionPoints,
    calculatedTotalPoints: result.points,
    appliedBase: result.applied[0] || null,
    validationErrors: result.validationErrors
  };
}

function visitTree(node, visitor) {
  if (!node) return;
  visitor(node);
  for (const child of node.children || []) visitTree(child, visitor);
}

function wargearName(label) {
  return normalize(label).replace(/^(?:per\s+|\d+\s+)/, "");
}

function comparableWargearName(value) {
  return normalize(value)
    .replace(/^per\s+/, "")
    .replace(/battlecannon/g, "battle cannon")
    .replace(/s$/, "");
}

function findWargearNodes(definition, row) {
  const wanted = wargearName(row.label);
  const found = [];
  visitTree(definition.selectionTree, node => {
    const candidate = normalize(node.name).replace(/^per\s+/, "");
    if (candidate === wanted || candidate.replace(/s$/, "") === wanted.replace(/s$/, "")) found.push(node);
  });
  return found;
}

function matchingArmies(armies, row) {
  const faction = targetFaction(row);
  return armies.filter(army => army.faction === faction);
}

function enhancementMatches(army, row) {
  const wantedName = canonicalEnhancementName(row.enhancementName);
  const wantedDetachment = canonicalDetachmentName(row.detachmentName);
  const detachmentIds = new Set((army.detachments || [])
    .filter(item => canonicalDetachmentName(item.name) === wantedDetachment)
    .map(item => item.id));
  return (army.enhancements || []).filter(item => {
    if (canonicalEnhancementName(item.name) !== wantedName) return false;
    return detachmentIds.size > 0 && (item.detachmentIds || []).some(id => detachmentIds.has(id));
  });
}

function unitMatchesEnhancementFaction(unit, row) {
  const faction = targetFaction(row);
  if (unit.faction === faction) return true;
  return row.factionSlug === "space-marines"
    && String(unit.faction || "").startsWith("Imperium - Adeptus Astartes - ");
}

function embeddedEnhancementMatches(units, row) {
  const wanted = canonicalEnhancementName(row.enhancementName);
  const matches = [];
  for (const unit of units.filter(item => unitMatchesEnhancementFaction(item, row))) {
    visitTree(unit.selectionTree, node => {
      if (node.kind === "upgrade" && canonicalEnhancementName(node.name) === wanted) {
        matches.push({ unit, node });
      }
    });
  }
  return matches;
}

function runtimeRowKey(row) {
  return [normalize(row.context), normalize(row.costBand), normalize(row.label), Number(row.points)].join("|");
}

function unitIdentity(unit) {
  return `${unit.faction}\u0000${unit.selectionKey}`;
}

function audit(document, ruleset) {
  const report = {
    source: document.source,
    version: document.version,
    extracted: {
      pages: document.pages,
      rows: document.rows.length,
      unitRows: document.rows.filter(row => row.kind === "unit").length,
      wargearRows: document.rows.filter(row => row.kind === "wargear").length,
      enhancementRows: document.rows.filter(row => row.kind === "enhancement").length
    },
    unit: { matchedRows: 0, unmatched: [], ambiguous: [], evaluationErrors: [], priceMismatches: [], staleMfmRows: [], extraPricedUnits: [] },
    wargear: { matchedRows: 0, unmatchedUnits: [], unmatchedOptions: [], ambiguousUnits: [], priceMismatches: [], extraPaidOptions: [] },
    enhancement: { matchedRows: 0, unmatchedArmies: [], unmatched: [], ambiguous: [], priceMismatches: [], extraPricedEnhancements: [], extraEmbeddedPricedEnhancements: [] }
  };

  const expectedByUnit = new Map();
  const matchedUnitDefinitions = new Map();
  const directUnitKeys = new Set(document.rows
    .filter(row => row.kind === "unit")
    .map(row => `${targetFaction(row)}\u0000${unitName(row.unitName)}`));
  for (const row of document.rows.filter(item => item.kind === "unit")) {
    const matches = matchingUnits(ruleset.units, row, directUnitKeys);
    if (!matches.length) {
      report.unit.unmatched.push(row);
      continue;
    }
    let evaluated = false;
    for (const definition of matches) {
      const definitionKey = unitIdentity(definition);
      matchedUnitDefinitions.set(definitionKey, definition);
      if (!expectedByUnit.has(definitionKey)) expectedByUnit.set(definitionKey, new Set());
      expectedByUnit.get(definitionKey).add(runtimeRowKey(row));
      try {
        const result = evaluateUnitRow(definition, row);
        evaluated = true;
        if (result.calculatedUnitPoints !== Number(row.points)) {
          report.unit.priceMismatches.push({
            row,
            unit: { faction: definition.faction, name: definition.name, selectionKey: definition.selectionKey },
            actual: result.calculatedUnitPoints,
            totalWithDefaultPaidOptions: result.calculatedTotalPoints,
            appliedBase: result.appliedBase,
            validationErrors: result.validationErrors
          });
        }
      } catch (error) {
        report.unit.evaluationErrors.push({ row, unit: { faction: definition.faction, name: definition.name }, error: error.message });
      }
    }
    if (evaluated) report.unit.matchedRows += 1;
  }

  for (const definition of ruleset.units) {
    const expected = expectedByUnit.get(unitIdentity(definition));
    if (!expected) continue;
    for (const row of definition.pricing?.mfmRows || []) {
      if (row.source !== `mfm-${document.version}`) continue;
      if (!expected.has(runtimeRowKey(row))) {
        report.unit.staleMfmRows.push({
          unit: { faction: definition.faction, name: definition.name, selectionKey: definition.selectionKey },
          row
        });
      }
    }
  }

  const allowedSelectionKeysByFaction = new Map(ruleset.armies.map(army => [
    army.faction,
    new Set(army.allowedSelectionKeys || [])
  ]));
  for (const definition of ruleset.units) {
    if (expectedByUnit.has(unitIdentity(definition))) continue;
    if (!PLAYABLE_FACTIONS.has(definition.faction) || /\[legends\]$/i.test(definition.name)) continue;
    if (!allowedSelectionKeysByFaction.get(definition.faction)?.has(definition.selectionKey)) continue;
    const basePoints = Number(definition.pricing?.base ?? definition.points ?? 0);
    if (basePoints <= 0) continue;
    report.unit.extraPricedUnits.push({
      unit: {
        faction: definition.faction,
        name: definition.name,
        selectionKey: definition.selectionKey,
        points: basePoints
      },
      reason: "Playable priced runtime definition has no row on the current faction MFM page"
    });
  }

  const expectedWargearByUnit = new Map();
  for (const row of document.rows.filter(item => item.kind === "wargear")) {
    const matches = matchingUnits(ruleset.units, row);
    if (!matches.length) {
      report.wargear.unmatchedUnits.push(row);
      continue;
    }
    let foundAny = false;
    for (const definition of matches) {
      const definitionKey = unitIdentity(definition);
      matchedUnitDefinitions.set(definitionKey, definition);
      if (!expectedWargearByUnit.has(definitionKey)) expectedWargearByUnit.set(definitionKey, new Set());
      expectedWargearByUnit.get(definitionKey).add(comparableWargearName(wargearName(row.label)));
      const nodes = findWargearNodes(definition, row);
      if (!nodes.length) {
        report.wargear.unmatchedOptions.push({ row, unit: { faction: definition.faction, name: definition.name, selectionKey: definition.selectionKey } });
        continue;
      }
      foundAny = true;
      const pricedNodes = nodes.filter(node => !["unit", "group", "model"].includes(node.kind));
      const candidates = pricedNodes.length ? pricedNodes : nodes;
      const wrong = candidates.filter(node => Number(node.points || 0) !== Number(row.points));
      if (wrong.length) {
        report.wargear.priceMismatches.push({
          row,
          unit: { faction: definition.faction, name: definition.name, selectionKey: definition.selectionKey },
          nodes: candidates.map(node => ({ id: node.id, name: node.name, kind: node.kind, points: Number(node.points || 0) }))
        });
      }
    }
    if (foundAny) report.wargear.matchedRows += 1;
  }

  for (const [selectionKey, definition] of matchedUnitDefinitions) {
    const expected = expectedWargearByUnit.get(selectionKey) || new Set();
    const seen = new Set();
    const sourceEnhancementNames = new Set(document.rows
      .filter(row => row.kind === "enhancement" && unitMatchesEnhancementFaction(definition, row))
      .map(row => canonicalEnhancementName(row.enhancementName)));
    const matchingArmy = ruleset.armies.find(army => army.faction === definition.faction);
    const runtimeEnhancementNames = new Set((matchingArmy?.enhancements || []).map(item => canonicalEnhancementName(item.name)));
    const runtimeDetachmentNames = new Set((matchingArmy?.detachments || []).map(item => canonicalDetachmentName(item.name)));
    const walkPaidOptions = (node, enhancementAncestor = false) => {
      if (!node) return;
      const groupName = canonicalDetachmentName(node.name).replace(/ enhancements?$/, "");
      const underEnhancements = enhancementAncestor
        || /\benhancements?\b/i.test(String(node.name || ""))
        || (node.kind === "group" && runtimeDetachmentNames.has(groupName));
      if (!["unit", "group", "model"].includes(node.kind) && Number(node.points || 0) > 0) {
        const name = comparableWargearName(node.name);
        const enhancementName = canonicalEnhancementName(node.name);
        const duplicateKey = `${name}|${Number(node.points)}`;
        const expectedWargear = [...expected].some(item => name === item || name.includes(item) || item.includes(name));
        if (sourceEnhancementNames.has(enhancementName)) {
          // The forward enhancement pass validates every embedded copy.
        } else if ((underEnhancements || runtimeEnhancementNames.has(enhancementName)) && !seen.has(duplicateKey)) {
          seen.add(duplicateKey);
          report.enhancement.extraEmbeddedPricedEnhancements.push({
            unit: { faction: definition.faction, name: definition.name, selectionKey },
            node: { id: node.id, name: node.name, kind: node.kind, points: Number(node.points) }
          });
        } else if (!expectedWargear && !seen.has(duplicateKey)) {
          seen.add(duplicateKey);
          report.wargear.extraPaidOptions.push({
            unit: { faction: definition.faction, name: definition.name, selectionKey },
            node: { id: node.id, name: node.name, kind: node.kind, points: Number(node.points) }
          });
        }
      }
      for (const child of node.children || []) walkPaidOptions(child, underEnhancements);
    };
    walkPaidOptions(definition.selectionTree);
  }

  const expectedEnhancementsByArmy = new Map();
  const expectedEnhancementNamesByFaction = new Map();
  for (const row of document.rows.filter(item => item.kind === "enhancement")) {
    const armies = matchingArmies(ruleset.armies, row);
    if (!armies.length) {
      report.enhancement.unmatchedArmies.push(row);
      continue;
    }
    const matches = armies.flatMap(army => enhancementMatches(army, row).map(item => ({ army, item })));
    const embeddedMatches = embeddedEnhancementMatches(ruleset.units, row);
    if (!matches.length && !embeddedMatches.length) {
      report.enhancement.unmatched.push(row);
      continue;
    }
    if (matches.length > 1) {
      report.enhancement.ambiguous.push({ row, matches: matches.map(({ army, item }) => ({ faction: army.faction, name: item.name, id: item.id })) });
      continue;
    }
    report.enhancement.matchedRows += 1;
    const sourceFaction = targetFaction(row);
    if (!expectedEnhancementNamesByFaction.has(sourceFaction)) expectedEnhancementNamesByFaction.set(sourceFaction, new Set());
    expectedEnhancementNamesByFaction.get(sourceFaction).add(canonicalEnhancementName(row.enhancementName));
    if (matches.length) {
      const match = matches[0];
      if (!expectedEnhancementsByArmy.has(match.army.faction)) expectedEnhancementsByArmy.set(match.army.faction, new Set());
      expectedEnhancementsByArmy.get(match.army.faction).add(`${canonicalDetachmentName(row.detachmentName)}|${canonicalEnhancementName(row.enhancementName)}`);
    }
    const wrongEmbedded = embeddedMatches.filter(match => Number(match.node.points || 0) !== Number(row.points));
    if ((matches.length && Number(matches[0].item.points || 0) !== Number(row.points)) || wrongEmbedded.length) {
      report.enhancement.priceMismatches.push({
        row,
        army: matches[0]?.army.faction || sourceFaction,
        enhancement: matches.length ? { id: matches[0].item.id, name: matches[0].item.name, points: Number(matches[0].item.points || 0) } : null,
        embedded: wrongEmbedded.map(match => ({
          unit: { faction: match.unit.faction, name: match.unit.name, selectionKey: match.unit.selectionKey },
          node: { id: match.node.id, name: match.node.name, points: Number(match.node.points || 0) }
        }))
      });
    }
  }

  for (const army of ruleset.armies) {
    const expected = expectedEnhancementsByArmy.get(army.faction);
    if (!expected) continue;
    const detachmentNames = new Map((army.detachments || []).map(item => [item.id, canonicalDetachmentName(item.name)]));
    for (const enhancement of army.enhancements || []) {
      if (Number(enhancement.points || 0) <= 0) continue;
      const name = canonicalEnhancementName(enhancement.name);
      const keys = (enhancement.detachmentIds || []).map(id => `${detachmentNames.get(id) || ""}|${name}`);
      if (keys.some(item => expected.has(item))) continue;
      report.enhancement.extraPricedEnhancements.push({
        army: army.faction,
        enhancement: {
          id: enhancement.id,
          name: enhancement.name,
          points: Number(enhancement.points),
          detachments: (enhancement.detachmentIds || []).map(id => detachmentNames.get(id) || id)
        }
      });
    }
  }

  report.summary = {
    discrepancies:
      report.unit.unmatched.length + report.unit.ambiguous.length + report.unit.evaluationErrors.length + report.unit.priceMismatches.length + report.unit.staleMfmRows.length + report.unit.extraPricedUnits.length
      + report.wargear.unmatchedUnits.length + report.wargear.unmatchedOptions.length + report.wargear.ambiguousUnits.length + report.wargear.priceMismatches.length
      + report.wargear.extraPaidOptions.length
      + report.enhancement.unmatchedArmies.length + report.enhancement.unmatched.length + report.enhancement.ambiguous.length + report.enhancement.priceMismatches.length
      + report.enhancement.extraPricedEnhancements.length,
    unit: Object.fromEntries(Object.entries(report.unit).map(([key, value]) => [key, Array.isArray(value) ? value.length : value])),
    wargear: Object.fromEntries(Object.entries(report.wargear).map(([key, value]) => [key, Array.isArray(value) ? value.length : value])),
    enhancement: Object.fromEntries(Object.entries(report.enhancement).map(([key, value]) => [key, Array.isArray(value) ? value.length : value]))
  };
  return report;
}

function main() {
  const input = process.argv[2] ? path.resolve(process.argv[2]) : null;
  const output = process.argv[3] ? path.resolve(process.argv[3]) : null;
  if (!input || !output) throw new Error("Usage: node scripts/reconcile-mfm-full.js <mfm-full.json> <report.json>");
  const document = JSON.parse(fs.readFileSync(input, "utf8"));
  const ruleset = extractNormalizedRuleset(undefined, { fresh: true });
  const report = audit(document, ruleset);
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { audit };
