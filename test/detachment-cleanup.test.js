'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const domain = require('../src/domain/army');

const army = {
  id: 'army',
  detachments: [{ id: 'one' }, { id: 'two' }],
  enhancements: [
    { id: 'relic', points: 10, detachmentIds: ['one'] },
    { id: 'upgrade', kind: 'upgrade', points: 5, detachmentIds: ['one'] },
    { id: 'other', points: 20, detachmentIds: ['two'] },
    { id: 'shared', kind: 'upgrade', points: 15, detachmentIds: ['one', 'two'] }
  ]
};

function assignedState(api) {
  return {
    ...api.setSelectedDetachments(army, api.createArmyState(army), ['one', 'two']),
    warlordInstanceId: 'leader',
    attachments: [{ leaderInstanceId: 'leader', targetInstanceId: 'bodyguard' }],
    enhancements: [
      { enhancementId: 'relic', bearerInstanceId: 'leader' },
      { enhancementId: 'upgrade', bearerInstanceId: 'vehicle-1' },
      { enhancementId: 'upgrade', bearerInstanceId: 'vehicle-2' },
      { enhancementId: 'other', bearerInstanceId: 'leader-2' },
      { enhancementId: 'shared', bearerInstanceId: 'vehicle-3' }
    ]
  };
}

const browser = { window: {}, structuredClone };
vm.runInNewContext(fs.readFileSync(require.resolve('../src/domain/army'), 'utf8'), browser);

for (const [runtime, api] of [['domain', domain], ['browser', browser.window.ArmyEngine]]) {
  test(`${runtime}: removing a detachment removes its enhancements and every upgrade assignment`, () => {
    const state = assignedState(api);
    const original = structuredClone(state);
    const next = api.setSelectedDetachments(army, state, ['two']);
    assert.deepEqual(Array.from(next.enhancements), state.enhancements.slice(3));
    assert.deepEqual(next.attachments, state.attachments);
    assert.equal(next.warlordInstanceId, state.warlordInstanceId);
    assert.equal(api.calculateArmyOptionPoints(army, state), 55);
    assert.equal(api.calculateArmyOptionPoints(army, next), 35);
    assert.equal(api.validateArmyState(army, next, []).some(item => item.code === 'ENHANCEMENT_NOT_AVAILABLE'), false);
    assert.deepEqual(state, original, 'input state is unchanged');
    const reselected = api.setSelectedDetachments(army, next, ['one', 'two']);
    assert.deepEqual(Array.from(reselected.enhancements), state.enhancements.slice(3), 'removed options do not reappear');
  });

  test(`${runtime}: clearing all detachments removes all detachment options and points`, () => {
    const state = assignedState(api);
    for (const next of [api.setSelectedDetachments(army, state, []), api.selectDetachment(army, state, null)]) {
      assert.equal(next.enhancements.length, 0);
      assert.equal(next.detachmentIds.length, 0);
      assert.equal(next.detachmentId, null);
      assert.equal(api.calculateArmyOptionPoints(army, next), 0);
    }
  });

  test(`${runtime}: single-detachment switching preserves shared upgrades`, () => {
    const state = assignedState(api);
    const next = api.selectDetachment(army, state, 'one');
    assert.deepEqual(Array.from(next.enhancements), state.enhancements.filter(item => item.enhancementId !== 'other'));
    assert.equal(api.calculateArmyOptionPoints(army, next), 35);
  });

  test(`${runtime}: definition normalization and detachment changes use the same cleanup`, () => {
    const state = assignedState(api);
    state.detachmentIds = ['two'];
    state.detachmentId = 'two';
    const loaded = api.normalizeArmyStateForDefinition(army, state);
    const changed = api.setSelectedDetachments(army, state, ['two']);
    assert.deepEqual(Array.from(loaded.enhancements), Array.from(changed.enhancements));
    assert.equal(loaded.enhancements.length, 2);
  });
}
