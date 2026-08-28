"use strict";

const fs = require("fs");
const { canonicalDetachmentName, canonicalEnhancementName, normalizeMfmName } = require("./mfm-normalization");

const FACTION_ALIASES = new Map(Object.entries({
  "adepta sororitas": "Imperium - Adepta Sororitas",
  "adeptus custodes": "Imperium - Adeptus Custodes",
  "adeptus mechanicus": "Imperium - Adeptus Mechanicus",
  "aeldari": "Xenos - Aeldari",
  "astra militarum": "Imperium - Astra Militarum",
  "black templars": "Imperium - Adeptus Astartes - Black Templars",
  "blood angels": "Imperium - Adeptus Astartes - Blood Angels",
  "chaos daemons": "Chaos - Chaos Daemons",
  "chaos knights": "Chaos - Chaos Knights",
  "chaos space marines": "Chaos - Chaos Space Marines",
  "chaos titan legions": "Chaos - Titanicus Traitoris",
  "dark angels": "Imperium - Adeptus Astartes - Dark Angels",
  "death guard": "Chaos - Death Guard",
  "deathwatch": "Imperium - Adeptus Astartes - Deathwatch",
  "drukhari": "Xenos - Drukhari",
  "emperor s children": "Chaos - Emperor's Children",
  "genestealer cults": "Xenos - Genestealer Cults",
  "grey knights": "Imperium - Grey Knights",
  "imperial agents": "Imperium - Agents of the Imperium",
  "imperial knights": "Imperium - Imperial Knights",
  "leagues of votann": "Xenos - Leagues of Votann",
  "necrons": "Xenos - Necrons",
  "orks": "Xenos - Orks",
  "space marines": "Imperium - Adeptus Astartes - Space Marines",
  "space wolves": "Imperium - Adeptus Astartes - Space Wolves",
  "t au empire": "Xenos - T'au Empire",
  "thousand sons": "Chaos - Thousand Sons",
  "titan legions": "Imperium - Adeptus Titanicus",
  "tyranids": "Xenos - Tyranids",
  "world eaters": "Chaos - World Eaters"
}));

const UNIT_NAME_ALIASES = new Map(Object.entries({
  "chaos reaver titan": "reaver titan",
  "chaos warbringer nemesis titan": "warbringer nemesis titan",
  "chaos warhound titan": "warhound titan",
  "chaos warlord titan": "warlord titan",
  "myphitic blight haulers": "myphitic blight hauler",
  "vyper": "vypers"
}));

const SPACE_MARINE_SECTION_FACTIONS = new Map(Object.entries({
  "imperial fists": "Imperium - Adeptus Astartes - Imperial Fists",
  "iron hands": "Imperium - Adeptus Astartes - Iron Hands",
  "raven guard": "Imperium - Adeptus Astartes - Raven Guard",
  "salamanders": "Imperium - Adeptus Astartes - Salamanders",
  "ultramarines": "Imperium - Adeptus Astartes - Ultramarines",
  "white scars": "Imperium - Adeptus Astartes - White Scars"
}));

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

function normalize(value) {
  return normalizeMfmName(value);
}

function readMfmPoints(filePath) {
  if (!filePath) return { changes: [], conditionalUnitSchedules: [], source: null, version: null, generatedAt: null, issues: [] };
  if (!fs.existsSync(filePath)) {
    return {
      changes: [], conditionalUnitSchedules: [], source: null, version: null, generatedAt: null,
      issues: [{ code: "mfm-points-missing", severity: "error", message: `Configured MFM points source is missing: ${filePath}`, filePath }]
    };
  }
  try {
    const document = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      changes: Array.isArray(document?.changes) ? document.changes : [],
      conditionalUnitSchedules: Array.isArray(document?.conditionalUnitSchedules) ? document.conditionalUnitSchedules : [],
      source: document?.source || null,
      version: document?.version || null,
      generatedAt: document?.generatedAt || null,
      issues: []
    };
  } catch (error) {
    return {
      changes: [], conditionalUnitSchedules: [], source: null, version: null, generatedAt: null,
      issues: [{ code: "mfm-points-invalid", severity: "error", message: `Configured MFM points source could not be parsed: ${filePath}`, filePath, cause: error.message }]
    };
  }
}

function canonicalFaction(mfmFaction) {
  return FACTION_ALIASES.get(normalize(mfmFaction)) || mfmFaction;
}

function canonicalChangeFaction(change) {
  if (normalize(change.faction) === "space marines") {
    return SPACE_MARINE_SECTION_FACTIONS.get(normalize(change.section)) || canonicalFaction(change.faction);
  }
  return canonicalFaction(change.faction);
}

function unitMatchesFaction(unit, change) {
  const expected = canonicalChangeFaction(change);
  if (unit.faction === expected) return true;
  // The Space Marines MFM page also carries named Chapter units.
  return normalize(change.faction) === "space marines"
    && expected === canonicalFaction(change.faction)
    && String(unit.faction || "").startsWith("Imperium - Adeptus Astartes - ");
}

function matchingUnits(units, change, directUnitKeys = new Set()) {
  const normalizedName = normalize(change.unitName);
  const wantedName = UNIT_NAME_ALIASES.get(normalizedName) || normalizedName;
  const expectedFaction = canonicalChangeFaction(change);
  const exactFaction = units.filter(unit => unit.faction === expectedFaction && normalize(unit.name) === wantedName);
  if (normalize(change.faction) === "space marines" && expectedFaction === canonicalFaction(change.faction)) {
    return units.filter(unit => unitMatchesFaction(unit, change) && normalize(unit.name) === wantedName);
  }
  const borrowed = units.filter(unit =>
    unit.faction !== expectedFaction
    && BORROWED_MFM_SOURCES.get(unit.faction)?.has(expectedFaction)
    && !directUnitKeys.has(`${unit.faction}\u0000${wantedName}`)
    && normalize(unit.name) === wantedName
  );
  if (exactFaction.length || borrowed.length) return [...exactFaction, ...borrowed];
  return units.filter(unit => {
    if (!unitMatchesFaction(unit, change)) return false;
    const candidate = normalize(unit.name);
    if (candidate === wantedName) return true;
    if (candidate.replace(/s$/, "") === wantedName.replace(/s$/, "")) return true;
    return wantedName === "soul grinder" && candidate.endsWith(" soul grinder");
  });
}

function inferImperialAgentsContext(change, occurrence) {
  if (change.context) return change.context;
  if (change.faction !== "Imperial Agents" || change.kind !== "unit") return null;
  const name = normalize(change.unitName);
  if (["deathwatch kill team", "sisters of battle squad", "watch master"].includes(name)) return "Every model has the Imperium keyword";
  if (name === "eversor assassin") return change.points === 100 ? "Imperial Agents army" : "Every model has the Imperium keyword";
  if (name === "grey knights terminator squad") return change.points === 175 ? "Imperial Agents army" : "Every model has the Imperium keyword";
  if (name === "sisters of battle immolator") return change.points <= 100 ? "Imperial Agents army" : "Every model has the Imperium keyword";
  if (["imperial rhino", "inquisitorial chimera"].includes(name)) {
    return occurrence % 2 === 0 ? "Imperial Agents army" : "Every model has the Imperium keyword";
  }
  return null;
}

function copyBand(costBand) {
  const band = normalize(costBand);
  if (band === "your 1st unit costs") return { min: 0, max: 0 };
  if (band === "your 2nd unit costs") return { min: 1, max: null };
  if (band === "your 1st to 2nd units cost") return { min: 0, max: 1 };
  if (band === "your 3rd unit costs") return { min: 2, max: null };
  if (band === "your 1st to 3rd units cost") return { min: 0, max: 2 };
  if (band === "your 4th unit costs") return { min: 3, max: null };
  return { min: 0, max: null };
}

function unitIdentity(unit) {
  return `${unit.faction}\u0000${unit.selectionKey}`;
}

function scheduleRow(change, context, source) {
  const simple = String(change.label || "").match(/^(\d+)\s+models?$/i);
  const composition = simple ? null : String(change.label || "").split(",").map(part => {
    const match = part.trim().match(/^(\d+)\s+(.+)$/);
    return match ? { count: Number(match[1]), name: match[2].trim() } : null;
  }).filter(Boolean);
  return {
    source,
    context,
    costBand: change.costBand,
    label: change.label,
    points: Number(change.points),
    copies: copyBand(change.costBand),
    modelCount: simple ? Number(simple[1]) : null,
    composition: composition?.length ? composition : null
  };
}

function replaceTreePoints(node, wantedName, points) {
  if (!node) return { node, matches: 0 };
  let matches = 0;
  const normalizedNodeName = normalize(node.name).replace(/^per\s+/, "");
  const nameMatches = normalizedNodeName === wantedName
    || normalizedNodeName.replace(/s$/, "") === wantedName.replace(/s$/, "");
  const updated = nameMatches ? { ...node, points } : { ...node };
  if (nameMatches) matches += 1;
  updated.children = (node.children || []).map(child => {
    const result = replaceTreePoints(child, wantedName, points);
    matches += result.matches;
    return result.node;
  });
  return { node: updated, matches };
}

function replaceTreeEnhancementPoints(node, wantedName, points) {
  if (!node) return { node, matches: 0 };
  let matches = 0;
  const nameMatches = node.kind === "upgrade" && canonicalEnhancementName(node.name) === wantedName;
  const updated = nameMatches ? { ...node, points } : { ...node };
  if (nameMatches) matches += 1;
  updated.children = (node.children || []).map(child => {
    const result = replaceTreeEnhancementPoints(child, wantedName, points);
    matches += result.matches;
    return result.node;
  });
  return { node: updated, matches };
}

function applyMfmPoints(units, armies, document) {
  let definitions = units.map(unit => ({ ...unit, pricing: { ...(unit.pricing || {}) } }));
  let armyDefinitions = armies.map(army => ({ ...army, enhancements: (army.enhancements || []).map(item => ({ ...item })) }));
  const issues = [...(document?.issues || [])];
  const summary = { total: 0, unitRows: 0, conditionalUnitRows: 0, wargearRows: 0, enhancementRows: 0, unmatched: 0 };
  const imperialOccurrences = new Map();
  const pointSource = `mfm-${document?.version || "unknown"}`;
  const directUnitKeys = new Set((document?.changes || [])
    .filter(change => change.kind === "unit")
    .map(change => `${canonicalChangeFaction(change)}\u0000${UNIT_NAME_ALIASES.get(normalize(change.unitName)) || normalize(change.unitName)}`));

  for (const change of document?.changes || []) {
    summary.total += 1;
    if (change.kind === "unit") {
      const key = [change.unitName, change.costBand, change.label, change.points].join("|");
      const occurrence = imperialOccurrences.get(key) || 0;
      imperialOccurrences.set(key, occurrence + 1);
      const context = inferImperialAgentsContext(change, occurrence);
      const matches = matchingUnits(definitions, change, directUnitKeys);
      if (!matches.length) {
        issues.push(unmatchedIssue(change)); summary.unmatched += 1; continue;
      }
      const matchKeys = new Set(matches.map(unitIdentity));
      definitions = definitions.map(unit => matchKeys.has(unitIdentity(unit)) ? {
        ...unit,
        pricing: {
          ...(unit.pricing || {}),
          // A Chapter's own MFM table overrides the generic Space Marines table.
          // Prepending exact-faction rows keeps that true regardless of the
          // alphabetical order in which faction pages were scraped.
          mfmRows: unit.faction === canonicalChangeFaction(change)
            ? [scheduleRow(change, context, pointSource), ...(unit.pricing?.mfmRows || [])]
            : [...(unit.pricing?.mfmRows || []), scheduleRow(change, context, pointSource)]
        }
      } : unit);
      summary.unitRows += 1;
      continue;
    }

    if (change.kind === "wargear") {
      const matches = matchingUnits(definitions, change, directUnitKeys);
      const wantedName = normalize(change.label).replace(/^(?:per\s+|\d+\s+)/, "");
      let changed = 0;
      const matchKeys = new Set(matches.map(unitIdentity));
      definitions = definitions.map(unit => {
        if (!matchKeys.has(unitIdentity(unit))) return unit;
        const result = replaceTreePoints(unit.selectionTree, wantedName, Number(change.points));
        changed += result.matches;
        return result.matches ? { ...unit, selectionTree: result.node } : unit;
      });
      if (!changed) { issues.push(unmatchedIssue(change)); summary.unmatched += 1; }
      else summary.wargearRows += 1;
      continue;
    }

    if (change.kind === "enhancement") {
      const faction = canonicalFaction(change.faction);
      const wantedDetachment = canonicalDetachmentName(change.detachmentName);
      const wantedEnhancement = canonicalEnhancementName(change.enhancementName);
      let changed = 0;
      armyDefinitions = armyDefinitions.map(army => {
        const factionMatches = army.faction === faction || (
          normalize(change.faction) === "space marines"
          && String(army.faction || "").startsWith("Imperium - Adeptus Astartes - ")
        );
        if (!factionMatches) return army;
        const detachmentIds = new Set((army.detachments || []).filter(item => canonicalDetachmentName(item.name) === wantedDetachment).map(item => item.id));
        const candidates = (army.enhancements || []).filter(item => canonicalEnhancementName(item.name) === wantedEnhancement);
        const matches = candidates.filter(item => !detachmentIds.size || (item.detachmentIds || []).some(id => detachmentIds.has(id)));
        if (!matches.length) return army;
        const ids = new Set(matches.map(item => item.id));
        changed += matches.length;
        return { ...army, enhancements: army.enhancements.map(item => ids.has(item.id) ? { ...item, points: Number(change.points), pointsSource: pointSource } : item) };
      });
      definitions = definitions.map(unit => {
        if (!unitMatchesFaction(unit, change)) return unit;
        const result = replaceTreeEnhancementPoints(unit.selectionTree, wantedEnhancement, Number(change.points));
        changed += result.matches;
        return result.matches ? { ...unit, selectionTree: result.node } : unit;
      });
      if (!changed) { issues.push(unmatchedIssue(change)); summary.unmatched += 1; }
      else summary.enhancementRows += 1;
    }
  }

  for (const schedule of document?.conditionalUnitSchedules || []) {
    const matches = matchingUnits(definitions, { ...schedule, kind: "unit" }, directUnitKeys);
    if (!matches.length) {
      issues.push(unmatchedIssue({ ...schedule, kind: "conditional-unit-schedule" }));
      summary.unmatched += 1;
      continue;
    }
    const rows = (schedule.rows || []).map(row => scheduleRow({
      costBand: row.costBand || "YOUR UNIT COSTS",
      label: row.label,
      points: row.points
    }, row.context, pointSource));
    const matchKeys = new Set(matches.map(unitIdentity));
    definitions = definitions.map(unit => {
      if (!matchKeys.has(unitIdentity(unit))) return unit;
      return {
        ...unit,
        pricing: {
          ...(unit.pricing || {}),
          // Context schedules are complete, authoritative tables. Replace
          // partial flat scrape rows for this unit so they cannot mask the
          // dedicated allied-Imperium prices.
          mfmRows: [
            ...rows,
            ...(unit.pricing?.mfmRows || []).filter(row => row.source !== pointSource)
          ]
        }
      };
    });
    summary.conditionalUnitRows += rows.length;
  }

  return { units: definitions, armies: armyDefinitions, summary, issues };
}

function unmatchedIssue(change) {
  return {
    code: "mfm-points-unmatched",
    severity: "error",
    message: `Could not apply MFM points row: ${change.faction} / ${change.unitName || change.detachmentName} / ${change.label || change.enhancementName}`,
    change
  };
}

module.exports = { applyMfmPoints, readMfmPoints };
