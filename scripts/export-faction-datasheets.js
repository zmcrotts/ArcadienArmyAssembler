const fs = require("fs");
const path = require("path");
const { XMLParser } = require("fast-xml-parser");

const bsDataDir =
  "E:/my own rosterbuilder/data/wh40K/wh40k-10e-main/wh40k-10e-main";

const factionFile = process.argv[2];

if (!factionFile) {
  console.error('Usage: node .\\scripts\\export-faction-datasheets.js "<faction>.cat"');
  process.exit(1);
}

const sourceFile = path.join(bsDataDir, factionFile);

const outputName = factionFile
  .replace(/\.cat$/i, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

const outputFile =
  `E:/my own rosterbuilder/data/json/${outputName}-datasheets.json`;

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function characteristicsToObject(profile) {
  const chars = asArray(profile.characteristics?.characteristic);
  const obj = {};

  for (const c of chars) {
    obj[c["@_name"]] = c["#text"] ?? "";
  }

  return obj;
}

function collectProfilesDeep(obj, profiles = []) {
  if (!obj || typeof obj !== "object") return profiles;

  if (obj.profiles?.profile) {
    profiles.push(...asArray(obj.profiles.profile));
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      if (Array.isArray(value)) {
        for (const item of value) collectProfilesDeep(item, profiles);
      } else {
        collectProfilesDeep(value, profiles);
      }
    }
  }

  return profiles;
}

function getProfiles(entry) {
  return asArray(entry.profiles?.profile);
}

function getPoints(entry) {
  const costs = asArray(entry.costs?.cost);
  const pts = costs.find((c) => String(c["@_name"]).toLowerCase() === "pts");
  return pts ? Number(pts["@_value"]) : null;
}

function getUnitStats(entry) {
  const unitProfile = collectProfilesDeep(entry).find(
    (p) => p["@_typeName"] === "Unit"
  );

  return unitProfile ? characteristicsToObject(unitProfile) : null;
}

function getAbilities(entry) {
  return collectProfilesDeep(entry)
    .filter((p) => p["@_typeName"] === "Abilities")
    .map((p) => ({
      name: p["@_name"],
      text: characteristicsToObject(p).Description || "",
    }));
}

function getOtherAbilityProfiles(entry) {
  return collectProfilesDeep(entry)
    .filter((p) => {
      const typeName = p["@_typeName"];
      return (
        typeName &&
        typeName !== "Unit" &&
        typeName !== "Abilities" &&
        !typeName.includes("Weapons")
      );
    })
    .map((p) => {
      const chars = characteristicsToObject(p);

      return {
        name: p["@_name"],
        type: p["@_typeName"],
        text: chars.Description || chars.Effect || "",
      };
    });
}

function getKeywords(entry) {
  return asArray(entry.categoryLinks?.categoryLink)
    .filter((l) => l["@_hidden"] !== "true")
    .map((l) => l["@_name"])
    .filter(Boolean)
    .filter((name) => !name.startsWith("Faction:"));
}

function getRules(entry) {
  return asArray(entry.infoLinks?.infoLink)
    .filter((l) => l["@_type"] === "rule")
    .map((l) => {
      let name = l["@_name"];

      const modifier = l.modifiers?.modifier;
      if (modifier?.["@_type"] === "append" && modifier?.["@_field"] === "name") {
        name = `${name} ${modifier["@_value"]}`;
      }

      return name;
    })
    .filter(Boolean);
}

function weaponFromProfile(profile) {
  const chars = characteristicsToObject(profile);

  return {
    name: String(profile["@_name"] || "").replace(/^➤\s*/, ""),
    type: profile["@_typeName"],
    range: chars.Range ?? "",
    A: chars.A ?? "",
    BS: chars.BS ?? "",
    WS: chars.WS ?? "",
    S: chars.S ?? "",
    AP: chars.AP ?? "",
    D: chars.D ?? "",
    keywords: chars.Keywords ?? "",
  };
}

function getWeaponsFromEntry(entry) {
  return collectProfilesDeep(entry)
    .filter((p) => String(p["@_typeName"]).includes("Weapons"))
    .map(weaponFromProfile);
}

function collectEntryLinksDeep(obj, links = []) {
  if (!obj || typeof obj !== "object") return links;

  if (obj.entryLinks?.entryLink) {
    links.push(...asArray(obj.entryLinks.entryLink));
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      if (Array.isArray(value)) {
        for (const item of value) collectEntryLinksDeep(item, links);
      } else {
        collectEntryLinksDeep(value, links);
      }
    }
  }

  return links;
}

function collectInfoLinksDeep(obj, links = []) {
  if (!obj || typeof obj !== "object") return links;

  if (obj.infoLinks?.infoLink) {
    links.push(...asArray(obj.infoLinks.infoLink));
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      if (Array.isArray(value)) {
        for (const item of value) collectInfoLinksDeep(item, links);
      } else {
        collectInfoLinksDeep(value, links);
      }
    }
  }

  return links;
}

function dedupeWeapons(weapons) {
  const unique = new Map();

  for (const weapon of weapons) {
    const key = [
      weapon.name,
      weapon.type,
      weapon.range,
      weapon.A,
      weapon.BS,
      weapon.WS,
      weapon.S,
      weapon.AP,
      weapon.D,
      weapon.keywords,
    ].join("|");

    unique.set(key, weapon);
  }

  return [...unique.values()];
}

function getWeapons(entry, entriesById, profilesById) {
  const weapons = [];

  // Any weapon profile directly or deeply nested under this datasheet
  weapons.push(...getWeaponsFromEntry(entry));

  // Linked shared selection entries, now resolved globally
  for (const link of collectEntryLinksDeep(entry)) {
    const targetId = link["@_targetId"];
    if (!targetId) continue;

    const target = entriesById.get(targetId);
    if (!target) continue;

    weapons.push(...getWeaponsFromEntry(target));
  }

  // Linked shared profiles, now resolved globally
  for (const link of collectInfoLinksDeep(entry)) {
    if (link["@_type"] !== "profile") continue;

    const targetId = link["@_targetId"];
    if (!targetId) continue;

    const profile = profilesById.get(targetId);
    if (!profile) continue;

    if (!String(profile["@_typeName"]).includes("Weapons")) continue;

    weapons.push(weaponFromProfile(profile));
  }

  return dedupeWeapons(weapons);
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

// Build GLOBAL indexes from every .cat file
const entriesById = new Map();
const profilesById = new Map();

const catFiles = fs
  .readdirSync(bsDataDir)
  .filter((file) => file.toLowerCase().endsWith(".cat"));

for (const catFile of catFiles) {
  const catPath = path.join(bsDataDir, catFile);
  const xml = fs.readFileSync(catPath, "utf8");
  const parsed = parser.parse(xml);
  const cat = parsed.catalogue;

  for (const entry of asArray(cat.sharedSelectionEntries?.selectionEntry)) {
    entriesById.set(entry["@_id"], entry);
  }

  for (const profile of asArray(cat.sharedProfiles?.profile)) {
    profilesById.set(profile["@_id"], profile);
  }
}

// Parse requested faction
const xml = fs.readFileSync(sourceFile, "utf8");
const data = parser.parse(xml);
const catalogue = data.catalogue;

const entries = asArray(catalogue.sharedSelectionEntries?.selectionEntry);

const datasheets = entries
  .filter((entry) => {
    const type = entry["@_type"];
    const points = getPoints(entry);
    const stats = getUnitStats(entry);

    return (
      (type === "unit" || type === "model") &&
      stats &&
      points !== null &&
      points > 0
    );
  })
  .map((entry) => ({
    id: entry["@_id"],
    name: entry["@_name"],
    type: entry["@_type"],
    points: getPoints(entry),
    stats: getUnitStats(entry),
    keywords: getKeywords(entry),
    rules: getRules(entry),
    abilities: [...getAbilities(entry), ...getOtherAbilityProfiles(entry)],
    weapons: getWeapons(entry, entriesById, profilesById),
  }));

const exportData = {
  faction: catalogue["@_name"],
  catalogueId: catalogue["@_id"],
  sourceRevision: catalogue["@_revision"],
  generatedAt: new Date().toISOString(),
  datasheetCount: datasheets.length,
  datasheets,
};

fs.writeFileSync(outputFile, JSON.stringify(exportData, null, 2));

console.log(`Exported ${datasheets.length} datasheets`);
console.log(outputFile);