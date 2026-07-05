const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const BUILDER_UNITS_DIR = path.join(ROOT, "data", "builder-units");
const LEADER_FILE = path.join(ROOT, "data", "builder-rules", "leader-attachments-raw.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function getUnitsContainer(data) {
  if (Array.isArray(data)) {
    return {
      units: data,
      setUnits: units => units
    };
  }

  if (Array.isArray(data.units)) {
    return {
      units: data.units,
      setUnits: units => {
        data.units = units;
        return data;
      }
    };
  }

  if (Array.isArray(data.builderUnits)) {
    return {
      units: data.builderUnits,
      setUnits: units => {
        data.builderUnits = units;
        return data;
      }
    };
  }

  return {
    units: [],
    setUnits: () => data
  };
}

function main() {
  const leaderRecords = readJson(LEADER_FILE);

  const byProfileId = new Map();

  for (const record of leaderRecords) {
    if (!record.profileId) continue;

    byProfileId.set(record.profileId, {
      leaderTargetsRaw: record.rawText,
      leaderTargets: record.parsedTargets || [],
      leaderRestrictionsRaw: record.restrictionsRaw || []
    });
  }

  const files = fs
    .readdirSync(BUILDER_UNITS_DIR)
    .filter(file => file.endsWith(".json"));

  let filesChanged = 0;
  let unitsChanged = 0;

  for (const file of files) {
    const fullPath = path.join(BUILDER_UNITS_DIR, file);
    const data = readJson(fullPath);
    const container = getUnitsContainer(data);

    let changedThisFile = false;

    for (const unit of container.units) {
      const profiles = Array.isArray(unit.profiles) ? unit.profiles : [];

      const leaderProfile = profiles.find(profile =>
        profile &&
        profile.name === "Leader" &&
        byProfileId.has(profile.id)
      );

      if (!leaderProfile) continue;

      const leaderData = byProfileId.get(leaderProfile.id);

      unit.leaderProfileId = leaderProfile.id;
      unit.leaderTargetsRaw = leaderData.leaderTargetsRaw;
      unit.leaderTargets = leaderData.leaderTargets;
      unit.leaderRestrictionsRaw = leaderData.leaderRestrictionsRaw;

      changedThisFile = true;
      unitsChanged++;
    }

    if (changedThisFile) {
      writeJson(fullPath, container.setUnits(container.units));
      filesChanged++;
    }
  }

  console.log(`Builder-unit files scanned: ${files.length}`);
  console.log(`Builder-unit files changed: ${filesChanged}`);
  console.log(`Units given leaderTargets: ${unitsChanged}`);
}

main();