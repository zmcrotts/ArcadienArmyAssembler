"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const source = require("../data/manual-rules/wh40k-11e-custodes-codex.json");
const {applyCustodesCodex} = require("../src/rulesets/custodes-codex");
const loadout = require("../src/domain/loadout");
const {calculateEntryPoints} = require("../src/domain/pricing");
const armyEngine = require("../src/domain/army");
const dispositions = [...new Set(source.detachments.flatMap(d=>d.forceDispositions))].map(name=>({id:name,name}));
const other = {faction:"Xenos - Test",selectionKey:"other",name:"Other"};
const result = applyCustodesCodex([other],[{faction:"Imperium - Adeptus Custodes",forceDispositions:dispositions,detachments:[],enhancements:[],allowedSelectionKeys:[]}],source,"wh40k-11e-vflam");
const army=result.armies[0];
const unit=name=>{const u=result.units.find(u=>u.name===name);assert.ok(u,name);return u;};
const nodes=u=>loadout.buildTreeIndex(u).all;
const option=(u,name)=>{const n=nodes(u).find(n=>n.name===name && n.kind==="upgrade");assert.ok(n,name);return n;};
const record=(u,id)=>({instanceId:id,selectionKey:u.selectionKey,name:u.name,definition:u,roles:u.roles,rosterRules:u.rosterRules,entry:loadout.createDefaultRosterEntry(u,id)});
test("Custodes fully replace the active range and retain the confirmed Legends units",()=>{
 assert.equal(result.units.filter(u=>u.faction===army.faction).length,31);
 assert.equal(result.units.filter(u=>/\[Legends\]/.test(u.name)).length,4);
 assert.equal(result.units[0],other);
 assert.equal(army.detachments.length,13);
 assert.equal(army.enhancements.length,29);
 assert.equal(army.detachments.reduce((n,d)=>n+d.stratagems.length,0),41);
 assert.ok(!army.detachments.some(d=>d.name==="Shield Host"));
 assert.ok(!result.units.some(u=>u.name==="Aleya" || u.name==="Valerian" || /\[Crucible\]/.test(u.name)));
 assert.equal(army.armyRules.find(r=>r.name==="Martial Ka'tah").description.includes("readied"),true);
 assert.equal(army.armyRules.length,6);
});
test("All 27 new datasheets validate every printed size and MFM copy tier",()=>{
 for(const u of result.units.filter(u=>u.custodesCodexSource)) {
  for(let size=u.composition[0].min;size<=u.composition[0].max;size++) {
   const e=loadout.setUnitSize(u,loadout.createDefaultRosterEntry(u),size);
   assert.deepEqual(loadout.validateLoadout(u,e),[],u.name);
   for(const copies of [0,1,2,3]) {
    e.context={previousCopies:copies};
    const rows=u.pricing.mfmRows.filter(r=>copies>=r.copies.min && (r.copies.max===null || copies<=r.copies.max));
    const expected=rows.filter(r=>r.modelCount>=size).sort((a,b)=>a.modelCount-b.modelCount)[0];
    const surcharge=u.name==="Shield-Captain"?25:0;
    assert.equal(calculateEntryPoints(u,e).points,expected.points+surcharge,`${u.name}/${size}/${copies}`);
   }
  }
 }
});
test("Captain joint replacements remove shield and its 25-point cost",()=>{
 const u=unit("Shield-Captain");const e=loadout.createDefaultRosterEntry(u);
 assert.equal(calculateEntryPoints(u,e).points,205);
 assert.ok(loadout.getConfiguredProfiles(u,e).abilities.some(p=>p.name==="Praesidium Shield"));
 const axe=loadout.setSelection(u,e,option(u,"Castellan Axe").id,1);
 assert.equal(calculateEntryPoints(u,axe).points,180);
 const profiles=loadout.getConfiguredProfiles(u,axe);
 assert.ok(!profiles.abilities.some(p=>p.name==="Praesidium Shield"));
 assert.ok(!profiles.weapons.some(p=>p.name==="Pyrithite Spear"));
 assert.deepEqual(profiles.weapons.filter(p=>p.typeName==="Melee Weapons").map(p=>[p.name,p.characteristics.A]),[["Castellan Axe","5"]]);
});
test("Model counts scale weapons, while optional Vexilla retains a single bearer",()=>{
 const u=unit("Custodian Wardens");let e=loadout.setUnitSize(u,loadout.createDefaultRosterEntry(u),3);
 e=loadout.setSelection(u,e,option(u,"Castellan Axe").id,1);
 e=loadout.setSelection(u,e,option(u,"Vexilla").id,1);
 const p=loadout.getConfiguredProfiles(u,e);
 assert.deepEqual(p.weapons.filter(p=>p.typeName==="Melee Weapons").map(p=>[p.name,p.count]).sort(),[["Castellan Axe",1],["Guardian Spear",2]]);
 assert.equal(p.abilities.find(p=>p.name==="Vexilla").count,1);
 assert.deepEqual(loadout.validateLoadout(u,e),[]);
});
test("Telemon/ Achillus joint weapon options preserve counts and forbid invented mixed bundles",()=>{
 const t=unit("Telemon Heavy Dreadnought");const e=loadout.createDefaultRosterEntry(t);
 assert.equal(loadout.getConfiguredProfiles(t,e).weapons.find(p=>p.name==="Twin Neutronium Cascade Projectors").count,2);
 const changed=loadout.setSelection(t,e,option(t,"Adrathic Desolator and Caestus Fist").id,1);
 const p=loadout.getConfiguredProfiles(t,changed);
 assert.equal(p.weapons.find(p=>p.name==="Twin Neutronium Cascade Projectors").count,1);
 assert.ok(!p.weapons.some(p=>p.name==="Dual Caestus Fists"));
 const a=unit("Contemptor-Achillus Dreadnought");const ae=loadout.setSelection(a,loadout.createDefaultRosterEntry(a),option(a,"Adrathic Combi-destructor").id,1);
 assert.equal(loadout.getConfiguredProfiles(a,ae).weapons.find(p=>p.name==="Adrathic Combi-destructor").count,2);
});
test("MFM Leader authority, conditional Battleline/Warlord and shared Unique tag are enforced",()=>{
 const cap=unit("Shield-Captain on Dawneagle Jetbike");assert.ok(cap.roles.leader);
 assert.ok(armyEngine.leaderCanTarget(record(cap,"c"),record(unit("Gyrfalcon Jetbike Sodality"),"g")));
 const nullDet=army.detachments.find(d=>d.name==="Null Maiden Vigil");
 const knight=record(unit("Knight-Centura"),"k");
 assert.equal(armyEngine.canSelectWarlord({roles:knight.definition.roles,rosterRules:knight.definition.rosterRules}),false);
 assert.equal(armyEngine.canSelectWarlord({roles:knight.definition.roles,rosterRules:knight.definition.rosterRules},{detachmentIds:[nullDet.id]}),true);
 const prosecutor=record(unit("Prosecutor Squad"),"p");
 assert.ok(!armyEngine.effectiveKeywordsForEntry(prosecutor,{detachmentIds:[]}).some(k=>k.toLowerCase()==="battleline"));
 assert.ok(armyEngine.effectiveKeywordsForEntry(prosecutor,{detachmentIds:[nullDet.id]}).some(k=>k.toLowerCase()==="battleline"));
 const required=armyEngine.validateRosterLegality(army,{detachmentIds:[nullDet.id],warlordInstanceId:"k"},[knight,record(unit("Trajann Valoris"),"t")],{pointsLimit:2000});
 assert.ok(required.warnings.some(w=>w.code==="SUPREME_COMMANDER_WARLORD"));
 assert.equal(army.detachments.filter(d=>d.uniqueTags.includes("SHIELD HOST")).length,6);
 const tags=army.detachments.filter(d=>d.uniqueTags.includes("SHIELD HOST")).slice(0,2);
 const state={...armyEngine.createArmyState(army),detachmentIds:tags.map(d=>d.id)};
 const validation=armyEngine.validateRosterLegality(army,state,[],{pointsLimit:2000});
 assert.ok(validation.warnings.some(w=>/unique/i.test(w.code)));
});
test("RAW enhancement limits and non-Character upgrades remain faithful",()=>{
 const eye=army.enhancements.find(e=>e.name==="Eagle's Eye");assert.doesNotMatch(eye.profiles[0].characteristics.Description,/until|end of.*phase/i);
 const superior=army.enhancements.find(e=>e.name==="Superior Creation");assert.doesNotMatch(superior.profiles[0].characteristics.Description,/once per/i);
 const moritoi=army.enhancements.find(e=>e.name==="Memento Moritoi");assert.equal(moritoi.kind,"upgrade");assert.equal(moritoi.maxSelections,1);assert.ok(moritoi.eligibleSelectionKeys.includes(unit("Telemon Heavy Dreadnought").selectionKey));
 const eagle=army.enhancements.find(e=>e.name==="Auric Eagle");assert.ok(eagle.eligibleSelectionKeys.includes(unit("Vertus Praetors").selectionKey));assert.ok(!eagle.eligibleSelectionKeys.includes(unit("Allarus Custodians").selectionKey));
 const cor=unit("Coronus Grav-Carrier");const tr=loadout.getConfiguredProfiles(cor,loadout.createDefaultRosterEntry(cor)).abilities.find(p=>p.name==="Transport");assert.match(tr.characteristics.Description,/8 ADEPTUS CUSTODES INFANTRY/);assert.match(tr.characteristics.Description,/cannot transport JUMP PACK/);
 const a=unit("Shield-Captain in Allarus Terminator Armour");assert.ok(loadout.getConfiguredProfiles(a,loadout.createDefaultRosterEntry(a)).abilities.some(p=>p.name.startsWith("Archeotech Teleport-Shunter")));
});

test("Permanent Custodes stat changes update sheets without applying battle-state rules",()=> {
 const sheets=require("../src/domain/sheets");
 const enhancement=name=>army.enhancements.find(e=>e.name===name);
 assert.deepEqual(new Set(sheets.extractWeaponEffects([enhancement("Memento Moritoi")]).map(e=>e.characteristic)),new Set(["A","S","D"]));
 assert.deepEqual(sheets.extractWeaponEffects([enhancement("Not a Shell Wasted")]).map(e=>[e.characteristic,e.weaponType,e.delta]),[["A","Ranged Weapons",1]]);
 assert.ok(sheets.extractUnitEffects([enhancement("Eagle's Eye")]).some(e=>e.characteristic==="W" && e.delta===1));
 assert.ok(sheets.extractWeaponEffects([enhancement("Flawless Bladework")]).some(e=>e.kind==="keyword" && /sustained hits/i.test(e.keyword)));
 assert.equal(sheets.extractUnitEffects(army.detachments.find(d=>d.name==="Might of the Moritoi").rules).length,0);
 const leonine=enhancement("Leonine Ferocity");
 assert.deepEqual(leonine.eligibleSelectionKeys,[unit("Shield-Captain in Allarus Terminator Armour").selectionKey]);
});

test('confirmed Legends units have fixed MFM costs, printed profiles and conditional abilities',()=>{
 const sheets=require('../src/domain/sheets');
 for(const [name,size,points] of [['Sagittarum Custodians Sodality [Legends]',3,185],['Valerian [Legends]',1,130]]){
  const u=unit(name),e=loadout.createDefaultRosterEntry(u),p=loadout.getConfiguredProfiles(u,e);
  assert.deepEqual(loadout.validateLoadout(u,e),[],name);
  assert.equal(u.composition[0].min,size);assert.equal(u.composition[0].max,size);
  for(const previousCopies of [0,1,2,3])assert.equal(calculateEntryPoints(u,{...e,context:{previousCopies}}).points,points);
  assert.equal(p.units[0].characteristics.SV,'2+');assert.equal(p.units[0].characteristics.LD,'5+');assert.equal(p.units[0].characteristics.InSv,'4+');
  assert.ok(p.abilities.some(x=>x.name==="Martial Ka'tah"));assert.ok(p.abilities.some(x=>x.name==='Aegis of the Emperor'));
  assert.ok(p.weapons.every(w=>w.count===size));
  assert.deepEqual(sheets.extractWeaponEffects(p.abilities),[],name+' has no permanent ability weapon buffs');
  assert.ok(u.keywords.includes('Legends'));assert.ok(!u.roles.battleline);
 }
 const s=unit('Sagittarum Custodians Sodality [Legends]'),v=unit('Valerian [Legends]');
 assert.ok(s.keywords.includes('TRUSTED SENTINEL'));assert.ok(v.keywords.includes('SHIELD-CAPTAIN'));assert.ok(v.roles.epicHero);assert.equal(v.rosterRules.maxCopies,1);
 assert.ok(army.enhancements.every(x=>!x.eligibleSelectionKeys.includes(v.selectionKey)));
 const sp=loadout.getConfiguredProfiles(s,loadout.createDefaultRosterEntry(s));
 assert.deepEqual(sp.weapons.map(x=>[x.name,x.characteristics.Keywords]),[['Adrastus Bolt Caliver','SUSTAINED HITS 1'],['Misericordia','-']]);
 assert.doesNotMatch(sp.abilities.find(x=>x.name.startsWith('Disintegration Beams')).characteristics.Description,/until|end of/i);
 const vp=loadout.getConfiguredProfiles(v,loadout.createDefaultRosterEntry(v));
 assert.deepEqual(vp.weapons.map(x=>[x.typeName,x.characteristics.A,x.characteristics.S,x.characteristics.Keywords]),[['Ranged Weapons','3','6','ASSAULT, RAPID FIRE 2'],['Melee Weapons','7','8','-']]);
 for(const leader of [v,unit('Shield-Captain'),unit('Trajann Valoris')])assert.ok(armyEngine.leaderCanTarget(record(leader,'l'),record(s,'s')),leader.name);
 for(const name of ['Custodian Guard Sodality','Custodian Wardens','Sentinel Guard Sodality'])assert.ok(armyEngine.leaderCanTarget(record(v,'v'),record(unit(name),'b')));
 assert.equal(armyEngine.leaderCanTarget(record(v,'v'),record(unit('Allarus Custodians'),'a')),false);
});
