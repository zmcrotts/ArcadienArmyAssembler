"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  mergeStratagemSources,
  readLocalCoreStratagems,
  readLocalDetachmentStratagems,
  readNewRecruitStratagems
} = require("../src/rulesets/newrecruit-stratagems");

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "roster-stratagem-source-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("configured missing stratagem sources remain visible as release issues", () => {
  const result = readLocalDetachmentStratagems(path.join(os.tmpdir(), "definitely-missing-stratagems.json"));

  assert.equal(result.source, null);
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].code, "configured-source-missing");
});

test("deleted New Recruit metadata is preserved and reported", t => {
  const directory = temporaryDirectory(t);
  const filePath = path.join(directory, "stratagems.json");
  fs.writeFileSync(filePath, JSON.stringify({
    metadata: {
      name: "Test Stratagems",
      deleted: true,
      last_updated: "2026-01-02T03:04:05Z"
    },
    data: { stratagems: [] }
  }));

  const result = readNewRecruitStratagems(filePath);

  assert.equal(result.source.deleted, true);
  assert.equal(result.issues[0].code, "upstream-source-deleted");
});

test("an 11e supplement that links to 10e pages is reported", t => {
  const directory = temporaryDirectory(t);
  const filePath = path.join(directory, "local.json");
  fs.writeFileSync(filePath, JSON.stringify({
    name: "Local 11e Detachment Stratagems",
    version: "11e-test",
    detachmentStratagems: [{
      id: "test",
      name: "Test",
      detachment: "Test Detachment",
      sourceUrl: "https://example.test/wh40k10ed/factions/test/"
    }]
  }));

  const result = readLocalDetachmentStratagems(filePath);

  assert.equal(result.all.length, 1);
  assert.equal(result.issues[0].code, "edition-source-url-mismatch");
  assert.equal(result.issues[0].affectedRecords, 1);
});

test("merged source diagnostics include missing and present-source issues", t => {
  const directory = temporaryDirectory(t);
  const corePath = path.join(directory, "core.json");
  fs.writeFileSync(corePath, JSON.stringify({
    name: "Core",
    coreStratagems: [{ id: "core", name: "Core Test", scope: "core" }]
  }));

  const merged = mergeStratagemSources(
    readLocalCoreStratagems(corePath),
    readLocalDetachmentStratagems(path.join(directory, "missing.json"))
  );

  assert.equal(merged.core.length, 1);
  assert.equal(merged.source.issues.length, 1);
  assert.equal(merged.source.issues[0].code, "configured-source-missing");
});
