"use strict";

const fs = require("fs");

function normalize(value) {
  return String(value || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function readFactionPackUpdates(filePath) {
  if (!filePath) return { updates: [], source: null, version: null, issues: [] };
  if (!fs.existsSync(filePath)) {
    return {
      updates: [], source: null, version: null,
      issues: [{ code: "faction-pack-updates-missing", severity: "error", message: `Configured faction-pack update source is missing: ${filePath}`, filePath }]
    };
  }
  try {
    const document = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      updates: Array.isArray(document?.updates) ? document.updates : [],
      source: document?.source || null,
      version: document?.version || null,
      lastUpdated: document?.lastUpdated || null,
      issues: []
    };
  } catch (error) {
    return {
      updates: [], source: null, version: null,
      issues: [{ code: "faction-pack-updates-invalid", severity: "error", message: `Configured faction-pack update source could not be parsed: ${filePath}`, filePath, cause: error.message }]
    };
  }
}

function matchesFaction(faction, target) {
  if (target.faction) return faction === target.faction;
  if (target.factionPrefix) return faction === target.factionPrefix || faction.startsWith(`${target.factionPrefix} - `);
  return false;
}

function matchesName(name, names) {
  return (names || []).some(item => normalize(item) === normalize(name));
}

function matchesRuleName(left, right) {
  const clean = value => normalize(String(value || "").replace(/\([^)]*\)\s*$/g, "")).replace(/\b(?:aura|psychic)\b$/g, "").trim();
  return clean(left) === clean(right);
}

function patchedText(value, update) {
  const current = String(value || "");
  let next = update.description !== undefined ? update.description : current;
  if (update.replaceSection && update.description !== undefined) {
    const marker = current.toLowerCase().indexOf(String(update.replaceSection).toLowerCase());
    if (marker >= 0) {
      const following = current.slice(marker + String(update.replaceSection).length);
      const nextSection = following.search(/\n(?:WHEN|TARGET|EFFECT|RESTRICTION):/);
      const suffix = nextSection >= 0 ? following.slice(nextSection) : "";
      next = `${current.slice(0, marker)}${update.description}${suffix}`;
    }
  }
  for (const replacement of update.textReplacements || []) {
    next = next.split(replacement.from).join(replacement.to);
  }
  return next;
}

function walkTree(node, visitor) {
  if (!node) return;
  visitor(node);
  for (const child of node.children || []) walkTree(child, visitor);
}

function updateUnit(unit, update) {
  const next = JSON.parse(JSON.stringify(unit));
  if (update.kind === "keywords-add") {
    next.keywords = [...new Set([...(next.keywords || []), ...(update.keywords || [])])];
    return { value: next, matches: 1 };
  }
  if (update.kind === "keywords-remove") {
    const removed = new Set((update.keywords || []).map(normalize));
    next.keywords = (next.keywords || []).filter(item => !removed.has(normalize(item)));
    return { value: next, matches: 1 };
  }
  if (update.kind === "roster-rules-patch") {
    next.rosterRules = { ...(next.rosterRules || {}), ...(update.patch || {}) };
    return { value: next, matches: 1 };
  }
  if (update.kind === "role-patch") {
    next.roles = { ...(next.roles || {}), ...(update.patch || {}) };
    return { value: next, matches: 1 };
  }
  let matches = 0;
  if (update.kind === "rule-add") {
    next.selectionTree.rules = [...(next.selectionTree.rules || []), {
      id: update.id,
      name: update.ruleName,
      description: update.description,
      source: update.source
    }];
    return { value: next, matches: 1 };
  }
  if (update.kind === "profile-add") {
    const target = update.nodeName
      ? (() => { let found = null; walkTree(next.selectionTree, node => { if (!found && normalize(node.name) === normalize(update.nodeName)) found = node; }); return found; })()
      : next.selectionTree;
    if (!target) return { value: next, matches: 0 };
    target.profiles = [...(target.profiles || []), {
      id: update.id,
      name: update.profileName,
      typeId: update.typeId || null,
      typeName: update.typeName,
      characteristics: { ...(update.characteristics || {}) },
      source: update.source
    }];
    return { value: next, matches: 1 };
  }
  walkTree(next.selectionTree, node => {
    if (update.kind === "rule-remove") {
      const before = (node.rules || []).length;
      node.rules = (node.rules || []).filter(rule => !matchesRuleName(rule.name, update.ruleName));
      matches += before - node.rules.length;
      const profileCount = (node.profiles || []).length;
      node.profiles = (node.profiles || []).filter(profile => !(
        normalize(profile.typeName) === "abilities" && matchesRuleName(profile.name, update.ruleName)
      ));
      matches += profileCount - node.profiles.length;
    }
    if (update.kind === "rule-replace") {
      node.rules = (node.rules || []).map(rule => {
        if (!matchesRuleName(rule.name, update.ruleName)) return rule;
        matches += 1;
        return { ...rule, description: patchedText(rule.description, update), source: update.source };
      });
      node.profiles = (node.profiles || []).map(profile => {
        if (normalize(profile.typeName) !== "abilities" || !matchesRuleName(profile.name, update.ruleName)) return profile;
        matches += 1;
        return {
          ...profile,
          characteristics: { ...(profile.characteristics || {}), Description: patchedText(profile.characteristics?.Description, update) },
          source: update.source
        };
      });
    }
    if (update.kind === "profile-patch") {
      node.profiles = (node.profiles || []).map(profile => {
        if (normalize(profile.name) !== normalize(update.profileName)) return profile;
        if (update.typeName && normalize(profile.typeName) !== normalize(update.typeName)) return profile;
        matches += 1;
        return {
          ...profile,
          characteristics: { ...(profile.characteristics || {}), ...(update.characteristics || {}) },
          source: update.source
        };
      });
    }
  });
  return { value: next, matches };
}

function updateArmy(army, update) {
  const next = JSON.parse(JSON.stringify(army));
  let matches = 0;
  if (update.kind === "army-rule-add") {
    next.armyRules = [...(next.armyRules || []), {
      id: update.id,
      name: update.ruleName,
      description: update.description,
      source: update.source
    }];
    matches += 1;
  }
  if (update.kind === "army-rule-replace") {
    next.armyRules = (next.armyRules || []).map(rule => {
      if (normalize(rule.name) !== normalize(update.ruleName)) return rule;
      matches += 1;
      return { ...rule, description: patchedText(rule.description, update), source: update.source };
    });
  }
  for (const detachment of next.detachments || []) {
    if (update.detachmentName && normalize(detachment.name) !== normalize(update.detachmentName)) continue;
    if (update.kind === "detachment-rule-replace") {
      detachment.rules = (detachment.rules || []).map(rule => {
        if (normalize(rule.name) !== normalize(update.ruleName)) return rule;
        matches += 1;
        return { ...rule, description: patchedText(rule.description, update), source: update.source };
      });
    }
    if (["stratagem-replace", "stratagem-patch"].includes(update.kind)) {
      detachment.stratagems = (detachment.stratagems || []).map(stratagem => {
        if (normalize(stratagem.name) !== normalize(update.stratagemName)) return stratagem;
        matches += 1;
        return {
          ...stratagem,
          ...(update.newName ? { name: update.newName } : {}),
          ...((update.description !== undefined || update.textReplacements) ? { description: patchedText(stratagem.description, update) } : {}),
          ...(update.cpCost !== undefined ? { cpCost: String(update.cpCost) } : {}),
          sourceUrl: update.source
        };
      });
    }
  }
  if (update.kind === "enhancement-add") {
    const detachmentIds = (next.detachments || [])
      .filter(item => !update.detachmentName || normalize(item.name) === normalize(update.detachmentName))
      .map(item => item.id);
    if (detachmentIds.length) {
      next.enhancements = [...(next.enhancements || []), {
        id: update.id,
        name: update.enhancementName,
        kind: update.enhancementKind || "enhancement",
        maxSelections: Number(update.maxSelections || 1),
        points: Number(update.points || 0),
        detachmentIds,
        eligibleSelectionKeys: update.eligibleSelectionKeys || [],
        profiles: [{
          id: `${update.id}-ability`,
          name: update.enhancementName,
          typeName: "Abilities",
          characteristics: { Description: update.description || "" },
          source: update.source
        }],
        rules: [],
        source: update.source
      }];
      matches += 1;
    }
  }
  if (update.kind === "enhancement-replace") {
    next.enhancements = (next.enhancements || []).map(enhancement => {
      if (normalize(enhancement.name) !== normalize(update.enhancementName)) return enhancement;
      if (update.detachmentName) {
        const ids = new Set((next.detachments || []).filter(item => normalize(item.name) === normalize(update.detachmentName)).map(item => item.id));
        if (!(enhancement.detachmentIds || []).some(id => ids.has(id))) return enhancement;
      }
      matches += 1;
      const profiles = (enhancement.profiles || []).map(profile => profile.typeName === "Abilities"
        ? { ...profile, characteristics: { ...(profile.characteristics || {}), Description: patchedText(profile.characteristics?.Description, update) }, source: update.source }
        : profile);
      return { ...enhancement, profiles, source: update.source };
    });
  }
  return { value: next, matches };
}

function applyFactionPackUpdates(units, armies, document) {
  let unitDefinitions = units;
  let armyDefinitions = armies;
  const issues = [...(document?.issues || [])];
  const summary = { configured: 0, applied: 0, unmatched: 0 };
  for (const raw of document?.updates || []) {
    const update = { ...raw, source: raw.source || document.source };
    summary.configured += 1;
    let matches = 0;
    if (["army-rule-add", "army-rule-replace", "detachment-rule-replace", "stratagem-replace", "stratagem-patch", "enhancement-add", "enhancement-replace"].includes(update.kind)) {
      if (update.kind === "enhancement-add") {
        update.eligibleSelectionKeys = unitDefinitions
          .filter(unit => matchesFaction(unit.faction, update.target || {}) && (!update.unitNames || matchesName(unit.name, update.unitNames)))
          .map(unit => unit.selectionKey);
      }
      armyDefinitions = armyDefinitions.map(army => {
        if (!matchesFaction(army.faction, update.target || {})) return army;
        const result = updateArmy(army, update);
        matches += result.matches;
        return result.value;
      });
    } else {
      unitDefinitions = unitDefinitions.map(unit => {
        if (!matchesFaction(unit.faction, update.target || {}) || !matchesName(unit.name, update.unitNames)) return unit;
        const result = updateUnit(unit, update);
        matches += result.matches;
        return result.value;
      });
    }
    if (matches) summary.applied += 1;
    else {
      summary.unmatched += 1;
      issues.push({ code: "faction-pack-update-unmatched", severity: "error", message: `Could not apply faction-pack update: ${update.id || update.kind}`, update });
    }
  }
  return { units: unitDefinitions, armies: armyDefinitions, summary, issues };
}

module.exports = { applyFactionPackUpdates, readFactionPackUpdates };
