"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { SHARED_RUNTIME_FILES } = require("./shared-runtime-package");

const ROOT = path.resolve(__dirname, "..");
const REQUIRED_SHARED_SOURCES = [
  "ui/engine-data-manifest.js",
  "ui/engine-runtime.js",
  "src/domain/army.js",
  "src/domain/roster-document.js",
  "src/domain/roster-share-code.js",
  "src/domain/sheets.js"
];
const FORBIDDEN_DUPLICATES = ["mobile/ui/engine-runtime.js", "mobile/src/domain"];
const PLATFORM_BUILDERS = ["scripts/build-user-runtime.js", "mobile/scripts/build-user-runtime.js"];

function auditRuntimeParity(options = {}) {
  const root = path.resolve(options.root || ROOT);
  const sharedSources = options.sharedSources || REQUIRED_SHARED_SOURCES;
  const packagedSources = new Set(options.packagedSources || SHARED_RUNTIME_FILES.map(([source]) => source));
  const forbiddenDuplicates = options.forbiddenDuplicates || FORBIDDEN_DUPLICATES;
  const platformBuilders = options.platformBuilders || PLATFORM_BUILDERS;
  const findings = [];

  for (const source of sharedSources) {
    if (!fs.existsSync(path.join(root, source))) {
      findings.push({
        code: "shared-runtime-source-missing",
        severity: "error",
        message: `Canonical shared runtime source is missing: ${source}`,
        source
      });
    } else if (!packagedSources.has(source)) {
      findings.push({
        code: "shared-runtime-source-unpackaged",
        severity: "error",
        message: `Canonical shared runtime source is not in the shared package: ${source}`,
        source
      });
    }
  }

  for (const duplicate of forbiddenDuplicates) {
    if (fs.existsSync(path.join(root, duplicate))) findings.push({
      code: "shared-runtime-duplicate",
      severity: "error",
      message: `Platform-specific rules/runtime duplicate must be removed: ${duplicate}`,
      duplicate
    });
  }

  for (const builder of platformBuilders) {
    const absolute = path.join(root, builder);
    if (!fs.existsSync(absolute) || !/copySharedRuntime/.test(fs.readFileSync(absolute, "utf8"))) findings.push({
      code: "platform-builder-bypasses-shared-runtime",
      severity: "error",
      message: `Platform builder does not consume the shared runtime package: ${builder}`,
      builder
    });
  }
  return findings;
}

function main() {
  const findings = auditRuntimeParity();
  if (!findings.length) {
    console.log("Shared runtime package: OK");
    return;
  }
  console.error(`Shared runtime package: ${findings.length} problem(s)`);
  for (const item of findings) console.error(`- ${item.message}`);
  process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { FORBIDDEN_DUPLICATES, PLATFORM_BUILDERS, REQUIRED_SHARED_SOURCES, auditRuntimeParity };
