const fs = require("fs");
const path = require("path");

const dir = path.join(process.cwd(), "data", "builder-units");

const files = fs.readdirSync(dir).filter((file) => file.endsWith(".json"));

const report = {
  files: 0,
  totalUnits: 0,
  zeroPoints: [],
  referenceUnits: [],
  noComposition: [],
  noUnitProfile: []
};

function loadUnits(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Array.isArray(data) ? data : data.units;
}

function hasUnitProfile(unit) {
  return Array.isArray(unit.profiles)
    && unit.profiles.some((profile) => profile.typeName === "Unit");
}

for (const file of files) {
  const fullPath = path.join(dir, file);
  const units = loadUnits(fullPath);

  if (!Array.isArray(units)) {
    console.log(`Skipping ${file}: no units array`);
    continue;
  }

  report.files++;

  for (const unit of units) {
    report.totalUnits++;

    const item = {
      file,
      name: unit.name,
      points: unit.points,
      categories: unit.categories ?? []
    };

    if (!unit.points || unit.points === 0) {
      report.zeroPoints.push(item);
    }

    if ((unit.categories ?? []).includes("Reference")) {
      report.referenceUnits.push(item);
    }

    if (!Array.isArray(unit.composition) || unit.composition.length === 0) {
      report.noComposition.push(item);
    }

    if (!hasUnitProfile(unit)) {
      report.noUnitProfile.push(item);
    }
  }
}

console.log("========================================");
console.log("BUILDER DATA QUALITY REPORT");
console.log("========================================");
console.log(`Files processed: ${report.files}`);
console.log(`Total units:     ${report.totalUnits}`);
console.log(`Zero points:     ${report.zeroPoints.length}`);
console.log(`Reference units: ${report.referenceUnits.length}`);
console.log(`No composition:  ${report.noComposition.length}`);
console.log(`No Unit profile: ${report.noUnitProfile.length}`);

function printSection(title, rows) {
  console.log("\n========================================");
  console.log(title);
  console.log("========================================");

  for (const row of rows.slice(0, 100)) {
    console.log(`${row.file} | ${row.name} | ${row.points}`);
  }

  if (rows.length > 100) {
    console.log(`...and ${rows.length - 100} more`);
  }
}

printSection("ZERO POINTS", report.zeroPoints);
printSection("REFERENCE UNITS", report.referenceUnits);
printSection("NO COMPOSITION", report.noComposition);
printSection("NO UNIT PROFILE", report.noUnitProfile);
