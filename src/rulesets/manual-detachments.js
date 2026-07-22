"use strict";

const fs = require("fs");

function readManualDetachments(filePath) {
  if (!filePath) return { detachments: [], source: null, issues: [] };
  if (!fs.existsSync(filePath)) {
    return {
      detachments: [], source: null,
      issues: [{ code: "manual-detachments-missing", severity: "error", message: `Configured manual detachments source is missing: ${filePath}`, filePath }]
    };
  }
  try {
    const document = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      detachments: Array.isArray(document?.detachments) ? document.detachments : [],
      source: { kind: document?.kind || "manual-detachments", name: document?.name || "Manual Detachments", lastUpdated: document?.lastUpdated || null, filePath },
      issues: []
    };
  } catch (error) {
    return {
      detachments: [], source: null,
      issues: [{ code: "manual-detachments-invalid", severity: "error", message: `Configured manual detachments source could not be parsed: ${filePath}`, filePath, cause: error.message }]
    };
  }
}

function matchesFaction(faction, target) {
  if (target?.faction) return faction === target.faction;
  if (target?.factionPrefix) return faction === target.factionPrefix || faction.startsWith(`${target.factionPrefix} - `);
  return false;
}

function matchesEligibility(unit, eligibility) {
  if (!eligibility) return true;
  if (Array.isArray(eligibility.any)) return eligibility.any.some(item => matchesEligibility(unit, item));
  const keywords = new Set((unit.keywords || []).map(item => String(item).toLowerCase()));
  return (eligibility.allKeywords || []).every(item => keywords.has(String(item).toLowerCase()));
}

function normalizeStratagem(item, detachment) {
  return {
    id: item.id,
    name: item.name,
    type: `${detachment.name} Stratagem`,
    cpCost: String(item.cpCost || "1"),
    turn: item.turn || "",
    phase: item.phase || "",
    legend: item.legend || "",
    description: item.description || "",
    detachment: detachment.name,
    factionId: "",
    scope: "detachment",
    sourceUrl: detachment.source || null,
    target: item.target || null
  };
}

function applyManualDetachments(units, armies, document) {
  let added = 0;
  const definitions = armies.map(army => {
    const additions = (document?.detachments || []).filter(item => matchesFaction(army.faction, item.target));
    if (!additions.length) return army;
    let detachments = [...(army.detachments || [])];
    let enhancements = [...(army.enhancements || [])];
    for (const addition of additions) {
      if (detachments.some(item => item.name === addition.name)) continue;
      const detachment = {
        id: addition.id,
        name: addition.name,
        points: 0,
        detachmentPoints: Number(addition.detachmentPoints || 0),
        forceDisposition: addition.forceDisposition || null,
        rules: (addition.rules || []).map(rule => ({ ...rule, source: document.source })),
        stratagems: (addition.stratagems || []).map(item => normalizeStratagem(item, addition))
      };
      const armyUnits = units.filter(unit => unit.faction === army.faction && (army.allowedSelectionKeys || []).includes(unit.selectionKey));
      const detachmentEnhancements = (addition.enhancements || []).map(item => ({
        id: item.id,
        name: item.name,
        kind: "enhancement",
        maxSelections: 1,
        points: Number(item.points || 0),
        detachmentIds: [addition.id],
        eligibleSelectionKeys: armyUnits.filter(unit => matchesEligibility(unit, item.eligibility)).map(unit => unit.selectionKey),
        profiles: item.profiles || [{
          id: `${item.id}-ability`,
          name: item.name,
          typeName: "Abilities",
          characteristics: { Description: item.description || "" }
        }],
        rules: [],
        source: document.source
      }));
      detachments.push(detachment);
      enhancements.push(...detachmentEnhancements);
      added += 1;
    }
    return { ...army, detachments, enhancements };
  });
  return { definitions, summary: { configured: document?.detachments?.length || 0, added }, issues: [...(document?.issues || [])] };
}

module.exports = { applyManualDetachments, readManualDetachments };
