const fs = require("fs");
const { XMLParser } = require("fast-xml-parser");

const sourceFile =
  "E:/my own rosterbuilder/data/wh40K/wh40k-10e-main/wh40k-10e-main/Chaos - World Eaters.cat";

const unitName = process.argv[2] || "Khorne Berzerkers";

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

function getWeaponsFromEntry(entry) {
  return getProfiles(entry)
    .filter((p) => String(p["@_typeName"]).includes("Weapons"))
    .map((p) => {
      const chars = characteristicsToObject(p);

      return {
        sourceEntry: entry["@_name"],
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

const unit = entries.find((entry) => entry["@_name"] === unitName);

if (!unit) {
  console.error(`Could not find unit: ${unitName}`);
  process.exit(1);
}

const entryLinks = collectEntryLinksDeep(unit);
const infoLinks = collectInfoLinksDeep(unit);

const resolvedWeapons = [];

// Resolve linked shared selection entries, e.g. Chainblade, Bolt pistol, Eviscerator
for (const link of entryLinks) {
  const targetId = link["@_targetId"];
  if (!targetId) continue;

  const target = entriesById.get(targetId);
  if (!target) continue;

  resolvedWeapons.push(...getWeaponsFromEntry(target));
}

// Resolve linked shared profiles, e.g. Plasma pistol standard/supercharge
for (const link of infoLinks) {
  if (link["@_type"] !== "profile") continue;

  const targetId = link["@_targetId"];
  if (!targetId) continue;

  const profile = profilesById.get(targetId);
  if (!profile) continue;

  if (!String(profile["@_typeName"]).includes("Weapons")) continue;

  const fakeEntry = {
    "@_name": link["@_name"],
    profiles: {
      profile,
    },
  };

  resolvedWeapons.push(...getWeaponsFromEntry(fakeEntry));
}

const uniqueWeapons = dedupeWeapons(resolvedWeapons);

console.log(`Unit: ${unitName}`);
console.log(`Found ${entryLinks.length} entry links`);
console.log(`Found ${infoLinks.length} info links`);
console.log(`Resolved ${resolvedWeapons.length} weapon profiles`);
console.log(`Unique weapon profiles: ${uniqueWeapons.length}`);
console.log("");

for (const weapon of uniqueWeapons) {
  console.log(
    `${weapon.name} | ${weapon.type} | ${weapon.range} | A ${weapon.A} | BS ${weapon.BS} | WS ${weapon.WS} | S ${weapon.S} | AP ${weapon.AP} | D ${weapon.D} | ${weapon.keywords}`
  );
}