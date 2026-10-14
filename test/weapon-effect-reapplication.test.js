'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const sheets=require('../src/domain/sheets');
const khorne={name:'Khorne',description:'Add 2 to the Strength characteristic of this model’s hellforged weapons.'};
const enhancement={name:'Melee boost',description:'Add 1 to the Attacks characteristic of melee weapons equipped by the bearer.'};
const configured={weapons:[{name:'Hellforged weapons - strike',typeName:'Melee Weapons',characteristics:{A:'6',S:'8',AP:'-2',D:'3'}},{name:'Hellforged weapons - sweep',typeName:'Melee Weapons',characteristics:{A:'12',S:'6',AP:'0',D:'1'}},{name:'Infernal cannon',typeName:'Ranged Weapons',characteristics:{A:'3',S:'5',AP:'-1',D:'2'}}],abilities:[khorne]};
const stats=c=>c.weapons.map(w=>[w.characteristics.S,w.characteristics.A]);
const source=fs.readFileSync(require.resolve('../mobile/ui/play-mode.js'),'utf8');
const start=source.indexOf('  function effectiveWeaponsForGroup('),end=source.indexOf('  function isGroupBattleShocked(',start);
function playWeapons(profile,extra=[]){const context={session:{roster:{enhancements:extra}},window:{RosterSheets:sheets},normalize:x=>x};vm.runInNewContext(source.slice(start,end)+'\nthis.weapons=effectiveWeaponsForGroup',context);return context.weapons({members:[{instanceId:'prince',name:'Heretic Astartes Daemon Prince of Khorne',configured:profile}]});}
test('static weapon bonuses are applied once across serialized snapshots and repeated calculations',()=>{
 const once=sheets.applyWeaponEffectsToConfigured(configured,[khorne]);assert.deepEqual(stats(once),[['10','6'],['8','12'],['5','3']]);
 const snapshot=JSON.parse(JSON.stringify(once));const twice=sheets.applyWeaponEffectsToConfigured(snapshot,[khorne]);assert.deepEqual(stats(twice),stats(once));assert.deepEqual(stats(configured),[['8','6'],['6','12'],['5','3']]);
 const enhanced=sheets.applyWeaponEffectsToConfigured(snapshot,[khorne,enhancement]);assert.deepEqual(stats(enhanced),[['10','7'],['8','13'],['5','3']]);
 assert.deepEqual(stats(sheets.applyWeaponEffectsToConfigured(enhanced,[khorne,enhancement])),stats(enhanced));
});
test('Play mode keeps Khorne melee Strength at 10 and 8, including resumed legacy games',()=>{
 const snapshot=sheets.applyWeaponEffectsToConfigured(configured,[khorne]);
 assert.deepEqual(stats({weapons:playWeapons(snapshot)}),[['10','6'],['8','12'],['5','3']]);
 const legacy=JSON.parse(JSON.stringify(snapshot));for(const weapon of legacy.weapons)delete weapon.weaponEffectBaseCharacteristics;
 assert.deepEqual(stats({weapons:playWeapons(legacy)}),[['10','6'],['8','12'],['5','3']]);
 assert.deepEqual(stats({weapons:playWeapons(configured)}),[['10','6'],['8','12'],['5','3']]);
});

test('both packaged CSM Daemon Princes keep their Khorne Strength through roster snapshots and Play mode',()=>{
 const dataContext={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../ui/engine-data/chaos-chaos-space-marines.js'),'utf8'),dataContext);
 const runtimeContext={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../ui/engine-runtime'),'utf8'),runtimeContext);
 const engine=runtimeContext.window.RosterEngine;
 const units=dataContext.window.ROSTER_ENGINE_FACTIONS['Chaos - Chaos Space Marines'].filter(unit=>/^Heretic Astartes Daemon Prince(?: with wings)?$/.test(unit.name));
 assert.equal(units.length,2);
 for(const unit of units){
  const definition=unit.definition;let entry=engine.createDefaultRosterEntry(definition);
  const blessing=engine.getOptionStates(definition,entry).find(option=>option.name==='Khorne');entry=engine.setSelection(definition,entry,blessing.id,1);
  const raw=engine.getConfiguredProfiles(definition,entry);
  const effects=[...(raw.abilities||[]),...(raw.rules||[]),...(raw.profiles||[])];
  const snapshot=JSON.parse(JSON.stringify(sheets.applyWeaponEffectsToConfigured(raw,effects)));
  const weapons=playWeapons(snapshot);
  assert.deepEqual(weapons.filter(w=>/Hellforged weapons/i.test(w.name)).map(w=>w.characteristics.S),['10','8']);
  const legacy=JSON.parse(JSON.stringify(snapshot));for(const weapon of legacy.weapons)delete weapon.weaponEffectBaseCharacteristics;
  assert.deepEqual(playWeapons(legacy).filter(w=>/Hellforged weapons/i.test(w.name)).map(w=>w.characteristics.S),['10','8']);
 }
});
