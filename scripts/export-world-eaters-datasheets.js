const fs = require("fs");
const { XMLParser } = require("fast-xml-parser");

const sourceFile =
  "E:/my own rosterbuilder/data/wh40K/wh40k-10e-main/wh40k-10e-main/Chaos - World Eaters.cat";

const outputFile =
  "E:/my own rosterbuilder/data/json/world-eaters-datasheets.json";

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

function getProfiles(entry) {
  return asArray(entry.profiles?.profile);
}

function getPoints(entry) {
  const costs = asArray(entry.costs?.cost);
  const pts = costs.find((c) => String(c["@_name"]).toLowerCase() === "pts");
  return pts ? Number(pts["@_value"]) : null;
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

function getUnitStats(entry) {
  const unitProfile = collectProfilesDeep(entry).find(
    (p) => p["@_typeName"] === "Unit"
  );

  return unitProfile ? characteristicsToObject(unitProfile) : null;
}

function getAbilities(entry) {
  return getProfiles(entry)
    .filter((p) => p["@_typeName"] === "Abilities")
    .map((p) => ({
      name: p["@_name"],
      text: characteristicsToObject(p).Description || "",
    }));
}

function getOtherAbilityProfiles(entry) {
  return getProfiles(entry)
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

function getWeaponsFromEntry(entry) {
  return getProfiles(entry)
    .filter((p) => String(p["@_typeName"]).includes("Weapons"))
    .map((p) => {
      const chars = characteristicsToObject(p);

      return {
        name: String(p["@_name"] || "").replace(/^➤\s*/, ""),
        type: p["@_typeName"],
        range: chars.Range ?? "",
        A: chars.A ?? "",
        BS: chars.BS ?? "",
        WS: chars.WS ?? "",
        S: chars.S ?? "",
        AP: chars.AP ?? "",
        D: chars.D ?? "",
        keywords: chars.Keywords ?? "",
      };
    });
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

  weapons.push(...getWeaponsFromEntry(entry));

  for (const child of asArray(entry.selectionEntries?.selectionEntry)) {
    weapons.push(...getWeaponsFromEntry(child));
  }

  for (const link of collectEntryLinksDeep(entry)) {
    const targetId = link["@_targetId"];
    if (!targetId) continue;

    const target = entriesById.get(targetId);
    if (!target) continue;

    weapons.push(...getWeaponsFromEntry(target));
  }

  for (const link of collectInfoLinksDeep(entry)) {
    if (link["@_type"] !== "profile") continue;

    const targetId = link["@_targetId"];
    if (!targetId) continue;

    const profile = profilesById.get(targetId);
    if (!profile) continue;

    if (!String(profile["@_typeName"]).includes("Weapons")) continue;

    weapons.push(
      ...getWeaponsFromEntry({
        "@_name": link["@_name"],
        profiles: { profile },
      })
    );
  }

  return dedupeWeapons(weapons);
}

const xml = fs.readFileSync(sourceFile, "utf8");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

const data = parser.parse(xml);
const catalogue = data.catalogue;

const entries = asArray(catalogue.sharedSelectionEntries?.selectionEntry);
const sharedProfiles = asArray(catalogue.sharedProfiles?.profile);

const entriesById = new Map();
const profilesById = new Map();

for (const entry of entries) {
  entriesById.set(entry["@_id"], entry);
}

for (const profile of sharedProfiles) {
  profilesById.set(profile["@_id"], profile);
}

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