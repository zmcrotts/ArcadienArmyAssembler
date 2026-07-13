"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = "https://gdmissions.app";
const INDEX_PATH = "/11th/secondary-missions";
const OUTPUT_ROOT = path.join(__dirname, "..", "ui", "assets", "11th", "secondary-missions");

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

function unique(values) {
  return [...new Set(values)];
}

function cardLinksFromIndex(html) {
  return unique([...html.matchAll(/href="(\/11th\/secondary-missions\/[^"]+)"/g)]
    .map(match => match[1])
    .filter(href => href !== INDEX_PATH));
}

function titleFromPage(html, fallback) {
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1] || fallback;
  return title
    .replace(/\s+-\s+[^|]+Secondary\s+\|\s+GDM 2026$/i, "")
    .replace(/\s+\|\s+GDM 2026$/i, "")
    .trim();
}

function cardImagePathFromPage(html, cardSlug) {
  const direct = html.match(/\/assets\/11th\/secondary-missions\/[^"\\]+\.png/);
  if (direct) return direct[0];
  const escaped = html.match(new RegExp(`/assets/11th/secondary-missions/[^"]+${cardSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"]+\\.png`));
  if (escaped) return escaped[0];
  throw new Error(`Missing secondary card image path for ${cardSlug}`);
}

async function downloadAsset(assetPath) {
  const relative = assetPath.replace(/^\/assets\/11th\/secondary-missions\//, "");
  const outputPath = path.join(OUTPUT_ROOT, relative);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const buffer = await get(`${ROOT}${assetPath}`);
  fs.writeFileSync(outputPath, buffer);
  return assetPath.replace("/assets/", "assets/");
}

async function main() {
  const indexHtml = (await get(`${ROOT}${INDEX_PATH}`)).toString("utf8");
  const links = cardLinksFromIndex(indexHtml);
  if (!links.length) throw new Error("No secondary mission links found.");

  const cards = [];
  for (const href of links) {
    const pageHtml = (await get(`${ROOT}${href}`)).toString("utf8");
    const pageSlug = href.split("/").pop();
    const imagePath = cardImagePathFromPage(pageHtml, pageSlug);
    const [, role, imageFile] = imagePath.match(/secondary-missions\/([^/]+)\/([^/]+)\.png$/) || [];
    const image = await downloadAsset(imagePath);
    cards.push({
      title: titleFromPage(pageHtml, pageSlug),
      pageSlug,
      cardSlug: imageFile || pageSlug.replace(/-[^-]+$/, ""),
      role: role || null,
      pagePath: href,
      image
    });
  }

  const manifestPath = path.join(OUTPUT_ROOT, "manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify({ cards }, null, 2)}\n`);
  console.log(`Downloaded ${cards.length} secondary mission cards.`);
  console.log(`Wrote ${manifestPath}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
