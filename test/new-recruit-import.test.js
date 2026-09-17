"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const importer = require("../src/domain/new-recruit-import");

function fixture() {
  return {
    roster: {
      name: "Imported Waaagh",
      generatedBy: "https://newrecruit.eu",
      battleScribeVersion: 2.03,
      gameSystemName: "Warhammer 40,000 11th Edition",
      costs: [{ name: "pts", value: 125 }],
      costLimits: [{ name: "pts", value: 1000 }],
      forces: [{
        catalogueId: "orks-cat",
        catalogueName: "Xenos - Orks",
        selections: [{
          name: "Detachment",
          type: "upgrade",
          categories: [{ name: "Configuration", primary: true }],
          selections: [{ name: "Da Big Hunt", group: "Detachment", number: 1 }]
        }, {
          name: "Force Disposition",
          type: "upgrade",
          categories: [{ name: "Configuration", primary: true }],
          selections: [{ name: "Purge the Foe", group: "Force Disposition", number: 1 }]
        }, {
          id: "unit-instance",
          name: "Beastboss",
          type: "model",
          number: 1,
          entryId: "catalogue::unit-link",
          categories: [{ name: "Character", primary: true }],
          selections: [{
            name: "Warlord",
            type: "upgrade",
            number: 1,
            categories: [{ name: "Warlord", primary: false }]
          }, {
            name: "Big choppa",
            type: "upgrade",
            group: "Wargear",
            number: 1,
            entryId: "catalogue::weapon-id"
          }, {
            name: "Trophy",
            type: "upgrade",
            group: "Enhancements - Upgrades::Da Big Hunt Enhancements",
            number: 1
          }]
        }]
      }]
    }
  };
}

const factionRecords = [{ id: "Xenos - Orks", label: "Orks", defaultMode: "Xenos - Orks", modes: [] }];
const definition = {
  id: "unit-definition",
  selectionKey: "orks-cat:unit-link",
  name: "Beastboss",
  selectionTree: {
    id: "unit-link",
    sourceId: "unit-link",
    kind: "unit",
    children: [{
      id: "unit-link/weapon-id",
      sourceId: "weapon-id",
      definitionId: "weapon-id",
      name: "Big choppa",
      kind: "upgrade",
      children: []
    }]
  }
};
const unitPackage = {
  id: "unit-definition",
  selectionKey: "orks-cat:unit-link",
  name: "Beastboss",
  source: { catalogueId: "orks-cat", linkId: "unit-link" },
  definition
};
const armyDefinition = {
  id: "orks-army",
  rulesetId: "wh40k-11e-vflam",
  detachments: [{ id: "hunt", name: "Da Big Hunt" }],
  forceDispositions: [{ id: "purge", name: "Purge the Foe" }],
  enhancements: [{ id: "trophy", name: "Trophy" }]
};
const engine = {
  createDefaultRosterEntry(unit, instanceId) {
    return { schemaVersion: 1, instanceId, unitId: unit.id, selectionKey: unit.selectionKey, selections: {}, wargear: {} };
  },
  setSelection(unit, entry, selectionId, count) {
    return { ...entry, selections: { ...entry.selections, [selectionId]: count } };
  }
};
const armyEngine = {
  createArmyState() {
    return {
      schemaVersion: 1,
      detachmentId: null,
      detachmentIds: [],
      forceDispositionId: null,
      opponentForceDispositionId: null,
      primaryMissionName: null,
      warlordInstanceId: null,
      attachments: [],
      enhancements: [],
      keywordAssignments: []
    };
  }
};

test("detects and converts a New Recruit roster into an AAA roster document", () => {
  const source = fixture();
  assert.equal(importer.isNewRecruitRoster(source), true);
  const identity = importer.identifyFaction(source, factionRecords);
  const document = importer.convertRoster(source, {
    identity,
    unitPackages: [unitPackage],
    armyDefinition,
    engine,
    armyEngine
  });

  assert.equal(document.kind, "roster-engine.savedRoster");
  assert.equal(document.schemaVersion, 2);
  assert.equal(document.name, "Imported Waaagh");
  assert.equal(document.faction, "Xenos - Orks");
  assert.equal(document.pointsLimit, 1000);
  assert.equal(document.totalPoints, 125);
  assert.equal(document.rosterEntries.length, 1);
  assert.equal(document.rosterEntries[0].entry.selections["unit-link/weapon-id"], 1);
  assert.deepEqual(document.armyState.detachmentIds, ["hunt"]);
  assert.equal(document.armyState.forceDispositionId, "purge");
  assert.equal(document.armyState.warlordInstanceId, document.rosterEntries[0].instanceId);
  assert.deepEqual(document.armyState.enhancements, [{
    enhancementId: "trophy",
    bearerInstanceId: document.rosterEntries[0].instanceId
  }]);
  assert.deepEqual(document.importWarnings, []);
});

test("rejects unsupported editions and units missing from installed rules", () => {
  const oldEdition = fixture();
  oldEdition.roster.gameSystemName = "Warhammer 40,000 10th Edition";
  assert.throws(() => importer.identifyFaction(oldEdition, factionRecords), /unsupported game system/);

  assert.throws(() => importer.convertRoster(fixture(), {
    identity: { faction: "Xenos - Orks", subfaction: "Xenos - Orks" },
    unitPackages: [],
    armyDefinition,
    engine,
    armyEngine
  }), /not found in the installed rules data: Beastboss/);
});

test("desktop and mobile runtimes load and call the shared New Recruit importer", () => {
  const root = path.resolve(__dirname, "..");
  const files = [
    fs.readFileSync(path.join(root, "ui", "index.html"), "utf8"),
    fs.readFileSync(path.join(root, "mobile", "ui", "index.html"), "utf8")
  ];
  for (const html of files) assert.match(html, /new-recruit-import\.js/);

  const apps = [
    fs.readFileSync(path.join(root, "ui", "engine-app.js"), "utf8"),
    fs.readFileSync(path.join(root, "mobile", "ui", "engine-app.js"), "utf8")
  ];
  for (const app of apps) {
    assert.match(app, /normalizeImportedJsonPayload/);
    assert.match(app, /newRecruitImport\.convertRoster/);
  }
});
