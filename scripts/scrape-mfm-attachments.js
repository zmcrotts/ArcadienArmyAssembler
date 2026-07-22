"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const INDEX_URL = "https://mfm.warhammer-community.com/en";
const OUT = path.join(ROOT, "data", "manual-rules", "wh40k-11e-mfm-attachments.json");

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)));
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseFactionLinks(html) {
  const links = [];
  const seen = new Set();
  const pattern = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  for (const match of html.matchAll(pattern)) {
    const name = stripTags(match[2]);
    if (!name || /warhammer 40,?000 logo/i.test(name)) continue;
    const url = new URL(match[1], INDEX_URL).toString();
    if (!url.startsWith(`${INDEX_URL}/`)) continue;
    const slug = url.slice(`${INDEX_URL}/`.length);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    links.push({ name, slug, url });
  }
  return links;
}

function parseTargets(value) {
  return stripTags(value)
    .split(/\s*,\s*/)
    .map(item => item.trim())
    .filter(Boolean);
}

function parseUnitAttachments(html) {
  const cards = html.split('<div class="flex flex-col space-y-1 m-1 print:break-inside-avoid-page">').slice(1);
  const records = [];
  for (const card of cards) {
    const nameMatch = card.match(/font-bold text-xl text-white">([\s\S]*?)<\/div>/);
    const unitName = stripTags(nameMatch?.[1]);
    if (!unitName) continue;

    const rolePattern = /<span>(LEADER|SUPPORT)<\/span>[\s\S]*?<span class="font-bold">([\s\S]*?)<\/span>/g;
    for (const roleMatch of card.matchAll(rolePattern)) {
      const role = roleMatch[1];
      const targets = parseTargets(roleMatch[2]);
      if (!targets.length) continue;
      records.push({ unitName, role, targets });
    }
  }
  return records;
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.text();
}

async function main() {
  const indexHtml = await fetchText(INDEX_URL);
  const factions = [];
  for (const faction of parseFactionLinks(indexHtml)) {
    const html = await fetchText(faction.url);
    const attachments = parseUnitAttachments(html);
    factions.push({ ...faction, attachments });
    console.log(`${faction.name}: ${attachments.length} attachment records`);
  }

  const attachmentCount = factions.reduce((total, faction) => total + faction.attachments.length, 0);
  if (attachmentCount < 100) {
    throw new Error(
      `Parsed only ${attachmentCount} MFM attachment records. ` +
      "GW's streamed page markup is not compatible with the raw HTML parser; refusing to overwrite the current data."
    );
  }

  const payload = {
    schemaVersion: 1,
    source: INDEX_URL,
    generatedAt: new Date().toISOString(),
    factions
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${OUT}`);
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
