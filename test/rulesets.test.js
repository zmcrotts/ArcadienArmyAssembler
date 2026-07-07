"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const {
  DEFAULT_RULESET_SOURCE_ID,
  extractNormalizedRuleset,
  getRulesetSource,
  listRulesetSources
} = require("../src/rulesets/sources");
const {
  createDefaultRosterEntry,
  getConfiguredModels,
  getConfiguredProfiles,
  getOptionStates,
  setSelection,
  setUnitSize,
  validateLoadout
} = require("../src/domain/loadout");
const { calculateEntryPoints } = require("../src/domain/pricing");

test("ruleset registry exposes the default 11e source", () => {
  const source = getRulesetSource(DEFAULT_RULESET_SOURCE_ID);

  assert.equal(source.id, "wh40k-11e-vflam");
  assert.equal(source.format, "bsdata-json");
  assert.equal(source.primary, true);
  assert.ok(fs.existsSync(source.sourcePath));
});

test("ruleset registry lists sources as copies", () => {
  const [source] = listRulesetSources();
  source.id = "mutated";

  assert.equal(getRulesetSource(DEFAULT_RULESET_SOURCE_ID).id, "wh40k-11e-vflam");
  assert.equal(getRulesetSource("wh40k-10e-bsdata").format, "bsdata-xml");
});

test("ruleset registry rejects unknown sources", () => {
  assert.throws(
    () => getRulesetSource("wh40k-11e-missing"),
    /Unknown ruleset source/
  );
});

test("11e native imported catalogues are available in their playable faction", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const daemons = ruleset.units.filter(unit => unit.faction === "Chaos - Chaos Daemons");
  const daemonArmy = ruleset.armies.find(army => army.faction === "Chaos - Chaos Daemons");
  const names = new Set(daemons.map(unit => unit.name));

  for (const name of [
    "Be'lakor",
    "Skarbrand",
    "Bloodthirster",
    "Bloodletters",
    "Kairos Fateweaver",
    "Lord of Change",
    "Screamers",
    "Flamers",
    "Pink Horrors",
    "Blue Horrors",
    "The Changeling"
  ]) {
    assert.ok(names.has(name), `Missing native Chaos Daemons unit ${name}`);
  }

  const belakor = daemons.find(unit => unit.name === "Be'lakor");
  assert.equal(belakor.source.importedFromFaction, "Chaos - Daemons Library");
  assert.ok(daemonArmy.allowedSelectionKeys.includes(belakor.selectionKey));
});

test("11e ruleset attaches New Recruit detachment stratagems", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const daemonArmy = ruleset.armies.find(army => army.faction === "Chaos - Chaos Daemons");
  const daemonicIncursion = daemonArmy.detachments.find(detachment => detachment.name === "Daemonic Incursion");

  assert.equal(ruleset.stratagemSource.kind, "merged-stratagem-sources");
  assert.ok(ruleset.stratagemSource.name.includes("Local 11e Core Stratagems"));
  assert.ok(ruleset.stratagemSource.name.includes("Stratagems"));
  assert.ok(daemonArmy.coreStratagems.length > 0);
  assert.ok(daemonArmy.coreStratagems.some(stratagem => stratagem.name === "Command Re-roll"));
  assert.ok(daemonArmy.coreStratagems.some(stratagem => stratagem.name === "Explosives"));
  assert.ok(daemonArmy.coreStratagems.some(stratagem => stratagem.name === "Crushing Impact"));
  assert.ok(daemonArmy.coreStratagems.some(stratagem => stratagem.name === "Snap Shooting"));
  assert.ok(daemonArmy.coreStratagems.some(stratagem => stratagem.name === "Counteroffensive" && stratagem.cpCost === "2"));
  assert.ok(!daemonArmy.coreStratagems.some(stratagem => stratagem.name === "Go to Ground"));
  assert.ok(!daemonArmy.coreStratagems.some(stratagem => stratagem.name === "Tank Shock"));
  assert.ok(daemonArmy.coreStratagems.every(stratagem => stratagem.scope === "core"));
  assert.ok(daemonicIncursion.stratagems.length > 0);
  assert.ok(daemonicIncursion.stratagems.every(stratagem => stratagem.scope === "detachment"));
  assert.ok(daemonicIncursion.stratagems.some(stratagem => stratagem.detachment === "Daemonic Incursion"));
});

test("11e ruleset gap-fills incomplete army rules", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const orks = ruleset.armies.find(army => army.faction === "Xenos - Orks");
  assert.ok(orks, "Missing Orks army definition");
  const waaagh = orks.armyRules.find(rule => rule.name === "Waaagh!");

  assert.ok(waaagh, "Missing Waaagh! army rule");
  assert.match(waaagh.description, /eligible to declare a charge/i);
  assert.match(waaagh.description, /Strength and Attacks characteristics/i);
  assert.match(waaagh.description, /5\+ invulnerable save/i);
  assert.equal(waaagh.source.name, "Local 11e Army Rule Gap-fill");
});

test("11e ruleset gap-fills missing Tyranids detachment stratagems without replacing New Recruit data", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const tyranids = ruleset.armies.find(army => army.faction === "Xenos - Tyranids");

  for (const detachmentName of [
    "Invasion Fleet",
    "Crusher Stampede",
    "Unending Swarm",
    "Assimilation Swarm",
    "Vanguard Onslaught",
    "Synaptic Nexus"
  ]) {
    const detachment = tyranids.detachments.find(item => item.name === detachmentName);
    assert.equal(detachment.stratagems.length, 6, `${detachmentName} should have six gap-filled stratagems`);
    assert.ok(detachment.stratagems.every(stratagem => stratagem.sourceUrl?.includes("wahapedia.ru")));
  }

  const talons = tyranids.detachments.find(item => item.name === "Talons of the Norn Queen");
  assert.equal(talons.stratagems.length, 3);
  assert.ok(talons.stratagems.every(stratagem => stratagem.detachment === "Talons of the Norn Queen"));
});

test("11e ruleset reads detachment point modifiers from catalogue-specific detachments", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const bloodAngels = ruleset.armies.find(army => army.faction === "Imperium - Adeptus Astartes - Blood Angels");
  const liberator = bloodAngels.detachments.find(item => item.name === "Liberator Assault Group");
  const angelic = bloodAngels.detachments.find(item => item.name === "Angelic Inheritors");

  assert.equal(liberator.detachmentPoints, 3);
  assert.equal(angelic.detachmentPoints, 3);
});

test("11e ruleset recognizes alternate detachment root names", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const custodes = ruleset.armies.find(army => army.faction === "Imperium - Adeptus Custodes");
  const leagues = ruleset.armies.find(army => army.faction === "Xenos - Leagues of Votann");

  assert.ok(custodes.detachments.length > 0, "Custodes should expose Detachments root");
  assert.ok(leagues.detachments.length > 0, "Leagues should expose Detachment Choice root");
  assert.equal(custodes.detachments.some(item => item.name === "Shield Host"), true);
  assert.equal(leagues.detachments.some(item => /oathband/i.test(item.name)), true);
});

test("11e ruleset keeps Crucible custom characters out of the main roster pool", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");

  assert.equal(ruleset.units.some(unit => /\[Crucible\]/i.test(unit.name)), false);
});

test("11e ruleset skips unpriced model shells but keeps priced Legends units", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const tau = ruleset.units.filter(unit => unit.faction === "Xenos - T'au Empire");
  const byName = name => tau.filter(unit => unit.name === name);

  assert.equal(byName("Shas'o R'alai").length, 0);
  assert.equal(byName("Shas'o R'alai [Legends]").length, 1);
  assert.equal(calculateEntryPoints(byName("Shas'o R'alai [Legends]")[0], createDefaultRosterEntry(byName("Shas'o R'alai [Legends]")[0])).points, 80);
  assert.equal(calculateEntryPoints(byName("The Twin Lance")[0], createDefaultRosterEntry(byName("The Twin Lance")[0])).points, 205);
});

test("11e Astartes chapter catalogues include shared Space Marine units and support leader targets", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const bloodAngelsUnits = ruleset.units.filter(unit => unit.faction === "Imperium - Adeptus Astartes - Blood Angels");
  const sanguinaryPriest = bloodAngelsUnits.find(unit => unit.name === "Sanguinary Priest");
  const bladeguard = bloodAngelsUnits.find(unit => unit.name === "Bladeguard Veteran Squad");

  assert.ok(bladeguard, "Blood Angels should include shared Space Marine Bladeguard Veteran Squad");
  assert.ok(
    sanguinaryPriest.rosterRules.leaderTargetSelectionKeys.includes(bladeguard.selectionKey),
    "Sanguinary Priest should be allowed to lead Bladeguard Veteran Squad"
  );
  assert.equal(sanguinaryPriest.rosterRules.leaderTargetNames.includes("even if one Captain"), false);
});

test("11e ruleset applies MFM leader and support attachment roles", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const sororitas = ruleset.units.filter(unit => unit.faction === "Imperium - Adepta Sororitas");
  const dialogus = sororitas.find(unit => unit.name === "Dialogus");
  const canoness = sororitas.find(unit => unit.name === "Canoness");
  const battleSisters = sororitas.find(unit => unit.name === "Battle Sisters Squad");

  assert.equal(dialogus.roles.leader, true);
  assert.equal(dialogus.roles.support, true);
  assert.equal(dialogus.rosterRules.allowsAdditionalLeader, true);
  assert.equal(dialogus.rosterRules.mfmAttachmentRole, "SUPPORT");
  assert.ok(dialogus.rosterRules.leaderTargetSelectionKeys.includes(battleSisters.selectionKey));

  assert.equal(canoness.roles.leader, true);
  assert.equal(canoness.roles.support, false);
  assert.equal(canoness.rosterRules.mfmAttachmentRole, "LEADER");
  assert.ok(canoness.rosterRules.leaderTargetSelectionKeys.includes(battleSisters.selectionKey));
});

test("11e Space Marine unit wargear controls do not include detachment upgrades", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const captain = ruleset.units.find(unit =>
    unit.faction === "Imperium - Adeptus Astartes - Space Marines" && unit.name === "Captain"
  );
  const states = getOptionStates(captain, createDefaultRosterEntry(captain))
    .filter(option => option.active && (option.editable || (option.current > 0 && option.kind !== "model")));
  const names = new Set(states.map(item => item.name));

  assert.equal(names.has("Fervent Exemplars"), false);
  assert.equal(names.has("Thirst for Glory"), false);
  assert.ok(names.has("Power fist"));
});

test("11e Death Company Marines with Jump Packs expose explicit alternate weapon lanes", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const deathCompany = ruleset.units.find(unit =>
    unit.faction === "Imperium - Adeptus Astartes - Blood Angels"
    && unit.name === "Death Company Marines with Jump Packs"
  );
  const entry = createDefaultRosterEntry(deathCompany);
  const tenModels = setUnitSize(deathCompany, entry, 10);
  const states = getOptionStates(deathCompany, tenModels);
  const state = name => states.find(option => option.name === name);

  for (const name of ["Plasma pistol", "Eviscerator"]) {
    assert.equal(state(name).groupMaximum, 2);
  }
  assert.equal(state("Power fist").groupMaximum, 1);
  assert.equal(state("Power weapon").groupMaximum, 1);

  for (const name of [
    "1 hand flamer and 1 Astartes chainsword",
    "1 hand flamer and 1 power fist",
    "1 hand flamer and 1 power weapon",
    "1 heavy bolt pistol and 1 power fist",
    "1 heavy bolt pistol and 1 power weapon",
    "1 inferno pistol and 1 Astartes chainsword",
    "1 inferno pistol and 1 power fist",
    "1 inferno pistol and 1 power weapon",
    "1 plasma pistol and 1 Astartes chainsword",
    "1 plasma pistol and 1 power fist",
    "1 plasma pistol and 1 power weapon"
  ]) {
    assert.equal(state(name).groupMaximum, 2, `Missing or uncapped paired option: ${name}`);
  }

  const alternateModel = states.find(option => option.name === "Death Company Marine w/ alternate weapons");
  const activeAlternates = setSelection(deathCompany, tenModels, alternateModel.id, 4, false);
  const overstackedPowerFists = JSON.parse(JSON.stringify(activeAlternates));
  overstackedPowerFists.selections[state("Power fist").id] = 2;
  assert.ok(
    validateLoadout(deathCompany, overstackedPowerFists).some(error =>
      error.name === "Power fist or power weapon" && error.type === "max"
    )
  );

  const oneAlternate = setSelection(deathCompany, tenModels, alternateModel.id, 1, false);
  const defaultAlternateProfiles = getConfiguredProfiles(deathCompany, oneAlternate);
  const defaultAlternateModels = getConfiguredModels(deathCompany, oneAlternate);
  const weaponCount = (configured, name) =>
    configured.weapons
      .filter(profile => profile.name === name)
      .reduce((sum, profile) => sum + Number(profile.count || 0), 0);

  assert.equal(weaponCount(defaultAlternateProfiles, "Heavy Bolt Pistol"), 10);
  assert.equal(weaponCount(defaultAlternateProfiles, "Astartes Chainsword"), 10);
  assert.deepEqual(
    defaultAlternateModels.find(model => model.name === "Death Company Marine w/ alternate weapons").equipment,
    ["Astartes Chainsword", "Heavy Bolt Pistol"]
  );

  const oneStandalonePlasma = setSelection(deathCompany, oneAlternate, state("Plasma pistol").id, 1, false);
  const plasmaProfiles = getConfiguredProfiles(deathCompany, oneStandalonePlasma);
  const plasmaModels = getConfiguredModels(deathCompany, oneStandalonePlasma);
  assert.equal(weaponCount(plasmaProfiles, "Heavy Bolt Pistol"), 9);
  assert.equal(weaponCount(plasmaProfiles, "Astartes Chainsword"), 10);
  assert.equal(weaponCount(plasmaProfiles, "➤ Plasma pistol - standard"), 1);
  assert.equal(weaponCount(plasmaProfiles, "➤ Plasma pistol - supercharge"), 1);
  assert.deepEqual(
    plasmaModels.find(model => model.name === "Death Company Marine w/ alternate weapons").equipment,
    ["Astartes Chainsword", "Plasma pistol"]
  );
});

test("11e configured abilities collapse duplicate same-name wargear rules", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const captain = ruleset.units.find(unit =>
    unit.faction === "Imperium - Adeptus Astartes - Space Marines" && unit.name === "Captain"
  );
  const entry = createDefaultRosterEntry(captain);
  const shieldPackage = getOptionStates(captain, entry)
    .find(option => option.name === "Heavy Bolt Pistol, Master-crafted power weapon and 1 Relic Shield");
  const configured = getConfiguredProfiles(captain, setSelection(captain, entry, shieldPackage.id, 1));
  const relicShield = configured.abilities.filter(ability => ability.name === "Relic Shield");

  assert.equal(relicShield.length, 1);
  assert.match(relicShield[0].characteristics.Description, /Wounds characteristic of 6/);
});

test("11e Templar Vows stays scoped to Black Templars units", () => {
  const ruleset = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID);
  const configuredRules = unit => {
    const entry = createDefaultRosterEntry(unit);
    return getConfiguredProfiles(unit, entry).rules.map(rule => rule.name);
  };
  const blackTemplarsUnit = ruleset.units.find(unit =>
    unit.faction === "Imperium - Adeptus Astartes - Black Templars"
    && configuredRules(unit).includes("Templar Vows")
  );
  const nonBlackTemplarsUnits = ruleset.units.filter(unit =>
    unit.faction !== "Imperium - Adeptus Astartes - Black Templars"
    && configuredRules(unit).includes("Templar Vows")
  );

  assert.ok(blackTemplarsUnit, "expected at least one Black Templars unit to retain Templar Vows");
  assert.deepEqual(nonBlackTemplarsUnits.map(unit => [unit.faction, unit.name]), []);
});

test("11e ruleset extracts detachment upgrades with unit eligibility", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const tyranids = ruleset.armies.find(army => army.faction === "Xenos - Tyranids");
  const talons = tyranids.detachments.find(item => item.name === "Talons of the Norn Queen");
  const assimilator = ruleset.units.find(unit => unit.faction === "Xenos - Tyranids" && unit.name === "Norn Assimilator");
  const emissary = ruleset.units.find(unit => unit.faction === "Xenos - Tyranids" && unit.name === "Norn Emissary");
  const synaptoprescience = tyranids.enhancements.find(item => item.name === "Synaptoprescience");
  const destabilisingPredation = tyranids.enhancements.find(item => item.name === "Destabilising Predation");

  assert.equal(synaptoprescience.kind, "upgrade");
  assert.equal(synaptoprescience.maxSelections, 3);
  assert.equal(synaptoprescience.points, 25);
  assert.deepEqual(synaptoprescience.detachmentIds, [talons.id]);
  assert.deepEqual(synaptoprescience.eligibleSelectionKeys, [assimilator.selectionKey]);
  assert.ok(synaptoprescience.profiles[0].characteristics.Description.includes("4+"));

  assert.equal(destabilisingPredation.kind, "upgrade");
  assert.deepEqual(destabilisingPredation.eligibleSelectionKeys, [emissary.selectionKey]);

  const worldEaters = ruleset.armies.find(army => army.faction === "Chaos - World Eaters");
  const brazenEngines = worldEaters.detachments.find(item => item.name === "Brazen Engines");
  const maulerfiend = ruleset.units.find(unit => unit.faction === "Chaos - World Eaters" && unit.name === "Maulerfiend");
  const talonsOfButchery = worldEaters.enhancements.find(item => item.name === "Talons of Butchery");
  const murderousEntity = worldEaters.enhancements.find(item => item.name === "Murder-forged Entity");

  assert.equal(talonsOfButchery.kind, "upgrade");
  assert.equal(talonsOfButchery.points, 20);
  assert.deepEqual(talonsOfButchery.detachmentIds, [brazenEngines.id]);
  assert.deepEqual(talonsOfButchery.eligibleSelectionKeys, [maulerfiend.selectionKey]);
  assert.equal(murderousEntity.eligibleSelectionKeys.includes(maulerfiend.selectionKey), true);
  assert.equal(murderousEntity.eligibleSelectionKeys.some(key => ruleset.units.find(unit => unit.selectionKey === key)?.name === "Khorne Berzerkers"), false);
});

test("11e Tyranids do not expose Genestealer Cults detachments", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const tyranids = ruleset.armies.find(army => army.faction === "Xenos - Tyranids");
  const genestealerCults = ruleset.armies.find(army => army.faction === "Xenos - Genestealer Cults");
  const tyranidNames = new Set(tyranids.detachments.map(item => item.name));
  const cultNames = new Set(genestealerCults.detachments.map(item => item.name));

  assert.ok(tyranidNames.has("Talons of the Norn Queen"));
  for (const name of ["Final Day", "Heroes of the Uprising", "Purestrain Broodswarm", "Xenocult Masses"]) {
    assert.equal(tyranidNames.has(name), false, `${name} should not be shown as a Tyranids detachment`);
    assert.equal(cultNames.has(name), true, `${name} should remain available to Genestealer Cults`);
  }
});

test("11e copy-count point modifiers apply only to third and later copies", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const orks = ruleset.units.filter(unit => unit.faction === "Xenos - Orks");
  const unit = name => {
    const found = orks.find(item => item.name === name);
    assert.ok(found, `Missing Orks unit ${name}`);
    return found;
  };

  for (const [name, expected] of [
    ["Big Mek Dakkarig", 100],
    ["Breaka Boyz", 125],
    ["Gorkanaut", 255]
  ]) {
    const definition = unit(name);
    const entry = createDefaultRosterEntry(definition);
    assert.equal(calculateEntryPoints(definition, entry).points, expected);
  }

  for (const [name, expected] of [
    ["Big Mek Dakkarig", 110],
    ["Breaka Boyz", 135],
    ["Gorkanaut", 275]
  ]) {
    const definition = unit(name);
    const entry = createDefaultRosterEntry(definition);
    entry.context = { previousCopies: 2 };
    assert.equal(calculateEntryPoints(definition, entry).points, expected);
  }

  const nobz = unit("Nobz");
  const nobzEntry = {
    schemaVersion: 1,
    instanceId: "nobz-test-entry",
    unitId: nobz.id,
    selections: Object.fromEntries(nobz.composition.map(selection => [selection.id, 0]))
  };
  nobzEntry.selections[nobz.composition.find(item => item.name === "Boss Nob").id] = 1;
  nobzEntry.selections[nobz.composition.find(item => item.name !== "Boss Nob").id] = 9;

  assert.equal(calculateEntryPoints(nobz, nobzEntry).points, 210);
  assert.equal(calculateEntryPoints(nobz, { ...nobzEntry, context: { previousCopies: 2 } }).points, 220);
});
