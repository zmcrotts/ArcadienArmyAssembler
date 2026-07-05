"use strict";

const fs = require("fs");
const path = require("path");
const { XMLParser } = require("fast-xml-parser");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "data", "audits");
const JSON_OUT = path.join(OUT_DIR, "ruleset-source-audit.json");
const MARKDOWN_OUT = path.join(OUT_DIR, "ruleset-source-audit.md");

const POINTS_FIELD_ID = "51b2-306e-1021-d207";
const MAX_EXAMPLES = 8;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  isArray: name => [
    "catalogue", "gameSystem", "selectionEntry", "selectionEntryGroup", "entryLink",
    "profile", "constraint", "cost", "modifier", "condition", "conditionGroup",
    "rule", "category", "categoryLink", "infoLink", "characteristic"
  ].includes(name)
});

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && "#text" in value) return String(value["#text"] || "");
  if (typeof value === "object" && "$text" in value) return String(value.$text || "");
  return "";
}

function normalize(value) {
  return String(value || "").toLowerCase();
}

function containsAny(value, patterns) {
  const candidate = normalize(value);
  return patterns.some(pattern => pattern.test(candidate));
}

function addExample(bucket, example) {
  if (!example || bucket.length >= MAX_EXAMPLES) return;
  if (!bucket.some(item => item.file === example.file && item.name === example.name && item.path === example.path)) {
    bucket.push(example);
  }
}

function listFiles(root) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else files.push(fullPath);
    }
  }
  visit(root);
  return files;
}

function parseFile(file) {
  const ext = path.extname(file).toLowerCase();
  const raw = fs.readFileSync(file, "utf8");
  if (ext === ".cat" || ext === ".gst" || /^\s*</.test(raw)) {
    return { format: "xml", data: parser.parse(raw) };
  }
  if (ext === ".json") {
    return { format: "json", data: JSON.parse(raw) };
  }
  return { format: "unsupported", data: null };
}

function shortPath(file, root) {
  return path.relative(root, file).replace(/\\/g, "/");
}

function nodeName(node) {
  return node?.name || node?.Name || node?.title || node?.label || node?.id || node?.Id || "";
}

function nodeId(node) {
  return node?.id || node?.Id || node?.sourceId || node?.source_id || node?.uuid || null;
}

function hasDirectKey(node, keys) {
  return keys.some(key => Object.prototype.hasOwnProperty.call(node, key));
}

function hasChildShape(node, keys) {
  return keys.some(key => node?.[key] !== undefined);
}

function directPoints(node) {
  const costs = asArray(node?.costs?.cost ?? node?.costs);
  if (costs.some(cost =>
    cost.typeId === POINTS_FIELD_ID
    || normalize(cost.name) === "pts"
    || normalize(cost.name) === "points"
  )) return true;
  return ["points", "pts", "cost", "basePoints", "base_points"].some(key => {
    const value = node?.[key];
    return typeof value === "number" || (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value));
  });
}

function isStructuredStratagem(node, trail) {
  const pathText = normalize(trail.join("."));
  const typeText = normalize([node?.typeName, node?.profileType, node?.type, node?.kind, node?.category].filter(Boolean).join(" "));
  const nameText = normalize(nodeName(node));
  return /stratagem/.test(typeText)
    || /(^|\.|_)stratagems?($|\.|_)/.test(pathText)
    || (/stratagem/.test(nameText) && hasDirectKey(node, ["cost", "cp", "phase", "target", "effect", "description", "rules"]));
}

function isStructuredCoreRule(node, trail) {
  const nameText = normalize(nodeName(node));
  const typeText = normalize([node?.typeName, node?.profileType, node?.type, node?.kind, node?.category].filter(Boolean).join(" "));
  const pathText = normalize(trail.join("."));
  const coreName = /(command re-?roll|fire overwatch|grenades|rapid ingress|tank shock|epic challenge|go to ground|smokescreen|heroic intervention|counter-offensive)/.test(nameText);
  return (/core/.test(typeText) && /rule|stratagem/.test(typeText))
    || (/core/.test(pathText) && /rule|stratagem/.test(pathText))
    || (coreName && (isStructuredStratagem(node, trail) || hasDirectKey(node, ["description", "rules", "profiles", "characteristics"])));
}

function categoryText(node) {
  const pieces = [];
  for (const link of asArray(node?.categoryLinks?.categoryLink)) pieces.push(link.name, link.targetId);
  for (const category of asArray(node?.categories?.category)) pieces.push(category.name, category.id);
  for (const key of ["category", "categories", "keywords", "factionKeywords"]) {
    const value = node?.[key];
    if (Array.isArray(value)) pieces.push(...value.map(item => typeof item === "object" ? nodeName(item) : item));
    else if (value && typeof value === "object") pieces.push(nodeName(value));
    else pieces.push(value);
  }
  return pieces.filter(Boolean).join(" ");
}

function valuesText(node) {
  const pieces = [nodeName(node), node?.type, node?.typeName, node?.profileType, node?.kind, node?.label, categoryText(node)];
  for (const characteristic of asArray(node?.characteristics?.characteristic)) {
    pieces.push(characteristic.name, text(characteristic));
  }
  if (typeof node?.description === "string") pieces.push(node.description);
  if (typeof node?.text === "string") pieces.push(node.text);
  return pieces.filter(Boolean).join(" ");
}

function looksLikeUnit(node) {
  const type = normalize(node?.type || node?.kind || node?.profileType || "");
  const keyText = valuesText(node);
  return type === "unit"
    || type === "datasheet"
    || containsAny(categoryText(node), [/(^|\s)unit($|\s)/, /character/, /battleline/])
    || (hasChildShape(node, ["selectionEntries", "entryLinks", "profiles"]) && containsAny(keyText, [/datasheet/]));
}

function looksLikeCatalogue(root, file) {
  const ext = path.extname(file).toLowerCase();
  return Boolean(root?.catalogue || root?.gameSystem || root?.catalogues || root?.catalog)
    || ext === ".cat"
    || ext === ".gst";
}

function createMetric() {
  return { count: 0, files: new Set(), examples: [] };
}

function hit(metrics, name, file, example) {
  metrics[name].count += 1;
  metrics[name].files.add(file);
  addExample(metrics[name].examples, example);
}

function walk(value, visitor, trail = []) {
  if (!value || typeof value !== "object") return;
  visitor(value, trail);
  if (Array.isArray(value)) {
    value.forEach((child, index) => walk(child, visitor, trail.concat(`[${index}]`)));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === "object") walk(child, visitor, trail.concat(key));
  }
}

function auditSource(sourceDirectory) {
  const root = path.resolve(sourceDirectory);
  const allFiles = listFiles(root);
  const candidateFiles = allFiles.filter(file => [".cat", ".gst", ".json", ".yaml", ".yml"].includes(path.extname(file).toLowerCase()));
  const parsedFiles = [];
  const parseErrors = [];
  const ids = new Map();
  const duplicateIds = [];
  const topLevelShapes = new Map();
  const unsupported = candidateFiles.filter(file => [".yaml", ".yml"].includes(path.extname(file).toLowerCase()));

  const metrics = {
    catalogues: createMetric(),
    units: createMetric(),
    stableIds: createMetric(),
    points: createMetric(),
    loadoutComposition: createMetric(),
    detachments: createMetric(),
    enhancements: createMetric(),
    stratagems: createMetric(),
    stratagemMentions: createMetric(),
    coreRules: createMetric(),
    coreRuleMentions: createMetric(),
    leaderRelationships: createMetric(),
    validationConstraints: createMetric()
  };

  for (const file of candidateFiles.filter(item => !unsupported.includes(item))) {
    const rel = shortPath(file, root);
    try {
      const parsed = parseFile(file);
      parsedFiles.push({ file: rel, format: parsed.format });
      const rootKeys = parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data)
        ? Object.keys(parsed.data).sort().join(", ")
        : Array.isArray(parsed.data) ? "array" : typeof parsed.data;
      topLevelShapes.set(rootKeys, (topLevelShapes.get(rootKeys) || 0) + 1);
      if (looksLikeCatalogue(parsed.data, file)) {
        const catalogue = parsed.data.catalogue || parsed.data.gameSystem || parsed.data.catalog || parsed.data;
        hit(metrics, "catalogues", rel, { file: rel, name: nodeName(catalogue) || path.basename(file), path: "" });
      }
      walk(parsed.data, (node, trail) => {
        const id = nodeId(node);
        const name = nodeName(node);
        const joinedPath = trail.join(".");
        const example = { file: rel, name: name || id || path.basename(file), path: joinedPath };
        const allText = valuesText(node);

        if (id) {
          hit(metrics, "stableIds", rel, example);
          if (ids.has(id) && ids.get(id) !== rel) duplicateIds.push({ id, firstFile: ids.get(id), secondFile: rel });
          else ids.set(id, rel);
        }
        if (looksLikeUnit(node)) hit(metrics, "units", rel, example);
        if (directPoints(node)) hit(metrics, "points", rel, example);
        if (
          hasChildShape(node, ["selectionEntries", "selectionEntryGroups", "entryLinks"])
          || containsAny(allText, [/wargear/, /weapon/, /composition/, /model count/, /loadout/])
        ) hit(metrics, "loadoutComposition", rel, example);
        if (containsAny(allText, [/detachment/])) hit(metrics, "detachments", rel, example);
        if (containsAny(allText, [/enhancement/])) hit(metrics, "enhancements", rel, example);
        if (isStructuredStratagem(node, trail)) hit(metrics, "stratagems", rel, example);
        else if (containsAny(allText, [/stratagem/])) hit(metrics, "stratagemMentions", rel, example);
        if (isStructuredCoreRule(node, trail)) {
          hit(metrics, "coreRules", rel, example);
        } else if (containsAny(allText, [/core rule/, /core stratagem/, /command re-?roll/, /fire overwatch/, /grenades/, /rapid ingress/, /tank shock/])) {
          hit(metrics, "coreRuleMentions", rel, example);
        }
        if (containsAny(allText, [/leader/, /attached unit/, /bodyguard/, /can be attached/])) {
          hit(metrics, "leaderRelationships", rel, example);
        }
        if (
          hasDirectKey(node, ["constraints", "constraint", "modifiers", "modifier", "conditions", "conditionGroups", "validation"])
          || containsAny(allText, [/minimum/, /maximum/, /cannot include/, /must include/, /at least/, /no more than/])
        ) hit(metrics, "validationConstraints", rel, example);
      });
    } catch (error) {
      parseErrors.push({ file: rel, message: error.message });
    }
  }

  const fileSummary = {
    total: allFiles.length,
    candidates: candidateFiles.length,
    parsed: parsedFiles.length,
    unsupportedYaml: unsupported.length,
    xml: parsedFiles.filter(file => file.format === "xml").length,
    json: parsedFiles.filter(file => file.format === "json").length,
    cat: candidateFiles.filter(file => path.extname(file).toLowerCase() === ".cat").length,
    gst: candidateFiles.filter(file => path.extname(file).toLowerCase() === ".gst").length
  };

  const normalizedMetrics = Object.fromEntries(Object.entries(metrics).map(([key, metric]) => [key, {
    count: metric.count,
    files: metric.files.size,
    examples: metric.examples
  }]));

  const coverage = Object.fromEntries(Object.entries(normalizedMetrics).map(([key, metric]) => [key, metric.count > 0]));
  const required = ["catalogues", "units", "stableIds", "points", "loadoutComposition", "detachments", "enhancements", "stratagems", "coreRules", "leaderRelationships", "validationConstraints"];
  const missing = required.filter(key => !coverage[key]);
  const partial = [];
  if (coverage.points && normalizedMetrics.points.files < Math.max(1, Math.ceil(normalizedMetrics.units.files * 0.25))) partial.push("points appear sparse relative to unit-bearing files");
  if (coverage.stratagems && normalizedMetrics.stratagems.files < Math.max(1, Math.ceil(normalizedMetrics.detachments.files * 0.25))) partial.push("structured stratagem records appear sparse relative to detachment files");
  if (coverage.coreRules && normalizedMetrics.coreRules.count < 6) partial.push("structured core rules/stratagems were only lightly detected");
  if (!coverage.stratagems && coverage.stratagemMentions) partial.push("stratagem prose mentions exist, but structured stratagem records were not detected");
  if (!coverage.coreRules && coverage.coreRuleMentions) partial.push("core rule/core stratagem prose mentions exist, but structured records were not detected");
  if (parseErrors.length) partial.push(`${parseErrors.length} candidate file(s) failed to parse`);
  if (unsupported.length) partial.push(`${unsupported.length} YAML file(s) were found but not parsed by this first-pass audit`);

  let recommendation = "reference-only";
  if (!missing.length && !partial.length) recommendation = "replacement";
  else if (coverage.catalogues && coverage.units && coverage.stableIds && coverage.loadoutComposition && coverage.detachments && coverage.enhancements && coverage.stratagems && coverage.coreRules && coverage.leaderRelationships && coverage.validationConstraints) {
    recommendation = coverage.points ? "replacement-with-follow-up-audit" : "replacement-plus-mfm-overlay";
  } else if (coverage.catalogues && coverage.units && coverage.stableIds) {
    recommendation = "partial-parser-candidate";
  }

  const parserShapeDifferences = [
    fileSummary.json ? "JSON catalogues are present; current runtime extractor only reads XML .cat/.gst through fast-xml-parser." : null,
    fileSummary.xml ? "XML .cat/.gst files are present and closer to the current BSData parser shape." : null,
    fileSummary.unsupportedYaml ? "YAML files are present; this audit records them but does not parse YAML yet." : null,
    coverage.catalogues && !fileSummary.gst ? "No .gst game-system file was found; core rules may live in catalogue JSON or another reference file instead of the current game-system path." : null,
    normalizedMetrics.stratagems.count
      ? "Structured-looking stratagem records were detected; follow-up parser work must map their timing, target, effect, and CP fields."
      : normalizedMetrics.stratagemMentions.count
        ? "Only prose stratagem mentions were detected; this is not enough to replace the missing structured stratagem layer."
        : "No stratagem records or mentions were detected.",
    normalizedMetrics.coreRules.count
      ? "Structured-looking core/reference rules were detected; follow-up parser work should classify core stratagems separately from faction rules."
      : normalizedMetrics.coreRuleMentions.count
        ? "Only prose core rule/core stratagem mentions were detected."
        : "No core stratagem/core reference rule records were detected.",
    duplicateIds.length ? "Some IDs repeat across files; verify whether IDs are globally stable or only stable within catalogue scope." : null
  ].filter(Boolean);

  return {
    summary: {
      generatedAt: new Date().toISOString(),
      sourceDirectory: root,
      recommendation,
      missing,
      partial,
      files: fileSummary
    },
    metrics: normalizedMetrics,
    parserShapeDifferences,
    topLevelShapes: [...topLevelShapes.entries()].map(([shape, count]) => ({ shape, count })),
    parseErrors,
    unsupportedFiles: unsupported.map(file => shortPath(file, root)),
    duplicateIds: duplicateIds.slice(0, 50),
    parsedFiles
  };
}

function markdown(report) {
  const metricLines = Object.entries(report.metrics).map(([key, metric]) =>
    `- ${key}: ${metric.count} hit(s) across ${metric.files} file(s)`
  );
  const missing = report.summary.missing.length ? report.summary.missing.join(", ") : "none";
  const partial = report.summary.partial.length ? report.summary.partial.map(item => `- ${item}`).join("\n") : "- none";
  const examples = Object.entries(report.metrics).flatMap(([key, metric]) => [
    `### ${key}`,
    "",
    ...(metric.examples.length
      ? metric.examples.map(item => `- ${item.file}: ${item.name}${item.path ? ` (${item.path})` : ""}`)
      : ["- No examples found."]),
    ""
  ]);

  return [
    "# Ruleset Source Replacement Audit",
    "",
    `Generated: ${report.summary.generatedAt}`,
    `Source: ${report.summary.sourceDirectory}`,
    `Recommendation: ${report.summary.recommendation}`,
    "",
    "## File Summary",
    "",
    `- Total files: ${report.summary.files.total}`,
    `- Candidate rules files: ${report.summary.files.candidates}`,
    `- Parsed files: ${report.summary.files.parsed}`,
    `- XML files parsed: ${report.summary.files.xml}`,
    `- JSON files parsed: ${report.summary.files.json}`,
    `- .cat files: ${report.summary.files.cat}`,
    `- .gst files: ${report.summary.files.gst}`,
    `- Unsupported YAML files: ${report.summary.files.unsupportedYaml}`,
    "",
    "## Replacement Coverage",
    "",
    ...metricLines,
    "",
    `Missing: ${missing}`,
    "",
    "Partial Signals",
    "",
    partial,
    "",
    "## Parser Shape Differences",
    "",
    ...(report.parserShapeDifferences.length ? report.parserShapeDifferences.map(item => `- ${item}`) : ["- none"]),
    "",
    "## Examples",
    "",
    ...examples
  ].join("\n");
}

function main() {
  const source = process.argv[2];
  if (!source) {
    console.error("Usage: node scripts/audit-ruleset-source.js <local-ruleset-source-folder>");
    process.exit(1);
  }
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    console.error(`Ruleset source folder not found: ${source}`);
    process.exit(1);
  }
  const report = auditSource(source);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  fs.writeFileSync(MARKDOWN_OUT, markdown(report));
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Audit: ${JSON_OUT}`);
  console.log(`Report: ${MARKDOWN_OUT}`);
  if (report.summary.recommendation === "reference-only") process.exitCode = 2;
}

if (require.main === module) main();

module.exports = { auditSource };
