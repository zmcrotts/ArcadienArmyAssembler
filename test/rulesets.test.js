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
  getConfiguredUnitName,
  getConfiguredModels,
  getConfiguredProfiles,
  getOptionStates,
  getUnitSizeState,
  normalizeRosterEntry,
  setSelection,
  setUnitSize,
  validateLoadout
} = require("../src/domain/loadout");
const { calculateEntryPoints } = require("../src/domain/pricing");
const { createArmyState, getUnitAssignmentState, leaderCanTarget } = require("../src/domain/army");
const {
  buildRosterSheets,
  extractUnitEffects,
  extractWeaponEffects
} = require("../src/domain/sheets");
const { audit: auditEnhancementEligibility } = require("../scripts/audit-enhancement-eligibility");

test("ruleset registry exposes the default 11e source", () => {
  const source = getRulesetSource(DEFAULT_RULESET_SOURCE_ID);

  assert.equal(source.id, "wh40k-11e-vflam");
  assert.equal(source.format, "bsdata-json");
  assert.equal(source.primary, true);
  assert.equal(source.available, true);
  assert.ok(fs.existsSync(source.sourcePath));
});

test("ruleset registry lists sources as copies", () => {
  const [source] = listRulesetSources();
  source.id = "mutated";

  assert.equal(getRulesetSource(DEFAULT_RULESET_SOURCE_ID).id, "wh40k-11e-vflam");
  assert.equal(getRulesetSource("wh40k-10e-bsdata").format, "bsdata-xml");
});

test("normalized rulesets are memoized within a process", () => {
  const first = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID);
  const second = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID);
  assert.strictEqual(first, second);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.units), true);
  assert.equal(Object.isFrozen(first.units[0]), true);
});

test("normalized enhancements and detachments expose only their always-on characteristic changes", () => {
  const ruleset = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID);
  const allEnhancements = ruleset.armies.flatMap(army => army.enhancements || []);
  const allDetachmentRules = ruleset.armies.flatMap(army =>
    (army.detachments || []).flatMap(detachment =>
      (detachment.rules || []).map(rule => ({ ...rule, sourceKind: "detachment" }))
    )
  );
  const effectsFor = (name, items = allEnhancements) => {
    const item = items.find(candidate => candidate.name === name);
    assert.ok(item, `Missing corpus rule ${name}`);
    return [...extractUnitEffects([item]), ...extractWeaponEffects([item])];
  };
  const characteristicsFor = (name, items) =>
    new Set(effectsFor(name, items).map(effect => effect.characteristic));

  assert.deepEqual(characteristicsFor("Bringer of Justice"), new Set(["A"]));
  assert.deepEqual(characteristicsFor("Weavers' Wail"), new Set(["S", "A"]));
  assert.deepEqual(characteristicsFor("Iron Surplice of Saint Istalela"), new Set(["SV"]));
  assert.deepEqual(characteristicsFor("Legacy Sidearm"), new Set(["A"]));
  assert.deepEqual(characteristicsFor("Power of the Hive Mind"), new Set(["S", "AP"]));
  assert.deepEqual(characteristicsFor("Admonimortis"), new Set(["S", "AP", "D"]));
  assert.deepEqual(characteristicsFor("Moritoi Ancients", allDetachmentRules), new Set(["M"]));
  assert.deepEqual(characteristicsFor("Travelling Players", allDetachmentRules), new Set(["OC"]));
  assert.deepEqual(characteristicsFor("Cyber Psalm-Programming", allDetachmentRules), new Set(["M"]));

  assert.equal(effectsFor("Panoply of the Cursed Knights").length, 0);
  assert.equal(effectsFor("Possessed Blade").length, 0);
  assert.equal(effectsFor("Strategic Conqueror").length, 0);
});

test("CSM Daemon Princes must choose one God Blessing and each blessing updates their sheet", () => {
  const ruleset = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID);
  const princes = ruleset.units.filter(unit =>
    unit.faction === "Chaos - Chaos Space Marines"
    && /^Heretic Astartes Daemon Prince(?: with wings)?$/i.test(unit.name)
  );
  assert.equal(princes.length, 2);

  for (const prince of princes) {
    const initial = createDefaultRosterEntry(prince);
    const blessingStates = getOptionStates(prince, initial).filter(option =>
      ["Khorne", "Nurgle", "Slaanesh", "Tzeentch"].includes(option.name)
    );
    assert.deepEqual(blessingStates.map(option => option.name), ["Khorne", "Nurgle", "Slaanesh", "Tzeentch"]);
    assert.equal(blessingStates.filter(option => option.current === 1).length, 1);
    assert.equal(blessingStates.every(option =>
      option.groupMinimum === 1 && option.groupMaximum === 1 && option.mutuallyExclusive
    ), true);

    for (const blessing of blessingStates) {
      const selected = setSelection(prince, initial, blessing.id, 1);
      assert.equal(getConfiguredUnitName(prince, selected), `${prince.name} of ${blessing.name}`);
      const configured = getConfiguredProfiles(prince, selected);
      const sheets = buildRosterSheets({
        name: `${prince.name} - ${blessing.name}`,
        totalPoints: prince.points,
        rosterEntries: [{
          ...selected,
          name: prince.name,
          points: prince.points,
          keywords: prince.keywords,
          configured
        }]
      });
      const sheet = sheets.combinedUnitSheets[0];
      const statline = sheet.statlines[0].characteristics;
      const hellforged = sheet.meleeWeapons.filter(weapon => /Hellforged weapons/i.test(weapon.name));
      const cannon = sheet.rangedWeapons.find(weapon => weapon.name === "Infernal cannon");

      if (blessing.name === "Khorne") {
        assert.deepEqual(hellforged.map(weapon => weapon.characteristics.S), ["10", "8"]);
        assert.equal(hellforged.every(weapon => weapon.modifiedCharacteristics.includes("S")), true);
      }
      if (blessing.name === "Nurgle") {
        assert.equal(statline.T, prince.name.endsWith("with wings") ? "10" : "11");
        assert.equal(sheet.statlines[0].modifiedCharacteristics.includes("T"), true);
      }
      if (blessing.name === "Slaanesh") {
        assert.equal(statline.M, prince.name.endsWith("with wings") ? "14\"" : "10\"");
        assert.equal(sheet.statlines[0].modifiedCharacteristics.includes("M"), true);
      }
      if (blessing.name === "Tzeentch") {
        assert.equal(cannon.characteristics.A, "6");
        assert.equal(cannon.modifiedCharacteristics.includes("A"), true);
      }
    }
  }
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
  assert.match(waaagh.description, /riled up/i);
  assert.match(waaagh.description, /re-roll Advance rolls/i);
  assert.match(waaagh.description, /\[ASSAULT\]/);
  assert.match(waaagh.description, /until the end of the next turn/i);
  assert.doesNotMatch(waaagh.description, /Strength and Attacks characteristics/i);
  assert.match(waaagh.description, /5\+ invulnerable save/i);
  assert.equal(waaagh.source.name, "Local 11e Army Rule Gap-fill");
});

test("Custodes expose Martial Ka'tah as an army rule", () => {
  const ruleset = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID, { fresh: true });
  const custodes = ruleset.armies.find(army => army.faction === "Imperium - Adeptus Custodes");
  const martialKatah = custodes?.armyRules.filter(rule => rule.name === "Martial Ka'tah") || [];

  assert.equal(martialKatah.length, 1);
  assert.match(martialKatah[0].description, /selected to fight/i);
  assert.match(martialKatah[0].description, /Dacatarai Stance/i);
  assert.match(martialKatah[0].description, /Rendax Stance/i);
  assert.equal(martialKatah[0].source.name, "Local 11e Army Rule Gap-fill");
});

test("Adepta Sororitas expose Acts of Faith as an army rule", () => {
  const ruleset = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID, { fresh: true });
  const sisters = ruleset.armies.find(army => army.faction === "Imperium - Adepta Sororitas");
  const actsOfFaith = sisters?.armyRules.filter(rule => rule.name === "Acts of Faith") || [];

  assert.equal(actsOfFaith.length, 1);
  assert.match(actsOfFaith[0].description, /gain 1 Miracle dice/i);
  assert.match(actsOfFaith[0].description, /perform one Act of Faith per phase/i);
  assert.match(actsOfFaith[0].description, /Saving throw/i);
  assert.equal(actsOfFaith[0].source.name, "Local 11e Army Rule Gap-fill");
});

test("Imperial Knights inherit Code Chivalric from their native library catalogue", () => {
  const ruleset = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID);
  const knights = ruleset.armies.find(item => item.faction === "Imperium - Imperial Knights");
  const codeChivalric = knights?.armyRules.find(item => item.name === "Code Chivalric");

  assert.ok(codeChivalric);
  assert.match(codeChivalric.description, /determine your army's Oath/i);
  assert.match(codeChivalric.description, /one Deed and one Quality/i);
  assert.match(codeChivalric.description, /army becomes Honoured/i);
  assert.deepEqual(codeChivalric.tables.map(table => table.name), ["Deed", "Quality"]);
  assert.equal(codeChivalric.tables[0].rows.length, 3);
  assert.equal(codeChivalric.tables[1].rows.length, 3);
  assert.deepEqual(codeChivalric.tables[0].rows.map(row => row.result), ["1 or 2", "3 or 4", "5 or 6"]);
  assert.deepEqual(codeChivalric.tables[1].rows.map(row => row.result), ["1 or 2", "3 or 4", "5 or 6"]);
  assert.match(codeChivalric.tables[0].rows.find(row => row.result === "1 or 2").description, /Character/i);
  assert.match(codeChivalric.tables[1].rows.find(row => row.result === "5 or 6").description, /Objective Control/i);
});

test("Questor Forgepact retains its named ability definitions in rules and sheets", () => {
  const ruleset = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID);
  const knights = ruleset.armies.find(item => item.faction === "Imperium - Imperial Knights");
  const forgepact = knights?.detachments.find(item => item.name === "Questor Forgepact");
  const assistedTargeting = forgepact?.rules.find(item => item.name === "Assisted Targeting (Aura)");
  const sacristanPledge = forgepact?.rules.find(item => item.name === "Sacristan Pledge");

  assert.match(assistedTargeting?.description || "", /within 6.+ADEPTUS MECHANICUS/i);
  assert.match(assistedTargeting?.description || "", /\+1 \*\*BS\*\*/i);
  assert.match(assistedTargeting?.description || "", /\*\*\[HEAVY\]\*\*/i);
  assert.match(sacristanPledge?.description || "", /within 3.+heals.+D3 wounds/i);

  const sheets = buildRosterSheets({
    faction: knights.faction,
    detachments: [forgepact],
    rosterEntries: []
  });
  const sheetRules = sheets.referenceSheets.rules.detachments[0].rules;
  assert.ok(sheetRules.some(item => item.name === "Assisted Targeting (Aura)"));
  assert.ok(sheetRules.some(item => item.name === "Sacristan Pledge"));

  const rangers = ruleset.units.find(item =>
    item.faction === "Imperium - Imperial Knights"
    && item.name === "Skitarii Rangers"
  );
  const configured = getConfiguredProfiles(rangers, createDefaultRosterEntry(rangers));
  const rangerSheets = buildRosterSheets({
    faction: knights.faction,
    detachments: [forgepact],
    rosterEntries: [{
      instanceId: "rangers-1",
      name: rangers.name,
      keywords: rangers.keywords || rangers.categories,
      configured
    }],
    groupedPresentation: [{
      id: "unit:rangers-1",
      kind: "unit",
      memberInstanceIds: ["rangers-1"],
      warnings: []
    }]
  });
  const galvanicRifle = rangerSheets.combinedUnitSheets[0].rangedWeapons.find(item => item.name === "Galvanic rifle");
  assert.equal(galvanicRifle.characteristics.BS, "4+");
  assert.doesNotMatch(galvanicRifle.keywords, /\b(?:Heavy|Assault)\b/i);
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

test("11e ruleset exposes the shared Force Dispositions reference set", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const army = ruleset.armies.find(item => item.faction === "Imperium - Adeptus Astartes - Space Marines");
  const takeAndHold = army.forceDispositions.find(item => item.name === "Take and Hold");

  assert.deepEqual((army.forceDispositions || []).map(item => item.name), [
    "Disruption",
    "Priority Assets",
    "Purge the Foe",
    "Take and Hold",
    "Reconnaissance"
  ]);
  assert.deepEqual(takeAndHold.missionMap.map(item => `${item.name} vs ${item.opponentDisposition}`), [
    "Battlefield Dominance vs Take and Hold",
    "Determined Acquisition vs Disruption",
    "Immovable Object vs Purge the Foe",
    "Inescapable Dominion vs Priority Assets",
    "Purge and Secure vs Reconnaissance"
  ]);
  assert.equal(takeAndHold.missionMap[0].sourceUrl, undefined);
  assert.equal(takeAndHold.missionMap[0].cardImages.front, "assets/11th/primary-missions/take-and-hold/battlefield-dominance.png");
  assert.equal(takeAndHold.missionMap[0].cardImages.back, null);
  assert.equal(takeAndHold.missionMap[3].cardImages.back, null);
  assert.ok(army.forceDispositions.every(item => item.missionMap.length === 5));

  const disruption = army.forceDispositions.find(item => item.name === "Disruption");
  assert.equal(disruption.missionMap[0].cardImages.front, "assets/11th/primary-missions/disruption/death-trap.png");
  assert.equal(disruption.missionMap[0].cardImages.back, "assets/11th/primary-missions/disruption/death-trap-back.png");

  const orks = ruleset.armies.find(item => item.faction === "Xenos - Orks");
  const warHorde = orks.detachments.find(item => item.name === "War Horde");
  assert.equal(warHorde.forceDisposition.name, "Take and Hold");
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

test("11e ruleset exposes Crucible custom characters for catalogue preference filtering", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const crucibleUnits = ruleset.units.filter(unit => /\[Crucible\]/i.test(unit.name));

  assert.ok(crucibleUnits.length > 0);
  assert.ok(crucibleUnits.some(unit => unit.faction === "Imperium - Adeptus Custodes" && unit.name === "Guardian of the Throne [Crucible]"));
  assert.ok(crucibleUnits.some(unit => unit.faction === "Xenos - Tyranids" && unit.name === "Node Organism [Crucible]"));
});

test("Tyranid Crucible organisms default to visible equipment and unlock specialism options", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const nodeOrganism = ruleset.units.find(unit =>
    unit.faction === "Xenos - Tyranids" && unit.name === "Node Organism [Crucible]"
  );
  assert.ok(nodeOrganism);

  const entry = createDefaultRosterEntry(nodeOrganism);
  const states = getOptionStates(nodeOrganism, entry);
  assert.deepEqual(states.filter(option => !option.active && option.current > 0), []);
  assert.ok(states.some(option => option.active && option.current > 0));
  assert.ok(getConfiguredProfiles(nodeOrganism, entry).weapons.length > 0);

  const leaderBeast = states.find(option => option.name === "Leader-beast");
  const leaderEntry = setSelection(nodeOrganism, entry, leaderBeast.id, 1);
  const psychicOverload = getOptionStates(nodeOrganism, leaderEntry)
    .find(option => option.name === "Psychic overload");
  assert.equal(psychicOverload.active, true);
  assert.equal(psychicOverload.editable, true);

  const staleEntry = JSON.parse(JSON.stringify(entry));
  staleEntry.selections["removed-selection-id"] = 1;
  for (const option of states.filter(item => item.current > 0)) staleEntry.selections[option.id] = 0;
  for (const name of ["Synaptic Senses (Psychic)", "Crushing claws"]) {
    const hiddenOption = states.find(option => option.name === name);
    staleEntry.selections[hiddenOption.id] = 1;
  }
  const repairedEntry = normalizeRosterEntry(nodeOrganism, staleEntry);
  assert.equal(repairedEntry.selections["removed-selection-id"], undefined);
  const repairedStates = getOptionStates(nodeOrganism, repairedEntry);
  assert.deepEqual(repairedStates.filter(option => !option.active && option.current > 0), []);
  assert.ok(getConfiguredProfiles(nodeOrganism, repairedEntry).weapons.length > 0);

  const primeOrganism = ruleset.units.find(unit =>
    unit.faction === "Xenos - Tyranids" && unit.name === "Prime Organism [Crucible]"
  );
  assert.ok(primeOrganism);
  const primeStates = getOptionStates(primeOrganism, createDefaultRosterEntry(primeOrganism));
  const primeRanged = primeStates.filter(option => option.active && [
    "Barbed strangler",
    "Deathspitter",
    "Devourer",
    "Thoracic bio-weapon"
  ].includes(option.name));
  assert.ok(primeRanged.length > 0);
  assert.ok(primeRanged.every(option => option.maximum === 2 && option.groupMaximum === 2));
  const primeMelee = primeStates.filter(option => option.active && [
    "Crushing claws",
    "Scything talons",
    "Warrior-beast weapons"
  ].includes(option.name));
  assert.ok(primeMelee.length > 0);
  assert.ok(primeMelee.every(option => option.maximum === 1 && option.groupMaximum === 2));
});

test("11e ruleset skips unpriced model shells but keeps priced Legends units", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const tau = ruleset.units.filter(unit => unit.faction === "Xenos - T'au Empire");
  const byName = name => tau.filter(unit => unit.name === name);

  assert.equal(byName("Shas'o R'alai").length, 0);
  assert.equal(byName("Shas'o R'alai [Legends]").length, 1);
  assert.equal(calculateEntryPoints(byName("Shas'o R'alai [Legends]")[0], createDefaultRosterEntry(byName("Shas'o R'alai [Legends]")[0])).points, 80);
  assert.equal(calculateEntryPoints(byName("The Twin Lance")[0], createDefaultRosterEntry(byName("The Twin Lance")[0])).points, 230);
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

  const leaders = ruleset.units.filter(unit => unit.roles?.leader);
  assert.ok(leaders.length > 0, "ruleset should contain Leader units");
  for (const leader of leaders) {
    const targets = ruleset.units.filter(unit =>
      unit.faction === leader.faction
      && leader.rosterRules.leaderTargetSelectionKeys.includes(unit.selectionKey)
    );
    const targetNames = new Set(targets.map(unit => unit.name.toLowerCase()));
    assert.ok(leader.rosterRules.leaderTargetNames.length > 0, `${leader.faction}: ${leader.name} should list Leader target names`);
    assert.ok(leader.rosterRules.leaderTargetSelectionKeys.length > 0, `${leader.faction}: ${leader.name} should resolve Leader target keys`);
    assert.ok(targets.length > 0, `${leader.faction}: ${leader.name} should resolve to selectable bodyguard units`);
    for (const name of leader.rosterRules.leaderTargetNames) {
      assert.ok(targetNames.has(name.toLowerCase()), `${leader.faction}: ${leader.name} has unavailable Leader target ${name}`);
    }
  }
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

test("11e Einhyr Hearthguard squad ranged weapons stay freely swappable", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const hearthguard = ruleset.units.find(unit =>
    unit.faction === "Xenos - Leagues of Votann" && unit.name === "Einhyr Hearthguard"
  );
  const entry = setUnitSize(hearthguard, createDefaultRosterEntry(hearthguard), 5);
  const squadWeaponState = name => getOptionStates(hearthguard, entry)
    .find(option => option.name === name && option.parentId.includes("ccb3-8ee6-568d-eee9"));

  const plasma = squadWeaponState("EtaCarn plasma gun");
  const volkanite = squadWeaponState("Volkanite disintegrator");

  assert.equal(plasma.current, 4);
  assert.equal(plasma.maximum, 4);
  assert.equal(volkanite.current, 0);
  assert.equal(volkanite.maximum, 4);
  assert.equal(volkanite.editable, true);

  const swapped = setSelection(hearthguard, entry, volkanite.id, 4);
  assert.deepEqual(validateLoadout(hearthguard, swapped), []);
  assert.equal(getOptionStates(hearthguard, swapped).find(option => option.id === plasma.id).current, 0);
  assert.equal(getOptionStates(hearthguard, swapped).find(option => option.id === volkanite.id).current, 4);
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

test("11e Helbrutes gain two melee attacks when equipped with two melee weapons", () => {
  const ruleset = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID);
  const expectedAttacks = new Map([
    ["Chaos - Chaos Space Marines", "7"],
    ["Chaos - Death Guard", "7"],
    ["Chaos - Thousand Sons", "7"],
    ["Chaos - World Eaters", "8"]
  ]);

  for (const [faction, attacks] of expectedAttacks) {
    const unit = ruleset.units.find(item => item.faction === faction && item.name === "Helbrute");
    assert.ok(unit, `Missing ${faction} Helbrute`);
    let entry = createDefaultRosterEntry(unit);
    const choices = [];
    for (const option of getOptionStates(unit, entry).filter(item => /^Helbrute fist with/i.test(item.name))) {
      if (!choices.some(item => item.parentId === option.parentId)) choices.push(option);
    }
    assert.equal(choices.length, 2, `${faction} should expose one fist choice in each weapon lane`);
    for (const option of choices) entry = setSelection(unit, entry, option.id, 1);

    const fists = getConfiguredProfiles(unit, entry).weapons.filter(profile => profile.name === "Helbrute fist");
    assert.ok(fists.length > 0, `${faction} should configure Helbrute fists`);
    assert.equal(fists.every(profile => profile.characteristics.A === attacks), true, faction);
    assert.equal(fists.every(profile => profile.modifiedCharacteristics?.includes("A")), true, faction);
  }
});

test("11e Deathshroud Champion defaults to two plaguespurt gauntlets", () => {
  const ruleset = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID);
  const unit = ruleset.units.find(item =>
    item.faction === "Chaos - Death Guard" && item.name === "Deathshroud Terminators"
  );
  const entry = createDefaultRosterEntry(unit);
  const gauntlet = getConfiguredProfiles(unit, entry).weapons.find(profile => profile.name === "Plaguespurt gauntlet");
  const championOption = getOptionStates(unit, entry).find(option =>
    option.name === "Plaguespurt gauntlet" && option.maximum === 2
  );

  assert.equal(championOption?.current, 2);
  assert.equal(gauntlet?.count, 4);
  assert.equal(gauntlet?.characteristics.A, "D6");
});

test("11e ten-model Plague Marines grow and spend the default boltgun row", () => {
  const ruleset = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID);
  const unit = ruleset.units.find(item => item.faction === "Chaos - Death Guard" && item.name === "Plague Marines");
  let entry = setUnitSize(unit, createDefaultRosterEntry(unit), 10);
  const option = name => getOptionStates(unit, entry).find(item => item.name === name);

  assert.equal(option("Plague Marine w/ boltgun")?.current, 9);
  assert.equal(option("Plague Marine w/ bubotic weapons")?.current, 0);
  assert.equal(option("Plague Marine w/ heavy plague weapon")?.current, 0);

  const blightLauncher = option("Plague Marine w/ blight launcher");
  entry = setSelection(unit, entry, blightLauncher.id, 1);
  assert.equal(option("Plague Marine w/ boltgun")?.current, 8);
  assert.equal(option("Plague Marine w/ blight launcher")?.current, 1);
  assert.equal(option("Plague Marine w/ bubotic weapons")?.current, 0);
});

test("11e Scarab Occult heavy weapons replace a baseline Terminator without changing unit size", () => {
  const ruleset = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID);
  const unit = ruleset.units.find(item =>
    item.faction === "Chaos - Thousand Sons" && item.name === "Scarab Occult Terminators"
  );
  for (const name of [
    "Scarab Occult Terminator w/ heavy warpflamer",
    "Scarab Occult Terminator w/ soulreaper cannon"
  ]) {
    let entry = createDefaultRosterEntry(unit);
    const heavy = getOptionStates(unit, entry).find(option => option.name === name);
    assert.ok(heavy, name);
    entry = setSelection(unit, entry, heavy.id, 1);

    const baseline = getOptionStates(unit, entry).find(option => option.name === "Scarab Occult Terminator");
    assert.equal(getUnitSizeState(unit, entry).current, 5, name);
    assert.equal(baseline?.current, 3, name);
    assert.deepEqual(validateLoadout(unit, entry), [], name);
  }
});

test("11e Chaos Terminator heavy weapons are limited to one per five models", () => {
  const ruleset = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID);
  const unit = ruleset.units.find(item =>
    item.faction === "Chaos - Chaos Space Marines" && item.name === "Chaos Terminator Squad"
  );
  let entry = createDefaultRosterEntry(unit);
  let heavy = getOptionStates(unit, entry).find(option => option.name === "Heavy weapon");

  assert.equal(getUnitSizeState(unit, entry).current, 5);
  assert.equal(heavy?.maximum, 1);

  entry = setSelection(unit, entry, heavy.id, 2, false);
  assert.equal(validateLoadout(unit, entry).find(error => error.nodeId === heavy.id)?.message,
    "Max 1 Heavy weapon per 5 models");

  entry = setUnitSize(unit, createDefaultRosterEntry(unit), 10);
  heavy = getOptionStates(unit, entry).find(option => option.name === "Heavy weapon");
  assert.equal(heavy?.maximum, 2);
});

test("11e Chaos Terminator melee weapon caps apply across every loadout branch", () => {
  const ruleset = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID);
  const unit = ruleset.units.find(item =>
    item.faction === "Chaos - Chaos Space Marines" && item.name === "Chaos Terminator Squad"
  );
  const optionsNamed = (entry, name) => getOptionStates(unit, entry).filter(option => option.name === name);

  for (const [size, name, allowed, rejected] of [
    [5, "Power fist and combi-bolter", 3, 4],
    [5, "Chainfist and combi-bolter", 1, 2],
    [5, "Paired accursed weapons", 1, 2],
    [10, "Power fist and combi-bolter", 6, 7],
    [10, "Chainfist and combi-bolter", 2, 3],
    [10, "Paired accursed weapons", 2, 3]
  ]) {
    let entry = setUnitSize(unit, createDefaultRosterEntry(unit), size);
    const option = optionsNamed(entry, name)[0];
    assert.ok(option, `${size} models: ${name}`);
    entry = setSelection(unit, entry, option.id, allowed);
    assert.deepEqual(validateLoadout(unit, entry), [], `${size} models: ${allowed} ${name}`);
    entry = setSelection(unit, entry, option.id, rejected, false);
    assert.ok(validateLoadout(unit, entry).some(error => error.type === "max"),
      `${size} models: ${rejected} ${name}`);
  }

  let entry = setUnitSize(unit, createDefaultRosterEntry(unit), 10);
  const powerFistBolter = getOptionStates(unit, entry).find(option => option.name === "Power fist and combi-bolter");
  const powerFistCombi = getOptionStates(unit, entry).find(option => option.name === "Power fist and combi-weapon");
  assert.equal(powerFistBolter.maximum, 6);
  assert.equal(powerFistCombi.maximum, 6);
  entry = setSelection(unit, entry, powerFistCombi.id, 6);
  assert.deepEqual(validateLoadout(unit, entry), []);

  entry = setUnitSize(unit, createDefaultRosterEntry(unit), 10);
  entry = setSelection(unit, entry, powerFistBolter.id, 3);
  entry = setSelection(unit, entry, powerFistCombi.id, 4);
  assert.equal(validateLoadout(unit, entry).find(error => error.constraintId === "dc97-25d5-522e-4213")?.actual, 7);

  entry = setUnitSize(unit, createDefaultRosterEntry(unit), 10);
  const chainfistBolter = getOptionStates(unit, entry).find(option => option.name === "Chainfist and combi-bolter");
  const chainfistCombi = getOptionStates(unit, entry).find(option => option.name === "Chainfist and combi-weapon");
  entry = setSelection(unit, entry, chainfistBolter.id, 2);
  entry = setSelection(unit, entry, chainfistCombi.id, 1);
  assert.equal(validateLoadout(unit, entry).find(error => error.constraintId === "55e4-7647-d0c0-5fc6")?.actual, 3);

  entry = setUnitSize(unit, createDefaultRosterEntry(unit), 10);
  const pairedOptions = getOptionStates(unit, entry).filter(option => option.name === "Paired accursed weapons");
  const pairedModel = pairedOptions.find(option => option.kind === "model");
  const championPairedWeapons = pairedOptions.find(option => option.kind === "upgrade" && option.editable);
  entry = setSelection(unit, entry, championPairedWeapons.id, 1);
  entry = setSelection(unit, entry, pairedModel.id, 1);
  assert.deepEqual(validateLoadout(unit, entry), []);
  entry = setSelection(unit, entry, pairedModel.id, 2, false);
  assert.equal(validateLoadout(unit, entry).find(error => error.constraintId === "3e7c-bbc0-3dc2-8ef4")?.actual, 3);
});

test("11e Legionary specialist limits scale with unit size and report their BSData error", () => {
  const ruleset = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID);
  const unit = ruleset.units.find(item =>
    item.faction === "Chaos - Chaos Space Marines" && item.name === "Legionaries"
  );

  let entry = createDefaultRosterEntry(unit);
  let specialist = getOptionStates(unit, entry).find(option =>
    option.name === "Legionary w/ other weapon" && option.kind === "model"
  );
  assert.equal(getUnitSizeState(unit, entry).current, 5);
  assert.equal(specialist?.maximum, 1);

  entry = setSelection(unit, entry, specialist.id, 2, false);
  assert.equal(validateLoadout(unit, entry).find(error => error.nodeId === specialist.id)?.message,
    "Max 1 Legionary w/ other weapon per 5 models");

  entry = setUnitSize(unit, createDefaultRosterEntry(unit), 10);
  specialist = getOptionStates(unit, entry).find(option =>
    option.name === "Legionary w/ other weapon" && option.kind === "model"
  );
  assert.equal(specialist?.maximum, 2);
  entry = setSelection(unit, entry, specialist.id, 2);
  const lascannon = getOptionStates(unit, entry).find(option =>
    option.name === "Lascannon" && option.id.startsWith(`${specialist.id}/`)
  );
  entry = setSelection(unit, entry, lascannon.id, 1);
  assert.deepEqual(validateLoadout(unit, entry), []);
});

test("11e roster-level conditional errors stay out of unit loadout validation", () => {
  const ruleset = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID);
  for (const name of ["Yvraine", "The Yncarne"]) {
    const unit = ruleset.units.find(item => item.faction === "Xenos - Aeldari" && item.name === name);
    assert.ok(unit, name);
    assert.deepEqual(validateLoadout(unit, createDefaultRosterEntry(unit)), [], name);
  }
});

test("every 11e unit keeps a legal generated default after conditional loadout validation", () => {
  const ruleset = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID);
  const invalid = ruleset.units.flatMap(unit => {
    const errors = validateLoadout(unit, createDefaultRosterEntry(unit));
    return errors.length ? [{ faction: unit.faction, name: unit.name, errors }] : [];
  });
  assert.deepEqual(invalid, []);
});

test("11e specialist models replace baseline members without increasing unit size", () => {
  const ruleset = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID);
  const cases = [
    ["Chaos - World Eaters", "Khorne Berzerkers", "Khorne Berzerker w/ eviscerator and bolt pistol", "Khorne Berzerker", 10, 8],
    ["Chaos - Chaos Space Marines", "Raptors", "Raptor w/ meltagun", "Raptor", 5, 3],
    ["Chaos - Chaos Space Marines", "Nemesis Claw", "Legionary w/ heavy weapon", "Legionary w/ boltgun", 10, 8],
    ["Xenos - Aeldari", "Corsair Voidreavers", "Voidreaver with Heavy weapon", "Voidreaver with Shuriken rifle", 10, 8],
    ["Xenos - Aeldari", "Corsair Skyreavers", "Skyreaver w/ blaster", "Skyreaver w/ pistol and blade", 5, 3],
    ["Xenos - Aeldari", "Corsair Voidscarred", "Shade Runner", "Voidscarred w/ pistol and sword", 5, 3],
    ["Xenos - Aeldari", "Corsair Voidscarred", "Soul Weaver", "Voidscarred w/ pistol and sword", 5, 3],
    ["Xenos - Aeldari", "Corsair Voidscarred", "Way Seeker", "Voidscarred w/ pistol and sword", 5, 3]
  ];

  for (const [faction, unitName, specialistName, baselineName, size, baselineCount] of cases) {
    const unit = ruleset.units.find(item => item.faction === faction && item.name === unitName);
    assert.ok(unit, `${faction} / ${unitName}`);
    let entry = createDefaultRosterEntry(unit);
    if (getUnitSizeState(unit, entry).current !== size) entry = setUnitSize(unit, entry, size);
    const specialist = getOptionStates(unit, entry).find(option => option.name === specialistName);
    assert.ok(specialist, `${unitName}: ${specialistName}`);
    entry = setSelection(unit, entry, specialist.id, 1);

    const baseline = getOptionStates(unit, entry).find(option => option.name === baselineName);
    assert.equal(getUnitSizeState(unit, entry).current, size, `${unitName}: ${specialistName}`);
    assert.equal(baseline?.current, baselineCount, `${unitName}: ${baselineName}`);
    assert.deepEqual(validateLoadout(unit, entry), [], `${unitName}: ${specialistName}`);
  }
});

test("11e Khorne Berzerker special weapons scale at one per five models", () => {
  const ruleset = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID);
  const unit = ruleset.units.find(item =>
    item.faction === "Chaos - World Eaters" && item.name === "Khorne Berzerkers"
  );
  const maximumFor = (entry, name) => getOptionStates(unit, entry).find(option => option.name === name)?.maximum;
  const plasmaName = "Khorne Berzerker w/ chainblade and plasma pistol";
  const evisceratorName = "Khorne Berzerker w/ eviscerator and bolt pistol";

  assert.deepEqual(unit.unitSizePresets, [
    { size: 10, label: "10 models" },
    { size: 20, label: "20 models" }
  ]);
  let entry = createDefaultRosterEntry(unit);
  assert.equal(maximumFor(entry, plasmaName), 2);
  assert.equal(maximumFor(entry, evisceratorName), 2);
  assert.throws(() => setUnitSize(unit, entry, 15), /Choose one of the listed Khorne Berzerkers compositions/);

  entry = setUnitSize(unit, entry, 20);
  assert.equal(maximumFor(entry, plasmaName), 4);
  assert.equal(maximumFor(entry, evisceratorName), 4);

  entry = setUnitSize(unit, createDefaultRosterEntry(unit), 10);
  const plasma = getOptionStates(unit, entry).find(option => option.name === plasmaName);
  const eviscerator = getOptionStates(unit, entry).find(option => option.name === evisceratorName);
  entry = setSelection(unit, entry, plasma.id, 4);
  entry = setSelection(unit, entry, eviscerator.id, 4);
  const errors = validateLoadout(unit, entry);
  assert.ok(errors.some(error =>
    error.name === "Plasma pistols" && error.actual === 4 && error.limit === 2
  ));
  assert.ok(errors.some(error =>
    error.name === "Khornate eviscerators" && error.actual === 4 && error.limit === 2
  ));
});

test("11e Lions of the Emperor enhancements display their confirmed bearer restrictions", () => {
  const ruleset = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID);
  const army = ruleset.armies.find(item => item.faction === "Imperium - Adeptus Custodes");
  const descriptions = name => {
    const enhancement = army.enhancements.find(item => item.name === name);
    assert.ok(enhancement, name);
    return (enhancement.profiles || []).map(profile => profile.characteristics?.Description).join(" ");
  };

  assert.match(descriptions("Praesidius"), /^ADEPTUS CUSTODES model only\./i);
  assert.match(descriptions("Fierce Conqueror"), /^SHIELD-CAPTAIN model only\./i);
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

test("11e Gorkanaut keeps its Transport capacity with its sheet profiles", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const gorkanaut = ruleset.units.find(unit =>
    unit.faction === "Xenos - Orks" && unit.name === "Gorkanaut"
  );
  const configured = getConfiguredProfiles(gorkanaut, createDefaultRosterEntry(gorkanaut));
  const transport = configured.abilities.find(profile => profile.typeName === "Transport");

  assert.ok(transport, "Gorkanaut should retain its Transport profile");
  assert.match(transport.characteristics.Capacity, /transport capacity of 12 ORKS INFANTRY/i);
});

test("11e Blitz Brigade exposes each wagon upgrade once", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const orks = ruleset.armies.find(army => army.faction === "Xenos - Orks");
  const blitzBrigade = orks.detachments.find(detachment => detachment.name === "Blitz Brigade");
  const upgrades = orks.enhancements.filter(item => item.detachmentIds.includes(blitzBrigade.id));

  assert.deepEqual(upgrades.map(item => item.name).sort(), ["Boss Boomer", "Targetin' Gizmos"]);
  assert.ok(upgrades.every(item => item.maxSelections === 3));
  const eligibleNames = upgrade => upgrade.eligibleSelectionKeys
    .map(selectionKey => ruleset.units.find(unit => unit.selectionKey === selectionKey)?.name)
    .filter(Boolean)
    .sort();
  assert.ok(upgrades.every(upgrade => JSON.stringify(eligibleNames(upgrade)) === JSON.stringify(["Battlewagon", "Gunwagon", "Hunta Rig", "Kill Rig"])));
});

test("11e Adepta Sororitas upgrades keep their bearer limits and unit eligibility", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const sisters = ruleset.armies.find(army => army.faction === "Imperium - Adepta Sororitas");
  const unitName = selectionKey => ruleset.units.find(unit => unit.selectionKey === selectionKey)?.name;
  const upgrade = name => {
    const found = sisters.enhancements.find(item => item.name === name);
    assert.ok(found, `Missing Adepta Sororitas upgrade ${name}`);
    return found;
  };
  const eligibleNames = item => item.eligibleSelectionKeys.map(unitName).filter(Boolean).sort();
  const description = item => item.profiles
    .map(profile => profile.characteristics?.Description || "")
    .join(" ");

  const writ = upgrade("Writ of Compunction");
  assert.deepEqual(eligibleNames(writ), ["Celestian Sacresants"]);
  assert.match(description(writ), /CELESTIAN SACRESANTS unit only/i);

  const payload = upgrade("Symphonic Payload");
  assert.deepEqual(eligibleNames(payload), ["Exorcist"]);
  assert.match(description(payload), /EXORCIST unit only/i);

  const hagiomnifex = upgrade("Hagiomnifex");
  assert.equal(eligibleNames(hagiomnifex).includes("Celestian Insidiants"), false);
  assert.deepEqual(eligibleNames(hagiomnifex), [
    "Canoness",
    "Canoness with Jump Pack",
    "Dialogus",
    "Dogmata",
    "Hospitaller",
    "Imagifier",
    "Palatine"
  ]);
  assert.match(description(hagiomnifex), /ADEPTA SORORITAS CHARACTER model only \(excluding PENITENT units\)/i);
});

test("11e detachment upgrades retain bearer limits and representative eligibility scopes", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const unitName = selectionKey => ruleset.units.find(unit => unit.selectionKey === selectionKey)?.name;
  const allUpgrades = ruleset.armies.flatMap(army =>
    (army.enhancements || []).filter(item => item.kind === "upgrade").map(item => ({ army, item }))
  );
  const description = item => [
    ...(item.profiles || []).map(profile => profile.characteristics?.Description),
    ...(item.rules || []).map(rule => rule.description)
  ].filter(Boolean).join(" ");
  const eligibleNames = (faction, name) => {
    const army = ruleset.armies.find(item => item.faction === faction);
    const upgrade = army.enhancements.find(item => item.name === name);
    assert.ok(upgrade, `Missing ${faction} upgrade ${name}`);
    return upgrade.eligibleSelectionKeys.map(unitName).filter(Boolean).sort();
  };

  assert.equal(allUpgrades.every(({ item }) => /\b(?:model|unit)s? only\b/i.test(description(item))), true);
  assert.deepEqual(eligibleNames("Imperium - Adeptus Mechanicus", "Stealth-screened Cybercanids"), ["Serberys Raiders"]);
  assert.deepEqual(eligibleNames("Xenos - Leagues of Votann", "Shroudwërke Talismans"), ["Hernkyn Yaegirs"]);
  assert.deepEqual(eligibleNames("Xenos - Necrons", "Mortality Shroud (Aura)"), ["Obelisk"]);
  assert.deepEqual(eligibleNames("Imperium - Adeptus Astartes - Black Templars", "Fervent Exemplars"), ["Sword Brethren Squad"]);
  assert.deepEqual(eligibleNames("Imperium - Adeptus Astartes - Black Templars", "Inheritors of Sigismund"), ["Sword Brethren Squad"]);
  assert.equal(
    eligibleNames("Chaos - World Eaters", "Murder-forged Entity").every(name =>
      ruleset.units.find(unit => unit.faction === "Chaos - World Eaters" && unit.name === name)?.keywords.includes("Vehicle")
    ),
    true
  );
});

test("11e ordinary enhancement restrictions exclude unrelated bearer units", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const unitName = selectionKey => ruleset.units.find(unit => unit.selectionKey === selectionKey)?.name;
  const description = item => [
    ...(item.profiles || []).map(profile => profile.characteristics?.Description),
    ...(item.rules || []).map(rule => rule.description)
  ].filter(Boolean).join(" ");
  const eligibleNames = (faction, name) => {
    const army = ruleset.armies.find(item => item.faction === faction);
    const enhancement = army.enhancements.find(item => item.name === name);
    assert.ok(enhancement, `Missing ${faction} enhancement ${name}`);
    return enhancement.eligibleSelectionKeys.map(unitName).filter(Boolean).sort();
  };

  assert.deepEqual(eligibleNames("Imperium - Adepta Sororitas", "Clarion of Urgency"), ["Canoness with Jump Pack"]);
  assert.deepEqual(eligibleNames("Imperium - Adeptus Mechanicus", "Explorator Dispensation"), ["Skitarii Marshal"]);
  assert.deepEqual(eligibleNames("Xenos - Aeldari", "Mistweave"), ["Shadowseer"]);
  assert.deepEqual(eligibleNames("Chaos - Chaos Space Marines", "Pact of Cursed Pinions"), ["Chaos Lord with Jump Pack"]);
  assert.deepEqual(eligibleNames("Xenos - Leagues of Votann", "Ironskein"), ["Kâhl"]);
  assert.deepEqual(eligibleNames("Xenos - T'au Empire", "Student of Kauyon"), [
    "Kroot Flesh Shaper",
    "Kroot Trail Shaper",
    "Kroot War Shaper"
  ]);

  const spaceMarines = ruleset.armies.find(item => item.faction === "Imperium - Adeptus Astartes - Space Marines");
  const orksbane = spaceMarines.enhancements.find(item => item.name === "Orksbane");
  assert.match(description(orksbane), /ADEPTUS ASTARTES FLY INFANTRY model only/i);
  assert.equal(ruleset.enhancementRestrictionSource.unmatched, 0);
  assert.equal(ruleset.enhancementRestrictionSource.applied, ruleset.enhancementRestrictionSource.configured);
});

test("11e Warrior Bioform Onslaught grants Warrior and Battleline keywords to both Warrior units", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const tyranids = ruleset.armies.find(army => army.faction === "Xenos - Tyranids");
  const detachment = tyranids.detachments.find(item => item.name === "Warrior Bioform Onslaught");
  for (const name of ["Tyranid Warriors with Melee Bio-Weapons", "Tyranid Warriors with Ranged Bio-Weapons"]) {
    const unit = ruleset.units.find(item => item.faction === tyranids.faction && item.name === name);
    const grants = unit.conditionalKeywords.filter(grant => grant.detachmentIds.includes(detachment.id)).map(grant => grant.keyword).sort();
    assert.deepEqual(grants, ["Battleline", "Tyranid Warriors"]);
  }
});

test("11e Steel Hammer offers a selectable Character keyword to Titanic units", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const army = ruleset.armies.find(item => item.faction === "Imperium - Astra Militarum");
  const detachment = army.detachments.find(item => item.name === "Steel Hammer");
  const baneblade = ruleset.units.find(item => item.faction === army.faction && item.name === "Baneblade");
  const grant = baneblade.conditionalKeywords.find(item =>
    item.keyword === "Character" && item.detachmentIds.includes(detachment.id)
  );

  assert.equal(grant?.selectable, true);
});

test("11e Sword Brethren default to five models and retain specialist weapons across size changes", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam", { fresh: true });
  const unit = ruleset.units.find(item =>
    item.faction === "Imperium - Adeptus Astartes - Black Templars"
    && item.name === "Sword Brethren Squad"
  );
  let entry = createDefaultRosterEntry(unit);
  assert.deepEqual(getUnitSizeState(unit, entry), {
    current: 5, minimum: 5, maximum: 10, editable: true
  });

  const option = name => getOptionStates(unit, entry).find(item => item.name === name);
  assert.equal(option("Plasma pistol").maximum, 1);
  assert.equal(option("Pyre Pistol").maximum, 2);
  assert.equal(option("Thunder Hammer").maximum, 1);
  assert.equal(option("Sword Brother w/ Twin Lightning Claws").maximum, 1);

  for (const name of ["Plasma pistol", "Pyre Pistol", "Thunder Hammer"]) {
    entry = setSelection(unit, entry, option(name).id, 1);
  }
  const selectedCount = name => getOptionStates(unit, entry).find(item => item.name === name)?.current;
  const before = ["Plasma pistol", "Pyre Pistol", "Thunder Hammer"].map(selectedCount);
  entry = setUnitSize(unit, entry, 6);
  entry = setUnitSize(unit, entry, 5);

  assert.deepEqual(["Plasma pistol", "Pyre Pistol", "Thunder Hammer"].map(selectedCount), before);
  assert.deepEqual(validateLoadout(unit, entry), []);
});

test("11e Outrider Squads can be increased from three to six models", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam", { fresh: true });
  const units = ruleset.units.filter(item =>
    item.faction.startsWith("Imperium - Adeptus Astartes")
    && item.name === "Outrider Squad"
  );

  assert.ok(units.length > 0);
  for (const unit of units) {
    let entry = createDefaultRosterEntry(unit);
    assert.deepEqual(getUnitSizeState(unit, entry), {
      current: 3, minimum: 3, maximum: 6, editable: true
    }, unit.faction);
    entry = setUnitSize(unit, entry, 6);
    assert.equal(getUnitSizeState(unit, entry).current, 6, unit.faction);
    assert.deepEqual(validateLoadout(unit, entry), [], unit.faction);
  }
});

test("11e Vanguard Veterans accept the squad-wide heavy pistol and master-crafted weapon kit", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam", { fresh: true });
  const units = ruleset.units.filter(item =>
    item.faction.startsWith("Imperium - Adeptus Astartes")
    && item.name === "Vanguard Veteran Squad with Jump Packs"
  );

  assert.ok(units.length > 0);
  for (const unit of units) {
    let entry = setUnitSize(unit, createDefaultRosterEntry(unit), 10);
    const state = name => getOptionStates(unit, entry).find(option => option.name === name);
    const standardVeterans = state("Vanguard Veterans with Jump Packs");
    const powerWeaponVeterans = state("Veteran: heavy bolt pistol + master-crafted power weapon");
    const sergeantKit = state("Heavy bolt pistol + master-crafted power weapon");
    assert.equal(powerWeaponVeterans.maximum, 9, unit.faction);
    assert.equal(sergeantKit.maximum, 1, unit.faction);
    assert.equal(unit.selectionTree.children
      .find(node => node.name === "Vanguard Veterans with Jump Packs")
      .children[1].id, powerWeaponVeterans.id, unit.faction);
    assert.equal(getOptionStates(unit, entry).some(option => option.name === "Alternate weapon option"), false, unit.faction);
    assert.equal(getConfiguredProfiles(unit, entry).weapons.some(profile =>
      profile.name === "Heavy bolt pistol" || profile.name === "Master-crafted power weapon"
    ), false, unit.faction);

    entry = setSelection(unit, entry, powerWeaponVeterans.id, 4);
    assert.equal(getOptionStates(unit, entry).find(option => option.id === standardVeterans.id).current, 5, unit.faction);
    assert.equal(getOptionStates(unit, entry).find(option => option.id === powerWeaponVeterans.id).current, 4, unit.faction);
    assert.equal(getUnitSizeState(unit, entry).current, 10, unit.faction);
    assert.deepEqual(validateLoadout(unit, entry), [], unit.faction);

    entry = setSelection(unit, entry, powerWeaponVeterans.id, 9);
    entry = setSelection(unit, entry, sergeantKit.id, 1);

    assert.deepEqual(validateLoadout(unit, entry), [], unit.faction);
    assert.equal(getOptionStates(unit, entry).find(option => option.id === standardVeterans.id).current, 0, unit.faction);
    assert.equal(getOptionStates(unit, entry).find(option => option.id === powerWeaponVeterans.id).current, 9, unit.faction);
    assert.equal(getUnitSizeState(unit, entry).current, 10, unit.faction);
    const weapons = getConfiguredProfiles(unit, entry).weapons;
    const kitProfiles = weapons.filter(profile => String(profile.id || "").startsWith("rules-update-vanguard-"));
    assert.equal(kitProfiles.filter(profile => profile.name === "Heavy bolt pistol").reduce((sum, profile) => sum + profile.count, 0), 10, unit.faction);
    assert.equal(kitProfiles.filter(profile => profile.name === "Master-crafted power weapon").reduce((sum, profile) => sum + profile.count, 0), 10, unit.faction);
    assert.ok(kitProfiles.filter(profile => profile.name === "Master-crafted power weapon").every(profile => profile.typeName === "Melee Weapons"), unit.faction);
    assert.equal(weapons.some(profile => profile.name === "Vanguard Veteran Weapon"), false, unit.faction);
  }
});

test("11e Pactbound Daemon Princes receive only the enhancement matching their selected God Blessing", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam", { fresh: true });
  const army = ruleset.armies.find(item => item.faction === "Chaos - Chaos Space Marines");
  const detachment = army.detachments.find(item => item.name === "Pactbound Zealots");
  const expectedByGod = {
    Khorne: "Talisman of Burning Blood",
    Nurgle: "Orbs of Unlife",
    Slaanesh: "Intoxicating Elixir",
    Tzeentch: "Eye of Tzeentch"
  };

  for (const prince of ruleset.units.filter(item =>
    item.faction === army.faction && /^Heretic Astartes Daemon Prince(?: with wings)?$/i.test(item.name)
  )) {
    const baseEntry = createDefaultRosterEntry(prince, `${prince.id}-test`);
    for (const [god, expected] of Object.entries(expectedByGod)) {
      const blessing = getOptionStates(prince, baseEntry).find(item => item.name === god);
      const entry = setSelection(prince, baseEntry, blessing.id, 1, false);
      const rosterEntry = {
        instanceId: entry.instanceId,
        unitPackage: {
          definition: prince,
          selectionKey: prince.selectionKey,
          name: prince.name,
          faction: prince.faction
        },
        entry
      };
      const state = { ...createArmyState(army), detachmentIds: [detachment.id] };
      const names = getUnitAssignmentState(army, state, [rosterEntry], rosterEntry)
        .enhancements.map(item => item.name);
      assert.deepEqual(names, [expected], `${prince.name} / ${god}`);
    }
  }
});

test("11e Ork Blitz Brigade upgrades enforce their wagon restriction", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const army = ruleset.armies.find(item => item.faction === "Xenos - Orks");
  const namesFor = enhancementName => {
    const enhancement = army.enhancements.find(item => item.name === enhancementName);
    const keys = new Set(enhancement.eligibleSelectionKeys);
    return ruleset.units.filter(item => keys.has(item.selectionKey)).map(item => item.name).sort();
  };

  assert.deepEqual(namesFor("Targetin' Gizmos"), ["Battlewagon", "Gunwagon", "Hunta Rig", "Kill Rig"]);
  assert.deepEqual(namesFor("Boss Boomer"), ["Battlewagon", "Gunwagon", "Hunta Rig", "Kill Rig"]);
});

test("11e Sisters of Silence use stepped MFM points at every selectable size", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const schedules = {
    Prosecutors: [45, 50, 75, 75, 75, 75, 85],
    Vigilators: [50, 55, 90, 90, 90, 90, 100],
    Witchseekers: [50, 55, 90, 90, 90, 90, 100]
  };

  for (const [name, expected] of Object.entries(schedules)) {
    const unit = ruleset.units.find(item => item.faction === "Imperium - Adeptus Custodes" && item.name === name);
    for (let size = 4; size <= 10; size += 1) {
      const entry = setUnitSize(unit, createDefaultRosterEntry(unit), size);
      assert.equal(calculateEntryPoints(unit, entry).points, expected[size - 4], `${name} at ${size} models`);
    }
  }
});

test("11e Templar Vows stays scoped to Black Templars units", () => {
  const ruleset = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID);
  const configuredRules = unit => {
    const entry = createDefaultRosterEntry(unit);
    return getConfiguredProfiles(unit, entry).rules.map(rule => rule.name);
  };
  const spaceMarinesArmy = ruleset.armies.find(army => army.faction === "Imperium - Adeptus Astartes - Space Marines");
  const blackTemplarsUnit = ruleset.units.find(unit =>
    unit.faction === "Imperium - Adeptus Astartes - Black Templars"
    && configuredRules(unit).includes("Templar Vows")
  );
  const nonBlackTemplarsUnits = ruleset.units.filter(unit =>
    unit.faction !== "Imperium - Adeptus Astartes - Black Templars"
    && configuredRules(unit).includes("Templar Vows")
  );

  assert.ok(blackTemplarsUnit, "expected at least one Black Templars unit to retain Templar Vows");
  assert.equal(spaceMarinesArmy?.armyRules.some(rule => rule.name === "Templar Vows"), false);
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
  assert.equal(synaptoprescience.points, 30);
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
    ["Big Mek Dakkarig", 135],
    ["Breaka Boyz", 135],
    ["Gorkanaut", 325]
  ]) {
    const definition = unit(name);
    const entry = createDefaultRosterEntry(definition);
    assert.equal(calculateEntryPoints(definition, entry).points, expected);
  }

  for (const [name, expected] of [
    ["Big Mek Dakkarig", 145],
    ["Breaka Boyz", 145],
    ["Gorkanaut", 355]
  ]) {
    const definition = unit(name);
    const entry = createDefaultRosterEntry(definition);
    entry.context = { previousCopies: 2 };
    assert.equal(calculateEntryPoints(definition, entry).points, expected);
  }

  const nobz = unit("Nobz");
  const nobzEntry = setUnitSize(nobz, createDefaultRosterEntry(nobz), 10);
  assert.equal(calculateEntryPoints(nobz, nobzEntry).points, 250);
  assert.equal(calculateEntryPoints(nobz, { ...nobzEntry, context: { previousCopies: 2 } }).points, 280);
});

test("11e selected wargear direct points are included in entry totals", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const riptide = ruleset.units.find(unit =>
    unit.faction === "Xenos - T'au Empire" && unit.name === "Riptide Battlesuit"
  );
  assert.ok(riptide, "Missing Riptide Battlesuit");

  const entry = createDefaultRosterEntry(riptide);
  assert.equal(calculateEntryPoints(riptide, entry).points, 190);

  const ionAccelerator = getOptionStates(riptide, entry).find(option => option.name === "Ion accelerator");
  assert.ok(ionAccelerator, "Missing Ion accelerator option");
  assert.equal(ionAccelerator.points, 25);

  const upgraded = setSelection(riptide, entry, ionAccelerator.id, 1);
  const pricing = calculateEntryPoints(riptide, upgraded);
  assert.equal(pricing.points, 215);
  assert.ok(pricing.applied.some(item =>
    item.source === "bsdata-selection-tree"
    && item.name === "Ion accelerator"
    && item.value === 25
  ));
});

test("11e roster normalization excludes explicitly classified zero-point placeholders", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const zeroPointPlaceholders = ruleset.excludedUnits.filter(unit =>
    unit.sourceDisposition === "zero-point-placeholder"
  );

  assert.ok(zeroPointPlaceholders.length > 0);
  assert.equal(ruleset.units.some(unit => unit.rosterSelectable === false), false);
  assert.equal(ruleset.units.some(unit =>
    calculateEntryPoints(unit, createDefaultRosterEntry(unit), { allowInvalid: true }).points === 0
  ), false);
  assert.equal(ruleset.armies.some(army =>
    (army.allowedSelectionKeys || []).some(key => !ruleset.units.some(unit => unit.selectionKey === key))
  ), false);
});

test("11e roster normalization classifies non-unit terrain features instead of exposing them as units", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const searchlight = ruleset.excludedUnits.find(unit => unit.name === "Searchlight");

  assert.ok(searchlight);
  assert.equal(searchlight.sourceDisposition, "non-unit-terrain-feature");
  assert.equal(ruleset.units.some(unit => unit.name === "Searchlight"), false);
});

test("enhancement branches cannot turn ordinary Astra Militarum units into Leaders", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  for (const name of ["Cadian Shock Troops", "Baneblade", "Basilisk", "Chimera", "Leman Russ Battle Tank"]) {
    const definition = ruleset.units.find(unit => unit.faction === "Imperium - Astra Militarum" && unit.name === name);
    assert.ok(definition, name);
    assert.equal(definition.roles.leader, false, name);
    assert.deepEqual(definition.rosterRules.leaderTargetSelectionKeys, [], name);
  }
});

test("compound Leaders inherit Character and Warlord status from their required models", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  for (const [faction, name] of [
    ["Imperium - Astra Militarum", "Hell's Last [Legends]"],
    ["Imperium - Adeptus Astartes - Ultramarines", "Marneus Calgar"]
  ]) {
    const definition = ruleset.units.find(unit => unit.faction === faction && unit.name === name);
    assert.ok(definition, `${faction}: ${name}`);
    assert.equal(definition.roles.leader, true, name);
    assert.equal(definition.roles.character, true, name);
    assert.equal(definition.rosterRules.canBeWarlord, true, name);
  }
});

test("11e Emperor's Children Characters expose nested Warlord selections", () => {
  const ruleset = extractNormalizedRuleset(DEFAULT_RULESET_SOURCE_ID);
  for (const name of ["Lord Exultant", "Lord Kakophonist", "Sorcerer"]) {
    const definition = ruleset.units.find(unit =>
      unit.faction === "Chaos - Emperor's Children" && unit.name === name
    );
    assert.ok(definition, name);
    assert.equal(definition.roles.character, true, name);
    assert.equal(definition.rosterRules.canBeWarlord, true, name);
  }
});

test("omitted root hidden flags stay visible for native and allied Imperial Knights", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const names = [
    "Knight Destrier", "Canis Rex", "Armiger Warglaive", "Armiger Helverin",
    "Knight Paladin", "Knight Errant", "Knight Gallant", "Knight Warden",
    "Knight Crusader", "Knight Preceptor", "Knight Castellan", "Knight Valiant",
    "Knight Defender"
  ];

  for (const faction of ["Imperium - Imperial Knights", "Imperium - Imperial Knights - Library"]) {
    for (const name of names) {
      const definition = ruleset.units.find(unit => unit.faction === faction && unit.name === name);
      assert.ok(definition, `${faction}: ${name}`);
      assert.equal(definition.selectionTree.forceVisible, true, `${faction}: ${name}`);
      assert.equal(
        getConfiguredProfiles(definition, createDefaultRosterEntry(definition)).units.length > 0,
        true,
        `${faction}: ${name}`
      );
    }
  }

  const nativeCanis = ruleset.units.find(unit => unit.faction === "Imperium - Imperial Knights" && unit.name === "Canis Rex");
  assert.deepEqual(
    getConfiguredProfiles(nativeCanis, createDefaultRosterEntry(nativeCanis)).units.map(profile => profile.name).sort(),
    ["Canis Rex", "Sir Hekhtur"]
  );
  assert.equal(nativeCanis.source.selectionCatalogueId, nativeCanis.selectionKey.split(":")[0]);
});

test("before-any copy-count modifiers apply their later-copy points tax", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  for (const [faction, name, previousCopies, expectedPoints] of [
    ["Chaos - Chaos Daemons", "Khorne Soul Grinder", 2, 195],
    ["Chaos - Chaos Space Marines", "Noise Marines", 2, 160],
    ["Chaos - Thousand Sons", "Rubric Marines", 3, 110]
  ]) {
    const definition = ruleset.units.find(unit => unit.faction === faction && unit.name === name);
    assert.ok(definition, `${faction}: ${name}`);
    const entry = createDefaultRosterEntry(definition);
    entry.context = { previousCopies };
    assert.equal(calculateEntryPoints(definition, entry).points, expectedPoints, name);
    assert.equal(definition.pricing.modifiers.every(modifier => modifier.supported !== false), true, name);
  }
});

test("generic MFM keyword targets let allied Inquisitors lead Imperium Battleline Infantry", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const target = ruleset.units.find(unit =>
    unit.faction === "Imperium - Astra Militarum" && unit.name === "Cadian Shock Troops"
  );
  assert.ok(target);

  for (const name of ["Inquisitor", "Inquisitor Coteaz", "Inquisitor Draxus", "Inquisitor Greyfax"]) {
    const leader = ruleset.units.find(unit =>
      unit.faction === "Imperium - Agents of the Imperium" && unit.name === name
    );
    assert.ok(leader, name);
    assert.equal(leader.rosterRules.leaderTargetPredicates.some(predicate =>
      predicate.kind === "keywords-all"
      && ["battleline", "imperium", "infantry"].every(keyword => predicate.keywords.includes(keyword))
    ), true, name);
    assert.equal(leaderCanTarget(leader, target), true, name);
  }
});

test("root-condition enhancement eligibility resolves to retained bearer units", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const retainedEnhancementNames = new Set([
    "Assassin's Eye",
    "Elixir of the Corpse Courts",
    "Parasitic Woe-reaper",
    "Lancet of the Worldsore",
    "Precognicient Volleys",
    "Boons of Deimos",
    "Predestined Coordinates",
    "Astral Overlap",
    "Magos Questoris",
    "Unmasking Suite",
    "Encircling Horrors",
    "Thermoneutronic Projector",
    "Plasma Accelerator Rifle",
    "Supernova Launcher"
  ]);
  const allEnhancements = ruleset.armies.flatMap(army => army.enhancements || []);
  const affected = allEnhancements.filter(enhancement => retainedEnhancementNames.has(enhancement.name));
  const retainedKeys = new Set(ruleset.units.map(unit => unit.selectionKey));

  assert.equal(new Set(affected.map(enhancement => enhancement.name)).size, retainedEnhancementNames.size);
  assert.equal(affected.every(enhancement =>
    enhancement.eligibleSelectionKeys.length > 0
    && enhancement.eligibleSelectionKeys.every(key => retainedKeys.has(key))
  ), true);
});

test("root-condition enhancement eligibility projects bearer keyword gates through mixed source conditions", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const chaosSpaceMarines = ruleset.armies.find(army => army.faction === "Chaos - Chaos Space Marines");
  const unitName = key => ruleset.units.find(unit => unit.selectionKey === key)?.name;
  const eligibleNames = name => {
    const enhancement = chaosSpaceMarines.enhancements.find(item => item.name === name);
    assert.ok(enhancement, `Missing enhancement ${name}`);
    return enhancement.eligibleSelectionKeys.map(unitName).filter(Boolean);
  };

  assert.equal(eligibleNames("Talisman of Burning Blood").includes("Chaos Lord"), false);
  assert.equal(eligibleNames("Talisman of Burning Blood").includes("Chaos Lord on Juggernaut [Legends]"), true);
  assert.deepEqual(eligibleNames("Eye of Tzeentch"), [
    "Heretic Astartes Daemon Prince",
    "Heretic Astartes Daemon Prince with wings",
    "Rubric Marines",
    "Sorcerer on Disc of Tzeentch [Legends]",
    "Chaos Lord on Disc of Tzeentch [Legends]"
  ]);
  assert.deepEqual(eligibleNames("Intoxicating Elixir"), [
    "Heretic Astartes Daemon Prince",
    "Heretic Astartes Daemon Prince with wings",
    "Noise Marines",
    "Chaos Lord on Steed of Slaanesh [Legends]",
    "Sorcerer on Steed of Slaanesh [Legends]"
  ]);
});

test("every explicit 11e enhancement and upgrade bearer restriction is enforced", () => {
  const result = auditEnhancementEligibility();

  assert.equal(result.summary.armies, 35);
  assert.equal(result.summary.records, 1575);
  assert.equal(result.summary.enhancements, 1453);
  assert.equal(result.summary.upgrades, 122);
  assert.equal(result.summary.explicitLimiters, 1256);
  assert.equal(result.summary.overBroadRecords, 0);
});

test("keyword-limited enhancements and upgrades expose only their printed bearers", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const eligibleNames = (faction, detachmentName, enhancementName) => {
    const army = ruleset.armies.find(item => item.faction === faction);
    const detachment = army?.detachments.find(item => item.name === detachmentName);
    const enhancement = army?.enhancements.find(item =>
      item.name === enhancementName && item.detachmentIds.includes(detachment?.id)
    );
    assert.ok(enhancement, `${faction}: ${detachmentName}: ${enhancementName}`);
    return new Set(enhancement.eligibleSelectionKeys.map(key =>
      ruleset.units.find(unit => unit.selectionKey === key)?.name
    ).filter(Boolean));
  };

  const catechism = eligibleNames(
    "Imperium - Adepta Sororitas", "Penitent Host", "Catechism of Divine Penitence"
  );
  assert.deepEqual([...catechism].sort(), [
    "Canoness", "Canoness with Jump Pack", "Ministorum Priest", "Palatine"
  ]);

  const targetinGizmos = eligibleNames("Xenos - Orks", "Blitz Brigade", "Targetin' Gizmos");
  assert.deepEqual([...targetinGizmos].sort(), ["Battlewagon", "Gunwagon", "Hunta Rig", "Kill Rig"]);

  const benediction = eligibleNames(
    "Imperium - Adeptus Astartes - Black Templars", "Wrathful Procession", "Benediction of Fury"
  );
  assert.equal(benediction.has("Chaplain"), true);
  assert.equal(benediction.has("Captain"), false);

  const psykOutGrenades = eligibleNames(
    "Imperium - Adeptus Custodes", "Silent Hunters", "Psyk-out Grenades"
  );
  assert.equal(psykOutGrenades.has("Vigilators"), true);
  assert.equal(psykOutGrenades.has("Custodian Wardens"), false);

  const raptorBlade = eligibleNames(
    "Imperium - Adeptus Custodes", "Null Maiden Vigil", "Raptor Blade"
  );
  assert.equal(raptorBlade.has("Knight-Centura"), true);
  assert.equal(raptorBlade.has("Custodian Wardens"), false);

  const enduringFaith = eligibleNames(
    "Imperium - Adepta Sororitas", "Penitent Host", "Refrain of Enduring Faith"
  );
  assert.equal(enduringFaith.has("Repentia Squad"), true);
  assert.equal(enduringFaith.has("Battle Sisters Squad"), false);

  const deepeningMadness = eligibleNames(
    "Xenos - Necrons", "Skyshroud Spearhead", "Deepening Madness"
  );
  assert.equal(deepeningMadness.has("Lokhust Lord"), true);
});
