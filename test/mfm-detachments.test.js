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

test("every current MFM v1.1 detachment schedule attaches to normalized data", () => {
  const source = extractNormalizedRuleset("wh40k-11e-vflam").mfmDetachmentSource;
  assert.equal(source.total, 346);
  assert.equal(source.matched, 346);
  assert.equal(source.unmatched, 0);
  assert.equal(source.dispositionFlags, 81);
  assert.equal(source.detachmentPointFlags, 10);
});

test("MFM v1.1 overrides changed force dispositions", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const cases = [
    ["Xenos - Orks", "Dread Mob", "Priority Assets"],
    ["Xenos - Orks", "More Dakka!", "Disruption"],
    ["Xenos - Orks", "Taktikal Brigade", "Reconnaissance"],
    ["Imperium - Imperial Knights", "Dominus Foebreakers", "Priority Assets"],
    ["Imperium - Adepta Sororitas", "Penitent Host", "Purge the Foe"]
  ];
  for (const [faction, name, disposition] of cases) {
    const result = detachment(ruleset, faction, name);
    assert.equal(result.forceDisposition.name, disposition);
    assert.equal(result.forceDispositionSource, "mfm-1.1");
  }
});

test("MFM v1.1 applies all ten flagged detachment point changes", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const cases = [
    ["Imperium - Adepta Sororitas", "Bringers of Flame", 2],
    ["Imperium - Astra Militarum", "Combined Arms", 2],
    ["Imperium - Agents of the Imperium", "Imperialis Fleet", 2],
    ["Imperium - Agents of the Imperium", "Purgation Force (Ordo Hereticus)", 2],
    ["Imperium - Agents of the Imperium", "Daemon Hunters (Ordo Malleus)", 2],
    ["Imperium - Agents of the Imperium", "Alien Hunters (Ordo Xenos)", 2],
    ["Imperium - Agents of the Imperium", "Veiled Blade Elimination Force", 1],
    ["Xenos - Orks", "Green Tide", 3],
    ["Xenos - T'au Empire", "Retaliation Cadre", 3],
    ["Chaos - Thousand Sons", "Hexwarp Thrallband", 3]
  ];
  for (const [faction, name, points] of cases) {
    const result = detachment(ruleset, faction, name);
    assert.equal(result.detachmentPoints, points);
    assert.equal(result.detachmentPointsSource, "mfm-1.1");
  }
});
