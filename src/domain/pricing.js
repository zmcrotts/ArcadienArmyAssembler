"use strict";

const { validateLoadout } = require("./loadout");

function selectedCount(rosterEntry, selectionId) {
  if (selectionId === "model") {
    const modelIds = rosterEntry?.context?.modelSelectionIds;
    const values = Array.isArray(modelIds)
      ? modelIds.map(id => rosterEntry?.selections?.[id])
      : Object.values(rosterEntry?.selections || {});
    return values.reduce(
      (sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0),
      0
    );
  }
  const value = rosterEntry?.selections?.[selectionId];
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function compositionCount(unitDefinition, rosterEntry, selection) {
  const occurrenceIds = [];
  function visit(node) {
    if (!node) return;
    if (node.kind === "model" && node.definitionId === selection.id && node.id) occurrenceIds.push(node.id);
    for (const child of node.children || []) visit(child);
  }
  visit(unitDefinition?.selectionTree);
  if (occurrenceIds.some(id => Object.prototype.hasOwnProperty.call(rosterEntry?.selections || {}, id))) {
    return occurrenceIds.reduce((sum, id) => sum + selectedCount(rosterEntry, id), 0);
  }
  if (Object.prototype.hasOwnProperty.call(rosterEntry?.selections || {}, selection.id)) {
    return selectedCount(rosterEntry, selection.id);
  }
  if (selection.source === "self-model") return Number(selection.defaultCount ?? selection.min ?? 1);
  return 0;
}

function evaluateCondition(condition, rosterEntry) {
  if (condition?.kind === "context-instance") {
    const instances = new Set(rosterEntry?.context?.instanceOf || []);
    const present = instances.has(condition.targetId);
    return condition.operator === "instanceOf" ? present : !present;
  }
  if (condition?.kind === "roster-copy-count") {
    const actual = Number(rosterEntry?.context?.previousCopies || 0);
    return compareNumbers(actual, condition.operator, Number(condition.value));
  }
  if (!condition || condition.kind !== "selection-count") return false;

  const actual = selectedCount(rosterEntry, condition.selectionId);
  return compareNumbers(actual, condition.operator, Number(condition.value));
}

function compareNumbers(actual, operator, expected) {
  switch (operator) {
    case "atLeast": return actual >= expected;
    case "atMost": return actual <= expected;
    case "equalTo": return actual === expected;
    case "notEqualTo": return actual !== expected;
    case "greaterThan": return actual > expected;
    case "lessThan": return actual < expected;
    default: return false;
  }
}

function evaluateConditionTree(tree, rosterEntry) {
  if (!tree) return true;
  if (tree.kind === "selection-count" || tree.kind === "context-instance" || tree.kind === "roster-copy-count") {
    return evaluateCondition(tree, rosterEntry);
  }

  const children = Array.isArray(tree.conditions) ? tree.conditions : [];
  if (tree.kind === "all") return children.every(c => evaluateConditionTree(c, rosterEntry));
  if (tree.kind === "any") return children.some(c => evaluateConditionTree(c, rosterEntry));
  return false;
}

function validateRosterEntry(unitDefinition, rosterEntry) {
  const errors = [];

  if (!unitDefinition || rosterEntry?.unitId !== unitDefinition.id) {
    errors.push("Roster entry unitId does not match the unit definition.");
    return errors;
  }

  if (hasTreeSelections(unitDefinition, rosterEntry)) {
    return validateLoadout(unitDefinition, rosterEntry).map(error =>
      `${error.name}: ${error.actual} selected; ${error.type}imum is ${error.limit}.`
    );
  }

  for (const selection of unitDefinition.composition || []) {
    const count = compositionCount(unitDefinition, rosterEntry, selection);
    if (selection.min !== null && count < selection.min) {
      errors.push(`${selection.name}: ${count} selected; minimum is ${selection.min}.`);
    }
    if (selection.max !== null && count > selection.max) {
      errors.push(`${selection.name}: ${count} selected; maximum is ${selection.max}.`);
    }
  }

  for (const group of unitDefinition.compositionConstraints || []) {
    const count = (group.selectionIds || [])
      .reduce((sum, id) => {
        const selection = (unitDefinition.composition || []).find(item => item.id === id);
        return sum + (selection ? compositionCount(unitDefinition, rosterEntry, selection) : selectedCount(rosterEntry, id));
      }, 0);
    if (group.min !== null && count < group.min) {
      errors.push(`${group.name}: ${count} models selected; minimum is ${group.min}.`);
    }
    if (group.max !== null && count > group.max) {
      errors.push(`${group.name}: ${count} models selected; maximum is ${group.max}.`);
    }
  }

  return errors;
}

function hasTreeSelections(unitDefinition, rosterEntry) {
  const selections = rosterEntry?.selections || {};
  let found = false;
  function visit(node) {
    if (!node || found) return;
    if (Object.prototype.hasOwnProperty.call(selections, node.id)) {
      found = true;
      return;
    }
    for (const child of node.children || []) visit(child);
  }
  visit(unitDefinition?.selectionTree);
  return found;
}

function selectedTreePointAdjustments(unitDefinition, rosterEntry) {
  const adjustments = [];
  function visit(node) {
    if (!node) return;
    if (!["unit", "group", "model"].includes(node.kind)) {
      const count = selectedCount(rosterEntry, node.id);
      const points = Number(node.points || 0);
      if (count > 0 && points) {
        adjustments.push({
          selectionId: node.id,
          name: node.name,
          count,
          points,
          value: count * points
        });
      }
    }
    for (const child of node.children || []) visit(child);
  }
  visit(unitDefinition?.selectionTree);
  return adjustments;
}

function normalizedMfmName(value) {
  return String(value || "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchesMfmComposition(row, unitDefinition, rosterEntry) {
  const selections = unitDefinition?.composition || [];
  if (row.modelCount !== null && row.modelCount !== undefined) {
    return selections.reduce((sum, selection) => sum + selectedCount(rosterEntry, selection.id), 0) === Number(row.modelCount);
  }
  if (!Array.isArray(row.composition) || !row.composition.length) return true;
  const wanted = new Map(row.composition.map(item => [normalizedMfmName(item.name).replace(/s$/, ""), Number(item.count)]));
  return selections.every(selection => {
    const name = normalizedMfmName(selection.name).replace(/s$/, "");
    return selectedCount(rosterEntry, selection.id) === Number(wanted.get(name) || 0);
  });
}

function matchingMfmRow(unitDefinition, rosterEntry) {
  const previousCopies = Number(rosterEntry?.context?.previousCopies || 0);
  const context = rosterEntry?.context?.mfmContext || null;
  return (unitDefinition?.pricing?.mfmRows || []).find(row => {
    if (row.context && row.context !== context) return false;
    if (previousCopies < Number(row.copies?.min || 0)) return false;
    if (row.copies?.max !== null && row.copies?.max !== undefined && previousCopies > Number(row.copies.max)) return false;
    return matchesMfmComposition(row, unitDefinition, rosterEntry);
  }) || null;
}

function calculateEntryPoints(unitDefinition, rosterEntry, options = {}) {
  const validationErrors = validateRosterEntry(unitDefinition, rosterEntry);
  if (validationErrors.length && options.allowInvalid !== true) {
    const error = new Error(validationErrors.join(" "));
    error.code = "INVALID_ROSTER_ENTRY";
    error.validationErrors = validationErrors;
    throw error;
  }

  const effectiveEntry = {
    ...rosterEntry,
    context: {
      ...rosterEntry?.context,
      instanceOf: [
        unitDefinition?.source?.catalogueId,
        unitDefinition?.source?.selectionCatalogueId,
        String(unitDefinition?.selectionKey || "").split(":")[0] || null,
        ...(unitDefinition?.categoryIds || []),
        ...(rosterEntry?.context?.instanceOf || [])
      ].filter(Boolean),
      modelSelectionIds: (unitDefinition.composition || []).map(item => item.id)
    }
  };
  for (const selection of unitDefinition.composition || []) {
    effectiveEntry.selections[selection.id] = compositionCount(unitDefinition, rosterEntry, selection);
  }
  for (const group of unitDefinition.compositionConstraints || []) {
    effectiveEntry.selections[group.id] = (group.selectionIds || [])
      .reduce((sum, id) => sum + selectedCount(effectiveEntry, id), 0);
  }

  const mfmRow = matchingMfmRow(unitDefinition, effectiveEntry);
  let points = mfmRow ? Number(mfmRow.points) : Number(unitDefinition?.pricing?.base || 0);
  const applied = [{
    source: mfmRow?.source || unitDefinition?.pricing?.baseSource || "bsdata",
    operation: mfmRow ? "set" : "base",
    value: points
  }];

  for (const selection of mfmRow ? [] : (unitDefinition.composition || [])) {
    const selectionPoints = selectedCount(effectiveEntry, selection.id) * Number(selection.points || 0);
    if (!selectionPoints) continue;
    points += selectionPoints;
    applied.push({
      source: "bsdata-selection",
      operation: "increment",
      value: selectionPoints,
      selectionId: selection.id
    });
  }

  for (const modifier of mfmRow ? [] : (unitDefinition?.pricing?.modifiers || [])) {
    if (modifier.supported === false) continue;
    if (!evaluateConditionTree(modifier.when, effectiveEntry)) continue;

    if (modifier.operation === "set") points = Number(modifier.value);
    else if (modifier.operation === "increment") points += Number(modifier.value);
    else if (modifier.operation === "decrement") points -= Number(modifier.value);
    else if (modifier.operation === "multiply") points *= Number(modifier.value);
    else continue;

    applied.push({
      source: modifier.source,
      operation: modifier.operation,
      value: Number(modifier.value),
      raw: modifier.raw
    });
  }

  for (const adjustment of selectedTreePointAdjustments(unitDefinition, effectiveEntry)) {
    points += adjustment.value;
    applied.push({
      source: "bsdata-selection-tree",
      operation: "increment",
      value: adjustment.value,
      selectionId: adjustment.selectionId,
      name: adjustment.name,
      count: adjustment.count,
      points: adjustment.points
    });
  }

  return { points, applied, validationErrors };
}

module.exports = {
  calculateEntryPoints,
  evaluateConditionTree,
  validateRosterEntry
};
