"use strict";
const fs = require("node:fs");
const zlib = require("node:zlib");
const isMarine = value => String(value || "").startsWith("Imperium - Adeptus Astartes");
function readSpaceMarineUnits(file) {
  if (!file) return null;
  const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
  if (data.schemaVersion !== 1 || !data.commit || !data.units?.length || !data.armies?.length) throw new Error("Invalid pinned Space Marine unit source");
  const keys = new Set();
  const hasCurrentCalgar = data.units.some(unit => unit.name === "Marneus Calgar in Armour of Antilochus");
  const units = data.units.filter(unit => !(hasCurrentCalgar && unit.name === "Marneus Calgar")).map(({ selectionTreeRef, ...unit }) => {
    if (!isMarine(unit.faction) || keys.has(unit.selectionKey) || !data.trees[selectionTreeRef]) throw new Error("Invalid Marine definition or selection tree");
    keys.add(unit.selectionKey);
    if (unit.name === "Marneus Calgar in Armour of Antilochus") {
      unit.previousSelectionKeys = data.units.filter(old => old.faction === unit.faction && old.name === "Marneus Calgar").map(old => old.selectionKey);
      unit.previousNames = ["Marneus Calgar"];
    }
    return { ...unit, selectionTree: repairMarineTree(data.trees[selectionTreeRef], unit.name), spaceMarineUnitSource: { source: data.source, branch: data.branch, commit: data.commit, date: data.date } };
  });
  return { ...data, units };
}
// These repairs address malformed upstream structure, without inventing weapon rules.
function repairMarineTree(tree, unitName) {
  if (!["Ancient in Terminator Armour", "Victrix Honour Guard", "Inner Circle Companions", "Wolf Scouts", "Eradicator Squad with Heavy Bolters"].includes(unitName)) return tree;
  function visit(node) {
    const next = { ...node, children: (node.children || []).map(visit) };
    if (unitName === "Ancient in Terminator Armour" && node.kind === "group" && node.name === "Wargear"
        && node.children?.length === 2 && node.children.every(child => child.constraints?.some(c => c.type === "min" && Number(c.value) === 1))) {
      next.defaultSelectionId = null;
      next.constraints = node.constraints.map(c => c.field === "selections" && ["min", "max"].includes(c.type) ? { ...c, value: 2 } : c);
    }
    if (unitName === "Victrix Honour Guard" && node.kind === "group" && node.name === "Victrix Honour Guard") {
      next.constraints = node.constraints.map(c => c.field === "selections" && c.type === "min" ? { ...c, value: 3 } : c);
    }
    if (unitName === "Inner Circle Companions" && node.kind === "group" && node.name === "Companions"
        && !node.constraints.some(c => c.field === "selections" && c.type === "max")) {
      next.constraints = [...node.constraints, { id: "marine-companions-maximum", type: "max", field: "selections", scope: "parent", value: 6 }];
    }
    if (unitName === "Wolf Scouts" && /^\d+ Models$/i.test(node.name)) next.modelBundleSize = Number(node.name.match(/^\d+/)[0]);
    if (unitName === "Eradicator Squad with Heavy Bolters" && node.kind === "group" && node.name === "Eradicators") {
      next.constraints = node.constraints.map(c => c.field === "selections" && c.type === "max" ? { ...c, value: 6 } : c);
    }
    return next;
  }
  return visit(tree);
}

function applySpaceMarineUnits(units, armies, source, rulesetId) {
  if (!source) return { units, armies, summary: { applied: false } };
  const definitions = source.units.map(unit => ({ ...unit, rulesetId }));
  const allowed = new Map(source.armies.map(army => [army.faction, army.allowedSelectionKeys]));
  return {
    units: [...units.filter(unit => !isMarine(unit.faction)), ...definitions],
    armies: armies.map(army => allowed.has(army.faction) ? { ...army, allowedSelectionKeys: allowed.get(army.faction) } : army),
    summary: { applied: true, source: source.source, commit: source.commit, branch: source.branch, units: definitions.length, armies: allowed.size }
  };
}
module.exports = { readSpaceMarineUnits, applySpaceMarineUnits };
