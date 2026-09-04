"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createDefaultRosterEntry, getOptionStates, setSelection, setUnitSize } = require("../src/domain/loadout");
const { calculateEntryPoints } = require("../src/domain/pricing");
const { extractNormalizedRuleset } = require("../src/rulesets/sources");
const mfmDocument = require("../data/manual-rules/wh40k-11e-mfm-points.json");

const ruleset = extractNormalizedRuleset(undefined, { fresh: true });

function unit(faction, name) {
  const result = ruleset.units.find(item => item.faction === faction && item.name === name);
  assert.ok(result, `Missing ${faction} / ${name}`);
  return result;
}

function points(definition, size, context = {}, options = {}) {
  let entry = createDefaultRosterEntry(definition);
  if (size !== null) entry = setUnitSize(definition, entry, size);
  entry.context = { ...(entry.context || {}), ...context };
  return calculateEntryPoints(definition, entry, options).points;
}

test("MFM v1.3 preserves separate model-count and copy-count bands", () => {
  const faction = "Imperium - Adepta Sororitas";
  const repentia = unit(faction, "Repentia Squad");
  assert.equal(points(repentia, 5), 70);
  assert.equal(points(repentia, 10), 140);

  const hospitaller = unit(faction, "Hospitaller");
  assert.equal(points(hospitaller, 1, { previousCopies: 0 }), 65);
  assert.equal(points(hospitaller, 1, { previousCopies: 1 }), 75);

  const immolator = unit(faction, "Immolator");
  assert.equal(points(immolator, 1, { previousCopies: 2 }), 100);
  assert.equal(points(immolator, 1, { previousCopies: 3 }), 115);
});

test("MFM v1.3 includes red increases", () => {
  const morvenn = unit("Imperium - Adepta Sororitas", "Morvenn Vahl");
  assert.equal(points(morvenn, 1), 200);
});

test("Gretchin and Runtherd use separate codex datasheets and MFM points", () => {
  const gretchin = unit("Xenos - Orks", "Gretchin");
  assert.deepEqual(gretchin.unitSizePresets.map(item => item.label), ["10 Gretchin", "20 Gretchin"]);
  assert.deepEqual([10, 20].map(size => points(gretchin, size)), [45, 80]);
  assert.equal(points(unit("Xenos - Orks", "Runtherd"), 1), 10);
});

test("Vertus Praetors use separate two- and three-model costs", () => {
  const vertusPraetors = unit("Imperium - Adeptus Custodes", "Vertus Praetors");
  assert.equal(points(vertusPraetors, 2), 145);
  assert.equal(points(vertusPraetors, 3), 215);
});

test("World Eaters use the current Berzerker costs", () => {
  const berzerkers = unit("Chaos - World Eaters", "Khorne Berzerkers");
  assert.equal(points(berzerkers, 10), 160);
  assert.equal(points(berzerkers, 20), 320);
});

test("MFM v1.3 keeps Chapter-specific Space Marine schedules distinct", () => {
  const bloodAngelsJumpIntercessors = unit(
    "Imperium - Adeptus Astartes - Blood Angels",
    "Assault Intercessors with Jump Packs"
  );
  assert.equal(points(bloodAngelsJumpIntercessors, 5, { previousCopies: 0 }), 95);
  assert.equal(points(bloodAngelsJumpIntercessors, 10, { previousCopies: 0 }, { allowInvalid: true }), 180);
  assert.equal(points(bloodAngelsJumpIntercessors, 5, { previousCopies: 2 }), 105);
  assert.equal(points(bloodAngelsJumpIntercessors, 10, { previousCopies: 2 }, { allowInvalid: true }), 190);

  const bloodAngelsBladeguard = unit(
    "Imperium - Adeptus Astartes - Blood Angels",
    "Bladeguard Veteran Squad"
  );
  assert.equal(points(bloodAngelsBladeguard, 3, { previousCopies: 0 }), 85);
  assert.equal(points(bloodAngelsBladeguard, 6, { previousCopies: 0 }), 170);
  assert.equal(points(bloodAngelsBladeguard, 3, { previousCopies: 2 }), 95);
  assert.equal(points(bloodAngelsBladeguard, 6, { previousCopies: 2 }), 180);

  const genericJumpIntercessors = unit(
    "Imperium - Adeptus Astartes - Space Marines",
    "Assault Intercessors with Jump Packs"
  );
  assert.equal(points(genericJumpIntercessors, 5, { previousCopies: 0 }), 85);
  assert.equal(points(genericJumpIntercessors, 10, { previousCopies: 0 }, { allowInvalid: true }), 160);

  const bloodAngelsOutriders = unit(
    "Imperium - Adeptus Astartes - Blood Angels",
    "Outrider Squad"
  );
  const outriderNodes = [];
  (function visit(node) {
    if (!node) return;
    outriderNodes.push(node);
    for (const child of node.children || []) visit(child);
  })(bloodAngelsOutriders.selectionTree);
  assert.equal(outriderNodes.find(node => node.name === "Invader ATV")?.points, 60);
});

test("Imperial Agents conditional schedules remain distinct", () => {
  const eversor = unit("Imperium - Agents of the Imperium", "Eversor Assassin");
  assert.equal(points(eversor, 1, { mfmContext: "Imperial Agents army" }), 100);
  assert.equal(points(eversor, 1, { mfmContext: "Every model has the Imperium keyword" }), 110);

  const immolator = unit("Imperium - Agents of the Imperium", "Sisters of Battle Immolator");
  assert.equal(points(immolator, 1, { mfmContext: "Imperial Agents army", previousCopies: 0 }), 90);
  assert.equal(points(immolator, 1, { mfmContext: "Imperial Agents army", previousCopies: 3 }), 100);
  assert.equal(points(immolator, 1, { mfmContext: "Every model has the Imperium keyword", previousCopies: 0 }), 105);
  assert.equal(points(immolator, 1, { mfmContext: "Every model has the Imperium keyword", previousCopies: 3 }), 115);
});

test("Imperial Knights use the complete allied-Imperium schedule for Imperial Agents", () => {
  const context = { mfmContext: "Every model has the Imperium keyword" };
  const expected = [
    ["Aquila Kill Team", 5, 100], ["Aquila Kill Team", 10, 200],
    ["Callidus Assassin", 1, 100], ["Corvus Blackstar", 1, 180],
    ["Culexus Assassin", 1, 85],
    ["Deathwatch Kill Team", 5, 100], ["Deathwatch Kill Team", 10, 190],
    ["Eversor Assassin", 1, 110],
    ["Grey Knights Terminator Squad", 5, 190],
    ["Imperial Navy Breachers", 10, 90], ["Imperial Rhino", 1, 65],
    ["Inquisitor", 1, 65], ["Inquisitor Coteaz", 1, 95],
    ["Inquisitor Draxus", 1, 110], ["Inquisitor Greyfax", 1, 65],
    ["Inquisitorial Agents", 6, 60], ["Inquisitorial Agents", 12, 120],
    ["Inquisitorial Chimera", 1, 60], ["Inquisitor Kroyle", 1, 100],
    ["Ministorum Priest", 1, 40], ["Navigator", 1, 75],
    ["Rogue Trader Entourage", 4, 105], ["Sanctifiers", 9, 100],
    ["Sisters of Battle Immolator", 1, 105],
    ["Sisters of Battle Squad", 10, 110], ["Subductor Squad", 11, 100],
    ["Vigilant Squad", 11, 85], ["Vindicare Assassin", 1, 125],
    ["Voidsmen-at-Arms", 6, 70], ["Watch Captain Artemis", 1, 65],
    ["Watch Master", 1, 95]
  ];

  for (const [name, size, expectedPoints] of expected) {
    const definition = unit("Imperium - Agents of the Imperium", name);
    assert.equal(points(definition, size, context), expectedPoints, `${name} (${size})`);
  }

  for (const [name, optionName, expectedPoints] of [
    ["Grey Knights Terminator Squad", "Psycannon", 195],
    ["Sisters of Battle Immolator", "Twin multi-melta", 120]
  ]) {
    const definition = unit("Imperium - Agents of the Imperium", name);
    let entry = createDefaultRosterEntry(definition);
    entry.context = context;
    const option = getOptionStates(definition, entry).find(item => item.name === optionName);
    assert.ok(option, `${name}: ${optionName}`);
    entry = setSelection(definition, entry, option.id, 1, false);
    assert.equal(calculateEntryPoints(definition, entry).points, expectedPoints, `${name}: ${optionName}`);
  }
});

test("MFM v1.3 applies enhancement and wargear totals", () => {
  const sisters = ruleset.armies.find(item => item.faction === "Imperium - Adepta Sororitas");
  const expected = new Map([
    ["Catechism of Divine Penitence", 15],
    ["Psalm of Righteous Judgement", 20],
    ["Refrain of Enduring Faith", 15]
  ]);
  for (const [name, value] of expected) {
    assert.equal(sisters.enhancements.find(item => item.name === name)?.points, value);
  }

  const venatari = unit("Imperium - Adeptus Custodes", "Venatari Custodians");
  const nodes = [];
  (function visit(node) {
    if (!node) return;
    nodes.push(node);
    for (const child of node.children || []) visit(child);
  })(venatari.selectionTree);
  assert.equal(nodes.find(node => node.name === "Venatari lance")?.points, 5);
});

test("MFM v1.3 updates embedded enhancement copies and zeros unlisted paid wargear", () => {
  const expectedEmbedded = [
    ["Imperium - Agents of the Imperium", "Callidus Assassin", "Decoy Targets", 15],
    ["Imperium - Agents of the Imperium", "Culexus Assassin", "Esoteric Explosives", 10],
    ["Imperium - Agents of the Imperium", "Eversor Assassin", "Intra-neural Biotech", 15],
    ["Imperium - Agents of the Imperium", "Vindicare Assassin", "Micromelta Round", 20],
    ["Xenos - Necrons", "C'tan Shard of the Deceiver", "Singularity Matrix", 45]
  ];
  for (const [faction, unitName, optionName, expectedPoints] of expectedEmbedded) {
    const definition = unit(faction, unitName);
    const nodes = [];
    (function visit(node) {
      if (!node) return;
      nodes.push(node);
      for (const child of node.children || []) visit(child);
    })(definition.selectionTree);
    assert.equal(nodes.find(node => node.name === optionName)?.points, expectedPoints, `${faction} / ${unitName} / ${optionName}`);
  }

  const ridgerunner = unit("Xenos - Genestealer Cults", "Achilles Ridgerunners");
  const nodes = [];
  (function visit(node) {
    if (!node) return;
    nodes.push(node);
    for (const child of node.children || []) visit(child);
  })(ridgerunner.selectionTree);
  assert.equal(nodes.find(node => node.name === "Heavy mining laser")?.points, 0);
});

test("MFM v1.3 applies changed unit schedules, wargear, and enhancements", () => {
  const allarus = unit("Imperium - Adeptus Custodes", "Allarus Custodians");
  assert.equal(points(allarus, 2, { previousCopies: 0 }), 110);
  assert.equal(points(allarus, 2, { previousCopies: 2 }), 140);

  const blightHauler = unit("Chaos - Death Guard", "Myphitic Blight-hauler");
  assert.equal(points(blightHauler, 1), 95);
  assert.equal(points(blightHauler, 2), 190);

  const tyrannofex = unit("Xenos - Tyranids", "Tyrannofex");
  const nodes = [];
  (function visit(node) {
    if (!node) return;
    nodes.push(node);
    for (const child of node.children || []) visit(child);
  })(tyrannofex.selectionTree);
  assert.equal(nodes.find(node => node.name === "Acid spray")?.points, 10);
  assert.equal(nodes.find(node => node.name === "Rupture cannon")?.points, 20);

  const expectedEnhancements = [
    ["Imperium - Adeptus Astartes - Dark Angels", "Recon Hunter", 30],
    ["Chaos - Emperor's Children", "Possessed Blade", 35],
    ["Chaos - Emperor's Children", "Warp Walker", 35],
    ["Xenos - T'au Empire", "Strike Swiftly", 45],
    ["Chaos - Thousand Sons", "Umbralefic Crystal", 30],
    ["Xenos - Tyranids", "Synaptoprescience", 30]
  ];
  for (const [faction, name, expectedPoints] of expectedEnhancements) {
    const army = ruleset.armies.find(item => item.faction === faction);
    assert.equal(army?.enhancements.find(item => item.name.replace(/\s+\(Upgrade\)$/i, "") === name)?.points, expectedPoints, `${faction} / ${name}`);
  }
});

test("Faction Pack v1.1 keeps the flagged Space Marine detachment", () => {
  const marines = ruleset.armies.find(item => item.faction === "Imperium - Adeptus Astartes - Space Marines");
  const vengeful = marines.detachments.find(item => item.name === "Vengeful Hosts");
  assert.deepEqual(
    { points: vengeful.detachmentPoints, disposition: vengeful.forceDisposition.name, rules: vengeful.rules.length, stratagems: vengeful.stratagems.length },
    { points: 1, disposition: "Take and Hold", rules: 1, stratagems: 3 }
  );
  assert.equal(marines.enhancements.find(item => item.name === "Avenging Angel")?.points, 20);
  assert.equal(marines.enhancements.find(item => item.name === "Orksbane")?.points, 20);

});

test("every MFM v1.3 row attaches to normalized roster data", () => {
  assert.equal(ruleset.mfmPointSource.version, "1.3");
  assert.equal(ruleset.mfmPointSource.total, 3818);
  assert.equal(ruleset.mfmPointSource.unitRows, 2536);
  assert.equal(ruleset.mfmPointSource.wargearRows, 111);
  assert.equal(ruleset.mfmPointSource.enhancementRows, 1171);
  assert.equal(ruleset.mfmPointSource.unmatched, 0);
  assert.deepEqual(mfmDocument.reconciliation, {
    mode: "full-table",
    pages: 30,
    extractedRows: 3850,
    activeRows: 3818,
    pendingRows: 33,
    derivedZeroCostRows: 1
  });
});
