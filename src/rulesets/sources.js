"use strict";

const path = require("path");

const { extractUnitDefinitions } = require("../bsdata/unit-definitions");
const { extractArmyDefinitions } = require("../bsdata/army-definitions");
const { extractAllyDefinitions } = require("../bsdata/ally-definitions");
const {
  attachStratagemsToArmies,
  mergeStratagemSources,
  readLocalCoreStratagems,
  readLocalDetachmentStratagems,
  readNewRecruitStratagems
} = require("./newrecruit-stratagems");
const {
  applyMfmAttachments,
  readMfmAttachments
} = require("./mfm-attachments");

const ROOT = path.resolve(__dirname, "..", "..");

const RULESET_SOURCES = {
  "wh40k-10e-bsdata": {
    id: "wh40k-10e-bsdata",
    edition: "10e",
    game: "warhammer-40000",
    format: "bsdata-xml",
    sourcePath: path.join(ROOT, "data", "wh40K", "wh40k-10e-main", "wh40k-10e-main"),
    primary: false,
    description: "Original 10th-edition BSData scaffold."
  },
  "wh40k-11e-vflam": {
    id: "wh40k-11e-vflam",
    edition: "11e",
    game: "warhammer-40000",
    format: "bsdata-json",
    sourcePath: path.join(ROOT, "data", "rulesets", "wh40k-11e-vflam"),
    auxiliarySources: {
      coreStratagems: path.join(ROOT, "data", "manual-rules", "wh40k-11e-core-stratagems.json"),
      detachmentStratagems: [
        path.join(ROOT, "data", "manual-rules", "wh40k-11e-tyranids-detachment-stratagems.json"),
        path.join(ROOT, "data", "manual-rules", "wh40k-11e-wahapedia-detachment-stratagems.json")
      ],
      mfmAttachments: path.join(ROOT, "data", "manual-rules", "wh40k-11e-mfm-attachments.json"),
      stratagems: path.join(ROOT, "data", "rulesets", "wh40k-11e-newrecruit", "stratagems.json")
    },
    primary: true,
    description: "11th-edition BSData-style JSON catalogues from vflam/wh40k-11e."
  }
};

const DEFAULT_RULESET_SOURCE_ID = "wh40k-11e-vflam";

function getRulesetSource(id = DEFAULT_RULESET_SOURCE_ID) {
  const source = RULESET_SOURCES[id];
  if (!source) throw new Error(`Unknown ruleset source: ${id}`);
  return { ...source };
}

function listRulesetSources() {
  return Object.values(RULESET_SOURCES).map(source => ({ ...source }));
}

function extractNormalizedRuleset(id = DEFAULT_RULESET_SOURCE_ID) {
  const source = getRulesetSource(id);
  if (!["bsdata-xml", "bsdata-json"].includes(source.format)) {
    throw new Error(`No extractor registered for ruleset source format: ${source.format}`);
  }

  const unitsResult = extractUnitDefinitions(source.sourcePath);
  const stratagemSource = mergeStratagemSources(
    readLocalCoreStratagems(source.auxiliarySources?.coreStratagems),
    readNewRecruitStratagems(source.auxiliarySources?.stratagems),
    ...asArray(source.auxiliarySources?.detachmentStratagems).map(readLocalDetachmentStratagems)
  );
  const armyDefinitions = attachStratagemsToArmies(extractArmyDefinitions(source.sourcePath).definitions, stratagemSource).map(army => ({
    ...army,
    rulesetId: source.id
  }));
  const mfmAttachments = readMfmAttachments(source.auxiliarySources?.mfmAttachments);
  const mfmAttachmentResult = applyMfmAttachments(unitsResult.definitions, mfmAttachments);
  const unitDefinitions = mfmAttachmentResult.definitions.map(unit => ({
    ...unit,
    rulesetId: source.id
  }));

  return {
    source,
    units: unitDefinitions,
    armies: armyDefinitions,
    allies: extractAllyDefinitions(source.sourcePath, unitDefinitions),
    stratagemSource: stratagemSource.source,
    mfmAttachmentSource: {
      source: mfmAttachments.source,
      generatedAt: mfmAttachments.generatedAt,
      ...mfmAttachmentResult.summary
    },
    unresolved: unitsResult.unresolved
  };
}

module.exports = {
  DEFAULT_RULESET_SOURCE_ID,
  RULESET_SOURCES,
  extractNormalizedRuleset,
  getRulesetSource,
  listRulesetSources
};

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
