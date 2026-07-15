"use strict";

(function () {
  function asArray(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }

  function buildTreeIndex(unitDefinition) {
    const byId = new Map();
    const byDefinitionId = new Map();
    const parentById = new Map();
    const all = [];

    function visit(node, parent = null) {
      if (!node) return;
      all.push(node);
      if (node.id) byId.set(node.id, node);
      if (node.definitionId) {
        if (!byDefinitionId.has(node.definitionId)) byDefinitionId.set(node.definitionId, []);
        byDefinitionId.get(node.definitionId).push(node);
      }
      if (parent && node.id) parentById.set(node.id, parent);
      for (const child of node.children || []) visit(child, node);
    }

    visit(unitDefinition.selectionTree);
    return { all, byId, byDefinitionId, parentById };
  }

  function groupCount(group, entry) {
    return (group.children || []).reduce((sum, child) => {
      if (child.kind === "group") return sum + groupCount(child, entry);
      return sum + Number(entry.selections[child.id] || 0);
    }, 0);
  }

  function selectionCount(entry, index, reference) {
    if (!reference) return 0;
    if (reference === "model") {
      return index.all
        .filter(node => node.kind === "model" && node.id !== index.all[0]?.id)
        .reduce((sum, node) => sum + Number(entry.selections[node.id] || 0), 0);
    }
    const direct = index.byId.get(reference);
    if (direct?.kind === "group") return groupCount(direct, entry);
    if (direct) return Number(entry.selections[direct.id] || 0);
    return (index.byDefinitionId.get(reference) || [])
      .reduce((sum, node) => sum + (node.kind === "group"
        ? groupCount(node, entry)
        : Number(entry.selections[node.id] || 0)), 0);
  }

  function scopedSelectionCount(entry, index, condition) {
    const scope = condition?.scope;
    const childId = condition?.childId || null;
    if (!childId || !scope || ["self", "parent", "force", "roster"].includes(scope)) {
      return selectionCount(entry, index, childId || scope);
    }

    return index.all
      .filter(node => nodeMatchesReference(node, scope))
      .reduce((sum, scopeNode) => sum + selectionCountUnder(scopeNode, entry, childId), 0);
  }

  function nodeMatchesReference(node, reference) {
    if (reference === "model") return node.kind === "model";
    return [node.id, node.sourceId, node.definitionId, node.targetId].includes(reference);
  }

  function selectionCountUnder(scopeNode, entry, reference) {
    let total = 0;
    function visit(node) {
      if (node !== scopeNode && nodeMatchesReference(node, reference)) {
        total += node.kind === "group" ? groupCount(node, entry) : Number(entry.selections[node.id] || 0);
      }
      for (const child of node.children || []) visit(child);
    }
    visit(scopeNode);
    return total;
  }

  function evaluateRawCondition(condition, entry, index, unitDefinition) {
    const expected = Number(condition?.value || 0);
    if (condition?.type === "instanceOf" || condition?.type === "notInstanceOf") {
      const instances = new Set([
        unitDefinition?.source?.catalogueId,
        ...(entry.context?.instanceOf || [])
      ].filter(Boolean));
      const present = instances.has(condition.childId);
      return condition.type === "instanceOf" ? present : !present;
    }

    const actual = scopedSelectionCount(entry, index, condition);
    switch (condition?.type) {
      case "atLeast": return actual >= expected;
      case "atMost": return actual <= expected;
      case "greaterThan": return actual > expected;
      case "lessThan": return actual < expected;
      case "equalTo": return actual === expected;
      case "notEqualTo": return actual !== expected;
      default: return false;
    }
  }

  function evaluateRawGroup(group, entry, index, unitDefinition) {
    const children = [
      ...asArray(group?.conditions?.condition).map(condition =>
        evaluateRawCondition(condition, entry, index, unitDefinition)),
      ...asArray(group?.conditionGroups?.conditionGroup).map(child =>
        evaluateRawGroup(child, entry, index, unitDefinition))
    ];
    return String(group?.type || "and").toLowerCase() === "or"
      ? children.some(Boolean)
      : children.every(Boolean);
  }

  function modifierApplies(modifier, entry, index, unitDefinition) {
    const direct = asArray(modifier.conditions);
    const groups = asArray(modifier.conditionGroups);
    return direct.every(condition => evaluateRawCondition(condition, entry, index, unitDefinition))
      && groups.every(group => evaluateRawGroup(group, entry, index, unitDefinition));
  }

  function effectiveHidden(node, entry, index, unitDefinition) {
    if (node.forceVisible) return false;
    let hidden = Boolean(node.hidden);
    for (const modifier of node.modifiers || []) {
      if (modifier.field !== "hidden" || modifier.type !== "set") continue;
      if (!modifierApplies(modifier, entry, index, unitDefinition)) continue;
      hidden = modifier.value === true || String(modifier.value).toLowerCase() === "true";
    }
    return hidden;
  }

  function nodeIsActive(node, entry, index, unitDefinition, requireSelectedGroups = false) {
    let current = node;
    while (current) {
      if (effectiveHidden(current, entry, index, unitDefinition)) return false;
      if (requireSelectedGroups && current !== node && current.kind === "group") {
        const baseMinimum = constraintValue(current, "min", "parent") ?? constraintValue(current, "min") ?? 0;
        if (baseMinimum === 0 && groupCount(current, entry) === 0) return false;
      }
      if (requireSelectedGroups && current !== node && !["group", "unit"].includes(current.kind) && actualCount(current, entry) <= 0) return false;
      current = index.parentById.get(current.id);
    }
    return true;
  }

  function repeatCount(repeat, entry, index) {
    const every = Number(repeat?.value || 0);
    if (!every) return 0;
    const actual = selectionCount(entry, index, repeat.childId || repeat.scope);
    const quotient = actual / every;
    const occurrences = repeat.roundUp === "true" ? Math.ceil(quotient) : Math.floor(quotient);
    const amountPerOccurrence = repeat.repeats === undefined ? 1 : Number(repeat.repeats);
    return Math.max(0, occurrences * amountPerOccurrence);
  }

  function effectiveConstraintValue(constraint, unitDefinition, entry, index) {
    let value = Number(constraint.value || 0);
    for (const node of index.all) {
      if (!nodeIsActive(node, entry, index, unitDefinition)) continue;
      for (const modifier of node.modifiers || []) {
        if (modifier.field !== constraint.id || !modifierApplies(modifier, entry, index, unitDefinition)) continue;
        const repeats = asArray(modifier.repeats);
        const multiplier = repeats.length
          ? repeats.reduce((sum, repeat) => sum + repeatCount(repeat, entry, index), 0)
          : 1;
        const amount = Number(modifier.value || 0) * multiplier;
        if (modifier.type === "set") value = amount;
        else if (modifier.type === "increment") value += amount;
        else if (modifier.type === "decrement") value -= amount;
      }
    }
    return value < 0 ? Infinity : value;
  }

  function nearestSelectedParentCount(node, entry, index) {
    let parent = index.parentById.get(node.id);
    while (parent) {
      if (parent.kind === "unit") return 1;
      if (parent.kind !== "group") return Number(entry.selections[parent.id] || 0);
      parent = index.parentById.get(parent.id);
    }
    return 1;
  }

  function actualCount(node, entry) {
    return node.kind === "group" ? groupCount(node, entry) : Number(entry.selections[node.id] || 0);
  }

  function validateLoadout(unitDefinition, entry) {
    const index = buildTreeIndex(unitDefinition);
    const errors = [];

    for (const node of index.all) {
      if (!nodeIsActive(node, entry, index, unitDefinition, true)) continue;
      for (const constraint of node.constraints || []) {
        if (constraint.field !== "selections" || !["min", "max"].includes(constraint.type)) continue;
        const multiplier = constraint.scope === "parent"
          ? nearestSelectedParentCount(node, entry, index)
          : 1;
        const limit = effectiveConstraintValue(constraint, unitDefinition, entry, index) * multiplier;
        const actual = actualCount(node, entry);
        if (constraint.type === "min" && actual < limit) {
          errors.push({ nodeId: node.id, name: node.name, type: "min", actual, limit });
        }
        if (constraint.type === "max" && actual > limit) {
          errors.push({ nodeId: node.id, name: node.name, type: "max", actual, limit });
        }
      }
    }

    return errors;
  }

  function constraintValue(node, type, scope = null) {
    const matches = (node.constraints || []).filter(item =>
      item.field === "selections" && item.type === type && (!scope || item.scope === scope)
    );
    if (!matches.length) return null;
    return Number(matches[0].value);
  }

  function defaultChild(group) {
    return (group.children || []).find(child =>
      child.id === group.defaultSelectionId
      || child.sourceId === group.defaultSelectionId
      || child.definitionId === group.defaultSelectionId
      || child.targetId === group.defaultSelectionId
    ) || (group.children || []).find(child => !child.hidden && child.kind !== "group") || null;
  }

  function clearSubtree(node, selections) {
    if (node.id) selections[node.id] = 0;
    for (const child of node.children || []) clearSubtree(child, selections);
  }

  function refreshDescendants(node, count, selections, unitDefinition, index) {
    for (const child of node.children || []) clearSubtree(child, selections);
    if (count > 0) applyDefaults(node, count, selections, unitDefinition, index);
  }

  function dynamicMaximum(node, parentCount, selections, unitDefinition, index) {
    const constraints = (node.constraints || []).filter(item => item.field === "selections" && item.type === "max");
    if (!constraints.length) return Infinity;
    return Math.min(...constraints.map(constraint => {
      const value = effectiveConstraintValue(constraint, unitDefinition, { selections, context: {} }, index);
      return constraint.scope === "parent" ? value * Math.max(1, parentCount) : value;
    }));
  }

  function dynamicMinimum(node, parentCount, selections, unitDefinition, index) {
    const constraints = (node.constraints || []).filter(item => item.field === "selections" && item.type === "min");
    if (!constraints.length) return 0;
    return Math.max(...constraints.map(constraint => {
      const value = effectiveConstraintValue(constraint, unitDefinition, { selections, context: {} }, index);
      return constraint.scope === "parent" ? value * Math.max(1, parentCount) : value;
    }));
  }

  function allocateAdditional(group, amount, parentCount, selections, unitDefinition, index) {
    let remaining = amount;
    const entry = { selections, context: {} };
    const entries = (group.children || []).filter(child =>
      child.kind !== "group" && nodeIsActive(child, entry, index, unitDefinition)
    );
    const preferred = defaultChild(group);
    const ordered = preferred
      ? [preferred, ...entries.filter(child => child.id !== preferred.id)]
      : entries;

    for (const candidate of ordered) {
      if (remaining <= 0) break;
      const current = Number(selections[candidate.id] || 0);
      const available = dynamicMaximum(candidate, parentCount, selections, unitDefinition, index) - current;
      const add = Math.min(remaining, available);
      if (add <= 0) continue;
      selections[candidate.id] = current + add;
      refreshDescendants(candidate, selections[candidate.id], selections, unitDefinition, index);
      remaining -= add;
    }

    return amount - remaining;
  }

  function reduceGroup(group, amount, selections, unitDefinition, index) {
    let remaining = amount;
    const preferred = defaultChild(group);
    const entries = (group.children || []).filter(child => child.kind !== "group");
    const ordered = preferred
      ? [...entries.filter(child => child.id !== preferred.id), preferred]
      : [...entries].reverse();

    for (const childGroup of (group.children || []).filter(child => child.kind === "group")) {
      if (remaining <= 0) break;
      remaining -= reduceGroup(childGroup, remaining, selections, unitDefinition, index);
    }

    for (const candidate of ordered) {
      if (remaining <= 0) break;
      const current = Number(selections[candidate.id] || 0);
      const remove = Math.min(remaining, current);
      if (remove <= 0) continue;
      selections[candidate.id] = current - remove;
      refreshDescendants(candidate, selections[candidate.id], selections, unitDefinition, index);
      remaining -= remove;
    }
    return amount - remaining;
  }

  function nodeContains(ancestor, descendantId) {
    if (!ancestor || !descendantId) return false;
    if (ancestor.id === descendantId) return true;
    return (ancestor.children || []).some(child => nodeContains(child, descendantId));
  }

  function reduceGroupExcluding(group, amount, excludedNodeId, selections, unitDefinition, index) {
    let remaining = amount;
    const preferred = defaultChild(group);
    const entries = (group.children || [])
      .filter(child => child.kind !== "group" && !nodeContains(child, excludedNodeId));
    const ordered = preferred && !nodeContains(preferred, excludedNodeId)
      ? [preferred, ...entries.filter(child => child.id !== preferred.id)]
      : [...entries].reverse();

    for (const childGroup of (group.children || []).filter(child => child.kind === "group" && !nodeContains(child, excludedNodeId))) {
      if (remaining <= 0) break;
      remaining -= reduceGroup(childGroup, remaining, selections, unitDefinition, index);
    }

    for (const candidate of ordered) {
      if (remaining <= 0) break;
      const current = Number(selections[candidate.id] || 0);
      const remove = Math.min(remaining, current);
      if (remove <= 0) continue;
      selections[candidate.id] = current - remove;
      refreshDescendants(candidate, selections[candidate.id], selections, unitDefinition, index);
      remaining -= remove;
    }
    return amount - remaining;
  }

  function rebalanceAncestorGroups(node, entry, unitDefinition, index) {
    let current = index.parentById.get(node.id);
    while (current) {
      if (current.kind === "group") {
        const parentCount = nearestSelectedParentCount(current, entry, index);
        const limits = evaluatedLimits(current, entry, index, unitDefinition);
        const actual = groupCount(current, entry);
        if (Number.isFinite(limits.maximum) && actual > limits.maximum) {
          reduceGroupExcluding(current, actual - limits.maximum, node.id, entry.selections, unitDefinition, index);
        }
        const refreshedActual = groupCount(current, entry);
        if (refreshedActual < limits.minimum) {
          allocateAdditional(current, limits.minimum - refreshedActual, parentCount, entry.selections, unitDefinition, index);
        }
      }
      current = index.parentById.get(current.id);
    }
  }

  function repairDefaultLoadout(unitDefinition, entry) {
    const index = buildTreeIndex(unitDefinition);
    const seen = new Set();

    for (let pass = 0; pass < 30; pass++) {
      const errors = validateLoadout(unitDefinition, entry);
      if (!errors.length) return entry;
      const signature = JSON.stringify(errors.map(error => [error.nodeId, error.type, error.actual, error.limit]));
      if (seen.has(signature)) return entry;
      seen.add(signature);

      let changed = false;
      const ordered = [...errors].sort((a, b) => (a.type === "max" ? -1 : 1) - (b.type === "max" ? -1 : 1));
      for (const error of ordered) {
        const node = index.byId.get(error.nodeId);
        if (!node) continue;
        if (error.type === "max") {
          const excess = error.actual - error.limit;
          if (node.kind === "group") changed = reduceGroup(node, excess, entry.selections, unitDefinition, index) > 0 || changed;
          else {
            entry.selections[node.id] = error.limit;
            refreshDescendants(node, error.limit, entry.selections, unitDefinition, index);
            changed = true;
          }
        } else {
          const deficit = error.limit - error.actual;
          if (node.kind === "group") {
            const parentCount = nearestSelectedParentCount(node, entry, index);
            changed = allocateAdditional(node, deficit, parentCount, entry.selections, unitDefinition, index) > 0 || changed;
          } else {
            entry.selections[node.id] = error.limit;
            refreshDescendants(node, error.limit, entry.selections, unitDefinition, index);
            changed = true;
          }
        }
      }
      if (!changed) return entry;
    }
    return entry;
  }

  function applyDefaults(node, parentCount, selections, unitDefinition, index) {
    if (!node || node.cycle) return;
    const diagnosticEntry = { selections, context: {} };
    if (index && !nodeIsActive(node, diagnosticEntry, index, unitDefinition)) return;

    if (node.kind === "group") {
      const visible = (node.children || []).filter(child =>
        !index || nodeIsActive(child, diagnosticEntry, index, unitDefinition)
      );
      const entryChildren = visible.filter(child => child.kind !== "group");
      const childGroups = visible.filter(child => child.kind === "group");
      const desired = dynamicMinimum(node, parentCount, selections, unitDefinition, index);

      for (const group of childGroups) applyDefaults(group, parentCount, selections, unitDefinition, index);

      for (const child of entryChildren) {
        const childMinimum = constraintValue(child, "min", "parent") ?? constraintValue(child, "min") ?? 0;
        if (childMinimum > 0) selections[child.id] = Math.max(
          Number(selections[child.id] || 0),
          childMinimum * Math.max(1, parentCount)
        );
      }

      const current = groupCount(node, { selections });
      if (current < desired) {
        allocateAdditional(node, desired - current, parentCount, selections, unitDefinition, index);
      }

      for (const child of entryChildren) {
        const count = Number(selections[child.id] || 0);
        if (count > 0) applyDefaults(child, count, selections, unitDefinition, index);
      }
      return;
    }

    for (const child of (node.children || []).filter(child =>
      !index || nodeIsActive(child, diagnosticEntry, index, unitDefinition)
    )) {
      if (child.kind === "group") {
        applyDefaults(child, parentCount, selections, unitDefinition, index);
        continue;
      }
      const minimum = constraintValue(child, "min", "parent") ?? constraintValue(child, "min") ?? 0;
      if (minimum > 0) {
        selections[child.id] = minimum * Math.max(1, parentCount);
        applyDefaults(child, selections[child.id], selections, unitDefinition, index);
      }
    }
  }

  function createDefaultRosterEntry(unitDefinition, instanceId = `${unitDefinition.id}-1`) {
    const entry = {
      schemaVersion: 1,
      instanceId,
      unitId: unitDefinition.id,
      selectionKey: unitDefinition.selectionKey,
      selections: {},
      wargear: {}
    };
    const index = buildTreeIndex(unitDefinition);
    applyDefaults(unitDefinition.selectionTree, 1, entry.selections, unitDefinition, index);
    return entry;
  }

  function evaluatedLimits(node, entry, index, unitDefinition) {
    const parentCount = nearestSelectedParentCount(node, entry, index);
    const constraints = (node.constraints || []).filter(item =>
      item.field === "selections" && ["min", "max"].includes(item.type)
    );
    const values = type => constraints
      .filter(constraint => constraint.type === type)
      .map(constraint => {
        const value = effectiveConstraintValue(constraint, unitDefinition, entry, index);
        return constraint.scope === "parent" ? value * Math.max(1, parentCount) : value;
      });
    const minimums = values("min");
    const maximums = values("max");
    return {
      minimum: minimums.length ? Math.max(...minimums) : 0,
      maximum: maximums.length ? Math.min(...maximums) : Infinity
    };
  }

  function getOptionStates(unitDefinition, entry) {
    const index = buildTreeIndex(unitDefinition);
    const states = index.all
      .filter(node => !["unit", "group"].includes(node.kind))
      .map(node => {
        const active = nodeIsActive(node, entry, index, unitDefinition);
        const current = Number(entry.selections[node.id] || 0);
        const { minimum, maximum } = evaluatedLimits(node, entry, index, unitDefinition);
        const parent = index.parentById.get(node.id);
        const activeSiblings = parent?.kind === "group"
          ? (parent.children || []).filter(sibling =>
            sibling.kind !== "group" && nodeIsActive(sibling, entry, index, unitDefinition)
          )
          : [];
        const parentLimits = parent?.kind === "group"
          ? evaluatedLimits(parent, entry, index, unitDefinition)
          : { minimum: 0, maximum: Infinity };
        const groupCurrent = parent?.kind === "group" ? groupCount(parent, entry) : current;
        const groupRequired = parent?.kind === "group" && parentLimits.minimum > 0;
        const mutuallyExclusive = parent?.kind === "group"
          && parentLimits.maximum === 1
          && activeSiblings.length > 1;
        const parentIsFixed = Number.isFinite(parentLimits.maximum)
          && parentLimits.minimum === parentLimits.maximum;
        const fixed = (Number.isFinite(maximum) && minimum === maximum)
          || (activeSiblings.length === 1 && parentIsFixed);
        const mandatory = minimum > 0;
        const editable = active && maximum > 0 && !mandatory && !fixed;

        return {
          id: node.id,
        definitionId: node.definitionId,
        name: node.name,
        kind: node.kind,
        points: Number(node.points || 0),
        parentId: parent?.id || null,
        current,
          minimum,
          maximum,
          groupCurrent,
          groupMinimum: parentLimits.minimum,
          groupMaximum: parentLimits.maximum,
          groupRequired,
          mutuallyExclusive,
          active,
          mandatory,
          fixed,
          editable,
          reason: !active ? "inactive" : mandatory ? "mandatory" : fixed ? "fixed" : editable ? null : "unavailable"
        };
      });

    if (validateLoadout(unitDefinition, entry).length) return states;
    return states.map(state => {
      if (!state.editable || !Number.isFinite(state.maximum) || state.maximum > 100) return state;
      for (let candidate = Math.floor(state.maximum); candidate >= state.current; candidate--) {
        const changed = setSelection(unitDefinition, entry, state.id, candidate, false);
        if (!validateLoadout(unitDefinition, changed).length) return { ...state, maximum: candidate };
      }
      return { ...state, maximum: state.current };
    });
  }

  function setSelection(unitDefinition, entry, nodeId, count, enforceOptionState = true) {
    const index = buildTreeIndex(unitDefinition);
    const node = index.byId.get(nodeId);
    if (!node || node.kind === "group" || node.kind === "unit") {
      throw new Error(`Unknown or non-selectable option: ${nodeId}`);
    }

    if (enforceOptionState) {
      const state = getOptionStates(unitDefinition, entry).find(option => option.id === nodeId);
      if (state && !state.editable && Number(count) !== state.current) {
        throw new Error(`Option is not editable (${state.reason}): ${node.name}`);
      }
    }

    const next = JSON.parse(JSON.stringify(entry));
    const oldCount = Number(next.selections[nodeId] || 0);
    const newCount = Math.max(0, Number(count));
    next.selections[nodeId] = newCount;
    if (newCount === 0) clearSubtree(node, next.selections);

    const parent = index.parentById.get(nodeId);
    if (parent?.kind === "group") {
      const siblings = parent.children.filter(child => child.kind !== "group" && child.id !== nodeId);
      const min = constraintValue(parent, "min", "parent") ?? constraintValue(parent, "min");
      const max = constraintValue(parent, "max", "parent") ?? constraintValue(parent, "max");
      const fixed = min !== null && max !== null && min === max;
      const delta = newCount - oldCount;
      const preferred = defaultChild(parent);
      // A fallback repair choice is not a declared default, so it must not
      // turn an otherwise multi-select group into a replacement choice.
      const replacingDefault = parent.defaultSelectionId && preferred && preferred.id !== nodeId;

      if ((fixed || replacingDefault) && delta !== 0) {
        let remaining = Math.abs(delta);
        const ordered = preferred && preferred.id !== nodeId
          ? [preferred, ...siblings.filter(item => item.id !== preferred.id)]
          : siblings;
        for (const sibling of ordered) {
          if (remaining <= 0) break;
          const current = Number(next.selections[sibling.id] || 0);
          if (delta > 0) {
            const change = Math.min(current, remaining);
            next.selections[sibling.id] = current - change;
            refreshDescendants(sibling, next.selections[sibling.id], next.selections, unitDefinition, index);
            remaining -= change;
          } else {
            next.selections[sibling.id] = current + remaining;
            refreshDescendants(sibling, next.selections[sibling.id], next.selections, unitDefinition, index);
            remaining = 0;
          }
        }
      }

      if (max === 1 && newCount > 0) {
        for (const sibling of siblings) clearSubtree(sibling, next.selections);
      }
    }

    if (newCount > 0) refreshDescendants(node, newCount, next.selections, unitDefinition, index);
    rebalanceAncestorGroups(node, next, unitDefinition, index);
    return next;
  }

  function compositionModelRecords(unitDefinition, entry) {
    const index = buildTreeIndex(unitDefinition);
    return (unitDefinition.composition || []).flatMap(selection => {
      const nodes = index.byDefinitionId.get(selection.id) || [];
      return nodes.filter(node => node.kind === "model").map(node => {
        const active = nodeIsActive(node, entry, index, unitDefinition, true);
        const limits = active ? evaluatedLimits(node, entry, index, unitDefinition) : { minimum: 0 };
        return {
          node,
          selection,
          active,
          current: active ? Number(entry.selections[node.id] || 0) : 0,
          minimum: active ? Number(selection.min ?? 0) : 0,
          maximum: active
            ? (selection.max === null || selection.max === undefined ? Infinity : Number(selection.max))
            : 0
        };
      });
    });
  }

  function potentialMaximum(node, fallbackMaximum) {
    if (!Number.isFinite(fallbackMaximum)) return fallbackMaximum;
    let maximum = fallbackMaximum;
    const maxConstraints = (node.constraints || []).filter(constraint =>
      constraint.field === "selections" && constraint.type === "max"
    );
    for (const constraint of maxConstraints) {
      const base = Number(constraint.value || 0);
      for (const modifier of node.modifiers || []) {
        if (modifier.field !== constraint.id) continue;
        const amount = Number(modifier.value || 0);
        if (modifier.type === "set") maximum = Math.max(maximum, amount);
        else if (modifier.type === "increment") maximum = Math.max(maximum, base + amount);
      }
    }
    return maximum;
  }

  function getUnitSizeState(unitDefinition, entry) {
    const index = buildTreeIndex(unitDefinition);
    const records = compositionModelRecords(unitDefinition, entry);
    if (!records.length) return { current: 1, minimum: 1, maximum: 1, editable: false };
    const covered = new Set();
    let minimum = 0;
    let maximum = 0;
    for (const constraint of unitDefinition.compositionConstraints || []) {
      const memberIds = new Set(constraint.selectionIds || []);
      if (!records.some(record => memberIds.has(record.selection.id))) continue;
      if ([...memberIds].every(id => covered.has(id))) continue;
      for (const id of memberIds) covered.add(id);
      const group = (index.byDefinitionId.get(constraint.id) || []).find(node => node.kind === "group");
      const limits = group
        ? evaluatedLimits(group, entry, index, unitDefinition)
        : {
            minimum: Number(constraint.min ?? 0),
            maximum: constraint.max === null || constraint.max === undefined ? Infinity : Number(constraint.max)
          };
      minimum += group ? Number(constraint.min ?? limits.minimum ?? 0) : limits.minimum;
      maximum += group ? potentialMaximum(group, limits.maximum) : limits.maximum;
    }
    for (const bundle of modelBundleRanges(index, records)) {
      const memberIds = new Set(bundle.selectionIds);
      if ([...memberIds].every(id => covered.has(id))) continue;
      for (const id of memberIds) covered.add(id);
      minimum += bundle.minimum;
      maximum += bundle.maximum;
    }
    for (const record of records) {
      if (covered.has(record.selection.id)) continue;
      minimum += record.minimum;
      maximum += record.maximum;
    }
    const current = records.reduce((sum, record) => sum + record.current, 0);
    return { current, minimum, maximum, editable: records.length > 0 && Number.isFinite(maximum) && maximum > minimum };
  }

  function modelBundleRanges(index, records) {
    return modelBundleGroups(index).map(group => {
      const choices = (group.children || []).filter(child => child.kind !== "group" && child.kind !== "model");
      const counts = choices.map(choice => fixedModelCount(choice)).filter(count => count > 0);
      const selectionIds = new Set();
      for (const record of records) {
        if (nodeContains(group, record.node.id)) selectionIds.add(record.selection.id);
      }
      return {
        selectionIds: [...selectionIds],
        minimum: counts.length ? Math.min(...counts) : 0,
        maximum: counts.length ? Math.max(...counts) : 0
      };
    }).filter(range => range.selectionIds.length);
  }

  function fixedModelCount(node) {
    if (!node) return 0;
    if (node.kind === "model") {
      return constraintValue(node, "min", "parent")
        ?? constraintValue(node, "min")
        ?? constraintValue(node, "max", "parent")
        ?? constraintValue(node, "max")
        ?? 0;
    }
    return (node.children || []).reduce((sum, child) => sum + fixedModelCount(child), 0);
  }

  function modelBundleGroups(index) {
    return index.all.filter(node => {
      if (node.kind !== "group") return false;
      const min = constraintValue(node, "min", "parent") ?? constraintValue(node, "min");
      const max = constraintValue(node, "max", "parent") ?? constraintValue(node, "max");
      if (min !== 1 || max !== 1) return false;
      const choices = (node.children || []).filter(child => child.kind !== "group" && child.kind !== "model");
      return choices.length > 1 && choices.every(child => fixedModelCount(child) > 0);
    });
  }

  function trySetBundleUnitSize(unitDefinition, entry, target, index) {
    const groups = modelBundleGroups(index);
    for (const group of groups) {
      const choices = (group.children || [])
        .filter(child => child.kind !== "group" && child.kind !== "model")
        .sort((a, b) =>
          (Math.abs(target - fixedModelCount(a)) - Math.abs(target - fixedModelCount(b)))
          || (/\bmauler\b/i.test(a.name) ? 1 : 0) - (/\bmauler\b/i.test(b.name) ? 1 : 0)
          || String(a.name).localeCompare(String(b.name))
        );
      for (const choice of choices) {
        let candidate = setSelection(unitDefinition, entry, choice.id, 1, false);
        candidate = repairDefaultLoadout(unitDefinition, candidate);
        if (getUnitSizeState(unitDefinition, candidate).current === target && validateLoadout(unitDefinition, candidate).length === 0) {
          return candidate;
        }
      }
    }
    return null;
  }

  function setUnitSize(unitDefinition, entry, requestedSize) {
    const state = getUnitSizeState(unitDefinition, entry);
    if (!state.editable) return JSON.parse(JSON.stringify(entry));
    const target = Math.max(state.minimum, Math.min(state.maximum, Math.round(Number(requestedSize))));
    if (!Number.isFinite(target)) throw new Error("Unit size must be a number.");
    const index = buildTreeIndex(unitDefinition);
    const bundleSized = trySetBundleUnitSize(unitDefinition, entry, target, index);
    if (bundleSized) return bundleSized;
    const records = compositionModelRecords(unitDefinition, entry);
    let next = JSON.parse(JSON.stringify(entry));
    let remaining = target - state.current;
    const preferred = record => record.selection.defaultCount !== null && record.selection.defaultCount !== undefined ? 0 : 1;
    const candidates = [...records].sort((a, b) => preferred(a) - preferred(b));
    if (remaining > 0) {
      for (const record of candidates) {
        const change = Math.min(remaining, record.maximum - record.current);
        if (change <= 0) continue;
        next = setSelection(unitDefinition, next, record.node.id, record.current + change, false);
        record.current += change;
        remaining -= change;
        if (remaining <= 0) break;
      }
    } else if (remaining < 0) {
      for (const record of candidates) {
        const change = Math.min(-remaining, record.current - record.minimum);
        if (change <= 0) continue;
        next = setSelection(unitDefinition, next, record.node.id, record.current - change, false);
        record.current -= change;
        remaining += change;
        if (remaining >= 0) break;
      }
    }
    if (remaining !== 0) throw new Error(`Unable to set unit size to ${target}.`);
    return next;
  }

  function getConfiguredProfiles(unitDefinition, entry) {
    const index = buildTreeIndex(unitDefinition);
    const profiles = new Map();
    const rules = new Map();

    for (const node of index.all) {
      if (!nodeIsActive(node, entry, index, unitDefinition, true)) continue;
      const count = node.kind === "unit" ? 1 : Number(entry.selections[node.id] || 0);
      if (count <= 0) continue;
      for (const profile of node.profiles || []) {
        const key = profile.typeName === "Unit"
          ? `${profile.typeName}:${profile.name}:${JSON.stringify(profile.characteristics || {})}`
          : profile.id || `${profile.typeName}:${profile.name}`;
        const contribution = count * Number(profile.countMultiplier ?? 1);
        const existing = profiles.get(key);
        if (existing) existing.count += contribution;
        else profiles.set(key, { ...profile, count: contribution });
      }
      for (const rule of node.rules || []) rules.set(rule.id || rule.name, rule);
    }

    const values = mergeDuplicateAbilityProfiles([...profiles.values()].filter(profile => Number(profile.count || 0) > 0));
    return {
      profiles: values,
      weapons: values.filter(profile => /Weapons$/i.test(profile.typeName || "")),
      units: values.filter(profile => profile.typeName === "Unit"),
      // Transport and other datasheet profile types belong on the configured
      // sheet too; only unit statlines and weapons have separate collections.
      abilities: values.filter(profile => profile.typeName !== "Unit" && !/Weapons$/i.test(profile.typeName || "")),
      rules: [...rules.values()]
    };
  }

  function getConfiguredModels(unitDefinition, entry) {
    const index = buildTreeIndex(unitDefinition);
    return index.all
      .filter(node => node.kind === "model" && nodeIsActive(node, entry, index, unitDefinition, true))
      .map(node => ({
        id: node.id,
        name: node.name,
        count: Number(entry?.selections?.[node.id] || 0),
        equipment: selectedEquipmentLabels(node, entry, index, unitDefinition)
      }))
      .filter(model => model.count > 0);
  }

  function selectedEquipmentLabels(node, entry, index, unitDefinition) {
    const records = collectEquipmentLabelRecords(node, entry, index, unitDefinition);
    const counts = new Map();
    for (const record of records) {
      if (!record.name) continue;
      counts.set(record.name, Number(counts.get(record.name) || 0) + Number(record.count || 0));
    }
    return [...counts.entries()]
      .filter(([, count]) => count > 0)
      .map(([name, count]) => `${count > 1 ? `${count}x ` : ""}${name}`);
  }

  function collectEquipmentLabelRecords(node, entry, index, unitDefinition) {
    const labels = (node.defaultEquipment || []).map(name => ({
      name,
      count: Number(entry?.selections?.[node.id] || 0)
    }));
    for (const child of node.children || []) {
      if (!nodeIsActive(child, entry, index, unitDefinition, true)) continue;
      if (child.kind === "group") {
        labels.push(...collectEquipmentLabelRecords(child, entry, index, unitDefinition));
        continue;
      }
      const count = Number(entry?.selections?.[child.id] || 0);
      if (count <= 0) continue;
      const nested = selectedEquipmentLabels(child, entry, index, unitDefinition);
      const suffix = nested.length ? ` (${nested.join(", ")})` : "";
      labels.push({ name: `${child.name}${suffix}`, count });
      for (const replaced of child.replacesEquipment || []) {
        labels.push({ name: replaced, count: -count });
      }
    }
    return labels;
  }

  function normalizeProfileText(value) {
    return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function mergeDuplicateAbilityProfiles(profiles) {
    const output = [];
    const abilityByName = new Map();
    for (const profile of profiles) {
      if (profile.typeName !== "Abilities") {
        output.push(profile);
        continue;
      }
      const key = normalizeProfileText(profile.name);
      const existingIndex = abilityByName.get(key);
      if (existingIndex === undefined) {
        abilityByName.set(key, output.length);
        output.push(profile);
        continue;
      }
      const existing = output[existingIndex];
      const existingDescription = normalizeProfileText(existing.characteristics?.Description);
      const nextDescription = normalizeProfileText(profile.characteristics?.Description);
      const preferNext = nextDescription.length > existingDescription.length
        || /has (?:a |an |the )?\w* characteristic of/i.test(profile.characteristics?.Description || "");
      output[existingIndex] = {
        ...(preferNext ? profile : existing),
        id: existing.id || profile.id,
        count: Math.max(Number(existing.count || 0), Number(profile.count || 0))
      };
    }
    return output;
  }

  function selectedCount(rosterEntry, selectionId) {
    if (selectionId === "model") {
      const modelIds = rosterEntry?.context?.modelSelectionIds;
      const values = Array.isArray(modelIds)
        ? modelIds.map(id => rosterEntry?.selections?.[id])
        : Object.values(rosterEntry?.selections || {});
      return values.reduce((sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0), 0);
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
    if (Object.prototype.hasOwnProperty.call(rosterEntry?.selections || {}, selection.id)) return selectedCount(rosterEntry, selection.id);
    if (selection.source === "self-model") return Number(selection.defaultCount ?? selection.min ?? 1);
    return 0;
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
      if (selection.min !== null && count < selection.min) errors.push(`${selection.name}: ${count} selected; minimum is ${selection.min}.`);
      if (selection.max !== null && count > selection.max) errors.push(`${selection.name}: ${count} selected; maximum is ${selection.max}.`);
    }
    for (const group of unitDefinition.compositionConstraints || []) {
      const count = (group.selectionIds || []).reduce((sum, id) => sum + selectedCount(rosterEntry, id), 0);
      if (group.min !== null && count < group.min) errors.push(`${group.name}: ${count} models selected; minimum is ${group.min}.`);
      if (group.max !== null && count > group.max) errors.push(`${group.name}: ${count} models selected; maximum is ${group.max}.`);
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

  function evaluatePricingCondition(condition, rosterEntry) {
    if (condition?.kind === "context-instance") {
      const present = new Set(rosterEntry?.context?.instanceOf || []).has(condition.targetId);
      return condition.operator === "instanceOf" ? present : !present;
    }
    if (condition?.kind === "roster-copy-count") {
      return compareNumbers(Number(rosterEntry?.context?.previousCopies || 0), condition.operator, Number(condition.value));
    }
    if (!condition || condition.kind !== "selection-count") return false;
    const actual = selectedCount(rosterEntry, condition.selectionId);
    return compareNumbers(actual, condition.operator, Number(condition.value));
  }

  function compareNumbers(actual, operator, expected) {
    if (operator === "atLeast") return actual >= expected;
    if (operator === "atMost") return actual <= expected;
    if (operator === "equalTo") return actual === expected;
    if (operator === "notEqualTo") return actual !== expected;
    if (operator === "greaterThan") return actual > expected;
    if (operator === "lessThan") return actual < expected;
    return false;
  }

  function evaluatePricingTree(tree, rosterEntry) {
    if (!tree) return true;
    if (["selection-count", "context-instance", "roster-copy-count"].includes(tree.kind)) return evaluatePricingCondition(tree, rosterEntry);
    const children = Array.isArray(tree.conditions) ? tree.conditions : [];
    if (tree.kind === "all") return children.every(item => evaluatePricingTree(item, rosterEntry));
    if (tree.kind === "any") return children.some(item => evaluatePricingTree(item, rosterEntry));
    return false;
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

  function calculateEntryPoints(unitDefinition, rosterEntry) {
    const effectiveEntry = {
      ...rosterEntry,
      context: {
        ...rosterEntry?.context,
        instanceOf: [
          unitDefinition?.source?.catalogueId,
          ...(rosterEntry?.context?.instanceOf || [])
        ].filter(Boolean),
        modelSelectionIds: (unitDefinition.composition || []).map(item => item.id)
      }
    };
    for (const selection of unitDefinition.composition || []) {
      effectiveEntry.selections[selection.id] = compositionCount(unitDefinition, rosterEntry, selection);
    }
    for (const group of unitDefinition.compositionConstraints || []) {
      effectiveEntry.selections[group.id] = (group.selectionIds || []).reduce((sum, id) => sum + selectedCount(effectiveEntry, id), 0);
    }

    let points = Number(unitDefinition?.pricing?.base || 0);
    const applied = [{ source: unitDefinition?.pricing?.baseSource || "bsdata", operation: "base", value: points }];

    for (const selection of unitDefinition.composition || []) {
      const value = selectedCount(effectiveEntry, selection.id) * Number(selection.points || 0);
      if (!value) continue;
      points += value;
      applied.push({ source: "bsdata-selection", operation: "increment", value, selectionId: selection.id });
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
    for (const modifier of unitDefinition?.pricing?.modifiers || []) {
      if (modifier.supported === false || !evaluatePricingTree(modifier.when, effectiveEntry)) continue;
      const value = Number(modifier.value);
      if (modifier.operation === "set") points = value;
      else if (modifier.operation === "increment") points += value;
      else if (modifier.operation === "decrement") points -= value;
      else if (modifier.operation === "multiply") points *= value;
      else continue;
      applied.push({ source: modifier.source, operation: modifier.operation, value, raw: modifier.raw });
    }

    return {
      points,
      applied,
      validationErrors: validateRosterEntry(unitDefinition, rosterEntry)
    };
  }

  window.RosterEngine = {
    createDefaultRosterEntry,
    getOptionStates,
    getUnitSizeState,
    setSelection,
    setUnitSize,
    getConfiguredModels,
    getConfiguredProfiles,
    validateLoadout,
    calculateEntryPoints
  };
})();
