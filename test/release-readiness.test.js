"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  auditGeneratedData,
  auditNormalizedRuleset
} = require("../scripts/check-release-readiness");
const { sourceFingerprint } = require("../scripts/ruleset-source-fingerprint");

test("release readiness retains configured source diagnostics", () => {
  const findings = auditNormalizedRuleset({
    units: [],
    armies: [],
    unresolved: [],
    stratagemSource: {
      issues: [{
        code: "upstream-source-deleted",
        severity: "error",
        message: "Deleted upstream"
      }]
    }
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "upstream-source-deleted");
});

test("release readiness includes and deduplicates all normalized source diagnostics", () => {
  const armyRuleIssue = {
    code: "manual-army-rules-missing",
    severity: "error",
    message: "Army rule source is missing",
    filePath: "missing-army-rules.json"
  };
  const findings = auditNormalizedRuleset({
    units: [],
    armies: [],
    unresolved: [],
    stratagemSource: {
      issues: [{
        code: "stratagem-source-missing",
        severity: "error",
        message: "Stratagem source is missing"
      }]
    },
    sourceIssues: [armyRuleIssue],
    armyRuleSourceIssues: [{ ...armyRuleIssue }]
  });

  assert.deepEqual(findings.map(item => item.code), [
    "stratagem-source-missing",
    "manual-army-rules-missing"
  ]);
});

test("MFM-authoritative compound Leaders are exempt from the Character invariant", () => {
  const findings = auditNormalizedRuleset({
    units: [{
      id: "compound",
      selectionKey: "compound",
      name: "Compound Character Unit",
      faction: "Test",
      roles: { leader: true, character: false },
      rosterRules: { mfmAttachmentRole: "LEADER" },
      pricing: { base: 1, modifiers: [] },
      composition: [],
      selectionTree: {
        id: "compound",
        kind: "unit",
        constraints: [],
        modifiers: [],
        profiles: [],
        rules: [],
        children: []
      }
    }],
    armies: [],
    unresolved: [],
    stratagemSource: { issues: [] }
  });

  assert.equal(findings.some(item => item.code === "non-character-leaders"), false);
});

test("generated-data readiness compares the complete source fingerprint", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "roster-generated-readiness-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, "rules");
  fs.mkdirSync(sourcePath);
  fs.writeFileSync(path.join(sourcePath, "catalogue.json"), "rules");
  const source = { sourcePath };
  const manifest = { sourceFingerprint: sourceFingerprint(source) };

  assert.deepEqual(auditGeneratedData(source, manifest), []);

  fs.writeFileSync(path.join(sourcePath, "catalogue.json"), "changed rules");
  const findings = auditGeneratedData(source, manifest);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "generated-data-stale");
});
