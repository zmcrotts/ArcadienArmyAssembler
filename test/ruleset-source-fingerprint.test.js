"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { sourceFingerprint } = require("../scripts/ruleset-source-fingerprint");

test("ruleset source fingerprints are stable, content-sensitive, and include missing inputs", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "roster-source-fingerprint-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, "source");
  const auxiliaryPath = path.join(root, "auxiliary.json");
  const missingPath = path.join(root, "missing.json");
  fs.mkdirSync(sourcePath);
  fs.writeFileSync(path.join(sourcePath, "army.json"), "first");
  fs.writeFileSync(auxiliaryPath, "auxiliary");
  const source = {
    sourcePath,
    auxiliarySources: { present: auxiliaryPath, missing: missingPath }
  };

  const first = sourceFingerprint(source, { root });
  const repeated = sourceFingerprint(source, { root });

  assert.deepEqual(repeated, first);
  assert.equal(first.fileCount, 2);
  assert.deepEqual(first.missing, ["missing.json"]);

  fs.writeFileSync(path.join(sourcePath, "army.json"), "second");
  const changed = sourceFingerprint(source, { root });

  assert.notEqual(changed.value, first.value);
});
