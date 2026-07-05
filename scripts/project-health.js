"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { auditSource } = require("./audit-ruleset-source");
const {
  DEFAULT_RULESET_SOURCE_ID,
  extractNormalizedRuleset,
  getRulesetSource,
  listRulesetSources
} = require("../src/rulesets/sources");

const ROOT = path.resolve(__dirname, "..");
const ENGINE_BUNDLE = path.join(ROOT, "ui", "engine-data-milestone15.js");
const ENGINE_MANIFEST = path.join(ROOT, "ui", "engine-data-manifest.js");
const ENGINE_CHUNK_DIR = path.join(ROOT, "ui", "engine-data");

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "missing";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function bundleSummary(filePath) {
  if (!fs.existsSync(filePath)) {
    return { path: path.relative(ROOT, filePath), exists: false, size: "missing" };
  }
  const stats = fs.statSync(filePath);
  return {
    path: path.relative(ROOT, filePath),
    exists: true,
    size: formatBytes(stats.size),
    updatedAt: stats.mtime.toISOString()
  };
}

function splitDataSummary() {
  const manifest = bundleSummary(ENGINE_MANIFEST);
  const chunks = fs.existsSync(ENGINE_CHUNK_DIR)
    ? fs.readdirSync(ENGINE_CHUNK_DIR).filter(file => file.endsWith(".js"))
    : [];
  const totalChunkBytes = chunks.reduce((sum, file) => sum + fs.statSync(path.join(ENGINE_CHUNK_DIR, file)).size, 0);
  return {
    manifest,
    chunkDirectory: path.relative(ROOT, ENGINE_CHUNK_DIR),
    chunks: chunks.length,
    chunkSize: formatBytes(totalChunkBytes)
  };
}

function gitSummary() {
  try {
    const output = execFileSync("git", ["status", "--short"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    const lines = output ? output.split(/\r?\n/) : [];
    return {
      clean: lines.length === 0,
      changedFiles: lines.length,
      modified: lines.filter(line => !line.startsWith("??")).length,
      untracked: lines.filter(line => line.startsWith("??")).length
    };
  } catch (error) {
    return { clean: null, error: error.message };
  }
}

function healthReport() {
  const source = getRulesetSource(DEFAULT_RULESET_SOURCE_ID);
  const ruleset = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID);
  const sourceAudit = auditSource(source.sourcePath);
  const armies = ruleset.armies || [];
  const units = ruleset.units || [];
  const detachments = armies.flatMap(army => army.detachments || []);
  const detachmentStratagems = detachments.flatMap(detachment => detachment.stratagems || []);
  const coreStratagems = armies.flatMap(army => army.coreStratagems || []);

  return {
    generatedAt: new Date().toISOString(),
    defaultRuleset: {
      id: source.id,
      edition: source.edition,
      format: source.format,
      sourcePath: path.relative(ROOT, source.sourcePath),
      availableRulesets: listRulesetSources().map(item => item.id)
    },
    normalizedData: {
      armies: armies.length,
      units: units.length,
      allies: Object.values(ruleset.allies || {}).reduce((sum, allies) => sum + allies.length, 0),
      detachments: detachments.length,
      enhancements: armies.reduce((sum, army) => sum + (army.enhancements || []).length, 0),
      coreStratagemRecords: coreStratagems.length,
      detachmentStratagemRecords: detachmentStratagems.length,
      unresolvedLinks: ruleset.unresolved?.length || 0
    },
    sourceCoverage: {
      recommendation: sourceAudit.summary.recommendation,
      missing: sourceAudit.summary.missing,
      partial: sourceAudit.summary.partial,
      files: sourceAudit.summary.files,
      metrics: Object.fromEntries(Object.entries(sourceAudit.metrics).map(([key, metric]) => [key, {
        count: metric.count,
        files: metric.files
      }]))
    },
    generatedBundle: bundleSummary(ENGINE_BUNDLE),
    splitGeneratedData: splitDataSummary(),
    git: gitSummary()
  };
}

function printReport(report) {
  const lines = [
    "# Project Health",
    "",
    `Generated: ${report.generatedAt}`,
    `Default ruleset: ${report.defaultRuleset.id} (${report.defaultRuleset.edition}, ${report.defaultRuleset.format})`,
    `Source path: ${report.defaultRuleset.sourcePath}`,
    `Available rulesets: ${report.defaultRuleset.availableRulesets.join(", ")}`,
    "",
    "## Normalized Data",
    "",
    `- Armies: ${report.normalizedData.armies}`,
    `- Units: ${report.normalizedData.units}`,
    `- Ally definitions: ${report.normalizedData.allies}`,
    `- Detachments: ${report.normalizedData.detachments}`,
    `- Enhancements/upgrades: ${report.normalizedData.enhancements}`,
    `- Core stratagem records: ${report.normalizedData.coreStratagemRecords}`,
    `- Detachment stratagem records: ${report.normalizedData.detachmentStratagemRecords}`,
    `- Unresolved links: ${report.normalizedData.unresolvedLinks}`,
    "",
    "## Source Coverage",
    "",
    `- Recommendation: ${report.sourceCoverage.recommendation}`,
    `- Missing: ${report.sourceCoverage.missing.length ? report.sourceCoverage.missing.join(", ") : "none"}`,
    `- Partial: ${report.sourceCoverage.partial.length ? report.sourceCoverage.partial.join("; ") : "none"}`,
    `- Parsed files: ${report.sourceCoverage.files.parsed}/${report.sourceCoverage.files.candidates}`,
    "",
    "## Generated Bundle",
    "",
    `- ${report.generatedBundle.path}: ${report.generatedBundle.exists ? report.generatedBundle.size : "missing"}`,
    `- ${report.splitGeneratedData.manifest.path}: ${report.splitGeneratedData.manifest.exists ? report.splitGeneratedData.manifest.size : "missing"}`,
    `- ${report.splitGeneratedData.chunkDirectory}: ${report.splitGeneratedData.chunks} chunk(s), ${report.splitGeneratedData.chunkSize}`,
    "",
    "## Git",
    "",
    report.git.error
      ? `- Status unavailable: ${report.git.error}`
      : `- ${report.git.clean ? "Clean" : "Dirty"} (${report.git.changedFiles} changed, ${report.git.modified} modified, ${report.git.untracked} untracked)`
  ];
  console.log(lines.join("\n"));
}

function main() {
  const report = healthReport();
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
}

if (require.main === module) main();

module.exports = { healthReport };
