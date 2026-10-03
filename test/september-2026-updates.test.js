"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { extractNormalizedRuleset } = require("../src/rulesets/sources");
const { canonicalUnitName } = require("../src/rulesets/mfm-normalization");
const updates = require("../data/manual-rules/wh40k-11e-faction-pack-updates.json").updates.filter(x => x.id.startsWith("sep2026-"));
const ruleset = extractNormalizedRuleset();
function profiles(node) { return [...(node.profiles || []), ...(node.children || []).flatMap(profiles)]; }
function unit(faction, name) { return ruleset.units.find(x => x.faction === faction && x.name === name); }
const normalize = s => String(s).normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
test("every confirmed September profile amendment reaches its intended profiles", () => {
  for (const update of updates.filter(x => x.kind === "profile-patch")) {
    for (const name of update.unitNames) {
      const definition = unit(update.target.faction, name);
      assert.ok(definition, name);
      const found = profiles(definition.selectionTree).filter(p =>
        (!update.typeName || p.typeName === update.typeName)
        && (!update.profileName || normalize(p.name) === normalize(update.profileName))
        && (!update.profileNames || update.profileNames.some(n => normalize(n) === normalize(p.name))));
      assert.ok(found.length, update.id);
      for (const p of found) for (const [key, value] of Object.entries(update.characteristics)) assert.equal(p.characteristics[key], value, `${name}/${p.name}/${key}`);
    }
  }
  assert.equal(ruleset.factionPackUpdateSource.unmatched, 0);
});
test("reviewed GK correction and Custodes complete profiles preserve their intended scope", () => {
  const gk = unit("Imperium - Grey Knights", "Interceptor Squad");
  assert.ok(profiles(gk.selectionTree).some(p => p.typeName === "Unit" && p.characteristics.T === "5"));
  const vertus = unit("Imperium - Adeptus Custodes", "Vertus Praetors");
  const bolter = profiles(vertus.selectionTree).find(p => p.name === "Vertus hurricane bolter");
  assert.equal(bolter.characteristics.S, "5"); assert.equal(bolter.characteristics.AP, "-1"); assert.equal(bolter.characteristics.D, "2");
  assert.ok(profiles(vertus.selectionTree).some(p => p.typeName === "Melee Weapons" && p.characteristics.S === "7"));
  const masters = unit("Chaos - Chaos Space Marines", "Masters of the Maelstrom");
  for (const name of ["Captain Sargotta", "The Enforcer"]) assert.ok(profiles(masters.selectionTree).some(p => p.name === name && p.characteristics.T === "3"));
});
test("September rules retain targeting while replacing the changed effects", () => {
  const army = faction => ruleset.armies.find(a => a.faction === faction);
  const strat = (a, det, name) => a.detachments.find(d => d.name === det).stratagems.find(s => normalize(s.name) === normalize(name));
  const ts = army("Chaos - Thousand Sons");
  assert.equal(strat(ts,"Rubricae Phalanx","Infernal Fusillade").cpCost,"1");
  assert.match(strat(ts,"Rubricae Phalanx","Unwavering Phalanx").description,/greater than the Toughness/);
  const agents = strat(army("Imperium - Agents of the Imperium"),"Veiled Blade Elimination Force","Ensnaring Trap");
  assert.doesNotMatch(agents.description,/does not receive a Charge bonus/); assert.match(agents.description,/Callidus Assassin/);
  assert.ok(strat(army("Chaos - Chaos Daemons"),"Legion of Excess","Rapturous Agony"));
});
test("MFM names resolve existing melta and Legends definitions without changing identity", () => {
  assert.equal(canonicalUnitName("ERADICATOR SQUAD WITH MELTA RIFLES"),canonicalUnitName("Eradicator Squad"));
  assert.equal(canonicalUnitName("SICARAN"),canonicalUnitName("Sicaran Battle Tank [Legends]"));
  assert.notEqual(canonicalUnitName("ERADICATOR SQUAD WITH HEAVY BOLTERS"),canonicalUnitName("Eradicator Squad"));
});

test("official Legends moves preserve IDs and remain distinct from active units", () => {
  const faction = "Imperium - Adeptus Astartes - Space Marines";
  const centurions = unit(faction, "Centurion Devastator Squad [Legends]");
  assert.ok(centurions); assert.equal(centurions.legendsSource, "mfm-1.5"); assert.ok(centurions.selectionKey);
  assert.ok(unit(faction,"Assault Intercessors with Jump Packs"));
});

test("Havocs retain the newly amended bolt-pistol profile", () => {
  const p = profiles(unit("Chaos - Chaos Space Marines", "Havocs").selectionTree).find(p => p.name === "Bolt pistol");
  assert.equal(p.characteristics.S, "5"); assert.equal(p.characteristics.AP, "-1");
});

test("added profiles update existing source IDs without duplicating them", () => {
  const { applyFactionPackUpdates } = require("../src/rulesets/faction-pack-updates");
  const definition = { name:"Havocs", faction:"Chaos - Chaos Space Marines", selectionTree:{ profiles:[{id:"upstream-pistol",name:"Bolt pistol",typeName:"Ranged Weapons",characteristics:{S:"4",Range:'12"'}}],children:[] } };
  const update = updates.find(x => x.id === "sep2026-havocs-bolt-pistol");
  const result = applyFactionPackUpdates([definition], [], {updates:[update]});
  assert.equal(result.units[0].selectionTree.profiles.length, 1);
  assert.equal(result.units[0].selectionTree.profiles[0].id, "upstream-pistol");
  assert.equal(result.units[0].selectionTree.profiles[0].characteristics.S, "5");
});


test("Butchers of Khorne targets the World Eaters Terminator Squad keyword in both engines", () => {
  const domain = require("../src/domain/army");
  const context = { window: {}, structuredClone };
  require("node:vm").runInNewContext(require("node:fs").readFileSync(require("node:path").join(__dirname, "../ui/army-runtime.js"), "utf8"), context);
  const army = ruleset.armies.find(a => a.faction === "Chaos - World Eaters");
  const detachment = army.detachments.find(d => d.name === "Butchers of Khorne");
  const terminators = unit("Chaos - World Eaters", "Chaos Terminators");
  const berzerkers = unit("Chaos - World Eaters", "Khorne Berzerkers");
  const expected = ["A TROPHY FOR THE THRONE", "FOCUSED FEROCITY", "WRATH BEYOND REASON"];
  for (const engine of [domain, context.window.ArmyEngine]) {
    const state = engine.selectDetachment(army, engine.createArmyState(army), detachment.id);
    const namesFor = definition => Array.from(engine.eligibleStratagemsForEntry(army, state, { definition }), s => s.name)
      .filter(name => expected.includes(name)).sort();
    assert.deepEqual(namesFor(terminators), expected);
    assert.deepEqual(namesFor(berzerkers), []);
    assert.deepEqual(namesFor({ ...terminators, name: "Chaos Terminators", keywords: ["Faction: World Eaters", "Infantry", "Terminator"] }), []);
    const other = engine.createArmyState(army);
    assert.equal(engine.eligibleStratagemsForEntry(army, other, { definition: terminators }).some(s => expected.includes(s.name)), false);
  }
  for (const stratagem of detachment.stratagems) {
    assert.deepEqual(stratagem.target, { type: "keyword", value: "Terminator Squad" });
    assert.match(stratagem.description, /TARGET:<\/b> That TERMINATOR SQUAD unit/);
  }
});
