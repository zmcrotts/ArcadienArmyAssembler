"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_PAIRS = [
  ["src/domain/army.js", "mobile/src/domain/army.js"],
  ["src/domain/factions.js", "mobile/src/domain/factions.js"],
  ["src/domain/loadout.js", "mobile/src/domain/loadout.js"],
  ["src/domain/pricing.js", "mobile/src/domain/pricing.js"],
  ["src/domain/roster-document.js", "mobile/src/domain/roster-document.js"],
  ["src/domain/sheets.js", "mobile/src/domain/sheets.js"],
  ["ui/catalogue-sections.js", "mobile/ui/catalogue-sections.js"],
  ["ui/engine-runtime.js", "mobile/ui/engine-runtime.js"]
];

function normalizedSource(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
}

function auditRuntimeParity(options = {}) {
  const root = path.resolve(options.root || ROOT);
  const pairs = options.pairs || DEFAULT_PAIRS;
  const findings = [];
  for (const [sharedPath, mobilePath] of pairs) {
    const shared = path.join(root, sharedPath);
    const mobile = path.join(root, mobilePath);
    if (!fs.existsSync(shared) || !fs.existsSync(mobile)) {
      findings.push({
        code: "runtime-parity-file-missing",
        severity: "error",
        message: `Runtime parity input is missing: ${!fs.existsSync(shared) ? sharedPath : mobilePath}`,
        sharedPath,
        mobilePath
      });
      continue;
    }
    if (normalizedSource(shared) !== normalizedSource(mobile)) {
      findings.push({
        code: "runtime-parity-mismatch",
        severity: "error",
        message: `Shared and mobile runtime sources have diverged: ${sharedPath} <> ${mobilePath}`,
        sharedPath,
        mobilePath
      });
    }
  }
  return findings;
}

function main() {
  const findings = auditRuntimeParity();
  if (!findings.length) {
    console.log("Runtime parity: OK");
    return;
  }
  console.error(`Runtime parity: ${findings.length} problem(s)`);
  for (const item of findings) console.error(`- ${item.message}`);
  process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { DEFAULT_PAIRS, auditRuntimeParity };
