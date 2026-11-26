"use strict";

const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const PACKS = ["Tyrannic War", "Pariah Nexus", "Nachmund Gauntlet", "Armageddon", "White Dwarf"];

function extractCrusadeData(directory) {
  const records = new Map();
  const relevant = /\bcrusade\b|battle traits|battle scars|battle honours|weapon modifications|blackstone upgrades|mighty champions/i;
  const roots = fs.readdirSync(directory).filter(name => name.endsWith(".json")).sort().map(file => {
    const document = JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
    return { file, root: document.gameSystem || document.catalogue, core: Boolean(document.gameSystem) };
  }).filter(item => item.root);
  const categories = {}, references = {}, costTypes = {}, catalogues = {};
  const nodes = new Map(), unitNodes = [];
  for (const { file, root, core } of roots) {
    if (!core) catalogues[root.id] = { name: root.name, file, links: (root.catalogueLinks || []).map(link => link.targetId) };
    for (const category of root.categoryEntries || []) categories[category.id] = category.name;
    for (const cost of root.costTypes || []) costTypes[cost.id] = cost.name;
    (function index(node, depth = 0) {
      if (node.id && node.name) { references[node.id] = node.name; nodes.set(node.id,node); }
      if (node.type === "unit" || (node.type === "model" && depth === 1)) unitNodes.push(node);
      for (const key of ["selectionEntries", "sharedSelectionEntries", "selectionEntryGroups", "sharedSelectionEntryGroups"])
        for (const child of node[key] || []) index(child, depth + 1);
    })(root);
  }
  function visibility(node) {
    const result = [];
    function collect(group, inherited = []) {
      const conditions = [...inherited, ...(group.conditions || []), ...(group.conditionGroups || [])];
      for (const modifier of group.modifiers || []) if (modifier.field === "hidden" && modifier.type === "set") result.push({
        value: modifier.value === true || modifier.value === "true",
        test: { type: "and", conditionGroups: conditions, conditions: modifier.conditions || [],
          ...(modifier.conditionGroups?.length ? { conditionGroups: [...conditions, ...modifier.conditionGroups] } : {}) }
      });
      for (const child of group.modifierGroups || []) collect(child, conditions);
    }
    collect(node);
    return { name: node.name, hidden: Boolean(node.hidden), rules: result };
  }
  for (const { file, root, core } of roots) {
    const faction = core ? "Core" : root.name || file.replace(/\.json$/, "");
    function visit(node, ancestors = [], active = false) {
      if (!node || typeof node !== "object") return;
      const names = [...ancestors.map(item => item.name), node.name || ""].filter(Boolean);
      const enabled = active || relevant.test(node.name || "");
      const descriptions = [
        ...(node.profiles || []).flatMap(profile => (profile.characteristics || [])
          .filter(item => /description/i.test(item.name)).map(item => item.$text || item["#text"] || "")),
        ...(node.rules || []).map(rule => rule.description || "")
      ].filter(Boolean);
      const weaponChoice = ancestors.some(item => item.name === "Weapon Modifications");
      if (enabled && node.type === "upgrade" && node.id && (descriptions.length || weaponChoice)) {
        const context = names.join(" / ");
        const pack = PACKS.find(name => context.toLowerCase().includes(name.toLowerCase())) || (faction === "Core" ? "Core" : "Faction");
        const kind = /weapon modif/i.test(context) ? "weapon" : /relic/i.test(context) ? "relic" : ancestors.some(item => /scars?$/i.test(item.name)) ? "scar" : "honour";
        const id = `${root.id}:${node.id}`;
        records.set(id, {
          id, sourceId: node.id, catalogueId: core ? null : root.id, name: node.name, kind, pack, faction,
          table: ancestors.slice(1).map(item => item.name).join(" / "),
          tableName: ancestors.at(-1)?.name || "Other upgrades",
          tableId: `${root.id}:${ancestors.at(-1)?.id || "other"}`,
          rarity: kind === "relic" ? (/\bLegendary Relics\b/i.test(context) ? "Legendary" : /\bAntiquity Relics\b/i.test(context) ? "Antiquity" : /\bArtificer Relics\b/i.test(context) ? "Artificer" : "Other") : null,
          visibility: [...ancestors.filter(item => item !== root), node].map(visibility).filter(item => item.hidden || item.rules.length),
          description: [...new Set(descriptions)].join("\n\n") || `Weapon upgrade: ${node.name}.`,
          crusadePoints: Number((node.costs || []).find(cost => /crusade points/i.test(cost.name))?.value || 0),
          constraints: node.constraints || [], modifiers: node.modifiers || [],
          modifierGroups: node.modifierGroups || []
        });
      }
      for (const key of ["selectionEntries", "sharedSelectionEntries", "selectionEntryGroups", "sharedSelectionEntryGroups"]) {
        for (const child of node[key] || []) visit(child, [...ancestors, node], enabled);
      }
    }
    visit(root);
  }
  // Some shared tables have no local visibility gate: they are linked only by
  // a specific unit in another catalogue (e.g. the Emperor's Champion).
  const owners = new Map();
  const awardIds = new Set([...records.values()].map(record => record.sourceId));
  for (const unit of unitNodes) {
    const seen = new Set();
    (function visit(node) {
      if (!node || seen.has(node) || (node.type === "unit" && node !== unit)) return;
      seen.add(node);
      if (awardIds.has(node.id)) { if (!owners.has(node.id)) owners.set(node.id,new Set()); owners.get(node.id).add(unit.id); }
      for (const key of ["selectionEntries","selectionEntryGroups"]) for (const child of node[key] || []) visit(child);
      for (const link of node.entryLinks || []) visit(nodes.get(link.targetId));
    })(unit);
  }
  const used = new Set();
  function referenced(value) {
    if (!value || typeof value !== "object") return;
    if (value.childId) used.add(value.childId);
    for (const child of Object.values(value)) if (child && typeof child === "object") referenced(child);
  }
  for (const record of records.values()) {
    referenced(record.visibility);
    const unitIds=owners.get(record.sourceId);
    if(unitIds?.size && unitIds.size<=12){record.allowedUnitIds=[...unitIds];for(const id of unitIds)used.add(id);}
  }
  return { schemaVersion: 2, source: "Bundled BSData wh40k-11e-vflam", packs: ["Core", ...PACKS],
    categories, costTypes, catalogues, references: Object.fromEntries([...used].filter(id => references[id]).map(id => [id, references[id]])), records: [...records.values()] };
}

function buildCrusadeData() {
  const data = extractCrusadeData(path.join(ROOT, "data/rulesets/wh40k-11e-vflam"));
  const suppliedRules = path.join(ROOT, "data/manual-rules/wh40k10-local-crusade.json");
  if (fs.existsSync(suppliedRules)) data.localRules = JSON.parse(fs.readFileSync(suppliedRules,"utf8"));
  fs.writeFileSync(path.join(ROOT, "ui/crusade-data.js"), `"use strict";\nwindow.ArcadienCrusadeData = ${JSON.stringify(data)};\n`);
  console.log(`Built Crusade reference data: ${data.records.length} entries.`);
  return data;
}
if (require.main === module) buildCrusadeData();
module.exports = { extractCrusadeData, buildCrusadeData };
