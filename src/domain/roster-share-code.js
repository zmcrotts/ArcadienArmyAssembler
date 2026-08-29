"use strict";

const SHARE_PREFIX = "AAA2-";
const LEGACY_SHARE_PREFIX = "AAA1-";
const MAX_CODE_LENGTH = 16384;
const MAX_ROSTER_ENTRIES = 200;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function utf8Encode(value) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(String(value || ""));
  return Uint8Array.from(Buffer.from(String(value || ""), "utf8"));
}

function utf8Decode(bytes) {
  if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return Buffer.from(bytes).toString("utf8");
}

function base64UrlEncode(bytes) {
  let base64;
  if (typeof Buffer !== "undefined") base64 = Buffer.from(bytes).toString("base64");
  else {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    base64 = btoa(binary);
  }
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  try {
    if (typeof Buffer !== "undefined") return Uint8Array.from(Buffer.from(padded, "base64"));
    return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
  } catch {
    throw new Error("The share code contains invalid characters.");
  }
}

class Writer {
  constructor() {
    this.bytes = [];
  }

  byte(value) {
    this.bytes.push(Number(value) & 0xff);
  }

  uint32(value) {
    const number = Number(value) >>> 0;
    this.byte(number);
    this.byte(number >>> 8);
    this.byte(number >>> 16);
    this.byte(number >>> 24);
  }

  varuint(value) {
    let number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) throw new Error("Share data contains an invalid number.");
    do {
      let byte = number % 128;
      number = Math.floor(number / 128);
      if (number) byte |= 0x80;
      this.byte(byte);
    } while (number);
  }

  string(value) {
    const bytes = utf8Encode(value);
    this.varuint(bytes.length);
    for (const byte of bytes) this.byte(byte);
  }

  output() {
    return Uint8Array.from(this.bytes);
  }
}

class Reader {
  constructor(bytes) {
    this.bytes = bytes;
    this.offset = 0;
  }

  byte() {
    if (this.offset >= this.bytes.length) throw new Error("The share code is incomplete.");
    return this.bytes[this.offset++];
  }

  uint32() {
    return (this.byte() | (this.byte() << 8) | (this.byte() << 16) | (this.byte() << 24)) >>> 0;
  }

  varuint() {
    let value = 0;
    let multiplier = 1;
    for (let index = 0; index < 8; index += 1) {
      const byte = this.byte();
      value += (byte & 0x7f) * multiplier;
      if (!(byte & 0x80)) {
        if (!Number.isSafeInteger(value)) throw new Error("The share code contains an invalid number.");
        return value;
      }
      multiplier *= 128;
    }
    throw new Error("The share code contains an invalid number.");
  }

  string(maxLength = 240) {
    const length = this.varuint();
    if (length > maxLength || this.offset + length > this.bytes.length) throw new Error("The share code contains invalid text.");
    const value = utf8Decode(this.bytes.slice(this.offset, this.offset + length));
    this.offset += length;
    return value;
  }

  done() {
    return this.offset === this.bytes.length;
  }
}

function selectableOptionIds(unitPackage) {
  // Roster selections contain both fully-qualified tree IDs and the source
  // definition IDs used as aggregate counters by the loadout engine.  The
  // latter are deliberately not rendered as selectable rows, but they still
  // have to round-trip or a shared roster can hydrate with the wrong model
  // count.  Build the codec dictionary from every stable ID the package
  // exposes, including those default aggregate counters.
  const ids = Object.keys(unitPackage?.defaultEntry?.selections || {});
  function visit(node) {
    if (!node) return;
    if (node.id) ids.push(node.id);
    if (node.definitionId) ids.push(node.definitionId);
    for (const child of node.children || []) visit(child);
  }
  visit(unitPackage?.definition?.selectionTree);
  for (const option of unitPackage?.selectableOptions || []) {
    if (option.id) ids.push(option.id);
    if (option.definitionId) ids.push(option.definitionId);
  }
  return [...new Set(ids)].sort();
}

function playableFactionIds(engineData) {
  const ids = [];
  for (const group of engineData?.factionNavigation || []) {
    for (const faction of group.factions || []) {
      const modes = faction.modes || [];
      if (modes.length) ids.push(...modes.map(mode => mode.id));
      else if (faction.id) ids.push(faction.id);
    }
  }
  return [...new Set(ids)];
}

function nativeLibraryFactions(faction) {
  if (faction === "Imperium - Imperial Knights") return ["Imperium - Imperial Knights - Library"];
  if (faction === "Chaos - Chaos Knights") return ["Chaos - Chaos Knights Library"];
  return [];
}

function sourceFactionsForIdentity(faction, subfaction) {
  return [...new Set([subfaction, faction, ...nativeLibraryFactions(faction)].filter(Boolean))];
}

function alliesForIdentity(engineData, faction, subfaction) {
  const allies = new Map();
  for (const source of sourceFactionsForIdentity(faction, subfaction)) {
    for (const ally of engineData?.allies?.[source] || []) {
      const native = (faction === "Imperium - Imperial Knights" && ally.type === "imperialKnights")
        || (faction === "Chaos - Chaos Knights" && ally.type === "chaosKnights");
      if (!native) allies.set(ally.type, ally);
    }
  }
  return [...allies.values()];
}

function requiredSourceFactions(engineData, faction, subfaction) {
  return [...new Set([
    ...sourceFactionsForIdentity(faction, subfaction),
    ...alliesForIdentity(engineData, faction, subfaction).map(ally => ally.sourceFaction)
  ].filter(Boolean))];
}

function mergeArmyDefinition(engineData, faction, subfaction, allies, unitPackages) {
  const base = engineData?.armies?.[faction] || null;
  const selected = engineData?.armies?.[subfaction] || base;
  if (!selected) return null;
  const allyKeys = allies.flatMap(item => item.selectionKeys || []);
  const nativeSources = new Set(nativeLibraryFactions(faction));
  const nativeKeys = unitPackages.filter(unit => nativeSources.has(unit.faction)).map(unit => unit.selectionKey);
  if (!base || base === selected) return {
    ...selected,
    allies,
    allowedSelectionKeys: [...new Set([...(selected.allowedSelectionKeys || []), ...nativeKeys, ...allyKeys])]
  };
  const enhancements = new Map();
  for (const enhancement of [...(base.enhancements || []), ...(selected.enhancements || [])]) {
    const existing = enhancements.get(enhancement.id);
    enhancements.set(enhancement.id, existing ? {
      ...enhancement,
      eligibleSelectionKeys: [...new Set([...(existing.eligibleSelectionKeys || []), ...(enhancement.eligibleSelectionKeys || [])])]
    } : enhancement);
  }
  return {
    ...selected,
    allies,
    allowedSelectionKeys: [...new Set([...(base.allowedSelectionKeys || []), ...(selected.allowedSelectionKeys || []), ...nativeKeys, ...allyKeys])],
    enhancements: [...enhancements.values()]
  };
}

function contextForRoster(engineData, faction, subfaction = faction) {
  const factionIds = playableFactionIds(engineData);
  if (!factionIds.includes(faction)) throw new Error(`The roster faction is not supported by this rules build (${faction || "unknown"}).`);
  if (!factionIds.includes(subfaction)) throw new Error(`The roster army variant is not supported by this rules build (${subfaction || "unknown"}).`);
  const ownSources = new Set(sourceFactionsForIdentity(faction, subfaction));
  const allies = alliesForIdentity(engineData, faction, subfaction);
  const units = new Map();
  for (const source of ownSources) {
    for (const unit of engineData?.factions?.[source] || []) units.set(unit.selectionKey, unit);
  }
  for (const ally of allies) {
    const allowed = new Set(ally.selectionKeys || []);
    for (const unit of engineData?.factions?.[ally.sourceFaction] || []) {
      if (!allowed.has(unit.selectionKey) || units.has(unit.selectionKey)) continue;
      units.set(unit.selectionKey, { ...unit, alliedFor: { type: ally.type, label: ally.label } });
    }
  }
  const unitPackages = [...units.values()];
  return {
    faction,
    subfaction,
    factionIds,
    unitPackages,
    armyDefinition: mergeArmyDefinition(engineData, faction, subfaction, allies, unitPackages)
  };
}

function stableItems(items) {
  return [...(items || [])].sort((left, right) => String(left?.id || "").localeCompare(String(right?.id || "")));
}

function buildDictionary(context) {
  const seenUnits = new Map();
  for (const unit of context?.unitPackages || []) {
    if (unit?.selectionKey) seenUnits.set(unit.selectionKey, unit);
  }
  const unitPackages = [...seenUnits.values()].sort((left, right) => left.selectionKey.localeCompare(right.selectionKey));
  if (!unitPackages.length) throw new Error("Roster unit rules data is not loaded.");
  const armyDefinition = context?.armyDefinition;
  if (!armyDefinition) throw new Error("Roster army data is not loaded.");
  const options = unitPackages.map(selectableOptionIds);
  const detachments = stableItems(armyDefinition.detachments);
  const enhancements = stableItems(armyDefinition.enhancements);
  const dispositions = stableItems(armyDefinition.forceDispositions);
  const signature = JSON.stringify({
    faction: context.faction,
    subfaction: context.subfaction,
    units: unitPackages.map(unit => unit.selectionKey),
    options,
    detachments: detachments.map(item => item.id),
    enhancements: enhancements.map(item => item.id),
    dispositions: dispositions.map(item => item.id)
  });
  return {
    unitPackages,
    unitByKey: new Map(unitPackages.map((unit, index) => [unit.selectionKey, index])),
    options,
    detachments,
    enhancements,
    dispositions,
    fingerprint: crc32(utf8Encode(signature))
  };
}

function requiredIndex(items, id, label) {
  const index = items.findIndex(item => item.id === id);
  if (index < 0) throw new Error(`${label} is not available in this roster share dictionary.`);
  return index;
}

function optionalIndex(items, id, label) {
  return id ? requiredIndex(items, id, label) + 1 : 0;
}

function rosterEntryIndex(byInstanceId, instanceId, label) {
  const index = byInstanceId.get(instanceId);
  if (index == null) throw new Error(`${label} points to a unit that is not in the roster.`);
  return index;
}

function encodeRoster(document, context) {
  const factionIds = context?.factionIds || [];
  const faction = document?.faction;
  const subfaction = document?.subfaction || faction;
  const factionIndex = factionIds.indexOf(faction);
  const subfactionIndex = factionIds.indexOf(subfaction);
  if (factionIndex < 0 || subfactionIndex < 0) throw new Error("This roster faction is not supported by the loaded share dictionary.");
  if (context.faction && context.faction !== faction) throw new Error("The loaded share dictionary is for a different faction.");
  if (context.subfaction && context.subfaction !== subfaction) throw new Error("The loaded share dictionary is for a different army variant.");
  const records = document.rosterEntries || [];
  if (records.length > MAX_ROSTER_ENTRIES) throw new Error("The roster has too many units for a share code.");
  const dictionary = buildDictionary(context);
  const writer = new Writer();
  writer.uint32(crc32(utf8Encode(faction)));
  writer.uint32(crc32(utf8Encode(subfaction)));
  writer.uint32(dictionary.fingerprint);
  writer.varuint(Number(document.pointsLimit || 1000));
  writer.string(String(document.name || "").slice(0, 240));

  const detachmentIds = (document.armyState?.detachmentIds || [document.armyState?.detachmentId]).filter(Boolean);
  writer.varuint(detachmentIds.length);
  for (const id of detachmentIds) writer.varuint(requiredIndex(dictionary.detachments, id, "A selected detachment"));
  writer.varuint(optionalIndex(dictionary.dispositions, document.armyState?.forceDispositionId, "The force disposition"));
  writer.varuint(optionalIndex(dictionary.dispositions, document.armyState?.opponentForceDispositionId, "The opponent disposition"));
  writer.string(document.armyState?.primaryMissionName || "");

  writer.varuint(records.length);
  const byInstanceId = new Map();
  records.forEach((record, index) => byInstanceId.set(record.instanceId || record.entry?.instanceId, index));
  for (const record of records) {
    const unitIndex = dictionary.unitByKey.get(record.selectionKey || record.entry?.selectionKey);
    if (unitIndex == null) throw new Error(`${record.name || "A roster unit"} is not available in this faction's native or allied share dictionary.`);
    writer.varuint(unitIndex);
    const defaults = dictionary.unitPackages[unitIndex].defaultEntry?.selections || {};
    const selections = record.entry?.selections || {};
    const changedIds = [...new Set([...Object.keys(defaults), ...Object.keys(selections)])]
      .filter(id => Number(defaults[id] || 0) !== Number(selections[id] || 0));
    const optionIds = dictionary.options[unitIndex];
    writer.varuint(changedIds.length);
    for (const id of changedIds) {
      const optionIndex = optionIds.indexOf(id);
      // Old saved rosters can legitimately retain a selection counter whose
      // source option was renamed or removed after the roster was created.
      // Known IDs stay tiny dictionary lookups; unknown IDs use an escaped
      // literal so the decision is never silently discarded.
      writer.varuint(optionIndex < 0 ? 0 : optionIndex + 1);
      if (optionIndex < 0) writer.string(id);
      writer.varuint(Number(selections[id] || 0));
    }
    writer.string(document.rosterDisplay?.unitNicknames?.[record.instanceId || record.entry?.instanceId] || "");
  }

  writer.varuint(document.armyState?.warlordInstanceId
    ? rosterEntryIndex(byInstanceId, document.armyState.warlordInstanceId, "The Warlord") + 1
    : 0);
  const attachments = document.armyState?.attachments || [];
  writer.varuint(attachments.length);
  for (const item of attachments) {
    writer.varuint(rosterEntryIndex(byInstanceId, item.leaderInstanceId, "A Leader attachment"));
    writer.varuint(rosterEntryIndex(byInstanceId, item.targetInstanceId, "A Leader attachment"));
  }
  const enhancements = document.armyState?.enhancements || [];
  writer.varuint(enhancements.length);
  for (const item of enhancements) {
    writer.varuint(requiredIndex(dictionary.enhancements, item.enhancementId, "An enhancement"));
    writer.varuint(rosterEntryIndex(byInstanceId, item.bearerInstanceId, "An enhancement"));
  }
  const keywords = document.armyState?.keywordAssignments || [];
  writer.varuint(keywords.length);
  for (const item of keywords) {
    writer.varuint(rosterEntryIndex(byInstanceId, item.instanceId, "A keyword assignment"));
    writer.string(item.keyword);
  }

  const payload = writer.output();
  const complete = new Writer();
  for (const byte of payload) complete.byte(byte);
  complete.uint32(crc32(payload));
  const code = SHARE_PREFIX + base64UrlEncode(complete.output());
  if (code.length > MAX_CODE_LENGTH) throw new Error("This roster is too large for a share code.");
  return code;
}

function normalizeCode(value) {
  const compact = String(value || "").trim().replace(/```/g, "").replace(/\s+/g, "");
  if (compact.length > MAX_CODE_LENGTH) throw new Error("The share code is too long.");
  const prefix = compact.startsWith(SHARE_PREFIX)
    ? SHARE_PREFIX
    : compact.startsWith(LEGACY_SHARE_PREFIX) ? LEGACY_SHARE_PREFIX : null;
  if (!prefix) throw new Error(`Share codes must begin with ${SHARE_PREFIX}`);
  return { prefix, encoded: compact.slice(prefix.length) };
}

function checkedPayload(code) {
  const normalized = normalizeCode(code);
  const complete = base64UrlDecode(normalized.encoded);
  if (complete.length < 9) throw new Error("The share code is incomplete.");
  const payload = complete.slice(0, -4);
  const checksumReader = new Reader(complete.slice(-4));
  if (checksumReader.uint32() !== crc32(payload)) throw new Error("The share code is damaged or incomplete.");
  return { prefix: normalized.prefix, payload };
}

function inspectRosterIdentity(code, context) {
  const checked = checkedPayload(code);
  if (checked.prefix === LEGACY_SHARE_PREFIX) {
    return { faction: "Imperium - Adeptus Custodes", subfaction: "Imperium - Adeptus Custodes", legacy: true };
  }
  const reader = new Reader(checked.payload);
  const factionIds = context?.factionIds || [];
  const faction = factionIdForHash(factionIds, reader.uint32());
  const subfaction = factionIdForHash(factionIds, reader.uint32());
  if (!faction || !subfaction) throw new Error("The share code references an unavailable faction.");
  return { faction, subfaction, legacy: false };
}

function factionIdForHash(factionIds, hash) {
  const matches = (factionIds || []).filter(id => crc32(utf8Encode(id)) === hash);
  if (matches.length > 1) throw new Error("The installed faction dictionary contains an ambiguous share identifier.");
  return matches[0] || null;
}

function legacyOptionIds(unitPackage) {
  const ids = Object.keys(unitPackage?.defaultEntry?.selections || {});
  function visit(node) {
    if (!node) return;
    if (node.id) ids.push(node.id);
    if (node.definitionId) ids.push(node.definitionId);
    for (const child of node.children || []) visit(child);
  }
  visit(unitPackage?.definition?.selectionTree);
  for (const option of unitPackage?.selectableOptions || []) {
    if (option.id) ids.push(option.id);
    if (option.definitionId) ids.push(option.definitionId);
  }
  return [...new Set(ids)];
}

function legacyDictionary(context) {
  const faction = "Imperium - Adeptus Custodes";
  // AAA1 predates Crucible units, so preserve its original ordered dictionary.
  const unitPackages = (context?.unitPackages || []).filter(unit => unit.faction === faction && !/\[Crucible\]/i.test(unit.name));
  const armyDefinition = context?.armyDefinition;
  if (!unitPackages.length || !armyDefinition) throw new Error("Custodes rules data is not loaded for this legacy share code.");
  const options = unitPackages.map(legacyOptionIds);
  const detachments = armyDefinition.detachments || [];
  const enhancements = armyDefinition.enhancements || [];
  const dispositions = armyDefinition.forceDispositions || [];
  const signature = JSON.stringify({
    units: unitPackages.map(unit => unit.selectionKey),
    options,
    detachments: detachments.map(item => item.id),
    enhancements: enhancements.map(item => item.id),
    dispositions: dispositions.map(item => item.id)
  });
  return { unitPackages, options, detachments, enhancements, dispositions, fingerprint: crc32(utf8Encode(signature)) };
}

function decodeLegacyRosterPayload(payload, context) {
  const reader = new Reader(payload);
  const dictionary = legacyDictionary(context);
  if (reader.uint32() !== dictionary.fingerprint) {
    throw new Error("This legacy Custodes code uses a different rules dictionary than the installed build.");
  }
  const pointsLimit = reader.varuint();
  const name = reader.string(960);
  const detachmentIds = [];
  const detachmentCount = reader.varuint();
  if (detachmentCount > dictionary.detachments.length) throw new Error("The share code has too many detachments.");
  for (let index = 0; index < detachmentCount; index += 1) {
    const detachment = dictionary.detachments[reader.varuint()];
    if (!detachment) throw new Error("The share code references an unavailable detachment.");
    detachmentIds.push(detachment.id);
  }
  const dispositionAt = encoded => {
    if (!encoded) return null;
    const disposition = dictionary.dispositions[encoded - 1];
    if (!disposition) throw new Error("The share code references an unavailable force disposition.");
    return disposition;
  };
  const forceDisposition = dispositionAt(reader.varuint());
  const opponentDisposition = dispositionAt(reader.varuint());
  const unitCount = reader.varuint();
  if (unitCount > MAX_ROSTER_ENTRIES) throw new Error("The share code has an invalid unit count.");
  const rosterEntries = [];
  const instanceIds = [];
  for (let index = 0; index < unitCount; index += 1) {
    const unitIndex = reader.varuint();
    const unit = dictionary.unitPackages[unitIndex];
    if (!unit) throw new Error("The share code references an unavailable Custodes unit.");
    const instanceId = `shared-${index + 1}`;
    instanceIds.push(instanceId);
    const entry = clone(unit.defaultEntry || {});
    entry.instanceId = instanceId;
    entry.selectionKey = unit.selectionKey;
    entry.unitId = unit.id;
    entry.selections = clone(entry.selections || {});
    const changeCount = reader.varuint();
    if (changeCount > dictionary.options[unitIndex].length) throw new Error("The share code has too many unit-option changes.");
    for (let change = 0; change < changeCount; change += 1) {
      const optionId = dictionary.options[unitIndex][reader.varuint()];
      if (!optionId) throw new Error("The share code references an unavailable unit option.");
      entry.selections[optionId] = reader.varuint();
    }
    rosterEntries.push({ instanceId, selectionKey: unit.selectionKey, name: unit.name, entry });
  }
  const entryAt = (index, label) => {
    const instanceId = instanceIds[index];
    if (!instanceId) throw new Error(`The share code contains an invalid ${label} reference.`);
    return instanceId;
  };
  const warlordEncoded = reader.varuint();
  const attachments = [];
  const attachmentCount = reader.varuint();
  for (let index = 0; index < attachmentCount; index += 1) {
    attachments.push({ leaderInstanceId: entryAt(reader.varuint(), "Leader"), targetInstanceId: entryAt(reader.varuint(), "bodyguard") });
  }
  const enhancements = [];
  const enhancementCount = reader.varuint();
  for (let index = 0; index < enhancementCount; index += 1) {
    const enhancement = dictionary.enhancements[reader.varuint()];
    if (!enhancement) throw new Error("The share code references an unavailable enhancement.");
    enhancements.push({ enhancementId: enhancement.id, bearerInstanceId: entryAt(reader.varuint(), "enhancement bearer") });
  }
  const keywordAssignments = [];
  const keywordCount = reader.varuint();
  for (let index = 0; index < keywordCount; index += 1) {
    keywordAssignments.push({ instanceId: entryAt(reader.varuint(), "keyword"), keyword: reader.string(480) });
  }
  if (!reader.done()) throw new Error("The share code contains unsupported trailing data.");
  const faction = "Imperium - Adeptus Custodes";
  return {
    kind: "roster-engine.savedRoster",
    schemaVersion: 2,
    name: name || "Shared Custodes roster",
    ruleset: { id: context.armyDefinition.rulesetId || "wh40k-11e-vflam", source: "share-code" },
    faction,
    subfaction: faction,
    pointsLimit,
    armyState: {
      schemaVersion: 1,
      rulesetId: context.armyDefinition.rulesetId || "wh40k-11e-vflam",
      armyId: context.armyDefinition.id || null,
      detachmentId: detachmentIds[0] || null,
      detachmentIds,
      forceDispositionId: forceDisposition?.id || null,
      opponentForceDispositionId: opponentDisposition?.id || null,
      primaryMissionName: null,
      warlordInstanceId: warlordEncoded ? entryAt(warlordEncoded - 1, "Warlord") : null,
      attachments,
      enhancements,
      keywordAssignments
    },
    rosterEntries
  };
}

function decodeRoster(code, context) {
  const checked = checkedPayload(code);
  if (checked.prefix === LEGACY_SHARE_PREFIX) return decodeLegacyRosterPayload(checked.payload, context);
  const reader = new Reader(checked.payload);
  const factionIds = context?.factionIds || [];
  const faction = factionIdForHash(factionIds, reader.uint32());
  const subfaction = factionIdForHash(factionIds, reader.uint32());
  if (!faction || !subfaction) throw new Error("The share code references an unavailable faction.");
  if (context.faction && context.faction !== faction) throw new Error("The loaded share dictionary is for a different faction.");
  if (context.subfaction && context.subfaction !== subfaction) throw new Error("The loaded share dictionary is for a different army variant.");
  const dictionary = buildDictionary(context);
  if (reader.uint32() !== dictionary.fingerprint) {
    throw new Error("This share code was created with a different unit-option dictionary than the installed rules build.");
  }
  const pointsLimit = reader.varuint();
  if (pointsLimit <= 0 || pointsLimit > 100000) throw new Error("The share code has an invalid points limit.");
  const name = reader.string(960);
  const detachmentCount = reader.varuint();
  if (detachmentCount > dictionary.detachments.length) throw new Error("The share code has too many detachments.");
  const detachmentIds = [];
  for (let index = 0; index < detachmentCount; index += 1) {
    const detachment = dictionary.detachments[reader.varuint()];
    if (!detachment) throw new Error("The share code references an unavailable detachment.");
    detachmentIds.push(detachment.id);
  }
  const dispositionAt = encoded => {
    if (!encoded) return null;
    const disposition = dictionary.dispositions[encoded - 1];
    if (!disposition) throw new Error("The share code references an unavailable force disposition.");
    return disposition;
  };
  const forceDisposition = dispositionAt(reader.varuint());
  const opponentDisposition = dispositionAt(reader.varuint());
  const primaryMissionName = reader.string(480) || null;
  const unitCount = reader.varuint();
  if (unitCount > MAX_ROSTER_ENTRIES) throw new Error("The share code has an invalid unit count.");
  const rosterEntries = [];
  const instanceIds = [];
  const unitNicknames = {};
  for (let index = 0; index < unitCount; index += 1) {
    const unitIndex = reader.varuint();
    const unit = dictionary.unitPackages[unitIndex];
    if (!unit) throw new Error("The share code references an unavailable unit.");
    const instanceId = `shared-${index + 1}`;
    instanceIds.push(instanceId);
    const entry = clone(unit.defaultEntry || {});
    entry.instanceId = instanceId;
    entry.selectionKey = unit.selectionKey;
    entry.unitId = unit.id;
    entry.selections = clone(entry.selections || {});
    const changeCount = reader.varuint();
    if (changeCount > 10000) throw new Error("The share code has too many unit-option changes.");
    for (let change = 0; change < changeCount; change += 1) {
      const encodedOption = reader.varuint();
      const optionId = encodedOption ? dictionary.options[unitIndex][encodedOption - 1] : reader.string(1200);
      if (!optionId) throw new Error("The share code references an unavailable unit option.");
      entry.selections[optionId] = reader.varuint();
    }
    const nickname = reader.string(480);
    if (nickname) unitNicknames[instanceId] = nickname;
    rosterEntries.push({ instanceId, selectionKey: unit.selectionKey, name: unit.name, entry });
  }
  const entryAt = (index, label) => {
    const instanceId = instanceIds[index];
    if (!instanceId) throw new Error(`The share code contains an invalid ${label} reference.`);
    return instanceId;
  };
  const warlordEncoded = reader.varuint();
  const attachments = [];
  const attachmentCount = reader.varuint();
  if (attachmentCount > unitCount) throw new Error("The share code has too many Leader attachments.");
  for (let index = 0; index < attachmentCount; index += 1) {
    attachments.push({ leaderInstanceId: entryAt(reader.varuint(), "Leader"), targetInstanceId: entryAt(reader.varuint(), "bodyguard") });
  }
  const enhancements = [];
  const enhancementCount = reader.varuint();
  if (enhancementCount > unitCount) throw new Error("The share code has too many enhancements.");
  for (let index = 0; index < enhancementCount; index += 1) {
    const enhancement = dictionary.enhancements[reader.varuint()];
    if (!enhancement) throw new Error("The share code references an unavailable enhancement.");
    enhancements.push({ enhancementId: enhancement.id, bearerInstanceId: entryAt(reader.varuint(), "enhancement bearer") });
  }
  const keywordAssignments = [];
  const keywordCount = reader.varuint();
  if (keywordCount > unitCount * 4) throw new Error("The share code has too many keyword assignments.");
  for (let index = 0; index < keywordCount; index += 1) {
    keywordAssignments.push({ instanceId: entryAt(reader.varuint(), "keyword"), keyword: reader.string(480) });
  }
  if (!reader.done()) throw new Error("The share code contains unsupported trailing data.");
  const armyDefinition = context.armyDefinition;
  return {
    kind: "roster-engine.savedRoster",
    schemaVersion: 2,
    name: name || "Shared roster",
    ruleset: { id: armyDefinition.rulesetId || "wh40k-11e-vflam", source: "share-code" },
    faction,
    subfaction,
    pointsLimit,
    armyState: {
      schemaVersion: 1,
      rulesetId: armyDefinition.rulesetId || "wh40k-11e-vflam",
      armyId: armyDefinition.id || null,
      detachmentId: detachmentIds[0] || null,
      detachmentIds,
      forceDispositionId: forceDisposition?.id || null,
      opponentForceDispositionId: opponentDisposition?.id || null,
      primaryMissionName,
      warlordInstanceId: warlordEncoded ? entryAt(warlordEncoded - 1, "Warlord") : null,
      attachments,
      enhancements,
      keywordAssignments
    },
    rosterEntries,
    rosterDisplay: {
      mode: "standard",
      customSections: [],
      sectionLabels: {},
      groupSections: {},
      groupOrder: [],
      unitNicknames
    }
  };
}

const rosterShareCodeApi = {
  LEGACY_SHARE_PREFIX,
  SHARE_PREFIX,
  buildDictionary,
  contextForRoster,
  decodeRoster,
  encodeRoster,
  inspectRosterIdentity,
  playableFactionIds,
  requiredSourceFactions
};

if (typeof module !== "undefined" && module.exports) module.exports = rosterShareCodeApi;
if (typeof window !== "undefined") window.RosterShareCode = rosterShareCodeApi;
