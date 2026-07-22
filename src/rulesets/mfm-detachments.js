"use strict";

const fs = require("fs");

const FACTION_TARGETS = new Map(Object.entries({
  "adepta-sororitas": "Imperium - Adepta Sororitas",
  "adeptus-custodes": "Imperium - Adeptus Custodes",
  "adeptus-mechanicus": "Imperium - Adeptus Mechanicus",
  "aeldari": "Xenos - Aeldari",
  "astra-militarum": "Imperium - Astra Militarum",
  "black-templars": "Imperium - Adeptus Astartes - Black Templars",
  "blood-angels": "Imperium - Adeptus Astartes - Blood Angels",
  "chaos-daemons": "Chaos - Chaos Daemons",
  "chaos-knights": "Chaos - Chaos Knights",
  "chaos-space-marines": "Chaos - Chaos Space Marines",
  "dark-angels": "Imperium - Adeptus Astartes - Dark Angels",
  "death-guard": "Chaos - Death Guard",
  "deathwatch": "Imperium - Adeptus Astartes - Deathwatch",
  "drukhari": "Xenos - Drukhari",
  "emperors-children": "Chaos - Emperor's Children",
  "genestealer-cults": "Xenos - Genestealer Cults",
  "grey-knights": "Imperium - Grey Knights",
  "imperial-agents": "Imperium - Agents of the Imperium",
  "imperial-knights": "Imperium - Imperial Knights",
  "leagues-of-votann": "Xenos - Leagues of Votann",
  "necrons": "Xenos - Necrons",
  "orks": "Xenos - Orks",
  "space-wolves": "Imperium - Adeptus Astartes - Space Wolves",
  "tau-empire": "Xenos - T'au Empire",
  "thousand-sons": "Chaos - Thousand Sons",
  "tyranids": "Xenos - Tyranids",
  "world-eaters": "Chaos - World Eaters"
}));

const DETACHMENT_ALIASES = new Map(Object.entries({
  "adeptus-mechanicus|haloscreed battle clade": "haloscreed battleclade",
  "adeptus-mechanicus|luminen auto choir": "luminen autochoir",
  "genestealer-cults|brood brothers auxilia": "brood brother auxilia",
  "imperial-agents|ordo hereticus purgation force": "purgation force ordo hereticus",
  "imperial-agents|ordo malleus daemon hunters": "daemon hunters ordo malleus",
  "imperial-agents|ordo xenos alien hunters": "alien hunters ordo xenos"
}));

function normalize(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function readMfmDetachments(filePath) {
  if (!filePath) return { detachments: [], source: null, version: null, generatedAt: null, issues: [] };
  if (!fs.existsSync(filePath)) {
    return {
      detachments: [], source: null, version: null, generatedAt: null,
      issues: [{ code: "mfm-detachments-missing", severity: "error", message: `Configured MFM detachment source is missing: ${filePath}`, filePath }]
    };
  }
  try {
    const document = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      detachments: Array.isArray(document?.detachments) ? document.detachments : [],
      source: document?.source || null,
      version: document?.version || null,
      generatedAt: document?.generatedAt || null,
      issues: []
    };
  } catch (error) {
    return {
      detachments: [], source: null, version: null, generatedAt: null,
      issues: [{ code: "mfm-detachments-invalid", severity: "error", message: `Configured MFM detachment source could not be parsed: ${filePath}`, filePath, cause: error.message }]
    };
  }
}

function matchingSpecificity(army, record) {
  if (record.factionSlug === "space-marines") {
    return String(army.faction || "").startsWith("Imperium - Adeptus Astartes - ") ? 1 : 0;
  }
  return army.faction === FACTION_TARGETS.get(record.factionSlug) ? 2 : 0;
}

function recordDetachmentName(record) {
  const name = normalize(record.detachmentName);
  return DETACHMENT_ALIASES.get(`${record.factionSlug}|${name}`) || name;
}

function applyMfmDetachments(armies, document) {
  const records = document?.detachments || [];
  const issues = [...(document?.issues || [])];
  const matchedRecords = new Set();
  const summary = {
    total: records.length,
    matched: 0,
    unmatched: 0,
    dpMismatches: 0,
    dispositionMismatches: 0,
    dispositionFlags: records.filter(item => item.dispositionChanged).length,
    detachmentPointFlags: records.filter(item => item.detachmentPointsChanged).length
  };

  const definitions = armies.map(army => {
    const applicable = records
      .map((record, index) => ({ record, index, specificity: matchingSpecificity(army, record) }))
      .filter(item => item.specificity)
      .sort((left, right) => left.specificity - right.specificity);
    const byName = new Map(applicable.map(item => [recordDetachmentName(item.record), item]));
    const detachments = (army.detachments || []).map(detachment => {
      const match = byName.get(normalize(detachment.name));
      if (!match) return detachment;
      matchedRecords.add(match.index);
      const points = Number(match.record.detachmentPoints);
      const disposition = (army.forceDispositions || []).find(item => normalize(item.name) === normalize(match.record.forceDisposition));
      if (!disposition) {
        issues.push({
          code: "mfm-detachment-disposition-unmatched",
          severity: "error",
          message: `Could not resolve MFM force disposition: ${army.faction} / ${detachment.name} / ${match.record.forceDisposition}`,
          record: match.record
        });
      }
      if (Number(detachment.detachmentPoints) !== points) summary.dpMismatches += 1;
      if (normalize(detachment.forceDisposition?.name) !== normalize(match.record.forceDisposition)) summary.dispositionMismatches += 1;
      return {
        ...detachment,
        detachmentPoints: points,
        detachmentPointsSource: `mfm-${document.version || "current"}`,
        forceDisposition: disposition ? { id: disposition.id, name: disposition.name } : detachment.forceDisposition,
        forceDispositionSource: `mfm-${document.version || "current"}`
      };
    });
    return { ...army, detachments };
  });

  summary.matched = matchedRecords.size;
  for (let index = 0; index < records.length; index += 1) {
    if (matchedRecords.has(index)) continue;
    summary.unmatched += 1;
    const record = records[index];
    issues.push({
      code: "mfm-detachment-unmatched",
      severity: "error",
      message: `Could not apply MFM detachment row: ${record.factionSlug} / ${record.detachmentName}`,
      record
    });
  }
  return { definitions, summary, issues };
}

module.exports = { applyMfmDetachments, readMfmDetachments };
