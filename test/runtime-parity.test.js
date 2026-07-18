"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { auditRuntimeParity } = require("../scripts/runtime-parity");

test("runtime parity ignores line endings but detects source divergence", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "roster-runtime-parity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "shared"));
  fs.mkdirSync(path.join(root, "mobile"));
  fs.writeFileSync(path.join(root, "shared", "runtime.js"), "first\r\nsecond\r\n");
  fs.writeFileSync(path.join(root, "mobile", "runtime.js"), "first\nsecond\n");
  const pairs = [["shared/runtime.js", "mobile/runtime.js"]];

  assert.deepEqual(auditRuntimeParity({ root, pairs }), []);

  fs.writeFileSync(path.join(root, "mobile", "runtime.js"), "different\n");
  const findings = auditRuntimeParity({ root, pairs });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "runtime-parity-mismatch");
});
