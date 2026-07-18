"use strict";

const fs = require("fs");

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sourceIssue(code, message, filePath, details = {}) {
  return {
    code,
    severity: "error",
    message,
    filePath: filePath || null,
    ...details
  };
}

function emptyStratagems(issue = null) {
  return {
    source: null,
    core: [],
    byDetachmentName: new Map(),
    all: [],
    issues: issue ? [issue] : []
  };
}

function readNewRecruitStratagems(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return emptyStratagems(filePath
      ? sourceIssue("configured-source-missing", `Configured New Recruit stratagem source is missing: ${filePath}`, filePath)
      : null);
  }

  const document = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const rawStratagems = Array.isArray(document?.data?.stratagems) ? document.data.stratagems : [];
  const source = {
    kind: "newrecruit-book",
    filePath,
    fetchedAt: document.fetchedAt || null,
    name: document.metadata?.name || "Stratagems",
    nrversion: document.metadata?.nrversion || null,
    lastUpdated: document.metadata?.last_updated || null,
    deleted: document.metadata?.deleted === true,
    playable: document.metadata?.playable ?? null
  };

  const issues = [];
  if (source.deleted) {
    issues.push(sourceIssue(
      "upstream-source-deleted",
      `New Recruit marks the configured stratagem source as deleted: ${source.name}`,
      filePath,
      { sourceName: source.name, lastUpdated: source.lastUpdated }
    ));
  }

  return buildStratagemIndex(rawStratagems, source, { issues });
}

function readLocalCoreStratagems(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return emptyStratagems(filePath
      ? sourceIssue("configured-source-missing", `Configured core stratagem source is missing: ${filePath}`, filePath)
      : null);
  }

  const document = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const rawStratagems = Array.isArray(document?.coreStratagems) ? document.coreStratagems : [];
  const source = {
    kind: "local-core-stratagems",
    filePath,
    name: document.name || "Local Core Stratagems",
    nrversion: document.version || null,
    lastUpdated: document.updatedAt || null
  };

  return buildStratagemIndex(rawStratagems, source, { defaultScope: "core" });
}

function readLocalDetachmentStratagems(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return emptyStratagems(filePath
      ? sourceIssue("configured-source-missing", `Configured detachment stratagem source is missing: ${filePath}`, filePath)
      : null);
  }

  const document = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const rawStratagems = Array.isArray(document?.detachmentStratagems) ? document.detachmentStratagems : [];
  const source = {
    kind: "local-detachment-stratagems",
    filePath,
    name: document.name || "Local Detachment Stratagems",
    nrversion: document.version || null,
    lastUpdated: document.updatedAt || null
  };

  const mismatchedUrls = rawStratagems
    .map(item => item?.sourceUrl)
    .filter(url => typeof url === "string" && /\/wh40k10ed\//i.test(url));
  const claimsEleventhEdition = /11e|11th/i.test(`${document.name || ""} ${document.version || ""}`);
  const issues = claimsEleventhEdition && mismatchedUrls.length
    ? [sourceIssue(
      "edition-source-url-mismatch",
      `${mismatchedUrls.length} record(s) in an 11e stratagem source link to explicitly 10e URLs`,
      filePath,
      { affectedRecords: mismatchedUrls.length }
    )]
    : [];

  return buildStratagemIndex(rawStratagems, source, { issues });
}

function mergeStratagemSources(...sources) {
  const present = sources.filter(source => source?.source);
  const issues = sources.flatMap(source => Array.isArray(source?.issues) ? source.issues : []);
  if (!present.length) {
    const empty = emptyStratagems();
    empty.issues = issues;
    return empty;
  }

  const merged = {
    source: {
      kind: "merged-stratagem-sources",
      name: present.map(source => source.source.name).filter(Boolean).join(" + "),
      nrversion: present.map(source => source.source.nrversion).filter(Boolean).join(" + ") || null,
      sources: present.map(source => source.source),
      issues
    },
    core: [],
    byDetachmentName: new Map(),
    all: [],
    issues
  };

  for (const source of present) {
    merged.core.push(...source.core);
    merged.all.push(...source.all);
    for (const [detachmentName, stratagems] of source.byDetachmentName.entries()) {
      if (!merged.byDetachmentName.has(detachmentName)) merged.byDetachmentName.set(detachmentName, []);
      merged.byDetachmentName.get(detachmentName).push(...stratagems);
    }
  }

  merged.core = dedupeStratagems(merged.core);
  merged.all = dedupeStratagems(merged.all);
  for (const [detachmentName, stratagems] of merged.byDetachmentName.entries()) {
    merged.byDetachmentName.set(detachmentName, dedupeStratagems(stratagems));
  }

  return merged;
}

function buildStratagemIndex(rawStratagems, source, options = {}) {
  if (!Array.isArray(rawStratagems)) {
    return {
      source,
      core: [],
      byDetachmentName: new Map(),
      all: [],
      issues: [...(options.issues || [])]
    };
  }

  const all = rawStratagems.map(item => normalizeStratagem(item, options));
  const core = [];
  const byDetachmentName = new Map();

  for (const stratagem of all) {
    if (stratagem.scope === "core") {
      core.push(stratagem);
      continue;
    }

    const key = normalizeName(stratagem.detachment);
    if (!key) continue;
    if (!byDetachmentName.has(key)) byDetachmentName.set(key, []);
    byDetachmentName.get(key).push(stratagem);
  }

  return {
    source,
    core,
    byDetachmentName,
    all,
    issues: [...(options.issues || [])]
  };
}

function normalizeStratagem(item, options = {}) {
  const detachment = String(item.detachment || "").trim();
  const type = String(item.type || "").trim();
  const isCore = options.defaultScope === "core" || (!detachment && /^core\b/i.test(type));
  return {
    id: String(item.id || `${item.name || "stratagem"}:${type}:${detachment}`),
    name: String(item.name || "Unnamed Stratagem").trim(),
    type,
    cpCost: String(item.cp_cost ?? item.cpCost ?? "").trim(),
    turn: String(item.turn || "").trim(),
    phase: String(item.phase || "").trim(),
    legend: String(item.legend || "").trim(),
    description: String(item.description || "").trim(),
    detachment,
    factionId: String(item.faction_id || "").trim(),
    scope: isCore ? "core" : "detachment",
    sourceUrl: item.sourceUrl || null,
    target: item.target || null
  };
}

function dedupeStratagems(stratagems) {
  const seen = new Set();
  const result = [];
  for (const stratagem of stratagems) {
    const key = `${normalizeName(stratagem.scope)}:${normalizeName(stratagem.detachment)}:${normalizeName(stratagem.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(stratagem);
  }
  return result;
}

function attachStratagemsToArmies(armies, stratagemSource) {
  if (!stratagemSource?.source) return armies;

  const compactByDetachmentName = new Map();
  for (const [detachmentName, stratagems] of stratagemSource.byDetachmentName.entries()) {
    const compact = compactName(detachmentName);
    if (!compactByDetachmentName.has(compact)) compactByDetachmentName.set(compact, stratagems);
  }

  return armies.map(army => ({
    ...army,
    stratagemSource: stratagemSource.source,
    coreStratagems: stratagemSource.core,
    detachments: (army.detachments || []).map(detachment => ({
      ...detachment,
      stratagems: [
        ...(detachment.stratagems || []),
        ...(stratagemSource.byDetachmentName.get(normalizeName(detachment.name))
          || compactByDetachmentName.get(compactName(detachment.name))
          || [])
      ]
    }))
  }));
}

function compactName(value) {
  return normalizeName(value).replace(/\s+/g, "");
}

module.exports = {
  attachStratagemsToArmies,
  mergeStratagemSources,
  normalizeName,
  readLocalCoreStratagems,
  readLocalDetachmentStratagems,
  readNewRecruitStratagems
};
