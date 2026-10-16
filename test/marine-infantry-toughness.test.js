'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),loadout=require('../src/domain/loadout'),{correctMarineInfantryToughness:correct}=require('../src/rulesets/marine-infantry-toughness');
const units=[];for(const file of fs.readdirSync('ui/engine-data').filter(n=>n.startsWith('imperium-adeptus-astartes'))){const w={};vm.runInNewContext(fs.readFileSync('ui/engine-data/'+file,'utf8'),{window:w});units.push(...Object.values(w.ROSTER_ENGINE_FACTIONS).flat().map(x=>({...x.definition,rulesetId:'wh40k-11e-vflam'})));}
const profiles=u=>loadout.buildTreeIndex(u).all.flatMap(n=>n.profiles||[]).filter(p=>p.typeName==='Unit');
test('Sanguinary Guard and Priests use T5 without changing identity, weapons or loadouts',()=>{
 for(const name of ['Sanguinary Guard','Sanguinary Priest','Commander Dante','Death Company Marines with Jump Packs','Inner Circle Companions','Wolf Guard Headtakers']){
  const original=units.find(u=>u.name===name);assert.ok(original,name);const u=correct(original),entry=loadout.createDefaultRosterEntry(u);
  assert.equal(u.selectionKey,original.selectionKey);assert.deepEqual(u.pricing,original.pricing);assert.deepEqual(u.roles,original.roles);assert.deepEqual(loadout.validateLoadout(u,entry),[]);
  const marineProfiles=profiles(u).filter(p=>!/wolves|hunting wolf/i.test(p.name));assert.ok(marineProfiles.length);assert.ok(marineProfiles.every(p=>Number(p.characteristics.T)>=5),name);
  const before=loadout.getConfiguredProfiles(original,loadout.createDefaultRosterEntry(original)),after=loadout.getConfiguredProfiles(u,entry);assert.deepEqual(after.weapons,before.weapons);assert.deepEqual(after.abilities,before.abilities);
 }
});
test('armour exceptions, non-infantry, non-Marine companions and higher toughness stay intact',()=>{
 for(const name of ['Infiltrator Squad','Captain in Gravis Armour','Terminator Squad','Land Raider']){const u=units.find(u=>u.name===name);assert.ok(u,name);assert.deepEqual(correct(u),u,name);}
 for(const [name,pattern] of [['Chaplain Grimaldus',/servitor/i],['Crusader Squad',/neophyte/i],['Wolf Guard Headtakers',/wolves/i],['Wardens of Ultramar',/Gaius Silva/i]]){const u=units.find(u=>u.name===name);assert.ok(u,name);const original=profiles(u).filter(p=>pattern.test(p.name));assert.ok(original.length);assert.deepEqual(profiles(correct(u)).filter(p=>pattern.test(p.name)),original);}
 const u=units.find(u=>u.name==='Sanguinary Guard');const once=correct(u);assert.deepEqual(correct(once),once);assert.deepEqual(correct({...u,faction:'Chaos - Chaos Space Marines'}),{...u,faction:'Chaos - Chaos Space Marines'});
});
