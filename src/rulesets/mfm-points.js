"use strict";

const fs = require("fs");

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
  "dark angels": "Imperium - Adeptus Astartes - Dark Angels",
  "death guard": "Chaos - Death Guard",
  "deathwatch": "Imperium - Adeptus Astartes - Deathwatch",
  "drukhari": "Xenos - Drukhari",
  "emperor s children": "Chaos - Emperor's Children",
  "genestealer cults": "Xenos - Genestealer Cults",
  "grey knights": "Imperium - Grey Knights",
  "imperial agents": "Imperium - Agents of the Imperium",
  "leagues of votann": "Xenos - Leagues of Votann",
  "necrons": "Xenos - Necrons",
  "orks": "Xenos - Orks",
  "space marines": "Imperium - Adeptus Astartes - Space Marines",
  "space wolves": "Imperium - Adeptus Astartes - Space Wolves",
  "t au empire": "Xenos - T'au Empire",
  "thousand sons": "Chaos - Thousand Sons",
  "tyranids": "Xenos - Tyranids",
  "world eaters": "Chaos - World Eaters"
}));

function normalize(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function readMfmPoints(filePath) {
  if (!filePath) return { changes: [], source: null, version: null, generatedAt: null, issues: [] };
  if (!fs.existsSync(filePath)) {
    return {
      changes: [], source: null, version: null, generatedAt: null,
      issues: [{ code: "mfm-points-missing", severity: "error", message: `Configured MFM points source is missing: ${filePath}`, filePath }]
    };
  }
  try {
    const document = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      changes: Array.isArray(document?.changes) ? document.changes : [],
      source: document?.source || null,
      version: document?.version || null,
      generatedAt: document?.generatedAt || null,
      issues: []
    };
  } catch (error) {
    return {
      changes: [], source: null, version: null, generatedAt: null,
      issues: [{ code: "mfm-points-invalid", severity: "error", message: `Configured MFM points source could not be parsed: ${filePath}`, filePath, cause: error.message }]
    };
  }
}

function canonicalFaction(mfmFaction) {
  return FACTION_ALIASES.get(normalize(mfmFaction)) || mfmFaction;
}

function unitMatchesFaction(unit, change) {
  const expected = canonicalFaction(change.faction);
  if (unit.faction === expected) return true;
  // The Space Marines MFM page also carries named Chapter units.
  return normalize(change.faction) === "space marines"
    && String(unit.faction || "").startsWith("Imperium - Adeptus Astartes - ");
}

function matchingUnits(units, change) {
  const wantedName = normalize(change.unitName);
  const exactFaction = units.filter(unit => unit.faction === canonicalFaction(change.faction) && normalize(unit.name) === wantedName);
  if (exactFaction.length) return exactFaction;
  return units.filter(unit => unitMatchesFaction(unit, change) && normalize(unit.name) === wantedName);
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

function scheduleRow(change, context) {
  const simple = String(change.label || "").match(/^(\d+)\s+models?$/i);
  const composition = simple ? null : String(change.label || "").split(",").map(part => {
    const match = part.trim().match(/^(\d+)\s+(.+)$/);
    return match ? { count: Number(match[1]), name: match[2].trim() } : null;
  }).filter(Boolean);
  return {
    source: "mfm-1.1",
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
  const updated = normalizedNodeName === wantedName ? { ...node, points } : { ...node };
  if (normalizedNodeName === wantedName) matches += 1;
  updated.children = (node.children || []).map(child => {
    const result = replaceTreePoints(child, wantedName, points);
    matches += result.matches;
    return result.node;
  });
  return { node: updated, matches };
}

function applyMfmPoints(units, armies, document) {
  let definitions = units.map(unit => ({ ...unit, pricing: { ...(unit.pricing || {}) } }));
  let armyDefinitions = armies.map(army => ({ ...army, enhancements: (army.enhancements || []).map(item => ({ ...item })) }));
  const issues = [...(document?.issues || [])];
  const summary = { total: 0, unitRows: 0, wargearRows: 0, enhancementRows: 0, unmatched: 0 };
  const imperialOccurrences = new Map();

  for (const change of document?.changes || []) {
    summary.total += 1;
    if (change.kind === "unit") {
      const key = [change.unitName, change.costBand, change.label, change.points].join("|");
      const occurrence = imperialOccurrences.get(key) || 0;
      imperialOccurrences.set(key, occurrence + 1);
      const context = inferImperialAgentsContext(change, occurrence);
      const matches = matchingUnits(definitions, change);
      if (!matches.length) {
        issues.push(unmatchedIssue(change)); summary.unmatched += 1; continue;
      }
      const matchKeys = new Set(matches.map(unit => unit.selectionKey));
      definitions = definitions.map(unit => matchKeys.has(unit.selectionKey) ? {
        ...unit,
        pricing: {
          ...(unit.pricing || {}),
          mfmRows: [...(unit.pricing?.mfmRows || []), scheduleRow(change, context)]
        }
      } : unit);
      summary.unitRows += 1;
      continue;
    }

    if (change.kind === "wargear") {
      const matches = matchingUnits(definitions, change);
      const wantedName = normalize(change.label).replace(/^per\s+/, "");
      let changed = 0;
      const matchKeys = new Set(matches.map(unit => unit.selectionKey));
      definitions = definitions.map(unit => {
        if (!matchKeys.has(unit.selectionKey)) return unit;
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
      const wantedDetachment = normalize(change.detachmentName);
      const wantedEnhancement = normalize(change.enhancementName).replace(/\s+upgrade$/, "");
      let changed = 0;
      armyDefinitions = armyDefinitions.map(army => {
        const factionMatches = army.faction === faction || (
          normalize(change.faction) === "space marines"
          && String(army.faction || "").startsWith("Imperium - Adeptus Astartes - ")
        );
        if (!factionMatches) return army;
        const detachmentIds = new Set((army.detachments || []).filter(item => normalize(item.name) === wantedDetachment).map(item => item.id));
        const candidates = (army.enhancements || []).filter(item => normalize(item.name).replace(/\s+upgrade$/, "") === wantedEnhancement);
        const matches = candidates.filter(item => !detachmentIds.size || (item.detachmentIds || []).some(id => detachmentIds.has(id)));
        if (!matches.length) return army;
        const ids = new Set(matches.map(item => item.id));
        changed += matches.length;
        return { ...army, enhancements: army.enhancements.map(item => ids.has(item.id) ? { ...item, points: Number(change.points), pointsSource: "mfm-1.1" } : item) };
      });
      if (!changed) { issues.push(unmatchedIssue(change)); summary.unmatched += 1; }
      else summary.enhancementRows += 1;
    }
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
