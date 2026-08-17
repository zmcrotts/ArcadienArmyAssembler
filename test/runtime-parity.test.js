"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { auditRuntimeParity } = require("../scripts/runtime-parity");

test("shared runtime audit rejects platform rule-engine duplicates and bypasses", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "roster-runtime-parity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const shared = "src/domain/army.js";
  const windowsBuilder = "scripts/build-user-runtime.js";
  const mobileBuilder = "mobile/scripts/build-user-runtime.js";
  for (const relative of [shared, windowsBuilder, mobileBuilder]) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), relative === shared ? "module.exports = 1;\n" : "copySharedRuntime();\n");
  }
  const options = {
    root,
    sharedSources: [shared],
    packagedSources: [shared],
    forbiddenDuplicates: ["mobile/src/domain"],
    platformBuilders: [windowsBuilder, mobileBuilder]
  };

  assert.deepEqual(auditRuntimeParity(options), []);

  fs.mkdirSync(path.join(root, "mobile", "src", "domain"), { recursive: true });
  fs.writeFileSync(path.join(root, mobileBuilder), "buildSomethingElse();\n");
  const findings = auditRuntimeParity(options);
  assert.deepEqual(findings.map(item => item.code), ["shared-runtime-duplicate", "platform-builder-bypasses-shared-runtime"]);
});
