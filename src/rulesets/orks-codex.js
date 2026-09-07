"use strict";

const fs = require("fs");

const ORKS_FACTION = "Xenos - Orks";
const normalize = value => String(value || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function readOrksCodex(filePath) {
  if (!filePath) return { detachments: [], issues: [] };
  if (!fs.existsSync(filePath)) {
    return { detachments: [], issues: [{
      code: "orks-codex-missing", severity: "error",
      message: `Configured Orks army supplement is missing: ${filePath}`, filePath
    }] };
  }
  try {
    return { ...JSON.parse(fs.readFileSync(filePath, "utf8")), issues: [] };
  } catch (error) {
    return { detachments: [], issues: [{
      code: "orks-codex-invalid", severity: "error",
      message: `Configured Orks army supplement could not be parsed: ${filePath}`,
      filePath, cause: error.message
    }] };
  }
}

function matchesEligible(unit, eligible) {
  if (!eligible) {
    return Boolean(unit.roles?.character || (unit.keywords || []).some(item => normalize(item) === "character"));
  }
  const names = new Set((eligible.names || []).map(normalize));
  const keywords = new Set((unit.keywords || []).map(normalize));
  return names.has(normalize(unit.name))
    || Boolean(eligible.keywords?.length && eligible.keywords.every(keyword => keywords.has(normalize(keyword))));
}

function makeDetachment(item, dispositions, source, existingDetachments = []) {
  const slug = normalize(item.name).replace(/ /g, "-");
  const disposition = dispositions.find(entry => normalize(entry.name) === normalize(item.forceDisposition));
  const existing = existingDetachments.find(entry => normalize(entry.name) === normalize(item.name));
  return {
    id: existing?.id || `orks-codex-detachment-${slug}`,
    name: item.name,
    points: 0,
    detachmentPoints: Number(item.detachmentPoints),
    forceDisposition: disposition ? { id: disposition.id, name: disposition.name } : null,
    uniqueTags: [],
    rules: (item.rules || []).map((rule, index) => ({
      id: `orks-codex-${slug}-rule-${index + 1}`, ...rule, source
    })),
    stratagems: (item.stratagems || []).map((stratagem, index) => ({
      id: `orks-codex-${slug}-strat-${index + 1}`,
      type: `${item.name} Stratagem`,
      cpCost: String(stratagem.cpCost || 1),
      turn: "",
      phase: "",
      legend: "",
      detachment: item.name,
      factionId: "",
      scope: "detachment",
      sourceUrl: source,
      target: null,
      ...stratagem
    })),
    detachmentPointsSource: source,
    forceDispositionSource: source
  };
}

function applyOrksCodex(units, armies, document) {
  if (!document?.detachments?.length) {
    return { units, armies, issues: [...(document?.issues || [])], summary: { applied: false } };
  }

  const source = document.source || "Orks army supplement";
  const activeOrks = units.filter(unit =>
    unit.faction === ORKS_FACTION
    && unit.rosterSelectable
    && !/\[(?:legends|crucible)\]/i.test(unit.name)
  );

  const armyDefinitions = armies.map(army => {
    if (army.faction !== ORKS_FACTION) return army;
    const detachments = (document.detachments || []).map(item =>
      makeDetachment(item, army.forceDispositions || [], source, army.detachments || [])
    );
    const ids = new Map(detachments.map(item => [normalize(item.name), item.id]));
    const enhancements = [];

    for (const detachment of document.detachments || []) {
      for (const enhancement of detachment.enhancements || []) {
        const slug = `${normalize(detachment.name)}-${normalize(enhancement.name)}`.replace(/ /g, "-");
        const existingEnhancement = (army.enhancements || []).find(item =>
          normalize(item.name.replace(/\s+\(Upgrade\)$/i, "")) === normalize(enhancement.name)
          && (item.detachmentIds || []).includes(ids.get(normalize(detachment.name)))
        );
        enhancements.push({
          id: existingEnhancement?.id || `orks-codex-enhancement-${slug}`,
          name: enhancement.name,
          kind: enhancement.kind || "enhancement",
          maxSelections: Number(enhancement.maxSelections || (enhancement.kind === "upgrade" ? 3 : 1)),
          points: Number(enhancement.points),
          detachmentIds: [ids.get(normalize(detachment.name))],
          eligibleSelectionKeys: activeOrks.filter(unit => matchesEligible(unit, enhancement.eligible)).map(unit => unit.selectionKey),
          profiles: [{
            id: `orks-codex-enhancement-${slug}-ability`,
            name: enhancement.name,
            typeName: "Abilities",
            characteristics: { Description: enhancement.description || "" },
            source
          }],
          rules: [],
          source,
          pointsSource: source
        });
      }
    }

    return { ...army, detachments, enhancements };
  });

  return {
    units,
    armies: armyDefinitions,
    issues: [...(document.issues || [])],
    summary: {
      applied: true,
      unitSource: "bsdata",
      activeUnits: activeOrks.length,
      detachments: document.detachments.length,
      enhancements: document.detachments.reduce((count, item) => count + (item.enhancements || []).length, 0),
      changedProfiles: 0
    }
  };
}

module.exports = { applyOrksCodex, readOrksCodex };
