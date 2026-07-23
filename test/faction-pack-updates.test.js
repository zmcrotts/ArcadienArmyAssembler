"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { extractNormalizedRuleset } = require("../src/rulesets/sources");

const root = path.resolve(__dirname, "..");
const updateDocument = JSON.parse(fs.readFileSync(path.join(root, "data", "manual-rules", "wh40k-11e-faction-pack-updates.json"), "utf8"));

function walk(node, visitor) {
  if (!node) return;
  visitor(node);
  for (const child of node.children || []) walk(child, visitor);
}

function nodes(unit, name) {
  const found = [];
  walk(unit.selectionTree, node => {
    if (String(node.name || "").toLowerCase() === name.toLowerCase()) found.push(node);
  });
  return found;
}

function ability(unit, name) {
  let found = null;
  walk(unit.selectionTree, node => {
    for (const profile of node.profiles || []) {
      if (profile.typeName === "Abilities" && String(profile.name || "").toLowerCase().startsWith(name.toLowerCase())) found = profile;
    }
  });
  return found;
}

test("Faction Pack v1.1 red-text overrides all resolve", () => {
  const ruleset = extractNormalizedRuleset(undefined, { fresh: true });
  assert.equal(updateDocument.audit.redCharacterCount, 28626);
  assert.equal(updateDocument.audit.changedPageCount, 57);
  assert.equal(ruleset.factionPackUpdateSource.configured, updateDocument.updates.length);
  assert.equal(ruleset.factionPackUpdateSource.applied, updateDocument.updates.length);
  assert.equal(ruleset.factionPackUpdateSource.unmatched, 0);

  const reportPath = path.join(root, "reports", "warhammer-40000-2026-07-22-red-updates.json");
  if (fs.existsSync(reportPath)) {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    const auditItems = [
      ...updateDocument.updates,
      ...updateDocument.audit.manualCorrections,
      ...updateDocument.audit.verifiedCurrentSource,
      ...updateDocument.audit.nonRosterFacing
    ];
    const uncovered = [];
    for (const document of report.documents) {
      const documentName = path.basename(document.file, ".pdf").replace(/^Faction Pack - /, "").toLowerCase();
      for (const page of document.changedPages || []) {
        const covered = auditItems.some(item => {
          const source = String(item.source || "");
          return source.toLowerCase().includes(documentName)
            && new RegExp(`page(?:s)?[^0-9]*${page.page}(?:\\D|$)`, "i").test(source);
        });
        if (!covered) uncovered.push(`${documentName}:${page.page}`);
      }
    }
    assert.deepEqual(uncovered, []);
  }
});

test("Ork red-text loadout changes are selectable", () => {
  const ruleset = extractNormalizedRuleset(undefined, { fresh: true });
  const boyz = ruleset.units.find(unit => unit.faction === "Xenos - Orks" && unit.name === "Boyz");
  const warboss = ruleset.units.find(unit => unit.faction === "Xenos - Orks" && unit.name === "Warboss");
  const gretchin = ruleset.units.find(unit => unit.faction === "Xenos - Orks" && unit.name === "Gretchin");
  assert.ok(nodes(boyz, "Big choppa and kustom shoota").length);
  assert.ok(nodes(boyz, "Big choppa, kombi-rokkit and kombi-shoota").length);
  assert.ok(nodes(warboss, "Kustom choppa and kustom shoota").length);
  assert.deepEqual(gretchin.allowedCompositions.map(row => row.map(item => item.count || item.max)), [[10, 1], [20, 2]]);
  assert.equal(boyz.rosterRules.allowsMultipleLeadersAsBodyguard, false);
});

test("Space Marine red-text weapon options are present", () => {
  const ruleset = extractNormalizedRuleset(undefined, { fresh: true });
  const chaplain = ruleset.units.find(unit => unit.name === "Chaplain with Jump Pack");
  const veterans = ruleset.units.find(unit => unit.name === "Vanguard Veteran Squad with Jump Packs");
  assert.ok(nodes(chaplain, "Absolvor bolt pistol").length);
  assert.equal(nodes(veterans, "Heavy bolt pistol and master-crafted power weapon").length, 2);
});

test("representative army, detachment and datasheet red changes are exact", () => {
  const ruleset = extractNormalizedRuleset(undefined, { fresh: true });
  const sisters = ruleset.armies.find(army => army.faction === "Imperium - Adepta Sororitas");
  const light = sisters.detachments.find(item => item.name === "Army of Faith").stratagems.find(item => item.name.toLowerCase() === "light of the emperor");
  assert.equal(light.cpCost, "2");
  const necrons = ruleset.armies.find(army => army.faction === "Xenos - Necrons");
  assert.match(necrons.armyRules.find(rule => rule.name === "Reanimation Protocols").description, /heals D3 wounds/);
  const dragsta = ruleset.units.find(unit => unit.faction === "Xenos - Orks" && unit.name === "Shokkjump Dragsta");
  const shokk = ability(dragsta, "Shokk Tunnel");
  assert.match(shokk.characteristics.Description, /more than 8" horizontally/);
});
