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

test("every available MFM v1.5 detachment schedule attaches to normalized data", () => {
  const source = extractNormalizedRuleset("wh40k-11e-vflam").mfmDetachmentSource;
  assert.equal(source.version, "1.5");
  assert.equal(source.total, 250);
  assert.equal(source.matched, 250);
  assert.equal(source.unmatched, 0);
  assert.equal(source.dispositionFlags, 30);
  assert.equal(source.detachmentPointFlags, 8);
});

test("MFM v1.5 overrides current force dispositions", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const cases = [
    ["Imperium - Imperial Knights", "Dominus Foebreakers", "Priority Assets"],
    ["Imperium - Adepta Sororitas", "Penitent Host", "Purge the Foe"],
    ["Imperium - Adeptus Custodes", "Lions of the Emperor", "Take and Hold"],
    ["Imperium - Adeptus Custodes", "Tharanatoi Hammerblow", "Disruption"],
    ["Xenos - Aeldari", "Aspect Host", "Priority Assets"],
    ["Chaos - Chaos Daemons", "Daemonic Incursion", "Take and Hold"],
    ["Chaos - Chaos Space Marines", "Huron's Marauders", "Disruption"]
  ];
  for (const [faction, name, disposition] of cases) {
    const result = detachment(ruleset, faction, name);
    assert.equal(result.forceDisposition.name, disposition);
    assert.equal(result.forceDispositionSource, "mfm-1.5");
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

test("MFM v1.5 applies current detachment points", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  const cases = [
    ["Imperium - Adepta Sororitas", "Bringers of Flame", 2],
    ["Imperium - Astra Militarum", "Combined Arms", 2],
    ["Imperium - Agents of the Imperium", "Imperialis Fleet", 2],
    ["Imperium - Agents of the Imperium", "Ordo Hereticus Purgation Force", 2],
    ["Imperium - Agents of the Imperium", "Ordo Malleus Daemon Hunters", 2],
    ["Imperium - Agents of the Imperium", "Ordo Xenos Alien Hunters", 2],
    ["Imperium - Agents of the Imperium", "Veiled Blade Elimination Force", 1],
    ["Xenos - T'au Empire", "Retaliation Cadre", 3],
    ["Chaos - Thousand Sons", "Hexwarp Thrallband", 3],
    ["Imperium - Adeptus Custodes", "Lions of the Emperor", 3],
    ["Imperium - Astra Militarum", "Recon Element", 2]
  ];
  for (const [faction, name, points] of cases) {
    const result = detachment(ruleset, faction, name);
    assert.equal(result.detachmentPoints, points);
    assert.equal(result.detachmentPointsSource, "mfm-1.5");
  }
});


test("MFM removes the Harlequin Unique tags from all four detachments", () => {
  const ruleset = extractNormalizedRuleset("wh40k-11e-vflam");
  for (const name of ["Twilight Flickers", "Fateful Performance", "Ghosts of the Webway", "Serpent's Brood"]) {
    assert.deepEqual(detachment(ruleset, "Xenos - Aeldari", name).uniqueTags, [], name);
    for (const rule of detachment(ruleset, "Xenos - Aeldari", name).rules) {
      assert.doesNotMatch(rule.description, /ACROBATIC.*tag|another.*ACROBATIC/i, `${name}: ${rule.name}`);
      assert.ok(rule.description.trim(), `${name}: ${rule.name} still has its gameplay text`);
    }
  }
});


test("MFM removes obsolete tag prose while preserving retained restrictions and gameplay", () => {
  const { applyMfmDetachments } = require("../src/rulesets/mfm-detachments");
  const description = "Friendly units have Stealth.\n\nThis **detachment** has the **ACROBATIC** tag and cannot be taken with another **ACROBATIC detachment**.";
  const army = { faction: "Xenos - Aeldari", forceDispositions: [{ id: "hold", name: "Take and Hold" }], detachments: [{ name: "Twilight Flickers", uniqueTags: ["ACROBATIC"], rules: [{ name: "Dance of Distortion", description }] }] };
  const record = { factionSlug: "aeldari", detachmentName: "Twilight Flickers", detachmentPoints: 1, forceDisposition: "Take and Hold" };
  const descriptionFor = uniqueTags => applyMfmDetachments([army], { detachments: [{ ...record, ...(uniqueTags === undefined ? {} : { uniqueTags }) }] }).definitions[0].detachments[0].rules[0].description;
  assert.equal(descriptionFor([]), "Friendly units have Stealth.");
  assert.equal(descriptionFor(["ACROBATIC"]), description);
  assert.equal(descriptionFor(undefined), description);
});
