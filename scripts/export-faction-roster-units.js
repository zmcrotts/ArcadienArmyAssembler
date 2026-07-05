const fs = require("fs");
const path = require("path");
const { XMLParser } = require("fast-xml-parser");

const DATA_DIR = path.join(
  __dirname,
  "..",
  "data",
  "wh40K",
  "wh40k-10e-main",
  "wh40k-10e-main"
);

const OUT_DIR = path.join(__dirname, "..", "data", "roster-rules");

const factionName = process.argv.slice(2).join(" ");

if (!factionName) {
  console.error('Usage: node scripts/export-faction-roster-units.js "Chaos - World Eaters"');
  process.exit(1);
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  isArray: (name) =>
    [
      "selectionEntry",
      "selectionEntryGroup",
      "entryLink",
      "profile",
      "categoryLink",
      "constraint",
      "modifier",
      "condition",
      "cost",
      "infoLink",
    ].includes(name),
});

let GLOBAL_PROFILES_BY_ID = new Map();

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function readXml(filePath) {
  return parser.parse(fs.readFileSync(filePath, "utf8"));
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function findAllCatalogueFiles() {
  return fs
    .readdirSync(DATA_DIR)
    .filter((file) => file.endsWith(".cat"))
    .map((file) => path.join(DATA_DIR, file));
}

function findFactionFile(catalogueFiles) {
  return catalogueFiles.find((file) => {
    const base = path.basename(file, ".cat");
    return base.toLowerCase() === factionName.toLowerCase();
  });
}

function getConstraints(node) {
  return asArray(node?.constraints?.constraint).map((c) => ({
    id: c.id ?? null,
    type: c.type ?? null,
    field: c.field ?? null,
    scope: c.scope ?? null,
    value: c.value !== undefined ? Number(c.value) : null,
    childId: c.childId ?? null,
    shared: c.shared ?? null,
    includeChildSelections: c.includeChildSelections ?? null,
    includeChildForces: c.includeChildForces ?? null,
  }));
}

function getMinMax(node) {
  const constraints = getConstraints(node);
  const min = constraints.find((c) => c.type === "min" && c.field === "selections");
  const max = constraints.find((c) => c.type === "max" && c.field === "selections");

  return {
    min: min ? min.value : null,
    max: max ? max.value : null,
  };
}

function getPoints(entry) {
  const found = [];

  function walk(node) {
    if (!node || typeof node !== "object") {
      return;
    }

    const costs = asArray(node?.costs?.cost);
    const pts = costs.find((c) => c.name?.toLowerCase() === "pts");

    if (pts) {
      const value = Number(pts.value);

      if (Number.isFinite(value) && value > 0) {
        found.push(value);
      }
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) {
          walk(child);
        }
      } else if (value && typeof value === "object") {
        walk(value);
      }
    }
  }

  walk(entry);

  if (found.length === 0) {
    return 0;
  }

  return Math.min(...found);
}

function getCategories(entry) {
  return asArray(entry?.categoryLinks?.categoryLink).map((cat) => ({
    id: cat.targetId ?? cat.id ?? null,
    name: cat.name ?? null,
  }));
}

function getEntryLinks(entryLinks) {
  return asArray(entryLinks?.entryLink).map((link) => ({
    id: link.id ?? null,
    name: link.name ?? null,
    type: link.type ?? null,
    targetId: link.targetId ?? null,
    hidden: link.hidden ?? null,
  }));
}

function getInfoLinks(entry) {
  return asArray(entry?.infoLinks?.infoLink).map((link) => ({
    id: link.id ?? null,
    name: link.name ?? null,
    type: link.type ?? null,
    targetId: link.targetId ?? null,
    hidden: link.hidden ?? null,
  }));
}

function getProfiles(entry) {
  const directProfiles = asArray(entry?.profiles?.profile).map((profile) => ({
    id: profile.id ?? null,
    name: profile.name ?? null,
    typeId: profile.typeId ?? null,
    typeName: profile.typeName ?? null,
    hidden: profile.hidden ?? null,
  }));

  const linkedProfiles = getInfoLinks(entry)
    .filter((link) => link.type === "profile")
    .map((link) => GLOBAL_PROFILES_BY_ID.get(link.targetId))
    .filter(Boolean)
    .map((profile) => ({
      id: profile.id ?? null,
      name: profile.name ?? null,
      typeId: profile.typeId ?? null,
      typeName: profile.typeName ?? null,
      hidden: profile.hidden ?? null,
      linked: true,
    }));

  return [...directProfiles, ...linkedProfiles];
}

function hasUnitProfile(entry) {
  return getProfiles(entry).some((profile) => {
    return profile.typeName === "Unit" || profile.typeId === "c547-1836-d8a-ff4f";
  });
}

function isRosterUnitEntry(entry) {
  if (!entry) return false;
  if (entry.type === "unit") return true;
  if (hasUnitProfile(entry)) return true;
  return false;
}

function walkSelectionEntryGroups(groups, callback) {
  for (const group of asArray(groups?.selectionEntryGroup)) {
    callback(group);
    walkSelectionEntryGroups(group.selectionEntryGroups, callback);
  }
}

function collectProfiles(node, output = []) {
  if (!node || typeof node !== "object") return output;

  for (const profile of asArray(node.profiles?.profile)) {
    output.push(profile);
  }

  for (const profile of asArray(node.sharedProfiles?.profile)) {
    output.push(profile);
  }

  for (const entry of asArray(node.selectionEntries?.selectionEntry)) {
    collectProfiles(entry, output);
  }

  for (const entry of asArray(node.sharedSelectionEntries?.selectionEntry)) {
    collectProfiles(entry, output);
  }

  for (const group of asArray(node.selectionEntryGroups?.selectionEntryGroup)) {
    collectProfiles(group, output);
  }

  for (const group of asArray(node.sharedSelectionEntryGroups?.selectionEntryGroup)) {
    collectProfiles(group, output);
  }

  return output;
}

function buildGlobalProfileIndex(catalogueFiles) {
  const byId = new Map();

  for (const file of catalogueFiles) {
    const xml = readXml(file);
    const catalogue = xml.catalogue;
    const catalogueName = catalogue.name ?? path.basename(file, ".cat");

    const profiles = collectProfiles(catalogue);

    for (const profile of profiles) {
      if (!profile.id) continue;

      byId.set(profile.id, {
        ...profile,
        sourceCatalogue: catalogueName,
        sourceFile: path.basename(file),
      });
    }
  }

  return byId;
}

function collectSelectionEntries(node, output = []) {
  if (!node || typeof node !== "object") return output;

  for (const entry of asArray(node.selectionEntries?.selectionEntry)) {
    output.push(entry);
    collectSelectionEntries(entry, output);
  }

  for (const entry of asArray(node.sharedSelectionEntries?.selectionEntry)) {
    output.push(entry);
    collectSelectionEntries(entry, output);
  }

  for (const group of asArray(node.selectionEntryGroups?.selectionEntryGroup)) {
    collectSelectionEntries(group, output);
  }

  for (const group of asArray(node.sharedSelectionEntryGroups?.selectionEntryGroup)) {
    collectSelectionEntries(group, output);
  }

  return output;
}

function getChildModelsFromEntries(entries) {
  return asArray(entries?.selectionEntry)
    .filter((entry) => entry.type === "model")
    .map((entry) => {
      const { min, max } = getMinMax(entry);

      return {
        id: entry.id ?? null,
        name: entry.name ?? null,
        type: entry.type ?? null,
        min,
        max,
        constraints: getConstraints(entry),
        entryLinks: getEntryLinks(entry.entryLinks),
        infoLinks: getInfoLinks(entry),
        profiles: getProfiles(entry),
      };
    });
}

function getComposition(unit) {
  const composition = [];

  if (unit.type === "model" || unit.type === "upgrade") {
    const { min, max } = getMinMax(unit);

    composition.push({
      kind: "self-model-unit",
      id: unit.id ?? null,
      name: unit.name ?? null,
      min: min ?? 1,
      max: max ?? 1,
      constraints: getConstraints(unit),
      entryLinks: getEntryLinks(unit.entryLinks),
      infoLinks: getInfoLinks(unit),
      profiles: getProfiles(unit),
    });
  }

  for (const entry of asArray(unit.selectionEntries?.selectionEntry)) {
    if (entry.type !== "model") continue;

    const { min, max } = getMinMax(entry);

    composition.push({
      kind: "direct-model",
      id: entry.id ?? null,
      name: entry.name ?? null,
      min,
      max,
      constraints: getConstraints(entry),
      entryLinks: getEntryLinks(entry.entryLinks),
      infoLinks: getInfoLinks(entry),
      profiles: getProfiles(entry),
    });
  }

  walkSelectionEntryGroups(unit.selectionEntryGroups, (group) => {
    const childModels = getChildModelsFromEntries(group.selectionEntries);
    if (childModels.length === 0) return;

    const { min, max } = getMinMax(group);

    composition.push({
      kind: "model-group",
      id: group.id ?? null,
      name: group.name ?? null,
      min,
      max,
      constraints: getConstraints(group),
      models: childModels,
    });
  });

  return composition;
}

function getOptionGroups(unit) {
  const groups = [];

  walkSelectionEntryGroups(unit.selectionEntryGroups, (group) => {
    const entries = asArray(group.selectionEntries?.selectionEntry).map((entry) => {
      const { min, max } = getMinMax(entry);

      return {
        id: entry.id ?? null,
        name: entry.name ?? null,
        type: entry.type ?? null,
        min,
        max,
        points: getPoints(entry),
        constraints: getConstraints(entry),
        entryLinks: getEntryLinks(entry.entryLinks),
        infoLinks: getInfoLinks(entry),
        profiles: getProfiles(entry),
      };
    });

    groups.push({
      id: group.id ?? null,
      name: group.name ?? null,
      min: getMinMax(group).min,
      max: getMinMax(group).max,
      constraints: getConstraints(group),
      entries,
      entryLinks: getEntryLinks(group.entryLinks),
    });
  });

  return groups;
}

function buildGlobalRosterUnitIndex(catalogueFiles) {
  const byId = new Map();

  for (const file of catalogueFiles) {
    const xml = readXml(file);
    const catalogue = xml.catalogue;
    const catalogueName = catalogue.name ?? path.basename(file, ".cat");

    const allEntries = collectSelectionEntries(catalogue);

    for (const entry of allEntries) {
      if (!isRosterUnitEntry(entry)) continue;

      byId.set(entry.id, {
        catalogueName,
        file: path.basename(file),
        unit: entry,
      });
    }
  }

  return byId;
}

function getFactionTopLevelEntryLinks(factionFile) {
  const xml = readXml(factionFile);
  const catalogue = xml.catalogue;

  return asArray(catalogue?.entryLinks?.entryLink)
    .filter((link) => link.type === "selectionEntry")
    .filter((link) => link.hidden !== "true")
    .map((link) => ({
      id: link.id ?? null,
      name: link.name ?? null,
      targetId: link.targetId ?? null,
      type: link.type ?? null,
      hidden: link.hidden ?? null,
      categoryLinks: getCategories(link),
      constraints: getConstraints(link),
    }));
}

function mergeCategories(unitCategories, linkCategories) {
  const merged = [];
  const seen = new Set();

  for (const cat of [...unitCategories, ...linkCategories]) {
    const key = `${cat.id}|${cat.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(cat);
  }

  return merged;
}

function exportUnitFromLink(link, globalUnits) {
  const resolved = globalUnits.get(link.targetId);

  if (!resolved) {
    return {
      id: link.targetId,
      name: link.name,
      unresolved: true,
      sourceLink: link,
    };
  }

  const unit = resolved.unit;

  return {
    id: unit.id ?? link.targetId,
    name: link.name ?? unit.name ?? null,
    definitionName: unit.name ?? null,
    entryType: unit.type ?? null,
    rosterUnitKind: unit.type === "unit" ? "unit" : `${unit.type}-as-unit`,
    points: getPoints(unit),
    categories: mergeCategories(getCategories(unit), link.categoryLinks),
    constraints: [...getConstraints(unit), ...link.constraints],
    profiles: getProfiles(unit),
    composition: getComposition(unit),
    optionGroups: getOptionGroups(unit),
    unitEntryLinks: getEntryLinks(unit.entryLinks),
    infoLinks: getInfoLinks(unit),
    source: {
      linkId: link.id,
      targetId: link.targetId,
      definitionCatalogue: resolved.catalogueName,
      definitionFile: resolved.file,
    },
  };
}

const catalogueFiles = findAllCatalogueFiles();
const factionFile = findFactionFile(catalogueFiles);

if (!factionFile) {
  console.error(`Could not find faction catalogue: ${factionName}`);
  process.exit(1);
}

GLOBAL_PROFILES_BY_ID = buildGlobalProfileIndex(catalogueFiles);
const globalUnits = buildGlobalRosterUnitIndex(catalogueFiles);
const factionLinks = getFactionTopLevelEntryLinks(factionFile);

const IGNORED_LINKS = new Set([
  "Blessings of Khorne Reference",
  "Detachment",
  "Order of Battle",
  "Show/Hide Options",
  "Battle Focus - Agile Manoeuvres",
  "Show Khorne Daemons",
  "Show Nurgle Daemons",
  "Show Slaanesh Daemons",
  "Show Tzeentch Daemons",
  "Combat Elixirs equipped in Current Battle",
  "Detachments",
  "Code Chivalric",
  "Unseated Pilot",
  "Searchlight",
]);

const exported = factionLinks
  .filter((link) => !IGNORED_LINKS.has(link.name))
  .map((link) => exportUnitFromLink(link, globalUnits));

const units = exported
  .filter((unit) => !unit.unresolved)
  .sort((a, b) => a.name.localeCompare(b.name));

const unresolved = exported
  .filter((unit) => unit.unresolved)
  .sort((a, b) => a.name.localeCompare(b.name));

fs.mkdirSync(OUT_DIR, { recursive: true });

const output = {
  faction: factionName,
  catalogue: path.basename(factionFile),
  unitCount: units.length,
  unresolvedCount: unresolved.length,
  units,
  unresolved,
};

const outFile = path.join(OUT_DIR, `${slugify(factionName)}-roster-units.json`);

fs.writeFileSync(outFile, JSON.stringify(output, null, 2), "utf8");

console.log(`Exported ${units.length} roster units`);
console.log(`Unresolved links: ${unresolved.length}`);
console.log(outFile);