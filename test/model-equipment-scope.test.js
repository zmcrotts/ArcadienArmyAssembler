'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const engine=require('../src/domain/loadout'),sheets=require('../src/domain/sheets');
const {bindModelEquipmentEffects:bind}=require('../src/rulesets/model-equipment-scope');
const {readSpaceMarineUnits}=require('../src/rulesets/space-marine-units');
const units=readSpaceMarineUnits(require.resolve('../data/manual-rules/wh40k-11e-space-marine-units.json.gz')).units;
const captain=units.find(u=>u.name==='Captain'&&u.faction.endsWith(' - Space Marines')),bodyguard=units.find(u=>u.name==='Intercessor Squad'&&u.faction===captain.faction);
test('Relic Shield adds one wound only to the Captain in an attached unit',()=>{
 const u=bind(captain),shield=engine.getOptionStates(u,engine.createDefaultRosterEntry(u)).find(n=>/Relic Shield/.test(n.name)&&n.editable),entry=engine.setSelection(u,engine.createDefaultRosterEntry(u),shield.id,1),c=engine.getConfiguredProfiles(u,entry),b=engine.getConfiguredProfiles(bodyguard,engine.createDefaultRosterEntry(bodyguard));
 const effect=c.abilities.find(a=>a.name==='Relic Shield');assert.ok(effect.bearerProfileIds.length);const rows=sheets.applyUnitEffectsToProfiles([...c.units,...b.units],[effect]);
 for(const p of b.units)assert.equal(rows.find(r=>r.id===p.id).characteristics.W,p.characteristics.W,p.name);
 for(const p of c.units)assert.equal(Number(rows.find(r=>r.id===p.id).characteristics.W),Number(p.characteristics.W)+1,p.name);
 const off=engine.setSelection(u,entry,shield.id,0);assert.ok(!engine.getConfiguredProfiles(u,off).abilities.some(a=>a.name==='Relic Shield'));assert.deepEqual(bind(u),u);
});
