"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const codex = require("../data/manual-rules/wh40k-11e-orks-codex-v1.json");
const core = require("../data/manual-rules/wh40k-11e-core-stratagems.json");
const { extractNormalizedRuleset } = require("../src/rulesets/sources");

test("Orks supplement contains army content only", () => {
  for (const removed of ["activeUnits", "points", "addedUnits", "unitUpdates", "wargearPoints", "pointsSource"]) {
    assert.equal(Object.hasOwn(codex, removed), false, `Manual Ork unit overlay field remains: ${removed}`);
  }
  assert.equal(codex.kind, "orks-army-supplement");
  assert.equal(codex.detachments.length, 15);
  assert.equal(codex.detachments.reduce((sum, item) => sum + item.enhancements.length, 0), 38);
  assert.equal(codex.detachments.reduce((sum, item) => sum + item.stratagems.length, 0), 40);
});
test("11e glossary defines Cleave as Blast-style scaling for melee weapons", () => {
  const cleave = core.coreRules.find(rule => rule.name === "Cleave");
  assert.ok(cleave);
  assert.match(cleave.description, /melee weapon/i);
  assert.match(cleave.description, /X additional attack dice for every five models/i);
});

test("Ork units remain authoritative BSData imports while army supplements are retained", () => {
  const ruleset = extractNormalizedRuleset(undefined, { fresh: true });
  const orks = ruleset.units.filter(unit => unit.faction === "Xenos - Orks" && unit.rosterSelectable);
  const byName = name => {
    const unit = orks.find(item => item.name === name);
    assert.ok(unit, `Missing upstream Orks unit ${name}`);
    return unit;
  };

  assert.ok(orks.length > 50);
  for (const name of [
    "Ghazghkull Thraka",
    "Big'ed Bossbunka",
    "Rukkatrukk Squigbuggies",
    "Wartrakks",
    "Nazdreg",
    "Gunwagon"
  ]) byName(name);

  const killRig = byName("Kill Rig");
  for (const abilityName of ["Warpath (psyker level 1)", "Beastscent (psyker level 1)"]) {
    const ability = killRig.selectionTree.profiles.find(profile => profile.name === abilityName);
    assert.ok(ability, `Missing Kill Rig psychic ability ${abilityName}`);
    assert.ok(ability.characteristics.Description, `Missing rules text for ${abilityName}`);
  }

  assert.equal(orks.some(unit => unit.sourceDisposition === "codex-current"), false);
  assert.equal(orks.every(unit => unit.source?.codex === undefined && unit.source?.kind !== "orks-codex"), true);
  assert.equal(orks.every(unit => unit.source?.catalogueId), true);

  const army = ruleset.armies.find(item => item.faction === "Xenos - Orks");
  assert.equal(army.detachments.length, 15);
  assert.equal(army.enhancements.length, 38);
  assert.equal(army.detachments.reduce((sum, item) => sum + item.stratagems.length, 0), 40);
  assert.equal(ruleset.orksCodexSource.unitSource, "bsdata");
  assert.equal(ruleset.orksCodexSource.changedProfiles, 0);
});
