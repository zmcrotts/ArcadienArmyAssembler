"use strict";

const { asArray, loadBsdataContext } = require("./unit-definitions");

const ALLY_SOURCES = [
  { pattern: /^Imperium - Agents of the Imperium$/, type: "agents", label: "Agents of the Imperium" },
  { pattern: /^Imperium - Imperial Knights - Library$/, type: "imperialKnights", label: "Imperial Knights" },
  { pattern: /^Chaos - Chaos Knights Library$/, type: "chaosKnights", label: "Chaos Knights" },
  { pattern: /^Chaos - (Chaos )?Daemons Library$/, type: "chaosDaemons", label: "Chaos Daemons" },
  { pattern: /^Imperium - Astra Militarum - Library$/, type: "astraMilitarum", label: "Astra Militarum" },
  { pattern: /^Library - Titans$/, type: "titans", label: "Titans" },
  { pattern: /^Unaligned Forces$/, type: "unaligned", label: "Unaligned Forces" }
];

function sourceFor(name) {
  return ALLY_SOURCES.find(item => item.pattern.test(name)) || null;
}

function extractAllyDefinitions(dataDirectory, unitDefinitions) {
  const { catalogues } = loadBsdataContext(dataDirectory);
  const unitsByFaction = new Map();
  for (const unit of unitDefinitions || []) {
    if (!unitsByFaction.has(unit.faction)) unitsByFaction.set(unit.faction, []);
    unitsByFaction.get(unit.faction).push(unit.selectionKey);
  }

  return Object.fromEntries(catalogues.map(({ catalogue }) => {
    const seenTypes = new Set();
    const allies = [];
    for (const link of asArray(catalogue?.catalogueLinks?.catalogueLink)) {
      const source = sourceFor(link.name || "");
      if (!source || seenTypes.has(source.type)) continue;
      const selectionKeys = unitsByFaction.get(link.name) || [];
      if (!selectionKeys.length) continue;
      seenTypes.add(source.type);
      allies.push({
        type: source.type,
        label: source.label,
        sourceFaction: link.name,
        sourceCatalogueId: link.targetId || null,
        selectionKeys
      });
    }
    if (!seenTypes.has("unaligned")) {
      const selectionKeys = unitsByFaction.get("Unaligned Forces") || [];
      if (selectionKeys.length) allies.push({
        type: "unaligned",
        label: "Unaligned Forces",
        sourceFaction: "Unaligned Forces",
        sourceCatalogueId: "581a-46b9-5b86-44b7",
        selectionKeys
      });
    }
    return [catalogue.name, allies];
  }).filter(([, allies]) => allies.length));
}

module.exports = { ALLY_SOURCES, extractAllyDefinitions };
