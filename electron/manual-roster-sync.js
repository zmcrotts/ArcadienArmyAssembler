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

function sameRecord(left, right) {
  return Boolean(left && right)
    && left.id === right.id
    && String(left.savedAt || "") === String(right.savedAt || "")
    && contentHash(left) === contentHash(right);
}

function savedAtValue(record) {
  const timestamp = Date.parse(record.savedAt || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareVersions(left, right) {
  const timeDifference = savedAtValue(left) - savedAtValue(right);
  if (timeDifference) return timeDifference;
  return contentHash(left).localeCompare(contentHash(right));
}

function conflictRecord(record, originalId) {
  const hash = crypto.createHash("sha256")
    .update(`${originalId}\n${JSON.stringify(record.document)}`)
    .digest("base64url")
    .slice(0, 24);
  const timestamp = record.savedAt && Number.isFinite(Date.parse(record.savedAt))
    ? new Date(record.savedAt).toISOString().slice(0, 10)
    : "undated";
  const result = clone(record);
  const originalName = String(result.document.name || "Unnamed roster").replace(/\s+\(conflict copy[^)]*\)$/i, "");
  result.id = `roster-conflict-${hash}`;
  result.conflictOf = originalId;
  result.document.name = `${originalName} (conflict copy ${timestamp})`;
  return result;
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

function syncRosterLibrary(syncFolder, localSaves) {
  fs.mkdirSync(syncFolder, { recursive: true });
  const local = validRecords(localSaves);
  const remote = readRemoteRecords(syncFolder);
  const localById = new Map();
  const remoteById = new Map();
  for (const record of local) {
    if (!localById.has(record.id)) localById.set(record.id, []);
    localById.get(record.id).push({ record, source: "local" });
  }
  for (const record of remote) {
    if (!remoteById.has(record.id)) remoteById.set(record.id, []);
    remoteById.get(record.id).push({ record, source: "remote" });
  }
  const summary = { uploaded: 0, downloaded: 0, conflicts: 0 };
  const merged = [];
  const pendingWrites = [];
  const ids = new Set([...localById.keys(), ...remoteById.keys()]);
  for (const id of ids) {
    const candidates = [...(localById.get(id) || []), ...(remoteById.get(id) || [])];
    const distinctByDocument = new Map();
    for (const candidate of candidates) {
      const hash = contentHash(candidate.record);
      const previous = distinctByDocument.get(hash);
      if (!previous || compareVersions(candidate.record, previous.record) > 0 || (candidate.source === "local" && previous.source !== "local")) {
        distinctByDocument.set(hash, candidate);
      }
    }
    const versions = [...distinctByDocument.values()].sort((left, right) => compareVersions(right.record, left.record));
    if (!versions.length) continue;
    const outputs = [{ ...versions[0], record: clone(versions[0].record) }];
    for (const version of versions.slice(1)) {
      outputs.push({ ...version, record: conflictRecord(version.record, id) });
      summary.conflicts += 1;
    }
    for (const output of outputs) {
      if (merged.some(record => sameRecord(record, output.record))) continue;
      merged.push(output.record);
      if (!remote.some(record => sameRecord(record, output.record))) {
        pendingWrites.push(output.record);
        summary.uploaded += 1;
      }
      if (output.source === "remote" && !local.some(record => sameRecord(record, output.record))) summary.downloaded += 1;
    }
  }
  // Conflict copies are committed first so a failed canonical replacement
  // cannot erase the only surviving form of the older content.
  for (const record of pendingWrites.sort((left, right) => Number(Boolean(right.conflictOf)) - Number(Boolean(left.conflictOf)))) {
    writeRemoteRecord(syncFolder, record);
  }
  return { saves: merged, summary };
}

module.exports = {
  SYNC_FILE_KIND,
  SYNC_FILE_VERSION,
  syncRosterLibrary
};
