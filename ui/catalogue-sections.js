"use strict";

(function exposeCatalogueSections(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CatalogueSections = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCatalogueSections() {
  const SECTION_ORDER = [
    "Epic Hero",
    "Character",
    "Battleline",
    "Infantry",
    "Mounted",
    "Beast",
    "Monster",
    "Vehicle",
    "Dedicated Transport",
    "Fortification",
    "Allied Units"
  ];

  function hasCategory(unit, category, effectiveKeywords = []) {
    return [...(unit.definition?.categories || unit.categories || []), ...effectiveKeywords]
      .some(item => item.toLowerCase() === category.toLowerCase());
  }

  function sectionForUnit(unit, effectiveKeywords = []) {
    const roles = unit.definition?.roles || unit.roles || {};
    if (unit.alliedFor) return "Allied Units";
    if (roles.epicHero || hasCategory(unit, "Epic Hero", effectiveKeywords)) return "Epic Hero";
    if (roles.character || hasCategory(unit, "Character", effectiveKeywords)) return "Character";
    if (roles.battleline || hasCategory(unit, "Battleline", effectiveKeywords)) return "Battleline";
    if (roles.dedicatedTransport || hasCategory(unit, "Dedicated Transport", effectiveKeywords)) return "Dedicated Transport";
    if (hasCategory(unit, "Fortification", effectiveKeywords)) return "Fortification";
    return ["Infantry", "Mounted", "Beast", "Monster", "Vehicle"]
      .find(category => hasCategory(unit, category, effectiveKeywords)) || "Infantry";
  }

  function groupUnits(units, keywordsForUnit = () => []) {
    const groups = new Map(SECTION_ORDER.map(section => [section, []]));
    for (const unit of units) groups.get(sectionForUnit(unit, keywordsForUnit(unit))).push(unit);
    for (const group of groups.values()) group.sort((a, b) => a.name.localeCompare(b.name));
    return SECTION_ORDER.map(section => ({ section, units: groups.get(section) }));
  }

  return { SECTION_ORDER, sectionForUnit, groupUnits };
});
