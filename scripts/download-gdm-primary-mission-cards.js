"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = "https://gdmissions.app";
const OUTPUT_ROOT = path.join(__dirname, "..", "ui", "assets", "11th", "primary-missions");

const MISSION_MAP = {
  "take-and-hold": [
    "battlefield-dominance",
    "determined-acquisition",
    "immovable-object",
    "inescapable-dominion",
    "purge-and-secure"
  ],
  "purge-the-foe": [
    "consecrate",
    "destroyers-wrath",
    "meatgrinder",
    "punishment",
    "unstoppable-force"
  ],
  reconnaissance: [
    "gather-intel",
    "reconnaissance-sweep",
    "search-and-scour",
    "surveil-the-foe",
    "triangulation"
  ],
  "priority-assets": [
    "extract-relic",
    "sabotage",
    "secure-asset",
    "vanguard-operation",
    "vital-link"
  ],
  disruption: [
    "death-trap",
    "delaying-action",
    "locate-and-deny",
    "outmanoeuvre",
    "smoke-and-mirrors"
  ]
};

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`${response.statusCode} ${url}`));
        return;
      }
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
}

function findCardImagePaths(html, deck, card) {
  const front = `/assets/11th/primary-missions/${deck}/${card}.png`;
  const escapedFront = front.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const backMatch = html.match(new RegExp(`\\\\"back\\\\":\\\\"([^"]+${card}[^"]+\\.png)\\\\"`))
    || html.match(new RegExp(`"back":"([^"]+${card}[^"]+\\.png)"`));
  const hasFront = new RegExp(escapedFront).test(html);
  if (!hasFront) throw new Error(`Missing front image path in page data for ${deck}/${card}`);
  return {
    front,
    back: backMatch ? backMatch[1] : null
  };
}

async function downloadAsset(assetPath) {
  const relative = assetPath.replace(/^\/assets\/11th\/primary-missions\//, "");
  const outputPath = path.join(OUTPUT_ROOT, relative);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const buffer = await get(`${ROOT}${assetPath}`);
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

async function main() {
  const manifest = {};
  for (const [deck, cards] of Object.entries(MISSION_MAP)) {
    manifest[deck] = {};
    for (const card of cards) {
      const pageUrl = `${ROOT}/11th/primary-missions/${deck}/${card}`;
      const html = (await get(pageUrl)).toString("utf8");
      const images = findCardImagePaths(html, deck, card);
      await downloadAsset(images.front);
      if (images.back) await downloadAsset(images.back);
      manifest[deck][card] = {
        front: images.front.replace("/assets/", "assets/"),
        back: images.back ? images.back.replace("/assets/", "assets/") : null
      };
    }
  }

  const manifestPath = path.join(OUTPUT_ROOT, "manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${manifestPath}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
