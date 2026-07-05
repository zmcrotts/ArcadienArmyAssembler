const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const ROOT = path.resolve(__dirname, "..");
const INPUT = path.join(ROOT, "data", "overrides", "11th", "warhammer_points_changes_by_faction.xlsx");
const OUT = path.join(ROOT, "data", "overrides", "11th", "points-overrides.json");

function clean(value) {
  return String(value ?? "").trim();
}

function parseDelta(...parts) {
  const text = parts.map(clean).filter(Boolean).join(" ");
  const matches = [...text.matchAll(/([+-]\d+)/g)];
  if (!matches.length) return null;
  return Number(matches[matches.length - 1][1]);
}

function isHeaderRow(a, b, c, d) {
  const joined = [a, b, c, d].map(clean).join("|").toLowerCase();
  return (
    joined.includes("unit") &&
    joined.includes("type")
  );
}

function ensureUnit(factionData, unitName) {
  if (!factionData.units[unitName]) {
    factionData.units[unitName] = {
      changes: [],
      wargear: [],
      copyRules: []
    };
  }
}

function main() {
  if (!fs.existsSync(INPUT)) {
    console.error(`Missing workbook: ${INPUT}`);
    process.exit(1);
  }

  const workbook = XLSX.readFile(INPUT);

  const overrides = {
    sourceFile: path.relative(ROOT, INPUT),
    generatedAt: new Date().toISOString(),
    factions: {}
  };

  for (const sheetName of workbook.SheetNames) {
    if (sheetName.toLowerCase() === "summary") continue;

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      blankrows: false,
      defval: ""
    });

    const factionData = { units: {} };
    let currentUnit = null;

    for (const row of rows) {
      const unitCell = clean(row[0]);
      const detailCell = clean(row[1]);
      const deltaCell = clean(row[2]);
      const typeCell = clean(row[3]);

      if (!unitCell && !detailCell && !deltaCell && !typeCell) continue;
      if (isHeaderRow(unitCell, detailCell, deltaCell, typeCell)) continue;

      if (unitCell) {
        currentUnit = unitCell;
        ensureUnit(factionData, currentUnit);
      }

      if (!currentUnit) continue;

      const text = [detailCell, deltaCell].filter(Boolean).join(" ");
      const type = typeCell || "Change";
      const delta = parseDelta(detailCell, deltaCell, typeCell);

      if (!text && typeCell.toLowerCase() === "unit") continue;
      if (!text && !typeCell) continue;

      const record = {
        text,
        delta,
        type
      };

      const lowerText = `${text} ${type}`.toLowerCase();

      if (lowerText.includes("wargear")) {
        factionData.units[currentUnit].wargear.push(record);
      } else if (
        lowerText.includes("2nd") ||
        lowerText.includes("3rd") ||
        lowerText.includes("second") ||
        lowerText.includes("third") ||
        lowerText.includes("copy")
      ) {
        factionData.units[currentUnit].copyRules.push(record);
      } else {
        factionData.units[currentUnit].changes.push(record);
      }
    }

    const usedUnits = Object.fromEntries(
      Object.entries(factionData.units).filter(([_, value]) =>
        value.changes.length || value.wargear.length || value.copyRules.length
      )
    );

    if (Object.keys(usedUnits).length) {
      overrides.factions[sheetName] = { units: usedUnits };
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(overrides, null, 2), "utf8");

  console.log(`Wrote ${OUT}`);
  console.log(`Factions: ${Object.keys(overrides.factions).length}`);

  let unitCount = 0;
  let changeCount = 0;
  let wargearCount = 0;
  let copyRuleCount = 0;

  for (const faction of Object.values(overrides.factions)) {
    unitCount += Object.keys(faction.units).length;

    for (const unit of Object.values(faction.units)) {
      changeCount += unit.changes.length;
      wargearCount += unit.wargear.length;
      copyRuleCount += unit.copyRules.length;
    }
  }

  console.log(`Units with overrides: ${unitCount}`);
  console.log(`Change rows: ${changeCount}`);
  console.log(`Wargear rows: ${wargearCount}`);
  console.log(`Copy rule rows: ${copyRuleCount}`);
}

main();