'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readSpaceMarineUnits } = require('../src/rulesets/space-marine-units');
const { applyMfmPoints, readMfmPoints } = require('../src/rulesets/mfm-points');
const l = require('../src/domain/loadout');
const { calculateEntryPoints } = require('../src/domain/pricing');
const { audit } = require('../scripts/audit-space-marine-reconciliation');
const source = readSpaceMarineUnits(path.resolve(__dirname, '../data/manual-rules/wh40k-11e-space-marine-units.json.gz'));
const mfm = readMfmPoints(path.resolve(__dirname, '../data/manual-rules/wh40k-11e-mfm-points.json'));
const result = applyMfmPoints(source.units, [], mfm);
const unit = name => result.units.find(u => u.name === name && u.faction.endsWith('Space Marines')) || result.units.find(u => u.name === name);
const cost = (u, e) => calculateEntryPoints(u, e).points;
test('all current Marine size/copy bands and paid wargear rows reconcile', () => {
  const report = audit({ units: result.units, sourceIssues: result.issues, spaceMarineUnitSource: { commit: source.commit } });
  assert.ok(report.summary.validatedSchedules > 1700);
  assert.deepEqual(report.defaults, []);
  assert.deepEqual(report.failures, []);
  assert.deepEqual(report.gearFailures, []);
  assert.equal(report.summary.paidWargearRows, 51);
  assert.deepEqual(report.missing.map(i => i.change.unitName), ['KAIUS KONORIUS']);
});
test('standard Chaplain costs 60 in all twelve chapter catalogues', () => {
  const chaplains = result.units.filter(u => u.name === 'Chaplain');
  assert.equal(chaplains.length, 12);
  for (const u of chaplains) assert.equal(cost(u, l.createDefaultRosterEntry(u)), 60, u.faction);
});
test('paid vehicle and sergeant equipment changes the configured total', () => {
  for (const [name, weapon, points] of [['Redemptor Dreadnought', 'Macro Plasma Incinerator', 10], ['Impulsor', 'Orbital Comms Array', 10], ['Desolation Squad', 'Vengor launcher', 5], ['Repulsor Executioner', 'Heavy Laser Destroyer', 10]]) {
    const u = unit(name), e = l.createDefaultRosterEntry(u);
    const option = l.listSelectableOptions(u).find(o => o.name === weapon);
    assert.equal(cost(u, l.setSelection(u, e, option.id, 1)) - cost(u, e), points, name);
  }
});
test('storm shield costs scale with squad size, including the sergeant', () => {
  const u = unit('Terminator Assault Squad');
  for (const size of [5, 10]) {
    const e = l.setUnitSize(u, l.createDefaultRosterEntry(u), size);
    const calculated = calculateEntryPoints(u, e);
    assert.equal(calculated.points - calculated.applied[0].value, size * 5);
    assert.deepEqual(l.validateLoadout(u, e), []);
  }
});
test('Wolf Scout bundle labels resolve actual six- and twelve-model squads', () => {
  const u = unit('Wolf Scouts');
  for (const [size, points] of [[6, 95], [12, 190]]) {
    const e = l.setUnitSize(u, l.createDefaultRosterEntry(u), size);
    assert.equal(l.getUnitSizeState(u, e).current, size);
    assert.equal(cost(u, e), points);
  }
});
test('new Victrix defaults and solo Calgar use current MFM composition', () => {
  for (const [name, size, points] of [['Victrix Honour Guard', 3, 120], ['Marneus Calgar in Armour of Antilochus', 1, 180]]) {
    const u = unit(name), e = l.createDefaultRosterEntry(u);
    assert.equal(l.getUnitSizeState(u, e).current, size);
    assert.equal(cost(u, e), points);
  }
});

test('old Calgar saves resolve to the updated datasheet without dropping the roster entry', () => {
  const definition = unit('Marneus Calgar in Armour of Antilochus');
  const oldKey = definition.previousSelectionKeys[0];
  assert.ok(oldKey);
  const loaded = require('../src/domain/roster-document').hydrateRosterDocument({ rosterEntries: [{ name: 'Marneus Calgar', selectionKey: oldKey, instanceId: 'calgar-old', entry: { selections: {} } }] }, { unitPackages: [{ name: definition.name, selectionKey: definition.selectionKey, id: definition.id, definition }], createDefaultRosterEntry: l.createDefaultRosterEntry, normalizeRosterEntry: l.normalizeRosterEntry });
  assert.equal(loaded.roster.length, 1);
  assert.equal(loaded.roster[0].unitPackage.selectionKey, definition.selectionKey);
  assert.equal(loaded.warnings.some(w => w.code === 'SAVED_UNIT_NOT_FOUND'), false);
});
