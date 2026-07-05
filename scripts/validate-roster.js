const fs = require("fs");
const path = require("path");

const rosterPath = process.argv[2];

if (!rosterPath) {
  console.log("Usage:");
  console.log("node scripts/validate-roster.js data/test-rosters/ROSTER.json");
  process.exit(1);
}

const roster = JSON.parse(fs.readFileSync(rosterPath, "utf8"));

const factionSlug = roster.faction
  .toLowerCase()
  .replaceAll(" ", "-")
  .replaceAll("'", "");

const rulesPath = path.join(
  process.cwd(),
  "data",
  "builder-rules",
  `${factionSlug}-builder-rules.json`
);

if (!fs.existsSync(rulesPath)) {
  console.log(`Rules file not found: ${rulesPath}`);
  process.exit(1);
}

const rulesData = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
const rulesByName = new Map();

for (const unit of rulesData.units) {
  rulesByName.set(unit.name, unit);
}

const counts = new Map();
let totalPoints = 0;
const errors = [];
const selectedUnits = [];

for (const rosterUnit of roster.units ?? []) {
  const name = rosterUnit.name;
  const rule = rulesByName.get(name);

  counts.set(name, (counts.get(name) ?? 0) + 1);

  if (!rule) {
    errors.push({
      type: "UNKNOWN_UNIT",
      unit: name,
      message: `${name} is not selectable in ${roster.faction}`
    });

    selectedUnits.push({
      name,
      points: null,
      status: "UNKNOWN"
    });

    continue;
  }

  totalPoints += rule.points;

  selectedUnits.push({
    name,
    points: rule.points,
    maxCopies: rule.maxCopies,
    status: "OK"
  });
}

if (
  typeof roster.pointsLimit === "number" &&
  totalPoints > roster.pointsLimit
) {
  errors.push({
    type: "POINTS_LIMIT_EXCEEDED",
    pointsLimit: roster.pointsLimit,
    totalPoints,
    message: `Roster is ${totalPoints} pts, limit is ${roster.pointsLimit} pts`
  });
}

for (const [name, count] of counts.entries()) {
  const rule = rulesByName.get(name);

  if (!rule) {
    continue;
  }

  if (count > rule.maxCopies) {
    errors.push({
      type: "COPY_LIMIT_EXCEEDED",
      unit: name,
      count,
      maxCopies: rule.maxCopies,
      message: `${name}: ${count} selected, max allowed is ${rule.maxCopies}`
    });
  }
}

console.log("========================================");
console.log("ROSTER VALIDATION");
console.log("========================================");
console.log(`Faction: ${roster.faction}`);
console.log(`Units selected: ${(roster.units ?? []).length}`);
console.log(`Total points: ${totalPoints}`);

if (typeof roster.pointsLimit === "number") {
  console.log(`Points limit: ${roster.pointsLimit}`);
}

console.log(`Errors: ${errors.length}`);

console.log("");
console.log("Selected units:");
for (const unit of selectedUnits) {
  if (unit.status === "UNKNOWN") {
    console.log(`- ${unit.name}: UNKNOWN`);
  } else {
    console.log(`- ${unit.name}: ${unit.points} pts`);
  }
}

for (const error of errors) {
  console.log("");
  console.log(`[${error.type}] ${error.message}`);
}

if (errors.length === 0) {
  console.log("");
  console.log("Roster passed validation.");
}