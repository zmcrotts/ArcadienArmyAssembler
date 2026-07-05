"use strict";

const fs = require("fs");
const path = require("path");

const defaultLevelDb = path.join(
  process.env.APPDATA || "",
  "Codex",
  "web",
  "Codex",
  "Default",
  "Partitions",
  "codex-browser-app",
  "Local Storage",
  "leveldb"
);

const sourceDir = process.argv[2] || defaultLevelDb;
const outputPath = process.argv[3] || path.join(process.cwd(), "release", "web-ui-roster-library.json");

function findJsonAfter(text, marker, opener) {
  const results = [];
  let markerIndex = text.indexOf(marker);
  while (markerIndex >= 0) {
    const start = text.indexOf(opener, markerIndex + marker.length);
    if (start >= 0) {
      const close = opener === "[" ? "]" : "}";
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let index = start; index < text.length; index += 1) {
        const char = text[index];
        if (escape) {
          escape = false;
          continue;
        }
        if (char === "\\") {
          escape = true;
          continue;
        }
        if (char === "\"") {
          inString = !inString;
          continue;
        }
        if (inString) continue;
        if (char === opener) depth += 1;
        if (char === close) depth -= 1;
        if (depth === 0) {
          const candidate = text.slice(start, index + 1);
          try {
            results.push(JSON.parse(candidate));
          } catch {
            // LevelDB files can contain old, partial, or compacted records.
          }
          break;
        }
      }
    }
    markerIndex = text.indexOf(marker, markerIndex + marker.length);
  }
  return results;
}

function rosterRecordsFrom(input) {
  if (!Array.isArray(input)) return [];
  return input.filter(record => record?.document?.faction && record?.document?.armyState);
}

function main() {
  if (!fs.existsSync(sourceDir)) throw new Error(`Storage folder not found: ${sourceDir}`);

  const candidates = [];
  for (const file of fs.readdirSync(sourceDir)) {
    if (!/\.(ldb|log|manifest)$/i.test(file) && !/^MANIFEST-/i.test(file)) continue;
    const fullPath = path.join(sourceDir, file);
    const buffer = fs.readFileSync(fullPath);
    for (const text of [buffer.toString("utf8"), buffer.toString("utf16le")]) {
      for (const parsed of findJsonAfter(text, "engineRosterSaves", "[")) {
        const records = rosterRecordsFrom(parsed);
        if (records.length) candidates.push({ file, records });
      }
    }
  }

  if (!candidates.length) throw new Error("No engineRosterSaves records found.");

  candidates.sort((a, b) => JSON.stringify(b.records).length - JSON.stringify(a.records).length);
  const best = candidates[0];
  const library = {
    kind: "roster-engine.savedRosterLibrary",
    exportedAt: new Date().toISOString(),
    source: sourceDir,
    engineRosterSaves: best.records
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(library, null, 2));
  console.log(`Extracted ${best.records.length} saved roster${best.records.length === 1 ? "" : "s"} from ${best.file}`);
  console.log(outputPath);
}

main();
