const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const BUILDER_UNITS_DIR = path.join(ROOT, "data", "builder-units");

const TARGETS = [
  "Broodlord",
  "Hive Tyrant",
  "Captain",
  "Archon",
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function walk(value, pathParts = [], hits = []) {
  if (value == null) return hits;

  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (
      lower.includes("leader") ||
      lower.includes("attach") ||
      lower.includes("attached") ||
      lower.includes("bodyguard") ||
      lower.includes("can be attached") ||
      lower.includes("can attach") ||
      lower.includes("this model can")
    ) {
      hits.push({
        path: pathParts.join("."),
        value,
      });
    }
    return hits;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walk(item, [...pathParts, `[${index}]`], hits);
    });
    return hits;
  }

  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      walk(child, [...pathParts, key], hits);
    }
  }

  return hits;
}

function loadAllUnits() {
  const files = fs
    .readdirSync(BUILDER_UNITS_DIR)
    .filter((file) => file.endsWith(".json"));

  const allUnits = [];

  for (const file of files) {
    const filePath = path.join(BUILDER_UNITS_DIR, file);
    const data = readJson(filePath);

    if (Array.isArray(data)) {
      for (const unit of data) {
        allUnits.push({ file, unit });
      }
    } else if (Array.isArray(data.units)) {
      for (const unit of data.units) {
        allUnits.push({ file, unit });
      }
    } else {
      console.warn(`Skipping unknown shape: ${file}`);
    }
  }

  return allUnits;
}

function unitName(unit) {
  return unit.name || unit.unitName || unit.displayName || unit.id || "(unnamed)";
}

function main() {
  const allUnits = loadAllUnits();

  for (const target of TARGETS) {
    const matches = allUnits.filter(({ unit }) => unitName(unit) === target);

    console.log("\n" + "=".repeat(80));
    console.log(target);
    console.log("=".repeat(80));

    if (matches.length === 0) {
      console.log("NOT FOUND");
      continue;
    }

    for (const { file, unit } of matches) {
      console.log(`\nFile: ${file}`);
      console.log(`Name: ${unitName(unit)}`);
      console.log(`Points: ${unit.points ?? "(none)"}`);
      console.log(`Keys: ${Object.keys(unit).join(", ")}`);

      const hits = walk(unit);

      if (hits.length === 0) {
        console.log("\nNo obvious attachment/leader text found in normalized unit.");
      } else {
        console.log("\nPossible attachment/leader hits:");
        for (const hit of hits) {
          console.log(`- ${hit.path}: ${hit.value}`);
        }
      }

      console.log("\nTop-level preview:");
      console.log(JSON.stringify(unit, null, 2).slice(0, 5000));
    }
  }
}

main();