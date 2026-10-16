'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),sheets=require('../src/domain/sheets');
const codex=require('../data/manual-rules/wh40k-11e-space-marines-codex.json');
const sword=codex.detachments.flatMap(d=>d.enhancements).find(e=>e.weaponProfile&&/Imperium/.test(e.name));
const effect={id:'imperiums-sword',name:sword.name,bearerInstanceId:'captain-1',profiles:[{...sword.weaponProfile,id:'imperiums-sword-weapon'}]};
const base={weapons:[{id:'chainsword',name:'Chainsword',typeName:'Melee Weapons',count:1,characteristics:{Range:'Melee',A:'5',WS:'2+',S:'5',AP:'-1',D:'1'}}]};
test('Imperium Sword is an additional bearer-only weapon and never duplicates on reapplication',()=>{
 const configured=sheets.applyWeaponEffectsToConfigured(base,[effect],{instanceId:'captain-1'});assert.equal(configured.weapons.length,2);assert.equal(configured.weapons[0].name,'Chainsword');assert.deepEqual(configured.weapons[1].characteristics,{Range:'Melee',A:'6',WS:'2+',S:'7',AP:'-3',D:'3'});assert.equal(configured.weapons[1].count,1);
 assert.equal(sheets.applyWeaponEffectsToConfigured(configured,[effect],{instanceId:'captain-1'}).weapons.length,2);assert.equal(sheets.applyWeaponEffectsToConfigured(base,[effect],{instanceId:'bodyguard-1'}).weapons.length,1);assert.equal(sheets.applyWeaponEffectsToConfigured(base,[],{instanceId:'captain-1'}).weapons.length,1);
});
