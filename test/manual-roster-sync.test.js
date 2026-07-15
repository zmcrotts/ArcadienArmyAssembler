"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { syncRosterLibrary } = require("../electron/manual-roster-sync");

function record(id, name, savedAt) {
  return {
    id,
    savedAt,
    document: { name, faction: "test", armyState: {}, rosterEntries: [] }
  };
}

function tempSyncFolder(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "arcadien-sync-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return folder;
}

test("manual sync uploads records the shared folder does not have", t => {
  const folder = tempSyncFolder(t);
  const local = [record("local", "Local list", "2026-07-15T12:00:00.000Z")];

  const result = syncRosterLibrary(folder, local);

  assert.equal(result.summary.uploaded, 1);
  assert.equal(result.summary.downloaded, 0);
  assert.equal(fs.readdirSync(path.join(folder, "rosters")).filter(name => name.endsWith(".json")).length, 1);
});

test("manual sync adds records found only in the shared folder", t => {
  const folder = tempSyncFolder(t);
  syncRosterLibrary(folder, [record("remote", "Remote list", "2026-07-15T12:00:00.000Z")]);

  const result = syncRosterLibrary(folder, []);

  assert.equal(result.summary.downloaded, 1);
  assert.equal(result.saves[0].id, "remote");
});

test("manual sync preserves both versions of a changed roster", t => {
  const folder = tempSyncFolder(t);
  syncRosterLibrary(folder, [record("same", "Older list", "2026-07-15T12:00:00.000Z")]);

  const result = syncRosterLibrary(folder, [record("same", "Newer list", "2026-07-15T13:00:00.000Z")]);

  assert.equal(result.summary.conflicts, 1);
  assert.equal(result.saves.length, 2);
  assert.equal(result.saves.find(item => item.id === "same").document.name, "Newer list");
  assert.match(result.saves.find(item => item.id !== "same").document.name, /sync conflict/);
});
