"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { extractNormalizedRuleset } = require("../src/rulesets/sources");

const root = path.resolve(__dirname, "..");
const ruleset = extractNormalizedRuleset(undefined, { fresh: true });

function walk(node, visitor) {
  if (!node) return;
  visitor(node);
  for (const child of node.children || []) walk(child, visitor);
}

function unit(faction, name) {
  const found = ruleset.units.find(item => item.faction === faction && item.name === name);
  assert.ok(found, `Missing unit: ${faction} / ${name}`);
  return found;
}

function profile(definition, name, typeName = null) {
  let found = null;
  walk(definition.selectionTree, node => {
    for (const item of node.profiles || []) {
      if (item.name === name && (!typeName || item.typeName === typeName)) found = item;
    }
  });
  assert.ok(found, `Missing profile: ${definition.name} / ${name}`);
  return found;
}

function ability(definition, name) {
  return profile(definition, name, "Abilities").characteristics.Description;
}

function army(faction) {
  const found = ruleset.armies.find(item => item.faction === faction);
  assert.ok(found, `Missing army: ${faction}`);
  return found;
}

function detachment(faction, name) {
  const found = army(faction).detachments.find(item => item.name === name);
  assert.ok(found, `Missing detachment: ${faction} / ${name}`);
  return found;
}

function stratagem(faction, name) {
  const found = army(faction).detachments.flatMap(item => item.stratagems || [])
    .find(item => item.name.toLowerCase() === name.toLowerCase());
  assert.ok(found, `Missing stratagem: ${faction} / ${name}`);
  return found.description;
}

function detachmentRule(faction, detachmentName, ruleName) {
  const found = detachment(faction, detachmentName).rules.find(item => item.name === ruleName);
  assert.ok(found, `Missing detachment rule: ${faction} / ${detachmentName} / ${ruleName}`);
  return found.description;
}

assert.equal(ruleset.factionPackUpdateSource.version, "2026-08-26");
assert.equal(ruleset.factionPackUpdateSource.unmatched, 0);

const core = JSON.parse(fs.readFileSync(path.join(root, "data", "manual-rules", "wh40k-11e-core-stratagems.json"), "utf8"));
const disembark = core.coreRules.find(item => item.name === "Move Types for Disembarking Units");
assert.match(disembark.description, /assault disembark move \(18\.06\)/);
assert.match(disembark.description, /shock disembark move \(18\.07\)/);

const acts = army("Imperium - Adepta Sororitas").armyRules.find(item => item.name === "Acts of Faith").description;
assert.match(acts, /start of each turn/);
assert.doesNotMatch(acts, /start of each battle round/);
assert.match(detachmentRule("Imperium - Adepta Sororitas", "Champions of Faith", "Righteous Purpose"), /CELESTIAN INSIDIANTS/);
assert.match(detachmentRule("Imperium - Adepta Sororitas", "Sacred Champions", "Holy Quest"), /Friendly CELESTIAN units/);
assert.match(stratagem("Imperium - Adepta Sororitas", "Divine Intervention"), /CHARACTER model/);
assert.equal(ability(unit("Imperium - Adepta Sororitas", "Saint Celestine"), "Healing Tears"),
  "While this unit contains a Celestine model, in your Command phase, you can return 1 destroyed Geminae Superia model to this unit.");
for (const name of ["Celestian Insidiants", "Celestian Sacresants"]) {
  assert.ok(unit("Imperium - Adepta Sororitas", name).keywords.some(keyword => keyword.toLowerCase() === "celestian"));
}

const datasmith = unit("Imperium - Adeptus Mechanicus", "Cybernetica Datasmith");
assert.ok(datasmith.keywords.some(keyword => keyword.toLowerCase() === "vehicle"));
assert.ok(!datasmith.keywords.some(keyword => keyword.toLowerCase() === "infantry"));
for (const [name, expected] of [
  ["X-101 [Legends]", { M: "6\"", T: "3", Sv: "4+", W: "3", LD: "8+", OC: "0" }],
  ["Secutarii Hoplites [Legends]", { M: "6\"", T: "3", Sv: "5+", W: "1", LD: "7+", OC: "1", InSv: "4+" }],
  ["Secutarii Peltasts [Legends]", { M: "6\"", T: "3", Sv: "5+", W: "1", LD: "7+", OC: "1", InSv: "6+" }]
]) {
  const actual = profile(unit("Imperium - Adeptus Mechanicus", name), name.replace(" [Legends]", ""), "Unit").characteristics;
  for (const [key, value] of Object.entries(expected)) assert.equal(actual[key], value, `${name} ${key}`);
}
const terrax = ruleset.units.find(item => item.name === "Terrax-pattern Termite [Legends]");
const terraxStats = profile(terrax, "Terrax-pattern Termite", "Unit").characteristics;
for (const [key, value] of Object.entries({ M: "8\"", T: "10", Sv: "3+", W: "14", LD: "6+", OC: "2" })) assert.equal(terraxStats[key], value, `Terrax-pattern Termite ${key}`);

assert.match(detachmentRule("Imperium - Astra Militarum", "Recon Element", "Masters of Camouflage"), /excluding TITANIC units.*Stealth/);
assert.match(stratagem("Chaos - Chaos Knights", "Storm of Darkness"), /Shooting phase or the Fight phase/);
assert.match(army("Chaos - Death Guard").armyRules.find(item => item.name === "Nurgle's Gift").description, /ranged attack, enemy units have the Benefit of Cover/);
assert.match(stratagem("Chaos - Death Guard", "Stinking Mire"), /friendly unengaged DEATH GUARD VEHICLE/);
assert.match(ability(unit("Xenos - Drukhari", "Venom"), "Aerialists"), /disembarked from a TRANSPORT/);
assert.match(stratagem("Chaos - Emperor's Children", "Onto The Next"), /disembarked from a TRANSPORT/);
assert.match(detachmentRule("Imperium - Imperial Knights", "Gate Warden Lance", "Dauntless Defenders"), /circular 40mm foundation marker/);
assert.match(stratagem("Xenos - Necrons", "Cosmic Precision"), /arriving using an ingress move this phase/);
assert.match(ability(unit("Xenos - Necrons", "Monolith"), "Eternity Gate"), /instead of more than 8" horizontally/);
assert.match(stratagem("Xenos - Orks", "Careen!"), /before any embarked units perform an emergency disembark move/);
assert.match(detachmentRule("Xenos - Orks", "Green Tide", "Mob Mentality"), /when it was targeted determines/);
assert.match(stratagem("Imperium - Adeptus Astartes - Space Marines", "Rapid Embarkation"), /disembarked from a TRANSPORT/);
assert.match(stratagem("Xenos - Tyranids", "Synaptic Goading"), /makes a surge move/);
assert.match(ability(unit("Chaos - World Eaters", "Khârn the Betrayer"), "The Betrayer"), /contains a Bodyguard model/);

for (const faction of ["Chaos - Chaos Space Marines", "Chaos - Emperor's Children", "Chaos - Thousand Sons", "Chaos - World Eaters"]) {
  assert.equal(profile(unit(faction, "Heldrake"), "Heldrake", "Unit").characteristics.OC, "0", faction);
}

for (const [faction, name] of [
  ["Xenos - Aeldari", "The Visarch"],
  ["Xenos - Aeldari", "Warlock Conclave"],
  ["Xenos - Aeldari", "Warlock Skyrunners"],
  ["Chaos - Chaos Space Marines", "Masters of the Maelstrom"],
  ["Imperium - Adeptus Astartes - Dark Angels", "Ravenwing Command Squad"],
  ["Imperium - Adeptus Astartes - Ultramarines", "Wardens of Ultramar"]
]) assert.equal(unit(faction, name).roles.support, true, name);
assert.ok(!unit("Chaos - Chaos Space Marines", "Huron Blackheart").rosterRules.leaderTargetNames.includes("MASTERS OF THE MAELSTROM"));
assert.ok(!unit("Xenos - Aeldari", "The Visarch").rosterRules.leaderTargetNames.includes("YNNARI INCUBI"));

const frameGroups = [
  ["Xenos - Aeldari", ["Autarch Skyrunner [Legends]", "Cobra [Legends]", "Corsair Cloud Dancer Band [Legends]", "Firestorm [Legends]", "Hornet [Legends]", "Lynx [Legends]", "Nightwing [Legends]", "Phoenix [Legends]", "Scorpion [Legends]", "Vampire Hunter [Legends]", "Vampire Raider [Legends]", "Warp Hunter [Legends]"]],
  ["Imperium - Astra Militarum", ["Aquila Lander [Legends]", "Arvus Lighter [Legends]", "Marauder Bomber [Legends]", "Marauder Destroyer [Legends]", "Valkyrie Sky Talon [Legends]", "Vendetta Gunship [Legends]", "Voss-pattern Lightning [Legends]", "Vulture Gunship [Legends]"]],
  ["Xenos - Drukhari", ["Raven Strike Fighter [Legends]", "Reaper [Legends]", "Tantalus [Legends]"]],
  ["Xenos - Necrons", ["Night Shroud [Legends]"]],
  ["Xenos - T'au Empire", ["Barracuda [Legends]", "Longstrike [Legends]", "Orca Dropship [Legends]", "Tetras [Legends]", "TX42 Piranha [Legends]"]],
  ["Xenos - Tyranids", ["Harridan"]]
];
for (const [faction, names] of frameGroups) {
  for (const name of names) assert.ok(!unit(faction, name).keywords.some(keyword => keyword.toLowerCase() === "frame"), `${faction}: ${name}`);
}

const updateDocument = JSON.parse(fs.readFileSync(path.join(root, "data", "manual-rules", "wh40k-11e-faction-pack-updates.json"), "utf8"));
assert.ok(updateDocument.audit.unavailableSource.some(item => item.id === "aug26-aeldari-stonesinger-spit"));
assert.ok(updateDocument.audit.unavailableSource.some(item => item.id === "aug26-admech-terrax-faction"));

console.log(`Verified ${ruleset.factionPackUpdateSource.applied} faction-pack updates; 0 unmatched overlays.`);
console.log("Known source gaps: Stonesinger and an Adeptus Mechanicus-faction Terrax are absent from the active imported catalogue.");
