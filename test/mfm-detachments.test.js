"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { extractNormalizedRuleset } = require("../src/rulesets/sources");

function detachment(ruleset, faction, name) {
  const army = ruleset.armies.find(item => item.faction === faction);
  assert.ok(army, `missing army ${faction}`);
  const result = army.detachments.find(item => item.name.toLowerCase() === name.toLowerCase());
  assert.ok(result, `missing detachment ${faction} / ${name}`);
  return result;
}

test("every current MFM v1.4 detachment schedule attaches to normalized data", () => {
  const source = extractNormalizedRuleset("wh40k-11e-vflam").mfmDetachmentSource;
  assert.equal(source.version, "1.4");
  assert.equal(source.total, 348);
  assert.equal(source.matched, 348);
  assert.equal(source.unmatched, 0);
  assert.equal(source.dispositionFlags, 0);
  assert.equal(source.detachmentPointFlags, 0);
});

test("MFM v1.4 overrides current force dispositions", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const cases = [
    ["Imperium - Imperial Knights", "Dominus Foebreakers", "Priority Assets"],
    ["Imperium - Adepta Sororitas", "Penitent Host", "Purge the Foe"],
    ["Imperium - Adeptus Custodes", "Lions of the Emperor", "Take and Hold"],
    ["Imperium - Adeptus Custodes", "Tharanatoi Hammerblow", "Disruption"],
    ["Xenos - Aeldari", "Aspect Host", "Priority Assets"],
    ["Chaos - Chaos Daemons", "Daemonic Incursion", "Take and Hold"],
    ["Chaos - Chaos Space Marines", "Huron's Marauders", "Purge the Foe"]
  ];
  for (const [faction, name, disposition] of cases) {
    const result = detachment(ruleset, faction, name);
    assert.equal(result.forceDisposition.name, disposition);
    assert.equal(result.forceDispositionSource, "mfm-1.4");
  }
});

test("MFM unique detachment tags are preserved for legality checks", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  assert.deepEqual(
    detachment(ruleset, "Imperium - Adepta Sororitas", "Champions of Faith").uniqueTags,
    ["REVEREND"]
  );
  assert.deepEqual(
    detachment(ruleset, "Imperium - Adepta Sororitas", "Sacred Champions").uniqueTags,
    ["REVEREND"]
  );
});

test("MFM v1.4 applies current detachment points", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const cases = [
    ["Imperium - Adepta Sororitas", "Bringers of Flame", 2],
    ["Imperium - Astra Militarum", "Combined Arms", 2],
    ["Imperium - Agents of the Imperium", "Imperialis Fleet", 2],
    ["Imperium - Agents of the Imperium", "Ordo Hereticus, Purgation Force", 2],
    ["Imperium - Agents of the Imperium", "Ordo Malleus, Daemon Hunters", 2],
    ["Imperium - Agents of the Imperium", "Ordo Xenos, Alien Hunters", 2],
    ["Imperium - Agents of the Imperium", "Veiled Blade Elimination Force", 1],
    ["Xenos - T'au Empire", "Retaliation Cadre", 3],
    ["Chaos - Thousand Sons", "Hexwarp Thrallband", 3],
    ["Imperium - Adeptus Custodes", "Lions of the Emperor", 3],
    ["Imperium - Astra Militarum", "Recon Element", 2]
  ];
  for (const [faction, name, points] of cases) {
    const result = detachment(ruleset, faction, name);
    assert.equal(result.detachmentPoints, points);
    assert.equal(result.detachmentPointsSource, "mfm-1.4");
  }
});
