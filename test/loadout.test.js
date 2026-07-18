"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const { extractUnitDefinitions } = require("../src/bsdata/unit-definitions");
const {
  createDefaultRosterEntry,
  getConfiguredModels,
  getConfiguredProfiles,
  getOptionStates,
  getUnitSizeState,
  listSelectableOptions,
  setSelection,
  setUnitSize,
  validateLoadout
} = require("../src/domain/loadout");

const BSDATA = path.join(__dirname, "..", "data", "wh40K", "wh40k-10e-main", "wh40k-10e-main");
const hasLegacyBsdata = fs.existsSync(BSDATA);
const legacyTest = hasLegacyBsdata ? test : test.skip;
const extracted = hasLegacyBsdata ? extractUnitDefinitions(BSDATA) : { definitions: [] };
const VFLAM_11E = path.join(__dirname, "..", "data", "rulesets", "wh40k-11e-vflam");
let extracted11e = null;

function unit(faction, name) {
  const found = extracted.definitions.find(item => item.faction === faction && item.name === name);
  assert.ok(found, `Missing fixture unit: ${faction} / ${name}`);
  return found;
}

function unit11e(faction, name) {
  extracted11e ||= extractUnitDefinitions(VFLAM_11E);
  const found = extracted11e.definitions.find(item => item.faction === faction && item.name === name);
  assert.ok(found, `Missing 11e fixture unit: ${faction} / ${name}`);
  return found;
}

function option(definition, name, parentName = null) {
  const options = listSelectableOptions(definition);
  const matches = options.filter(item => item.name === name);
  if (!parentName) {
    assert.ok(matches.length, `Missing option ${name}`);
    return matches[0];
  }
  const index = require("../src/domain/loadout").buildTreeIndex(definition);
  const found = matches.find(item => index.byId.get(item.parentId)?.name === parentName);
  assert.ok(found, `Missing option ${parentName} / ${name}`);
  return found;
}

legacyTest("Hive Tyrant defaults to both BSData default weapon choices", () => {
  const definition = unit("Xenos - Tyranids", "Hive Tyrant");
  const entry = createDefaultRosterEntry(definition);
  const bonesword = option(definition, "Monstrous bonesword and lash whip", "Monstrous Bonesword and Lash Whip");
  const talons = option(definition, "Monstrous scything talons", "Monstrous Scything Talons");
  assert.equal(entry.selections[bonesword.id], 1);
  assert.equal(entry.selections[talons.id], 1);
});

legacyTest("Hive Tyrant one-of group swaps its selected weapon", () => {
  const definition = unit("Xenos - Tyranids", "Hive Tyrant");
  const entry = createDefaultRosterEntry(definition);
  const bonesword = option(definition, "Monstrous bonesword and lash whip", "Monstrous Bonesword and Lash Whip");
  const cannon = option(definition, "Heavy venom cannon", "Monstrous Bonesword and Lash Whip");
  const changed = setSelection(definition, entry, cannon.id, 1);
  assert.equal(changed.selections[cannon.id], 1);
  assert.equal(changed.selections[bonesword.id] || 0, 0);
  const weaponNames = getConfiguredProfiles(definition, changed).weapons.map(item => item.name);
  assert.ok(weaponNames.includes("Heavy venom cannon"));
  assert.ok(!weaponNames.includes("Monstrous bonesword and lash whip"));
});

legacyTest("Battle Sister specialist replaces one default Battle Sister", () => {
  const definition = unit("Imperium - Adepta Sororitas", "Battle Sisters Squad");
  const entry = createDefaultRosterEntry(definition);
  const ordinary = option(definition, "Battle Sister");
  const banner = option(definition, "Battle Sister w/ Simulacrum Imperialis");
  assert.equal(entry.selections[ordinary.id], 9);
  const changed = setSelection(definition, entry, banner.id, 1);
  assert.equal(changed.selections[banner.id], 1);
  assert.equal(changed.selections[ordinary.id], 8);
});

legacyTest("Termagant special weapon replaces a default model and scales one per ten", () => {
  const definition = unit("Xenos - Tyranids", "Termagants");
  const entry = createDefaultRosterEntry(definition);
  const ordinary = option(definition, "Termagants");
  const shardlauncher = option(definition, "Termagant w/ Shardlauncher");
  assert.equal(entry.selections[ordinary.id], 10);

  const oneSpecial = setSelection(definition, entry, shardlauncher.id, 1);
  assert.equal(oneSpecial.selections[ordinary.id], 9);
  assert.equal(validateLoadout(definition, oneSpecial).length, 0);

  const twoSpecialAtTen = setSelection(definition, oneSpecial, shardlauncher.id, 2);
  assert.ok(validateLoadout(definition, twoSpecialAtTen).some(error => error.type === "max"));

  const stateAtTen = getOptionStates(definition, entry).find(state => state.id === shardlauncher.id);
  assert.equal(stateAtTen.editable, true);
  assert.equal(stateAtTen.maximum, 1);

  const twentyModels = structuredClone(oneSpecial);
  twentyModels.selections[ordinary.id] = 19;
  const stateAtTwenty = getOptionStates(definition, twentyModels).find(state => state.id === shardlauncher.id);
  assert.equal(stateAtTwenty.editable, true);
  assert.equal(stateAtTwenty.maximum, 2);
});

legacyTest("mandatory and fixed selections are engine-locked", () => {
  const definition = unit("Imperium - Adepta Sororitas", "Battle Sisters Squad");
  const entry = createDefaultRosterEntry(definition);
  const superior = option(definition, "Sister Superior");
  const state = getOptionStates(definition, entry).find(item => item.id === superior.id);

  assert.equal(state.mandatory, true);
  assert.equal(state.fixed, true);
  assert.equal(state.editable, false);
  assert.throws(() => setSelection(definition, entry, superior.id, 0), /not editable/);
});

legacyTest("fixed-total groups still expose genuine alternatives", () => {
  const definition = unit("Xenos - Tyranids", "Hive Tyrant");
  const entry = createDefaultRosterEntry(definition);
  const cannon = option(definition, "Heavy venom cannon", "Monstrous Bonesword and Lash Whip");
  const state = getOptionStates(definition, entry).find(item => item.id === cannon.id);

  assert.equal(state.minimum, 0);
  assert.equal(state.maximum, 1);
  assert.equal(state.editable, true);
});

legacyTest("option states expose compact-group limits, required choices, and exclusivity", () => {
  const definition = unit("Xenos - Tyranids", "Hive Tyrant");
  const entry = createDefaultRosterEntry(definition);
  const bonesword = option(definition, "Monstrous bonesword and lash whip", "Monstrous Bonesword and Lash Whip");
  const cannon = option(definition, "Heavy venom cannon", "Monstrous Bonesword and Lash Whip");
  const states = getOptionStates(definition, entry);
  const selected = states.find(item => item.id === bonesword.id);
  const alternative = states.find(item => item.id === cannon.id);

  assert.deepEqual(
    {
      current: selected.groupCurrent,
      minimum: selected.groupMinimum,
      maximum: selected.groupMaximum,
      required: selected.groupRequired,
      exclusive: selected.mutuallyExclusive
    },
    { current: 1, minimum: 1, maximum: 1, required: true, exclusive: true }
  );
  assert.equal(alternative.mutuallyExclusive, true);
});

legacyTest("visible Legends links retain profiles without false composition warnings", () => {
  const definition = unit("Xenos - Tyranids", "Barbed Hierodule [Legends]");
  const entry = createDefaultRosterEntry(definition);
  const configured = getConfiguredProfiles(definition, entry);
  assert.deepEqual(validateLoadout(definition, entry), []);
  assert.equal(configured.units.some(profile => profile.name === "Barbed Hierodule"), true);
  assert.equal(configured.weapons.some(profile => profile.name === "Bio-cannon"), true);
});

legacyTest("unit keywords expose BSData category links for rules queries", () => {
  const norn = unit("Xenos - Tyranids", "Norn Assimilator");
  assert.ok(norn.keywords.includes("Harvester"));
  assert.ok(norn.keywords.includes("Synapse"));

  const termagants = unit("Xenos - Tyranids", "Termagants");
  assert.ok(termagants.keywords.includes("Endless Multitude"));
  assert.ok(termagants.keywords.includes("Faction: Tyranids"));
});

legacyTest("direct weapon rules are included with configured selected wargear", () => {
  const definition = unit("Xenos - Tyranids", "Norn Assimilator");
  const configured = getConfiguredProfiles(definition, createDefaultRosterEntry(definition));
  const harpooned = configured.rules.find(rule => rule.name === "Harpooned");
  assert.ok(harpooned, "Norn Assimilator should include the Toxinjector Harpoon's direct Harpooned rule");
  assert.match(harpooned.description, /After the bearer has shot with this weapon/);
});

test("linked rule name modifiers preserve values for compact unit rules", () => {
  const definition = unit11e("Chaos - World Eaters", "Chaos Spawn");
  const configured = getConfiguredProfiles(definition, createDefaultRosterEntry(definition));
  const ruleNames = configured.rules.map(rule => rule.name);

  assert.ok(ruleNames.includes("Feel No Pain 5+"));
  assert.ok(ruleNames.includes("Scouts 8\""));
});

legacyTest("fixed-size units default their required models without a minimum warning", () => {
  const definition = unit("Xenos - Tyranids", "Barbgaunts");
  const entry = createDefaultRosterEntry(definition);
  assert.deepEqual(validateLoadout(definition, entry), []);
  assert.equal(getConfiguredProfiles(definition, entry).units[0].count, 5);
});

legacyTest("variable unit size can be changed without exposing model rows as wargear", () => {
  const definition = unit("Xenos - Tyranids", "Hormagaunts");
  const entry = createDefaultRosterEntry(definition);
  assert.deepEqual(getUnitSizeState(definition, entry), { current: 10, minimum: 10, maximum: 20, editable: true });
  const twenty = setUnitSize(definition, entry, 20);
  assert.deepEqual(getUnitSizeState(definition, twenty), { current: 20, minimum: 10, maximum: 20, editable: true });
  assert.equal(getConfiguredProfiles(definition, twenty).units[0].count, 20);
  assert.deepEqual(validateLoadout(definition, twenty), []);
});

legacyTest("single-model units report a size of one", () => {
  const definition = unit("Xenos - Tyranids", "Hive Tyrant");
  assert.deepEqual(getUnitSizeState(definition, createDefaultRosterEntry(definition)), {
    current: 1, minimum: 1, maximum: 1, editable: false
  });
});

legacyTest("unit size preserves specialist models and fixed-size units stay locked", () => {
  const termagants = unit("Xenos - Tyranids", "Termagants");
  const entry = createDefaultRosterEntry(termagants);
  const shardlauncher = option(termagants, "Termagant w/ Shardlauncher");
  const specialist = setSelection(termagants, entry, shardlauncher.id, 1);
  const twenty = setUnitSize(termagants, specialist, 20);
  assert.equal(getUnitSizeState(termagants, twenty).current, 20);
  assert.equal(twenty.selections[shardlauncher.id], 1);

  const sisters = unit("Imperium - Adepta Sororitas", "Battle Sisters Squad");
  assert.equal(getUnitSizeState(sisters, createDefaultRosterEntry(sisters)).editable, false);
});

test("nested specialist models replace outer default models and do not inflate unit size", () => {
  const definition = unit11e("Xenos - Orks", "Boyz");
  let entry = createDefaultRosterEntry(definition);
  assert.deepEqual(getUnitSizeState(definition, entry), { current: 10, minimum: 10, maximum: 20, editable: true });

  entry = setUnitSize(definition, entry, 20);
  const bigShoota = option(definition, "Boy w/ Big shoota and close combat weapon");
  const rokkit = option(definition, "Boy w/ Rokkit launcha and close combat weapon");
  let states = getOptionStates(definition, entry);
  assert.equal(states.find(item => item.id === bigShoota.id).maximum, 2);
  assert.equal(states.find(item => item.id === rokkit.id).maximum, 2);

  entry = setSelection(definition, entry, bigShoota.id, 1);
  entry = setSelection(definition, entry, rokkit.id, 1);
  assert.equal(getUnitSizeState(definition, entry).current, 20);
  assert.deepEqual(validateLoadout(definition, entry), []);
  assert.equal(getConfiguredProfiles(definition, entry).units.filter(profile => profile.name === "Boy").length, 1);
  assert.ok(getConfiguredProfiles(definition, entry).units.some(profile => profile.name === "Boss Nob"));
});

test("Jakhals treat weapon bundles as loadouts instead of extra model requirements", () => {
  const definition = unit11e("Chaos - World Eaters", "Jakhals");
  const entry = createDefaultRosterEntry(definition);

  assert.deepEqual(getUnitSizeState(definition, entry), { current: 10, minimum: 10, maximum: 20, editable: true });
  assert.deepEqual(getConfiguredModels(definition, entry).map(model => [model.name, model.count, model.equipment]), [
    ["Jakhal Pack Leader", 1, ["Autopistol", "Chainblades"]],
    ["Jakhal", 8, ["8x Autopistol", "8x Chainblades"]],
    ["Dishonoured w/ paired manglers", 1, ["Paired manglers"]]
  ]);
  assert.deepEqual(validateLoadout(definition, entry), []);

  const twenty = setUnitSize(definition, entry, 20);
  assert.equal(getUnitSizeState(definition, twenty).current, 20);
  assert.deepEqual(getConfiguredModels(definition, twenty).map(model => [model.name, model.count, model.equipment]), [
    ["Jakhal Pack Leader", 1, ["Autopistol", "Chainblades"]],
    ["Jakhal", 17, ["17x Autopistol", "17x Chainblades"]],
    ["Dishonoured w/ paired manglers", 2, ["2x Paired manglers"]]
  ]);
  assert.deepEqual(validateLoadout(definition, twenty), []);

  const maulerBundle = option(definition, "1 mauler chainblade, 7 chainblades");
  const withMauler = setSelection(definition, entry, maulerBundle.id, 1);
  assert.deepEqual(getUnitSizeState(definition, withMauler), { current: 10, minimum: 10, maximum: 20, editable: true });
  assert.deepEqual(getConfiguredModels(definition, withMauler).map(model => [model.name, model.count, model.equipment]), [
    ["Jakhal Pack Leader", 1, ["Autopistol", "Chainblades"]],
    ["Jakhal w/ mauler chainblade", 1, ["Autopistol", "Mauler chainblade"]],
    ["Jakhal", 7, ["7x Autopistol", "7x Chainblades"]],
    ["Dishonoured w/ paired manglers", 1, ["Paired manglers"]]
  ]);
  assert.deepEqual(validateLoadout(definition, withMauler), []);
});

test("11e unit profiles expose canonical save values", () => {
  const definition = unit11e("Xenos - Orks", "Boyz");
  const profiles = getConfiguredProfiles(definition, createDefaultRosterEntry(definition));
  const boy = profiles.units.find(profile => profile.name === "Boy");
  const bossNob = profiles.units.find(profile => profile.name === "Boss Nob");

  assert.equal(boy.characteristics.SV, "5+");
  assert.equal(bossNob.characteristics.SV, "5+");
});

test("multi-model epic heroes expose physical model loadouts", () => {
  const definition = unit11e("Xenos - T'au Empire", "The Twin Lance");
  const entry = createDefaultRosterEntry(definition);
  const models = getConfiguredModels(definition, entry);

  assert.deepEqual(models.map(model => [model.name, model.count]), [
    ["Ri'Lantar", 1],
    ["Ri'Locai", 1]
  ]);
  assert.ok(models[0].equipment.includes("Fusion eliminator"));
  assert.ok(models[0].equipment.includes("Shardstorm burst system"));
  assert.ok(models[0].equipment.some(item => item.includes("MV15 Gun Drone") && item.includes("Twin pulse blaster")));
  assert.ok(models[1].equipment.includes("Ion scattercannon"));
});

test("force-scoped War Dog limits do not become impossible per-unit defaults", () => {
  for (const faction of ["Chaos - Chaos Knights", "Chaos - Chaos Knights Library"]) {
    for (const name of [
      "War Dog Brigand",
      "War Dog Executioner",
      "War Dog Huntsman",
      "War Dog Karnivore",
      "War Dog Moirax",
      "War Dog Stalker"
    ]) {
      const definition = unit11e(faction, name);
      const entry = createDefaultRosterEntry(definition);
      assert.deepEqual(validateLoadout(definition, entry), [], `${faction}: ${name}`);
    }
  }
});

test("inactive negative minimum sentinels never create non-finite Assassin defaults", () => {
  for (const name of [
    "Vindicare Assassin",
    "Culexus Assassin",
    "Eversor Assassin",
    "Callidus Assassin"
  ]) {
    const definition = unit11e("Imperium - Agents of the Imperium", name);
    const entry = createDefaultRosterEntry(definition);
    assert.equal(Object.values(entry.selections).every(Number.isFinite), true, name);
    assert.deepEqual(validateLoadout(definition, entry), [], name);
  }
});

test("selected group-level Unit profiles contribute their descendant model count", () => {
  for (const [faction, name, expectedCount] of [
    ["Imperium - Adeptus Astartes - Space Wolves", "Wulfen", 5],
    ["Imperium - Adeptus Astartes - Ultramarines", "Victrix Honour Guard", 1]
  ]) {
    const definition = unit11e(faction, name);
    const units = getConfiguredProfiles(definition, createDefaultRosterEntry(definition)).units;
    assert.equal(units.find(profile => profile.name === name)?.count, expectedCount, name);
  }
});
