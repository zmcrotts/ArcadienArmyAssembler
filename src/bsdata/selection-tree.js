"use strict";

const { bsdataFlagIsTrue } = require("./flags");

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const POINTS_FIELD_ID = "51b2-306e-1021-d207";

function directPoints(node) {
  const cost = asArray(node?.costs?.cost).find(item =>
    item.typeId === POINTS_FIELD_ID || String(item.name).toLowerCase() === "pts"
  );
  return numberOrNull(cost?.value);
}

function characteristics(profile) {
  const values = {};
  for (const item of asArray(profile?.characteristics?.characteristic)) {
    const key = item.name || item.typeId;
    const value = typeof item === "object" && "#text" in item ? item["#text"] : String(item ?? "");
    values[key] = value;
    const canonical = canonicalCharacteristicKey(key);
    if (canonical && values[canonical] === undefined) values[canonical] = value;
  }
  return values;
}

function canonicalCharacteristicKey(key) {
  const normalized = String(key || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return {
    sv: "SV",
    save: "SV",
    invulnerablesave: "Invulnerable Save",
    invulnerablesv: "Invulnerable Save",
    ld: "LD",
    leadership: "LD",
    oc: "OC",
    objectivecontrol: "OC",
    bs: "BS",
    ballisticskill: "BS",
    ws: "WS",
    weaponskill: "WS",
    ap: "AP",
    armourpenetration: "AP"
  }[normalized] || null;
}

function normalizeProfile(profile, linked = false) {
  return {
    id: profile.id || null,
    name: profile.name || "Unnamed profile",
    typeId: profile.typeId || null,
    typeName: profile.typeName || null,
    characteristics: characteristics(profile),
    linked
  };
}

function profilesFor(node, indexes) {
  const profiles = asArray(node?.profiles?.profile).map(profile => normalizeProfile(profile));
  for (const link of asArray(node?.infoLinks?.infoLink)) {
    if (link.type !== "profile") continue;
    const profile = indexes.profiles.get(link.targetId);
    if (profile) profiles.push(normalizeProfile(profile, true));
  }
  return profiles;
}

function rulesFor(node, indexes) {
  const rules = asArray(node?.rules?.rule)
    .filter(rule => !bsdataFlagIsTrue(rule.hidden))
    .map(rule => ({
      id: rule.id || null,
      name: rule.name || "Unnamed rule",
      description: rule.description || ""
    }));

  rules.push(...asArray(node?.infoLinks?.infoLink)
    .filter(link => link.type === "rule")
    .map(link => {
      const rule = indexes.rules.get(link.targetId);
      const name = modifiedInfoLinkName(link, rule?.name || "Unnamed rule");
      return {
        id: link.targetId ? `${link.targetId}:${name}` : link.id || null,
        targetId: link.targetId || null,
        name,
        description: rule?.description || ""
      };
    }));

  return rules;
}

function modifiedInfoLinkName(link, fallbackName) {
  let name = link?.name || fallbackName || "Unnamed rule";
  for (const modifier of modifiersFor(link)) {
    if (modifier.field !== "name") continue;
    if (modifier.type === "set") name = String(modifier.value || "").trim() || name;
    if (modifier.type === "append") name = `${name} ${modifier.value || ""}`.trim();
  }
  return name;
}

function normalizeConstraint(constraint) {
  return {
    id: constraint.id,
    type: constraint.type,
    field: constraint.field,
    scope: constraint.scope,
    value: numberOrNull(constraint.value),
    childId: constraint.childId || null,
    includeChildSelections: bsdataFlagIsTrue(constraint.includeChildSelections),
    includeChildForces: bsdataFlagIsTrue(constraint.includeChildForces),
    raw: constraint
  };
}

function normalizeModifier(modifier, indexes) {
  return {
    type: modifier.type,
    field: modifier.field,
    value: numberOrNull(modifier.value) ?? modifier.value,
    categoryName: modifier.field === "category"
      ? indexes?.categories?.get(modifier.value)?.name || null
      : null,
    conditions: asArray(modifier?.conditions?.condition).map(item => ({ ...item })),
    conditionGroups: asArray(modifier?.conditionGroups?.conditionGroup).map(item => ({ ...item })),
    repeats: asArray(modifier?.repeats?.repeat).map(item => ({ ...item })),
    raw: modifier
  };
}

function modifiersFor(node) {
  const modifiers = [...asArray(node?.modifiers?.modifier)];
  function visit(groups, inheritedConditions = [], inheritedGroups = []) {
    for (const group of asArray(groups?.modifierGroup)) {
      const conditions = [...inheritedConditions, ...asArray(group?.conditions?.condition)];
      const conditionGroups = [...inheritedGroups, ...asArray(group?.conditionGroups?.conditionGroup)];
      for (const modifier of asArray(group?.modifiers?.modifier)) {
        modifiers.push({
          ...modifier,
          conditions: {
            condition: [...conditions, ...asArray(modifier?.conditions?.condition)]
          },
          conditionGroups: {
            conditionGroup: [...conditionGroups, ...asArray(modifier?.conditionGroups?.conditionGroup)]
          }
        });
      }
      visit(group?.modifierGroups, conditions, conditionGroups);
    }
  }
  visit(node?.modifierGroups);
  return modifiers;
}

function kindFor(node) {
  if (node?.selectionEntryGroup !== undefined) return "group";
  if (node?.type === "unit") return "unit";
  if (node?.type === "model") return "model";
  return "upgrade";
}

function isLoadoutLink(link) {
  const name = String(link?.name || "").trim().toLowerCase();
  return ![
    "crusade",
    "enhancements",
    "enhancements - upgrades",
    "upgrades",
    "warlord",
    "weapon modifications",
    "weapon upgrades"
  ].includes(name);
}

function isLoadoutNode(node) {
  return isLoadoutLink({ name: node?.name });
}

function shouldIncludeEntryLink(entryLink, definition) {
  if (!isLoadoutLink(entryLink)) return false;
  if (String(entryLink?.name || "") !== "Mark of Chaos") return true;
  return /daemon prince/i.test(String(definition?.name || ""));
}

function buildSelectionTree(unit, indexes, rootLink = null) {
  function build(source, link = null, ancestry = new Set(), forcedKind = null, parentPath = null) {
    let definition = source;
    let kind = forcedKind || kindFor(source);

    if (link?.type === "selectionEntry") {
      definition = indexes.entries.get(link.targetId) || source;
      if (!forcedKind) kind = kindFor(definition);
    } else if (link?.type === "selectionEntryGroup") {
      definition = indexes.groups.get(link.targetId) || source;
      if (!forcedKind) kind = "group";
    }

    const definitionId = definition?.id || link?.targetId || null;
    const localId = link?.id || definitionId;
    const occurrenceId = parentPath && localId ? `${parentPath}/${localId}` : localId;
    const cycleKey = `${kind}:${definitionId}`;
    if (ancestry.has(cycleKey)) {
      return {
        id: occurrenceId,
        sourceId: localId,
        definitionId,
        targetId: link?.targetId || null,
        name: link?.name || definition?.name || "Cyclic reference",
        kind,
        cycle: true,
        children: []
      };
    }

    const nextAncestry = new Set(ancestry);
    nextAncestry.add(cycleKey);
    const children = [];

    function addDirect(container) {
      for (const entry of [
        ...asArray(container?.selectionEntries?.selectionEntry),
        ...asArray(container?.sharedSelectionEntries?.selectionEntry)
      ]) {
        if (!isLoadoutNode(entry)) continue;
        children.push(build(entry, null, nextAncestry, null, occurrenceId));
      }
      for (const group of [
        ...asArray(container?.selectionEntryGroups?.selectionEntryGroup),
        ...asArray(container?.sharedSelectionEntryGroups?.selectionEntryGroup)
      ]) {
        if (!isLoadoutNode(group)) continue;
        children.push(build(group, null, nextAncestry, "group", occurrenceId));
      }
      for (const entryLink of asArray(container?.entryLinks?.entryLink)) {
        if (bsdataFlagIsTrue(entryLink.hidden)) continue;
        if (!shouldIncludeEntryLink(entryLink, definition)) continue;
        if (entryLink.type === "selectionEntry") {
          const target = indexes.entries.get(entryLink.targetId);
          if (target) children.push(build(target, entryLink, nextAncestry, null, occurrenceId));
        } else if (entryLink.type === "selectionEntryGroup") {
          const target = indexes.groups.get(entryLink.targetId);
          if (target) children.push(build(target, entryLink, nextAncestry, null, occurrenceId));
        }
      }
    }

    addDirect(definition);
    if (link && link !== definition) addDirect(link);

    const uniqueChildren = [];
    const seen = new Set();
    for (const child of children) {
      const key = `${child.id}:${child.definitionId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueChildren.push(child);
    }

    return {
      id: occurrenceId,
      sourceId: localId,
      definitionId,
      targetId: link?.targetId || null,
      name: link?.name || definition?.name || "Unnamed selection",
      kind,
      points: Number(directPoints(definition) || 0) + Number(link && link !== definition ? directPoints(link) || 0 : 0),
      collective: bsdataFlagIsTrue(link?.collective ?? definition?.collective),
      hidden: bsdataFlagIsTrue(link?.hidden ?? definition?.hidden),
      forceVisible: Boolean(parentPath === null && !bsdataFlagIsTrue(link?.hidden)),
      defaultSelectionId: link?.defaultSelectionEntryId || definition?.defaultSelectionEntryId || null,
      constraints: [
        ...asArray(definition?.constraints?.constraint),
        ...(link && link !== definition ? asArray(link?.constraints?.constraint) : [])
      ].map(normalizeConstraint),
      modifiers: [
        ...modifiersFor(definition),
        ...(link && link !== definition ? modifiersFor(link) : [])
      ].map(modifier => normalizeModifier(modifier, indexes)),
      profiles: [
        ...profilesFor(definition, indexes),
        ...(link && link !== definition ? profilesFor(link, indexes) : [])
      ],
      rules: [
        ...rulesFor(definition, indexes),
        ...(link && link !== definition ? rulesFor(link, indexes) : [])
      ],
      children: uniqueChildren
    };
  }

  return build(unit, rootLink, new Set(), "unit");
}

module.exports = { buildSelectionTree };
