'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),sheets=require('../src/domain/sheets'),data=require('../data/manual-rules/wh40k-11e-custodes-codex.json');
const martial=data.armyRules.find(x=>x.name==="Martial Ka'tah");
const weapons={weapons:[{name:'Guardian spear',typeName:'Melee Weapons',characteristics:{Keywords:'CLEAVE 1'}},{name:'Arachnus Blaze Carronade',typeName:'Ranged Weapons',characteristics:{Keywords:'LETHAL HITS: MONSTER/VEHICLE'}}]};
test('Martial and favoured Katahs are never permanent keyword or stat bonuses',()=>{
 for(const rule of [martial,...data.detachments.flatMap(d=>d.rules.filter(r=>/Ka.tah/.test(r.name)))]){for(const sourceKind of ['army','detachment']){assert.deepEqual(sheets.extractWeaponEffects([{...rule,sourceKind}]),[],rule.name);assert.deepEqual(sheets.extractUnitEffects([{...rule,sourceKind}]),[],rule.name);}}
 assert.deepEqual(sheets.applyWeaponEffectsToConfigured(weapons,[{...martial,sourceKind:'army'}]).weapons.map(w=>w.characteristics.Keywords),['CLEAVE 1','LETHAL HITS: MONSTER/VEHICLE']);
});
test('timed cards keep their payload associated with their WHEN condition',()=>{
 const card={name:'Rendax',sourceKind:'army',description:'WHEN: Fight phase, when selected to fight. TARGET: One readied unit. EFFECT: Its melee attacks have [LETHAL HITS: MONSTER/VEHICLE].'};
 assert.deepEqual(sheets.extractWeaponEffects([card]),[]);
});
test('saved polluted weapon profiles recalculate from their original printed keywords',()=>{
 const polluted=structuredClone(weapons);polluted.weapons[0].weaponEffectBaseCharacteristics={Keywords:'CLEAVE 1'};polluted.weapons[0].characteristics.Keywords='CLEAVE 1, Lethal Hits: Monster/Vehicle';
 const repaired=sheets.applyWeaponEffectsToConfigured(JSON.parse(JSON.stringify(polluted)),[{...martial,sourceKind:'army'}]);assert.equal(repaired.weapons[0].characteristics.Keywords,'CLEAVE 1');assert.equal(repaired.weapons[1].characteristics.Keywords,'LETHAL HITS: MONSTER/VEHICLE');
 assert.equal(sheets.applyWeaponEffectsToConfigured(repaired,[]).weapons[0].characteristics.Keywords,'CLEAVE 1');
});
test('bearer-only Custodes enhancement keywords do not spread to attached bodyguards',()=>{
 for(const [name,keyword] of [['Auric Exemplar','Cleave 1'],['Flawless Bladework','Sustained Hits 1'],['From the Hall of Armouries','Devastating Wounds']]){const e=data.detachments.flatMap(d=>d.enhancements).find(e=>e.name===name);const effect={...e,bearerInstanceId:'captain'};const input={weapons:[{name:'Weapon',typeName:'Melee Weapons',characteristics:{Keywords:'-'}}]};assert.equal(sheets.applyWeaponEffectsToConfigured(input,[effect],{instanceId:'guard'}).weapons[0].characteristics.Keywords,'-');assert.equal(sheets.applyWeaponEffectsToConfigured(input,[effect],{instanceId:'captain'}).weapons[0].characteristics.Keywords,keyword,name);}
});
