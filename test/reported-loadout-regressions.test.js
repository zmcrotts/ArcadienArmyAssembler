"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const domain = require("../src/domain/loadout");
const documents = require("../src/domain/roster-document");
const { readSpaceMarineUnits } = require("../src/rulesets/space-marine-units");
const { correctMarineInfantryToughness } = require("../src/rulesets/marine-infantry-toughness");

const window = {};
vm.runInNewContext(fs.readFileSync(require.resolve("../ui/engine-runtime.js"), "utf8"), { window });
vm.runInNewContext(fs.readFileSync(require.resolve("../ui/engine-data/xenos-t-au-empire.js"), "utf8"), { window });
const marines = readSpaceMarineUnits(require.resolve("../data/manual-rules/wh40k-11e-space-marine-units.json.gz")).units
  .map(unit => correctMarineInfantryToughness({ ...unit, rulesetId: "wh40k-11e-vflam" }));
const pathfinders = window.ROSTER_ENGINE_FACTIONS["Xenos - T'au Empire"].find(p => p.name === "Pathfinder Team");
const plain = value => JSON.parse(JSON.stringify(value));

for (const [name, engine] of [["domain", domain], ["browser", window.RosterEngine]]) {
  test(`${name}: an Intercessor launcher replaces a Marine at both squad sizes`, () => {
    for (const unit of marines.filter(u => u.name === "Intercessor Squad")) {
      const launcher = domain.buildTreeIndex(unit).all.find(n => n.name === "Intercessor w/ Grenade Launcher");
      for (const size of [5, 10]) {
        const before = engine.setUnitSize(unit, engine.createDefaultRosterEntry(unit), size);
        let entry = engine.setSelection(unit, before, launcher.id, 1);
        assert.equal(engine.getUnitSizeState(unit, entry).current, size, unit.faction);
        assert.deepEqual(plain(engine.validateLoadout(unit, entry)), []);
        const saved = plain(entry);
        entry = engine.normalizeRosterEntry(unit, saved);
        assert.deepEqual(plain(entry.selections), saved.selections);
        entry = engine.setSelection(unit, entry, launcher.id, 0);
        assert.equal(engine.getUnitSizeState(unit, entry).current, size);
        assert.deepEqual(plain(engine.validateLoadout(unit, entry)), []);
      }
    }
  });

  test(`${name}: Pathfinder weapons and drones survive repeated saved-roster loads`, () => {
    const unit = pathfinders.definition;
    const standard = ["Gun Drone", "Marker Drone", "Shield Drone"];
    for (const specialist of ["Grav-inhibitor drone", "Pulse accelerator drone", "Recon drone"]) {
      for (const weapon of [null, "Pathfinders w/ rail rifle", "Pathfinders w/ ion rifle", "Pathfinders w/ pulse carbine and grenade launcher"]) {
        for (let pair = 0; pair < 3; pair++) {
          let entry = engine.createDefaultRosterEntry(unit);
          const choices = [specialist, standard[pair], standard[(pair + 1) % 3], weapon].filter(Boolean);
          for (const choice of choices) {
            const option = engine.getOptionStates(unit, entry).find(n => n.name === choice);
            entry = engine.setSelection(unit, entry, option.id, 1);
          }
          assert.deepEqual(plain(engine.validateLoadout(unit, entry)), []);
          const expected = plain(entry.selections);
          let roster = [{ unitPackage: pathfinders, entry, instanceId: entry.instanceId }];
          for (let load = 0; load < 2; load++) {
            const document = documents.createRosterDocument({ rosterEntries: roster, services: {
              unitSizeState: engine.getUnitSizeState, configuredProfiles: engine.getConfiguredProfiles
            } });
            const result = documents.hydrateRosterDocument(plain(document), {
              unitPackages: [pathfinders], normalizeRosterEntry: engine.normalizeRosterEntry,
              createDefaultRosterEntry: engine.createDefaultRosterEntry,
              unitSizeState: engine.getUnitSizeState, setUnitSize: engine.setUnitSize
            });
            assert.deepEqual(result.warnings, []);
            roster = result.roster;
            assert.deepEqual(plain(roster[0].entry.selections), expected, choices.join(" / "));
          }
        }
      }
    }
  });
}

test("Deathwatch Marine and Gravis profiles retain the Toughness in the supplied catalogue", () => {
  for (const name of ["Decimus Kill Team", "Fortis Kill Team", "Indomitor Kill Team", "Talonstrike Kill Team", "Spectrus Kill Team"]) {
    const unit = marines.find(u => u.name === name && u.faction.endsWith("Deathwatch"));
    assert.ok(unit, name);
    const profiles = domain.buildTreeIndex(unit).all.flatMap(n => n.profiles || []).filter(p => p.typeName === "Unit");
    for (const profile of profiles) {
      const expected = name === "Spectrus Kill Team" ? "4"
        : /Gravis|Heavy Intercessor/.test(profile.name) ? "6" : "5";
      assert.equal(profile.characteristics.T, expected, name + " / " + profile.name);
    }
  }
});

for (const filename of ["../mobile/ui/engine-app.js", "../ui/engine-app.js"]) {
  test(`${filename}: individual weapon previews exclude the rest of a model's loadout`, () => {
    const source = fs.readFileSync(require.resolve(filename), "utf8");
    const start = source.indexOf("function renderWeaponOptionName(");
    const end = source.indexOf("function renderWeaponOptionPreview(", start);
    const context = { escapeHtml: x => x, renderWeaponOptionPreview: (name, profiles) => ({ name, profiles }) };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);
    const profiles = ["Bolt rifle", "Bolt pistol", "Close combat weapon", "➤ Grenade Launcher - Frag", "➤ Grenade Launcher - Krak"]
      .map(name => ({ name }));
    assert.deepEqual(plain(context.matchingWeaponPreviewProfiles("Bolt rifle", profiles)).map(p => p.name), ["Bolt rifle"]);
    assert.equal(context.matchingWeaponPreviewProfiles("Intercessor w/ Grenade Launcher", profiles).length, 2);
    for (const label of ["Bolt rifle and Bolt pistol", "Bolt rifle & Bolt pistol", "Bolt rifle, Bolt pistol"]) {
      const parts = context.splitWeaponOptionName(label, profiles).filter(p => p.profiles.length);
      assert.deepEqual(plain(parts).map(p => p.profiles.map(p => p.name)), [["Bolt rifle"], ["Bolt pistol"]]);
    }
  });
}
