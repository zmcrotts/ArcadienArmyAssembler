"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");

const { extractNormalizedRuleset } = require("../src/rulesets/sources");
const { normalizeName } = require("../src/rulesets/newrecruit-stratagems");

const QUICK_START_URL = "https://wahapedia.ru/wh40k10ed/the-rules/quick-start-guide/";
const OUTPUT_PATH = path.join(__dirname, "..", "data", "audits", "wahapedia-missing-stratagems.txt");

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
    request.setTimeout(30000, () => {
      request.destroy(new Error(`Fetch timed out: ${url}`));
    });
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
      if (attempt < attempts) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  throw lastError;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, " "));
}

function extractFactionUrls(html) {
  const urls = new Set();
  const pattern = /href="(\/wh40k10ed\/factions\/[^"#?]+\/?)"/g;
  let match;
  while ((match = pattern.exec(html))) {
    urls.add(new URL(match[1], QUICK_START_URL).toString());
  }
  return [...urls].sort();
}

function extractField(chunk, className) {
  const match = chunk.match(new RegExp(`<div class="${className}">([\\s\\S]*?)<\\/div>`));
  return match ? stripTags(match[1]) : "";
}

function detachmentFromType(type) {
  const parts = String(type || "").split(/\s+[\u2013\u2014-]\s+/);
  if (parts.length < 2) return "";
  return parts[0].trim();
}

function extractStratagemSummaries(html, sourceUrl) {
  return html.split(/<div class=" str10Wrap\b/).slice(1).map(chunk => {
    const name = extractField(chunk, "str10Name");
    const cpCost = extractField(chunk, "str10CP").replace(/CP$/i, "");
    const type = extractField(chunk, "str10Type");
    const detachment = detachmentFromType(type);
    return { name, cpCost, type, detachment, sourceUrl };
  }).filter(stratagem => stratagem.name && stratagem.detachment);
}

function missingDetachmentsByName(ruleset) {
  const missing = new Map();
  for (const army of ruleset.armies) {
    for (const detachment of army.detachments || []) {
      const existing = (detachment.stratagems || []).filter(stratagem => stratagem.scope !== "core").length;
      if (existing) continue;

      const key = normalizeName(detachment.name);
      if (!missing.has(key)) {
        missing.set(key, { name: detachment.name, armies: [], matches: [] });
      }
      missing.get(key).armies.push(army.faction);
    }
  }
  return missing;
}

function addMatches(missing, stratagems) {
  for (const stratagem of stratagems) {
    const key = normalizeName(stratagem.detachment);
    const record = missing.get(key);
    if (!record) continue;
    record.matches.push(stratagem);
  }
}

function uniqueStratagems(stratagems) {
  const seen = new Set();
  return stratagems.filter(stratagem => {
    const key = `${normalizeName(stratagem.name)}:${stratagem.cpCost}:${normalizeName(stratagem.type)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const missing = missingDetachmentsByName(ruleset);
  const quickStart = await fetchTextWithRetry(QUICK_START_URL);
  const factionUrls = extractFactionUrls(quickStart);

  const fetchedPages = await mapLimit(factionUrls, 3, async url => ({
    url,
    html: await fetchTextWithRetry(url)
  }));

  for (const { url, html } of fetchedPages) {
    addMatches(missing, extractStratagemSummaries(html, url));
  }

  let matched = 0;
  const lines = [
    "Wahapedia missing-stratagem coverage audit",
    "Only detachments with 0 current detachment stratagems were checked.",
    "This report records names/counts only; it does not import or overwrite rules text.",
    `Faction pages checked: ${factionUrls.length}`,
    ""
  ];

  for (const record of [...missing.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const stratagems = uniqueStratagems(record.matches);
    if (stratagems.length) matched += 1;
    lines.push(`${record.name}: ${stratagems.length}`);
    lines.push(`  Armies: ${[...new Set(record.armies)].join("; ")}`);
    if (stratagems.length) {
      lines.push(`  Source: ${stratagems[0].sourceUrl}`);
      for (const stratagem of stratagems) {
        lines.push(`  - ${stratagem.name}${stratagem.cpCost ? ` (${stratagem.cpCost}CP)` : ""}`);
      }
    }
  }

  lines.unshift(`Matched missing detachments: ${matched}/${missing.size}`);
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${lines.join("\n")}\n`);
  console.log(OUTPUT_PATH);
  console.log(`Matched missing detachments: ${matched}/${missing.size}`);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});

async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
