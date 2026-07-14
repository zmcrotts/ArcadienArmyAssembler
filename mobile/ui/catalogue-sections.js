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

  function hasCategory(unit, category) {
    return (unit.definition?.categories || unit.categories || [])
      .some(item => item.toLowerCase() === category.toLowerCase());
  }

  function sectionForUnit(unit) {
    const roles = unit.definition?.roles || unit.roles || {};
    if (unit.alliedFor) return "Allied Units";
    if (roles.epicHero || hasCategory(unit, "Epic Hero")) return "Epic Hero";
    if (roles.character || hasCategory(unit, "Character")) return "Character";
    if (roles.battleline || hasCategory(unit, "Battleline")) return "Battleline";
    if (roles.dedicatedTransport || hasCategory(unit, "Dedicated Transport")) return "Dedicated Transport";
    if (hasCategory(unit, "Fortification")) return "Fortification";
    return ["Infantry", "Mounted", "Beast", "Monster", "Vehicle"]
      .find(category => hasCategory(unit, category)) || "Infantry";
  }

  function groupUnits(units) {
    const groups = new Map(SECTION_ORDER.map(section => [section, []]));
    for (const unit of units) groups.get(sectionForUnit(unit)).push(unit);
    for (const group of groups.values()) group.sort((a, b) => a.name.localeCompare(b.name));
    return SECTION_ORDER.map(section => ({ section, units: groups.get(section) }));
  }

  return { SECTION_ORDER, sectionForUnit, groupUnits };
});
