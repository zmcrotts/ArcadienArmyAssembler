const fs = require("fs");
const path = require("path");

const inputDir = path.join(process.cwd(), "data", "builder-units");
const outputDir = path.join(process.cwd(), "data", "builder-rules");

fs.mkdirSync(outputDir, { recursive: true });

function loadUnits(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Array.isArray(data) ? data : data.units;
}

function hasCategory(unit, categoryName) {
  return (unit.categories ?? []).some((category) => {
    const name = typeof category === "string" ? category : category.name;
    return name?.toLowerCase() === categoryName.toLowerCase();
  });
}

function hasNamedInfoLink(unit, name) {
  return (unit.infoLinks ?? []).some(
    (link) => link.name?.toLowerCase() === name.toLowerCase()
  );
}

function hasNamedProfile(unit, name) {
  return (unit.profiles ?? []).some(
    (profile) => profile.name?.toLowerCase() === name.toLowerCase()
  );
}

function isLeader(unit) {
  return hasNamedInfoLink(unit, "Leader") || hasNamedProfile(unit, "Leader");
}

function classifyUnit(unit) {
  return {
    id: unit.id,
    name: unit.name,
    points: unit.points,

    battleline: hasCategory(unit, "Battleline"),
    epicHero: hasCategory(unit, "Epic Hero"),
    character: hasCategory(unit, "Character"),
    leader: isLeader(unit),
    dedicatedTransport: hasCategory(unit, "Dedicated Transport"),

    vehicle: hasCategory(unit, "Vehicle"),
    monster: hasCategory(unit, "Monster"),
    infantry: hasCategory(unit, "Infantry"),
    mounted: hasCategory(unit, "Mounted"),
    swarm: hasCategory(unit, "Swarm"),
    fortification: hasCategory(unit, "Fortification"),

    sourceFaction: unit.sourceFaction,
    selectableInFaction: unit.selectableInFaction,

    maxCopies: getDefaultMaxCopies(unit)
  };
}

function getDefaultMaxCopies(unit) {
  if (hasCategory(unit, "Epic Hero")) return 1;
  if (hasCategory(unit, "Battleline")) return 6;
  return 3;
}

let totalFiles = 0;
let totalUnits = 0;

for (const file of fs.readdirSync(inputDir)) {
  if (!file.endsWith(".json")) continue;

  const units = loadUnits(path.join(inputDir, file));

  if (!Array.isArray(units)) {
    continue;
  }

  const classified = units.map(classifyUnit);

  const output = {
    sourceFile: file,
    unitCount: classified.length,
    units: classified
  };

  const outFile = file.replace("-builder-units.json", "-builder-rules.json");

  fs.writeFileSync(
    path.join(outputDir, outFile),
    JSON.stringify(output, null, 2)
  );

  totalFiles++;
  totalUnits += classified.length;

  console.log(`${file} -> ${outFile}: ${classified.length} units`);
}

console.log("");
console.log(`Done. ${totalFiles} files processed, ${totalUnits} units classified.`);