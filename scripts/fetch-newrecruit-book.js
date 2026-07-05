"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join(ROOT, "data", "rulesets", "wh40k-11e-newrecruit", "stratagems.json");
const DEFAULT_SYSTEM_ID = "827374861";
const DEFAULT_BOOK_ID = "105";
const API_URL = "https://www.newrecruit.eu/api/rpc";

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = https.request(url, {
      method: "POST",
      headers: {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }
    }, response => {
      let data = "";
      response.setEncoding("utf8");
      response.on("data", chunk => {
        data += chunk;
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`New Recruit API returned HTTP ${response.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(new Error(`New Recruit API returned invalid JSON: ${error.message}`));
        }
      });
    });
    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

async function main() {
  const systemId = argValue("--system-id", DEFAULT_SYSTEM_ID);
  const bookId = argValue("--book-id", DEFAULT_BOOK_ID);
  const out = path.resolve(argValue("--out", DEFAULT_OUT));
  const row = await postJson(API_URL, {
    method: "books_get_book_row",
    params: [systemId, bookId, null]
  });

  if (row?.error) throw new Error(`New Recruit API error: ${JSON.stringify(row)}`);
  if (!row?.content) throw new Error("New Recruit book row did not include content.");

  const content = JSON.parse(row.content);
  const { content: _content, ...metadata } = row;
  const document = {
    schemaVersion: 1,
    source: "newrecruit-api",
    fetchedAt: new Date().toISOString(),
    request: {
      apiUrl: API_URL,
      method: "books_get_book_row",
      params: [systemId, bookId, null]
    },
    metadata,
    data: content.data || {}
  };

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(document, null, 2) + "\n", "utf8");

  console.log(`Wrote ${out}`);
  console.log(`Book: ${metadata.name} v${metadata.nrversion}`);
  console.log(`Stratagems: ${Array.isArray(document.data.stratagems) ? document.data.stratagems.length : 0}`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
