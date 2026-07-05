const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const BUILDER_UNITS_DIR = path.join(ROOT, "data", "builder-units");
const REPORT_FILE = path.join(ROOT, "leader-target-resolution-report.txt");

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

function normalizeName(name) {
  const normalized = String(name || "")
    .toLowerCase()
    .replace(/\[.*?\]/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/’/g, "'")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bsquad\b/g, "")
    .replace(/\bunit\b/g, "")
    .replace(/\bthe\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const aliases = {
    "hand of archon": "hand of archon kill team",
    "traitor guardsman": "traitor guardsmen",
    "legionaires": "legionaries",
    "sternguard veterans": "sternguard veteran",
    "wolfguard headtakers": "wolf guard headtakers",
    "storm guardian": "storm guardians",
    "plague bearers": "plaguebearers",
    "acolyte hybrids": "acolyte hybrid",
    "emperor s children terminator": "emperor s children terminators"
  };

  return aliases[normalized] || normalized;
}

function makeUnitRef(unit, file) {
  return {
    id: unit.id,
    name: unit.name,
    sourceFile: file,
    selectableInFaction: unit.selectableInFaction || null,
    sourceFaction: unit.sourceFaction || null
  };
}

function uniqueMatches(matches) {
  const seen = new Set();
  const out = [];

  for (const match of matches) {
    const key = [
      match.id,
      match.name,
      match.sourceFile,
      match.selectableInFaction,
      match.sourceFaction
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(match);
  }

  return out;
}

function pickBestMatch(matches, leaderUnit, leaderFile) {
  const unique = uniqueMatches(matches);

  if (unique.length === 0) return null;

  if (unique.length === 1) {
    return {
      match: unique[0],
      matchType: "exact-normalized"
    };
  }

  const sameSelectable = unique.filter(match =>
    match.selectableInFaction === leaderUnit.selectableInFaction
  );

  if (sameSelectable.length === 1) {
    return {
      match: sameSelectable[0],
      matchType: "same-selectable-faction"
    };
  }

  const sameFile = unique.filter(match =>
    match.sourceFile === leaderFile
  );

  if (sameFile.length === 1) {
    return {
      match: sameFile[0],
      matchType: "same-builder-file"
    };
  }

  const sameSourceFaction = unique.filter(match =>
    match.sourceFaction === leaderUnit.sourceFaction
  );

  if (sameSourceFaction.length === 1) {
    return {
      match: sameSourceFaction[0],
      matchType: "same-source-faction"
    };
  }

  return null;
}

function main() {
  const files = fs
    .readdirSync(BUILDER_UNITS_DIR)
    .filter(file => file.endsWith(".json"));

  const loadedFiles = [];
  const globalNameIndex = new Map();

  for (const file of files) {
    const fullPath = path.join(BUILDER_UNITS_DIR, file);
    const data = readJson(fullPath);
    const container = getUnitsContainer(data);

    loadedFiles.push({
      file,
      fullPath,
      data,
      container
    });

    for (const unit of container.units) {
      const key = normalizeName(unit.name);
      if (!key) continue;

      if (!globalNameIndex.has(key)) {
        globalNameIndex.set(key, []);
      }

      globalNameIndex.get(key).push(makeUnitRef(unit, file));
    }
  }

  const report = [];
  let unitsWithLeaderTargets = 0;
  let resolvedCount = 0;
  let unresolvedCount = 0;
  let ambiguousCount = 0;
  let filesChanged = 0;

  for (const loaded of loadedFiles) {
    let changedThisFile = false;

    for (const unit of loaded.container.units) {
      if (!Array.isArray(unit.leaderTargets) || unit.leaderTargets.length === 0) {
        continue;
      }

      unitsWithLeaderTargets++;

      const resolved = [];
      const unresolved = [];
      const ambiguous = [];

      for (const target of unit.leaderTargets) {
        const key = normalizeName(target);
        const matches = globalNameIndex.get(key) || [];
        const unique = uniqueMatches(matches);
        const best = pickBestMatch(unique, unit, loaded.file);

        if (best) {
          resolved.push({
            target,
            normalizedTarget: key,
            matchType: best.matchType,
            unit: best.match
          });
          resolvedCount++;
          continue;
        }

        if (unique.length > 1) {
          ambiguous.push({
            target,
            normalizedTarget: key,
            matches: unique
          });
          ambiguousCount++;
          continue;
        }

        unresolved.push({
          target,
          normalizedTarget: key
        });
        unresolvedCount++;
      }

      unit.leaderTargetsResolved = resolved;
      unit.leaderTargetsUnresolved = unresolved;
      unit.leaderTargetsAmbiguous = ambiguous;

      changedThisFile = true;

      if (unresolved.length || ambiguous.length) {
        report.push("");
        report.push("==================================================");
        report.push(`${unit.name} (${loaded.file})`);
        report.push("==================================================");

        if (unresolved.length) {
          report.push("Unresolved:");
          for (const item of unresolved) {
            report.push(`  - ${item.target} [${item.normalizedTarget}]`);
          }
        }

        if (ambiguous.length) {
          report.push("Ambiguous:");
          for (const item of ambiguous) {
            report.push(`  - ${item.target} [${item.normalizedTarget}]`);
            for (const match of item.matches) {
              report.push(`      -> ${match.name} (${match.sourceFile})`);
            }
          }
        }
      }
    }

    if (changedThisFile) {
      writeJson(loaded.fullPath, loaded.container.setUnits(loaded.container.units));
      filesChanged++;
    }
  }

  const header = [
    `Builder-unit files scanned: ${files.length}`,
    `Builder-unit files changed: ${filesChanged}`,
    `Units with leaderTargets: ${unitsWithLeaderTargets}`,
    `Resolved target refs: ${resolvedCount}`,
    `Unresolved target refs: ${unresolvedCount}`,
    `Ambiguous target refs: ${ambiguousCount}`,
    ""
  ];

  fs.writeFileSync(REPORT_FILE, header.concat(report).join("\n"), "utf8");

  console.log(header.join("\n"));
  console.log(`Report written: ${path.relative(ROOT, REPORT_FILE)}`);
}

main();