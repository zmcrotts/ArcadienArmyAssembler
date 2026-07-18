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

function syncKey(record) {
  const name = String(record?.document?.name || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return name ? `name:${name}` : `id:${record.id}`;
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
  const localByKey = new Map();
  const remoteByKey = new Map();
  for (const record of local) {
    const key = syncKey(record);
    const previous = localByKey.get(key);
    if (!previous || savedAtValue(record) >= savedAtValue(previous)) localByKey.set(key, record);
  }
  for (const record of remote) {
    const key = syncKey(record);
    const previous = remoteByKey.get(key);
    if (!previous || savedAtValue(record) >= savedAtValue(previous)) remoteByKey.set(key, record);
  }
  const summary = { uploaded: 0, downloaded: 0, conflicts: 0 };
  const merged = [];
  const keys = new Set([...localByKey.keys(), ...remoteByKey.keys()]);
  for (const key of keys) {
    const localRecord = localByKey.get(key);
    const remoteRecord = remoteByKey.get(key);
    const winner = !remoteRecord || (localRecord && savedAtValue(localRecord) >= savedAtValue(remoteRecord)) ? localRecord : remoteRecord;
    if (winner === localRecord && (!remoteRecord || contentHash(localRecord) !== contentHash(remoteRecord))) summary.uploaded += 1;
    if (winner === remoteRecord && (!localRecord || contentHash(localRecord) !== contentHash(remoteRecord))) summary.downloaded += 1;
    merged.push(clone(winner));
  }
  fs.rmSync(path.join(syncFolder, "rosters"), { recursive: true, force: true });
  for (const record of merged) writeRemoteRecord(syncFolder, record);
  return { saves: merged, summary };
}

module.exports = {
  SYNC_FILE_KIND,
  SYNC_FILE_VERSION,
  syncRosterLibrary
};
