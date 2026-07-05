"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");

const { extractNormalizedRuleset } = require("../src/rulesets/sources");
const { normalizeName } = require("../src/rulesets/newrecruit-stratagems");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.join(ROOT, "data", "manual-rules", "wh40k-11e-wahapedia-detachment-stratagems.json");
const BASE_URL = "https://wahapedia.ru/wh40k10ed/factions/";

const args = process.argv.slice(2);
if (!args.length) {
  console.error("Usage: node scripts/import-wahapedia-stratagem-gapfill.js <faction-slug-or-url> [...]");
  process.exit(1);
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const next = new URL(response.headers.location, url).toString();
        response.resume();
        fetchText(next).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Fetch failed ${response.statusCode}: ${url}`));
        response.resume();
        return;
      }
      let data = "";
      response.setEncoding("utf8");
      response.on("data", chunk => data += chunk);
      response.on("end", () => resolve(data));
    });
    request.setTimeout(45000, () => request.destroy(new Error(`Fetch timed out: ${url}`)));
    request.on("error", reject);
  });
}

async function fetchTextWithRetry(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetchText(url);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 1500));
    }
  }
  throw lastError;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&ndash;/g, "-")
    .replace(/&mdash;/g, "-")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractField(chunk, className) {
  const match = chunk.match(new RegExp(`<div class="${className}">([\\s\\S]*?)<\\/div>`));
  return match ? decodeHtml(match[1]) : "";
}

function detachmentFromType(type) {
  return String(type || "").split(/\s+[\u2013\u2014-]\s+/)[0]?.trim() || "";
}

function urlForArg(arg) {
  if (/^https?:\/\//i.test(arg)) return arg.endsWith("/") ? arg : `${arg}/`;
  return new URL(`${arg.replace(/^\/+|\/+$/g, "")}/`, BASE_URL).toString();
}

function slugForUrl(url) {
  return new URL(url).pathname.split("/").filter(Boolean).at(-1) || "unknown";
}

function idFor(stratagem, sourceSlug) {
  return `wahapedia-${sourceSlug}-${normalizeName(stratagem.detachment)}-${normalizeName(stratagem.name)}`.replace(/\s+/g, "-");
}

function ruleReminder(text) {
  const cleaned = decodeHtml(text).replace(/ \./g, ".").replace(/ ,/g, ",");
  const labels = ["WHEN", "TARGET", "EFFECT", "RESTRICTIONS", "RESTRICTION"];
  const parts = [];
  for (let index = 0; index < labels.length; index++) {
    const label = labels[index];
    const labelPattern = new RegExp(`${label}:`, "i");
    const start = cleaned.search(labelPattern);
    if (start < 0) continue;
    let end = cleaned.length;
    for (const nextLabel of labels) {
      if (nextLabel === label) continue;
      const next = cleaned.slice(start + label.length + 1).search(new RegExp(`${nextLabel}:`, "i"));
      if (next >= 0) end = Math.min(end, start + label.length + 1 + next);
    }
    const value = cleaned.slice(start + label.length + 1, end)
      .replace(/\s+/g, " ")
      .replace(/\bStratagem\b/g, "stratagem")
      .trim();
    if (value) parts.push(`${label === "RESTRICTIONS" ? "RESTRICTION" : label}: ${value}`);
  }
  return parts.length ? parts.join("\n") : "Rules reminder pending. See source URL for exact wording.";
}

function extractStratagems(html, sourceUrl, sourceSlug) {
  return html.split(/<div class=" str10Wrap\b/).slice(1).map(chunk => {
    const name = titleCase(extractField(chunk, "str10Name"));
    const cpCost = extractField(chunk, "str10CP").replace(/CP$/i, "");
    const type = extractField(chunk, "str10Type").replace(/\s+[\u2013\u2014]\s+/g, " - ");
    const detachment = detachmentFromType(type);
    const description = ruleReminder(extractField(chunk, "str10Text"));
    return {
      id: idFor({ name, detachment }, sourceSlug),
      name,
      type,
      cpCost,
      detachment,
      description,
      sourceUrl
    };
  }).filter(item => item.name && item.detachment);
}

function titleCase(value) {
  return String(value || "").toLowerCase().replace(/\b[a-z]/g, letter => letter.toUpperCase());
}

function uniqueStratagems(stratagems) {
  const seen = new Set();
  return stratagems.filter(stratagem => {
    const key = `${normalizeName(stratagem.detachment)}:${normalizeName(stratagem.name)}:${stratagem.cpCost}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function currentMissingDetachments() {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const missing = new Map();
  for (const army of ruleset.armies) {
    for (const detachment of army.detachments || []) {
      const existing = (detachment.stratagems || []).filter(stratagem => stratagem.scope !== "core").length;
      if (existing) continue;
      const key = normalizeName(detachment.name);
      if (!missing.has(key)) missing.set(key, { name: detachment.name, armies: [] });
      missing.get(key).armies.push(army.faction);
    }
  }
  return missing;
}

function readOutput() {
  if (!fs.existsSync(OUTPUT_PATH)) {
    return {
      schemaVersion: 1,
      name: "Local 11e Wahapedia Detachment Stratagem Gap-fill",
      version: "wahapedia-gapfill-1",
      updatedAt: new Date().toISOString().slice(0, 10),
      notes: [
        "Gap-fill source for detachments that currently have zero detachment stratagems from New Recruit or faction-specific local supplements.",
        "Records are source-linked, missing-only, and loaded after preferred sources so they do not overwrite existing stratagem records."
      ],
      detachmentStratagems: []
    };
  }
  return JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8"));
}

async function main() {
  const missing = currentMissingDetachments();
  const document = readOutput();
  const byId = new Map((document.detachmentStratagems || []).map(item => [item.id, item]));
  const added = [];

  for (const arg of args) {
    const url = urlForArg(arg);
    const sourceSlug = slugForUrl(url);
    const html = await fetchTextWithRetry(url);
    const matched = uniqueStratagems(extractStratagems(html, url, sourceSlug))
      .filter(item => missing.has(normalizeName(item.detachment)));

    for (const stratagem of matched) {
      if (byId.has(stratagem.id)) continue;
      byId.set(stratagem.id, stratagem);
      added.push(stratagem);
    }

    console.log(`${sourceSlug}: ${matched.length} matching stratagem rows, ${added.length} total new so far`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  document.updatedAt = new Date().toISOString().slice(0, 10);
  document.detachmentStratagems = [...byId.values()].sort((a, b) =>
    a.detachment.localeCompare(b.detachment) || a.name.localeCompare(b.name)
  );
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(document, null, 2)}\n`);

  console.log(`Added ${added.length} new stratagem records.`);
  console.log(OUTPUT_PATH);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
