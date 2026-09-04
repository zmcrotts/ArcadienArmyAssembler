"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const codex = require("../data/manual-rules/wh40k-11e-orks-codex-v1.json");
const core = require("../data/manual-rules/wh40k-11e-core-stratagems.json");
const mfm = require("../data/manual-rules/wh40k-11e-mfm-attachments.json");
const { extractNormalizedRuleset } = require("../src/rulesets/sources");
const {
  createDefaultRosterEntry,
  getConfiguredProfiles,
  getOptionStates,
  listSelectableOptions,
  normalizeRosterEntry,
  setSelection,
  setUnitSize,
  validateLoadout
} = require("../src/domain/loadout");
const { calculateEntryPoints } = require("../src/domain/pricing");

function profiles(unit) {
  const result = [];
  (function walk(node) {
    result.push(...(node?.profiles || []));
    for (const child of node?.children || []) walk(child);
  }(unit.selectionTree));
  return result;
}

function option(unit, name) {
  let found = null;
  (function walk(node) {
    if (String(node?.name).toLowerCase() === name.toLowerCase()) found = node;
    for (const child of node?.children || []) walk(child);
  }(unit.selectionTree));
  return found;
}

test("Orks codex replacement is complete and internally consistent", () => {
  assert.equal(codex.activeUnits.length, 54);
  assert.equal(codex.points.length, 54);
  assert.equal(codex.detachments.length, 15);
  assert.equal(codex.detachments.reduce((sum, item) => sum + item.enhancements.length, 0), 38);
  assert.equal(codex.detachments.reduce((sum, item) => sum + item.stratagems.length, 0), 40);
  assert.deepEqual(codex.wargearPoints, [
    { unit: "Gunwagon", option: "Zzap gun", points: 5 },
    { unit: "Meganobz", option: "Twin killsaw", points: 5 },
    { unit: "Meganobz", option: "Killsaw", points: 5 },
    { unit: "Nobz", option: "Paired krumpas", points: 5 }
  ]);
});

test("11e glossary defines Cleave as Blast-style scaling for melee weapons", () => {
  const cleave = core.coreRules.find(rule => rule.name === "Cleave");
  assert.ok(cleave);
  assert.match(cleave.description, /melee weapon/i);
  assert.match(cleave.description, /X additional attack dice for every five models/i);
});

test("Orks ruleset exposes only current units, MFM points, and codex profiles", () => {
  const ruleset = extractNormalizedRuleset(undefined, { fresh: true });
  const allOrks = ruleset.units.filter(unit => unit.faction === "Xenos - Orks" && unit.rosterSelectable);
  const orks = allOrks.filter(unit => unit.sourceDisposition === "codex-current");
  const byName = name => {
    const unit = orks.find(item => item.name === name);
    assert.ok(unit, `Missing current Orks unit ${name}`);
    return unit;
  };
  const statline = name => profiles(byName(name)).find(profile => profile.typeName === "Unit" && profile.name === name)?.characteristics;

  assert.equal(orks.length, 54);
  for (const name of ["Nazdreg", "Gunwagon", "Warbuggies"]) byName(name);
  for (const name of ["Lootas", "Burna Boyz", "Boomdakka Snazzwagon", "Wurrboy", "Gargantuan Squiggoth"]) {
    assert.equal(orks.some(item => item.name === name), false, `${name} must not remain current`);
    assert.ok(allOrks.some(item => item.name === `${name} [Legends]`), `${name} must survive only as Legends`);
  }

  assert.deepEqual(statline("Ghazghkull Thraka"), { M: '8"', T: "10", Sv: "2+", SV: "2+", W: "16", LD: "6+", OC: "4", InSv: "4+" });
  assert.equal(statline("Warboss").T, "6");
  assert.equal(statline("Warboss in Mega Armour").T, "7");
  assert.equal(statline("Battlewagon").T, "11");
  assert.equal(statline("Gunwagon").T, "12");
  assert.equal(statline("Mozrog Skragbad").W, "10");
  assert.equal(profiles(byName("Ghazghkull Thraka")).some(profile => /Makari's stabba|Makari’s stabba/i.test(profile.name)), false);

  for (const unit of orks) {
    const spec = [...codex.unitUpdates, ...codex.addedUnits].find(item => item.name === unit.name);
    assert.ok(spec, `${unit.name} must have a complete codex-owned definition`);
    const cardProfiles = items => items.filter(profile => !/^(Leader|Support)$/.test(profile.name));
    assert.deepEqual(
      [...new Set(cardProfiles(profiles(unit)).map(profile => `${profile.name}\u0000${profile.typeName}`))].sort(),
      [...new Set(cardProfiles(spec.profiles).map(profile => `${profile.name}\u0000${profile.typeName}`))].sort(),
      `${unit.name} retained legacy profiles`
    );
  }

  const ghazProfiles = profiles(byName("Ghazghkull Thraka"));
  assert.deepEqual(ghazProfiles.filter(item => /Weapons$/.test(item.typeName)).map(item => item.name), [
    "➤ Mork’s Roar - Aimed", "➤ Mork’s Roar - Point Blank", "Adamantine ’Eadbutt", "Gork’s Klaw"
  ]);
  assert.equal(ghazProfiles.find(item => item.name === "➤ Mork’s Roar - Aimed").characteristics.S, "6");
  assert.equal(ghazProfiles.find(item => item.name === "➤ Mork’s Roar - Point Blank").characteristics.Range, '9"');
  assert.equal(ghazProfiles.find(item => item.name === "Adamantine ’Eadbutt").characteristics.D, "D3+3");
  assert.equal(ghazProfiles.find(item => item.name === "Da Grand Warlord’s Ladz").characteristics.Description.includes('within 3"'), true);
  assert.equal(byName("Ghazghkull Thraka").roles.leader, false);

  const killaProfiles = profiles(byName("Killa Kans"));
  assert.equal(killaProfiles.find(item => item.name === "➤ Kan Blasta - Dakka").characteristics.Keywords, "BLAST 1, IGNORES COVER, SUSTAINED HITS 1");
  assert.equal(killaProfiles.some(item => item.name === "Shooty Power Trip"), false);

  const tankProfiles = profiles(byName("Tankbustas"));
  assert.equal(tankProfiles.find(item => item.name === "➤ Smash Hammer - Standard").characteristics.Keywords, "-");
  assert.equal(tankProfiles.find(item => item.name === "➤ Smash Hammer - Hunter").characteristics.Keywords, "HUNTER: MONSTER/VEHICLE");
  assert.equal(tankProfiles.find(item => item.name === "➤ Smash Hammer - Hunter").characteristics.S, "12");
  assert.equal(tankProfiles.some(item => item.name === "Tank Hunters"), false);

  const gretchin = byName("Gretchin");
  assert.deepEqual(gretchin.unitSizePresets.map(item => item.size), [10, 20]);
  assert.deepEqual([10, 20].map(size => calculateEntryPoints(gretchin, setUnitSize(gretchin, createDefaultRosterEntry(gretchin), size)).points), [45, 80]);

  assert.deepEqual(byName("Ghazghkull Thraka").pricing.mfmRows.map(row => row.points), [300]);
  assert.deepEqual(byName("Boyz").pricing.mfmRows.map(row => row.points), [90, 180, 100, 190]);
  assert.deepEqual(byName("Meganobz").pricing.mfmRows.map(row => row.points), [75, 110, 185, 225, 115, 150, 225, 265]);

  const army = ruleset.armies.find(item => item.faction === "Xenos - Orks");
  const armyRule = name => army.armyRules.find(rule => rule.name === name)?.description;
  assert.match(armyRule("Waaagh!"), /re-roll Advance rolls/);
  assert.match(armyRule("Waaagh!"), /riled up until the end of the next turn/);
  assert.match(armyRule("Da Boss"), /start of the battle round.*WARLORD, gain 1CP/);
  assert.match(armyRule("Unstable Energies"), /total psychic level does not exceed/);
  for (const unit of orks) {
    for (const profile of profiles(unit).filter(item => item.name === "Waaagh!")) {
      assert.equal(profile.characteristics.Description, armyRule("Waaagh!"));
    }
  }
  assert.equal(army.detachments.length, 15);
  assert.equal(army.enhancements.length, 38);
  assert.equal(army.detachments.reduce((sum, item) => sum + item.stratagems.length, 0), 40);

  assert.equal(option(byName("Meganobz"), "Twin killsaw")?.points, 5);
  assert.equal(option(byName("Meganobz"), "Killsaw")?.points, 5);
  const nobz = byName("Nobz");
  const pairedKrumpas = option(nobz, "Paired krumpas");
  assert.equal(pairedKrumpas?.points, 5);
  assert.deepEqual(nobz.composition.map(model => [model.name, model.min, model.max]), [["Nob", 5, 10]]);
  assert.deepEqual(
    listSelectableOptions(nobz).filter(item => item.kind === "upgrade").map(item => item.name),
    [
      "Kustom Krumpa and Kustom Shoota",
      "Kustom Krumpa and Kombi-rokkit",
      "Big Skorcha and Kustom Choppa",
      "Kustom Big Shoota and Kustom Choppa",
      "Big Choppa",
      "Paired krumpas"
    ]
  );
  const defaultNobz = createDefaultRosterEntry(nobz, "nobz-default");
  assert.deepEqual(validateLoadout(nobz, defaultNobz), []);
  assert.deepEqual(
    getConfiguredProfiles(nobz, defaultNobz).weapons.map(item => [item.name, item.count]),
    [["Kustom Krumpa", 5], ["Kustom Shoota", 5]]
  );
  assert.equal(getConfiguredProfiles(nobz, defaultNobz).weapons.some(item => item.name === "Paired Krumpas"), false);
  const pairedFive = setSelection(nobz, defaultNobz, pairedKrumpas.id, 1);
  assert.deepEqual(validateLoadout(nobz, pairedFive), []);
  assert.equal(getConfiguredProfiles(nobz, pairedFive).weapons.find(item => item.name === "Kustom Shoota").count, 4);
  assert.equal(getConfiguredProfiles(nobz, pairedFive).weapons.find(item => item.name === "Kustom Krumpa").count, 4);
  assert.equal(getConfiguredProfiles(nobz, pairedFive).weapons.find(item => item.name === "Paired Krumpas").count, 1);
  assert.equal(getConfiguredProfiles(nobz, pairedFive).weapons.find(item => item.name === "Paired Krumpas").characteristics.Keywords, "TWIN-LINKED");
  assert.equal(calculateEntryPoints(nobz, pairedFive).points - calculateEntryPoints(nobz, defaultNobz).points, 5);
  const tenNobz = setUnitSize(nobz, defaultNobz, 10);
  assert.equal(getOptionStates(nobz, tenNobz).find(item => item.id === pairedKrumpas.id).maximum, 2);
  assert.deepEqual(validateLoadout(nobz, setSelection(nobz, tenNobz, pairedKrumpas.id, 2)), []);
  assert.equal(option(byName("Gunwagon"), "Zzap gun")?.points, 5);
  assert.ok(byName("Nazdreg").rosterRules.leaderTargetSelectionKeys.includes(byName("Meganobz").selectionKey));
  const records = mfm.factions.find(faction => faction.name === "Orks").attachments;
  assert.equal(records.length, 17);
  for (const unit of orks) {
    const record = records.find(item => item.unitName === unit.name.toUpperCase());
    assert.equal(unit.roles.leader, Boolean(record), unit.name);
    assert.equal(unit.roles.support, record?.role === "SUPPORT", unit.name);
    assert.deepEqual(unit.rosterRules.leaderTargetNames, record?.targets || [], unit.name);
    assert.equal(unit.rosterRules.leaderTargetSelectionKeys.length, record?.targets.length || 0, unit.name);
    const attachmentProfiles = profiles(unit).filter(profile => /^(Leader|Support)$/.test(profile.name));
    assert.equal(attachmentProfiles.length, record ? 1 : 0, unit.name);
    if (record) {
      assert.equal(attachmentProfiles[0].name.toUpperCase(), record.role);
      for (const target of record.targets) assert.ok(attachmentProfiles[0].characteristics.Description.includes(target));
    }
  }
  const rig = byName("Big Mek Dakkarig");
  assert.equal(rig.roles.character, false);
  assert.equal(rig.rosterRules.canBeWarlord, false);
  assert.ok(!rig.keywords.includes("Character"));
  assert.deepEqual(getConfiguredProfiles(rig, createDefaultRosterEntry(rig, "rig")).weapons.map(p => p.name).sort(),
    ["Blitzkannon", "Multi-busta Launcha", "Stompy Feet"].sort());
  const warboss = byName("Warboss");
  const entry = createDefaultRosterEntry(warboss, "warboss");
  assert.deepEqual(validateLoadout(warboss, entry), []);
  const migrated = normalizeRosterEntry(warboss, { instanceId: "old-warboss", selections: { "obsolete-twin-sluggas": 1, "obsolete-big-choppa": 1 } });
  assert.deepEqual(validateLoadout(warboss, migrated), []);
  assert.deepEqual(getConfiguredProfiles(warboss, migrated).weapons.map(p => p.name).sort(), ["Kustom Choppa", "Kustom Shoota"]);
  assert.deepEqual(getConfiguredProfiles(warboss, entry).weapons.map(p => p.name).sort(), ["Kustom Choppa", "Kustom Shoota"]);
  for (const [choice, expected] of [
    ["Kombi-rokkit", ["Kustom Choppa", "➤ Kombi-rokkit - Busta Rokkit", "➤ Kombi-rokkit - Shoota"]],
    ["Kombi-skorcha", ["Kustom Choppa", "➤ Kombi-skorcha - Shoota", "➤ Kombi-skorcha - Skorcha"]],
    ["Power Klaw", ["Kustom Shoota", "Power Klaw"]]
  ]) {
    const selected = setSelection(warboss, entry, option(warboss, choice).id, 1);
    assert.deepEqual(validateLoadout(warboss, selected), []);
    assert.deepEqual(getConfiguredProfiles(warboss, selected).weapons.map(p => p.name).sort(), expected.sort());
  }
  const warbossProfiles = profiles(warboss);
  assert.equal(warbossProfiles.find(p => p.name === "Kustom Choppa").characteristics.S, "7");
  assert.equal(warbossProfiles.find(p => p.name === "Kustom Choppa").characteristics.Keywords, "CLEAVE 2");
  assert.equal(warbossProfiles.find(p => p.name === "Power Klaw").characteristics.A, "6");
  assert.match(warbossProfiles.find(p => p.name === "Might is Right").characteristics.Description, /\+3 A/);
  assert.match(warbossProfiles.find(p => p.name.startsWith("Intimidating Motivation")).characteristics.Description, /no longer battle-shocked/);
});
