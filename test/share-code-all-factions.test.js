"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const share = require("../src/domain/roster-share-code");
const { calculateEntryPoints } = require("../src/domain/pricing");
const { createArmyState, calculateArmyOptionPoints, normalizeArmyStateForDefinition, pruneArmyStateForRoster } = require("../src/domain/army");
const { hydrateRosterDocument } = require("../src/domain/roster-document");

const root = path.resolve(__dirname, "..");

function loadEngineData() {
  const window = { ROSTER_ENGINE_FACTIONS: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, "ui", "engine-data-manifest.js"), "utf8"), { window });
  for (const file of new Set(Object.values(window.ROSTER_ENGINE_DATA.factionFiles || {}))) {
    vm.runInNewContext(fs.readFileSync(path.join(root, "ui", file), "utf8"), { window });
  }
  window.ROSTER_ENGINE_DATA.factions = window.ROSTER_ENGINE_FACTIONS;
  return window.ROSTER_ENGINE_DATA;
}

const engineData = loadEngineData();

function baseFactionFor(identity) {
  for (const group of engineData.factionNavigation || []) {
    for (const faction of group.factions || []) {
      if (faction.id === identity || (faction.modes || []).some(mode => mode.id === identity)) return faction.id;
    }
  }
  return identity;
}

function contextFor(faction, subfaction = faction) {
  return share.contextForRoster(engineData, faction, subfaction);
}

function rosterRecord(unit, index, changes = {}) {
  const instanceId = `test-${index}`;
  return {
    instanceId,
    selectionKey: unit.selectionKey,
    name: unit.name,
    entry: {
      ...structuredClone(unit.defaultEntry),
      instanceId,
      selections: { ...structuredClone(unit.defaultEntry.selections), ...changes }
    }
  };
}

function documentFor(faction, subfaction, rosterEntries, context, options = {}) {
  const detachmentIds = options.detachmentIds || (context.armyDefinition.detachments?.[0] ? [context.armyDefinition.detachments[0].id] : []);
  return {
    kind: "roster-engine.savedRoster",
    schemaVersion: 2,
    faction,
    subfaction,
    name: options.name || `${subfaction} share test`,
    pointsLimit: options.pointsLimit || 2000,
    rosterEntries,
    rosterDisplay: options.rosterDisplay || { unitNicknames: {} },
    armyState: {
      ...createArmyState(context.armyDefinition),
      detachmentId: detachmentIds[0] || null,
      detachmentIds,
      ...(options.armyState || {})
    }
  };
}

function assertSelectionsEqual(actual, expected, label) {
  const keys = new Set([...Object.keys(actual || {}), ...Object.keys(expected || {})]);
  for (const key of keys) assert.equal(Number(actual?.[key] || 0), Number(expected?.[key] || 0), `${label}: ${key}`);
}

function referenceIndex(records, instanceId) {
  return instanceId == null ? null : records.findIndex(record => (record.instanceId || record.entry?.instanceId) === instanceId);
}

function comparableArmyState(document) {
  const records = document.rosterEntries || [];
  const state = document.armyState || {};
  return {
    detachmentIds: state.detachmentIds || [],
    forceDispositionId: state.forceDispositionId || null,
    opponentForceDispositionId: state.opponentForceDispositionId || null,
    primaryMissionName: state.primaryMissionName || null,
    warlord: referenceIndex(records, state.warlordInstanceId),
    attachments: (state.attachments || []).map(item => [referenceIndex(records, item.leaderInstanceId), referenceIndex(records, item.targetInstanceId)]),
    enhancements: (state.enhancements || []).map(item => [item.enhancementId, referenceIndex(records, item.bearerInstanceId)]),
    keywordAssignments: (state.keywordAssignments || []).map(item => [referenceIndex(records, item.instanceId), item.keyword])
  };
}

function calculatedTotal(document, context) {
  const loaded = hydrateRosterDocument(document, {
    unitPackages: context.unitPackages,
    createArmyState: () => createArmyState(context.armyDefinition),
    pruneArmyStateForRoster
  });
  const allImperium = loaded.roster.every(item =>
    (item.unitPackage?.definition?.keywords || []).some(keyword => String(keyword).toLowerCase() === "imperium")
  );
  const seen = new Map();
  let total = 0;
  for (const item of loaded.roster) {
    const key = item.unitPackage.selectionKey;
    const previousCopies = seen.get(key) || 0;
    seen.set(key, previousCopies + 1);
    total += calculateEntryPoints(item.unitPackage.definition, {
      ...item.entry,
      context: {
        ...(item.entry.context || {}),
        rosterCopyIndex: previousCopies + 1,
        previousCopies,
        rosterCopyCount: previousCopies + 1,
        mfmContext: allImperium ? "Every model has the Imperium keyword" : "Imperial Agents army"
      }
    }, { allowInvalid: true }).points;
  }
  return total + calculateArmyOptionPoints(context.armyDefinition, loaded.armyState);
}

test("every playable faction and chapter exports and imports every available unit", () => {
  const identities = share.playableFactionIds(engineData);
  assert.equal(identities.length, 34);
  for (const subfaction of identities) {
    const faction = baseFactionFor(subfaction);
    const context = contextFor(faction, subfaction);
    assert.ok(context.unitPackages.length, `${subfaction} has no shareable units`);
    const dictionary = share.buildDictionary(context);
    for (const unit of context.unitPackages) {
      const unitIndex = dictionary.unitByKey.get(unit.selectionKey);
      assert.notEqual(unitIndex, undefined, `${subfaction}: missing ${unit.name}`);
      const optionIds = new Set(dictionary.options[unitIndex]);
      for (const id of Object.keys(unit.defaultEntry?.selections || {})) assert.ok(optionIds.has(id), `${subfaction}: ${unit.name} missing ${id}`);
      for (const option of unit.selectableOptions || []) {
        assert.ok(optionIds.has(option.id), `${subfaction}: ${unit.name} missing ${option.id}`);
        if (option.definitionId) assert.ok(optionIds.has(option.definitionId), `${subfaction}: ${unit.name} missing ${option.definitionId}`);
      }
    }
    for (let offset = 0; offset < context.unitPackages.length; offset += 100) {
      const records = context.unitPackages.slice(offset, offset + 100).map((unit, index) => rosterRecord(unit, offset + index));
      const document = documentFor(faction, subfaction, records, context);
      const code = share.encodeRoster(document, context);
      const identity = share.inspectRosterIdentity(code, { factionIds: identities });
      const decoded = share.decodeRoster(code, context);
      assert.deepEqual(identity, { faction, subfaction, legacy: false });
      assert.deepEqual(decoded.rosterEntries.map(item => item.selectionKey), records.map(item => item.selectionKey));
      decoded.rosterEntries.forEach((item, index) => assertSelectionsEqual(item.entry.selections, records[index].entry.selections, `${subfaction}/${records[index].name}`));
    }
  }
});

test("every unit's saved selection counters survive non-default values", () => {
  const seenUnits = new Set();
  for (const subfaction of share.playableFactionIds(engineData)) {
    const faction = baseFactionFor(subfaction);
    const context = contextFor(faction, subfaction);
    const records = [];
    for (const unit of context.unitPackages) {
      if (seenUnits.has(unit.selectionKey)) continue;
      seenUnits.add(unit.selectionKey);
      const defaults = unit.defaultEntry?.selections || {};
      const ids = Object.keys(defaults);
      if (!ids.length) continue;
      const changes = Object.fromEntries(ids.map(id => [id, Number(defaults[id] || 0) + 1]));
      records.push(rosterRecord(unit, records.length, changes));
    }
    for (let offset = 0; offset < records.length; offset += 25) {
      const chunk = records.slice(offset, offset + 25);
      const decoded = share.decodeRoster(share.encodeRoster(documentFor(faction, subfaction, chunk, context), context), context);
      decoded.rosterEntries.forEach((item, index) => assertSelectionsEqual(item.entry.selections, chunk[index].entry.selections, `${subfaction}/${chunk[index].name}`));
    }
  }
  assert.ok(seenUnits.size > 3000, `expected broad unit coverage, got ${seenUnits.size}`);
});

test("every copied valid roster round-trips decisions, relationships, nicknames, and points", { skip: !fs.existsSync(path.join(root, ".test-env", "receiver", "test-roster-library.json")) }, () => {
  const library = JSON.parse(fs.readFileSync(path.join(root, ".test-env", "receiver", "test-roster-library.json"), "utf8")).engineRosterSaves;
  assert.equal(library.length, 17);
  for (const saved of library) {
    const document = saved.document || saved;
    const context = contextFor(document.faction, document.subfaction || document.faction);
    const migrated = {
      ...document,
      armyState: normalizeArmyStateForDefinition(context.armyDefinition, document.armyState)
    };
    const code = share.encodeRoster(migrated, context);
    const decoded = share.decodeRoster(code, context);
    assert.match(code, /^AAA2-[A-Za-z0-9_-]+$/);
    assert.equal(decoded.name, document.name);
    assert.equal(decoded.faction, document.faction);
    assert.equal(decoded.subfaction, document.subfaction);
    assert.equal(decoded.pointsLimit, document.pointsLimit);
    assert.deepEqual(decoded.rosterEntries.map(item => item.selectionKey), document.rosterEntries.map(item => item.selectionKey));
    decoded.rosterEntries.forEach((item, index) => assertSelectionsEqual(item.entry.selections, document.rosterEntries[index].entry.selections, document.name));
    assert.deepEqual(comparableArmyState(decoded), comparableArmyState(migrated), document.name);
    const originalNicknames = Object.entries(document.rosterDisplay?.unitNicknames || {}).map(([id, nickname]) => [referenceIndex(document.rosterEntries, id), nickname]);
    const decodedNicknames = Object.entries(decoded.rosterDisplay?.unitNicknames || {}).map(([id, nickname]) => [referenceIndex(decoded.rosterEntries, id), nickname]);
    assert.deepEqual(decodedNicknames, originalNicknames, `${document.name}: nicknames`);
    assert.equal(calculatedTotal(decoded, context), calculatedTotal(migrated, context), `${document.name}: points`);
  }
});

test("all-faction share codes detect damage and incompatible dictionaries", () => {
  const faction = "Xenos - Orks";
  const context = contextFor(faction);
  const document = documentFor(faction, faction, [rosterRecord(context.unitPackages[0], 0)], context);
  const code = share.encodeRoster(document, context);
  const damageAt = code.length - 8;
  const damaged = code.slice(0, damageAt) + (code[damageAt] === "A" ? "B" : "A") + code.slice(damageAt + 1);
  assert.throws(() => share.decodeRoster(damaged, context), /damaged|incomplete/);
  assert.throws(() => share.decodeRoster(code, { ...context, unitPackages: context.unitPackages.slice(1) }), /different unit-option dictionary/);
});
