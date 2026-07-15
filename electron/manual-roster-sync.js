"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SYNC_FILE_KIND = "arcadien-roster-sync-record";
const SYNC_FILE_VERSION = 1;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isRosterRecord(value) {
  return Boolean(value)
    && typeof value === "object"
    && typeof value.id === "string"
    && value.id.length > 0
    && value.id.length <= 240
    && value.document
    && typeof value.document === "object";
}

function validRecords(records) {
  return Array.isArray(records) ? records.filter(isRosterRecord).map(clone) : [];
}

function contentHash(record) {
  return crypto.createHash("sha256").update(JSON.stringify(record.document)).digest("hex");
}

function savedAtValue(record) {
  const timestamp = Date.parse(record.savedAt || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function fileNameForRecord(id) {
  return `${crypto.createHash("sha256").update(id).digest("hex")}.json`;
}

function recordFile(record) {
  return {
    kind: SYNC_FILE_KIND,
    version: SYNC_FILE_VERSION,
    record
  };
}

function readRemoteRecords(syncFolder) {
  const recordsFolder = path.join(syncFolder, "rosters");
  if (!fs.existsSync(recordsFolder)) return [];
  const records = [];
  for (const file of fs.readdirSync(recordsFolder, { withFileTypes: true })) {
    if (!file.isFile() || !file.name.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(recordsFolder, file.name), "utf8"));
      if (parsed?.kind === SYNC_FILE_KIND && parsed.version === SYNC_FILE_VERSION && isRosterRecord(parsed.record)) {
        records.push(parsed.record);
      }
    } catch {
      // A partially uploaded or unrelated file must never prevent the rest of the library from syncing.
    }
  }
  return validRecords(records);
}

function writeRemoteRecord(syncFolder, record) {
  const recordsFolder = path.join(syncFolder, "rosters");
  fs.mkdirSync(recordsFolder, { recursive: true });
  const target = path.join(recordsFolder, fileNameForRecord(record.id));
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(recordFile(record), null, 2), "utf8");
  fs.renameSync(temporary, target);
}

function conflictCopy(record, occupiedIds) {
  const copied = clone(record);
  const baseId = `${record.id}-conflict-${contentHash(record).slice(0, 8)}`;
  let id = baseId;
  let counter = 2;
  while (occupiedIds.has(id)) id = `${baseId}-${counter++}`;
  occupiedIds.add(id);
  copied.id = id;
  copied.document.name = `${copied.document.name || "Unnamed roster"} (sync conflict)`;
  return copied;
}

function syncRosterLibrary(syncFolder, localSaves) {
  fs.mkdirSync(syncFolder, { recursive: true });
  const local = validRecords(localSaves);
  const remote = readRemoteRecords(syncFolder);
  const remoteById = new Map(remote.map(record => [record.id, record]));
  const merged = local.map(clone);
  const mergedById = new Map(merged.map(record => [record.id, record]));
  const occupiedIds = new Set(merged.map(record => record.id));
  const summary = { uploaded: 0, downloaded: 0, conflicts: 0 };

  for (let index = 0; index < merged.length; index += 1) {
    const localRecord = merged[index];
    const remoteRecord = remoteById.get(localRecord.id);
    if (!remoteRecord) {
      writeRemoteRecord(syncFolder, localRecord);
      summary.uploaded += 1;
      continue;
    }

    if (contentHash(localRecord) === contentHash(remoteRecord)) continue;

    if (savedAtValue(localRecord) >= savedAtValue(remoteRecord)) {
      writeRemoteRecord(syncFolder, localRecord);
      const preservedRemote = conflictCopy(remoteRecord, occupiedIds);
      merged.push(preservedRemote);
      mergedById.set(preservedRemote.id, preservedRemote);
      summary.conflicts += 1;
    } else {
      const preservedLocal = conflictCopy(localRecord, occupiedIds);
      merged[index] = clone(remoteRecord);
      mergedById.set(remoteRecord.id, merged[index]);
      merged.push(preservedLocal);
      mergedById.set(preservedLocal.id, preservedLocal);
      summary.downloaded += 1;
      summary.conflicts += 1;
    }
  }

  for (const remoteRecord of remote) {
    if (mergedById.has(remoteRecord.id)) continue;
    merged.push(clone(remoteRecord));
    mergedById.set(remoteRecord.id, remoteRecord);
    occupiedIds.add(remoteRecord.id);
    summary.downloaded += 1;
  }

  return { saves: merged, summary };
}

module.exports = {
  SYNC_FILE_KIND,
  SYNC_FILE_VERSION,
  syncRosterLibrary
};
