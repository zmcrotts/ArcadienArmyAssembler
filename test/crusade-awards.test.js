"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),path=require("node:path");
const M=require("../src/domain/crusade"),E=require("../src/domain/crusade-eligibility"),W=require("../src/domain/crusade-weapons");
const {extractCrusadeData}=require("../scripts/build-crusade-data");
const data=extractCrusadeData(path.resolve(__dirname,"../data/rulesets/wh40k-11e-vflam"));
function rifle(name="Bolt Rifle",typeName="Ranged Weapons",count=10){return {id:name,typeName,name,count,bearerProfileIds:["sergeant","trooper"],characteristics:{Range:'24"',A:"2",BS:"3+",S:"4",AP:"-1",D:"1",Keywords:"ASSAULT"}};}
function unit(){return {id:"unit-a",name:"Ashen Shield",unitType:"Intercessor Squad",xp:9,games:1,wins:1,survived:1,kills:0,awards:[],enhancements:[],history:[],roles:{infantry:true},keywords:["Infantry","Battleline","Faction: Adeptus Astartes","Faction: Ultramarines"],record:{source:{catalogueId:"e0af-67df-9d63-8fb7",selectionCatalogueId:"4029-9237-e8db-af55",targetId:"8da0-4570-c3c-819f"},entry:{selections:{}},configured:{weapons:[rifle()]}}};}
function force(u){return {faction:"Imperium - Adeptus Astartes - Ultramarines",packs:["Core","Tyrannic War","Pariah Nexus","Armageddon"],units:[u]};}
test("extractor includes all six core modifications, including the five stat-only entries",()=>{
  for(const name of ["Armour Piercing (AP+1)","Brutal (S+1)","Finely Balanced (BS/WS+1)","Heirloom (A+1)","Master-worked (D+1)","Precise"])assert.ok(data.records.some(record=>record.kind==="weapon"&&record.name===name),name);
  assert.equal(data.records.find(record=>record.name==="Battle-scarred Resistance").kind,"honour");
});
test("a ten-rifle unit becomes nine ordinary rifles and ONE modified rifle",()=>{
  const original=unit(),modified=W.assign(original,{weaponKey:W.key(rifle()),copy:1,name:"Fancy Rifle"},["brutal","master"]);
  const profiles=W.profiles(modified);
  assert.equal(profiles.length,2);assert.equal(profiles[0].count,9);assert.equal(profiles[1].count,1);
  assert.equal(profiles[0].characteristics.S,"4");assert.equal(profiles[0].characteristics.D,"1");
  assert.equal(profiles[1].characteristics.S,"5");assert.equal(profiles[1].characteristics.D,"2");
  assert.equal(profiles[1].name,"Fancy Rifle ★");assert.equal(profiles[1].crusadeModified,true);
  assert.equal(original.record.configured.weapons[0].count,10);assert.equal(modified.record.configured.weapons[0].characteristics.D,"1");
  assert.equal(modified.awards.length,1);assert.equal(modified.awards[0].crusadePoints,1);
  assert.deepEqual(W.profiles(JSON.parse(JSON.stringify(modified))),profiles);
});
test('Seeping Poisons replaces the ordinary pair of modifications on one named weapon',()=>{
  const original=unit(),target={weaponKey:W.key(rifle()),copy:2,name:'Rotspitter'};
  assert.throws(()=>W.assign(original,target,['lethal']),/two different/);
  assert.throws(()=>W.assign(original,target,['brutal','master'],{seepingPoisons:true}),/instead/);
  const upgraded=W.assign(original,target,['lethal'],{seepingPoisons:true}),profiles=W.profiles(upgraded);
  assert.equal(profiles[0].count,9);assert.equal(profiles[1].count,1);assert.equal(profiles[1].name,'Rotspitter ★');assert.match(profiles[1].characteristics.Keywords,/LETHAL HITS/);assert.doesNotMatch(profiles[0].characteristics.Keywords,/LETHAL HITS/);assert.equal(upgraded.weaponModifications[0].blessing,'seeping-poisons');
});
test("permanent weapon upgrades survive Play Mode's enhancement baseline recalculation",()=>{
  const sheets=require("../src/domain/sheets"),u=unit();
  u.record.configured.weapons[0].weaponEffectBaseCharacteristics={...u.record.configured.weapons[0].characteristics};
  const upgraded=W.assign(u,{weaponKey:W.key(rifle()),copy:1,name:"Fancy Rifle"},["brutal","master"]);
  const gameProfiles=W.profiles(upgraded);
  const recalculated=sheets.applyWeaponEffectsToConfigured({weapons:gameProfiles},[],{}).weapons;
  const special=recalculated.find(item=>item.crusadeModified);
  assert.equal(special.characteristics.S,"5");assert.equal(special.characteristics.D,"2");
  assert.equal(special.weaponEffectBaseCharacteristics.S,"5");
  assert.equal(recalculated.find(item=>!item.crusadeModified).characteristics.S,"4");
  assert.equal(u.record.configured.weapons[0].weaponEffectBaseCharacteristics.S,"4");
});
test("each stat modification preserves dice characteristics and conditional Precision",()=>{
  const p=rifle();p.characteristics.A="D6";p.characteristics.D="D3+1";
  assert.equal(W.modify(p,["heirloom"]).characteristics.A,"D6+1");
  assert.equal(W.modify(p,["master"]).characteristics.D,"D3+2");
  assert.equal(W.modify(p,["balanced"]).characteristics.BS,"2+");
  assert.equal(W.modify(p,["piercing"]).characteristics.AP,"-2");
  assert.match(W.modify(p,["precise"]).characteristics.Keywords,/PRECISION \(Critical Wounds\)/);
  const melee=rifle("Sword","Melee Weapons",1);melee.characteristics.WS="4+";
  assert.equal(W.modify(melee,["balanced"]).characteristics.WS,"3+");
});
test("one physical weapon's ranged/melee and strike/sweep modes are modified together",()=>{
  const u=unit();u.record.configured.weapons=[rifle("Spear","Ranged Weapons",3),rifle("Spear","Melee Weapons",3)];
  const modified=W.assign(u,{weaponKey:W.key(u.record.configured.weapons[0]),copy:1},["brutal","master"]);
  const result=W.profiles(modified);assert.equal(result.filter(p=>p.crusadeModified).length,2);
  assert.ok(result.filter(p=>p.crusadeModified).every(p=>p.count===1&&p.characteristics.S==="5"));
  assert.ok(result.filter(p=>!p.crusadeModified).every(p=>p.count===2));
  assert.equal(W.key(rifle("Blade - Sweep")),W.key(rifle("Blade - Strike")));
  assert.equal(W.key(rifle("Bolt Rifle (Focused Fire)")),W.key(rifle("Bolt Rifle (Saturation)")));
});
test("modifications reject duplicate choices, duplicate weapons, and nonexistent copies",()=>{
  const u=unit(),target={weaponKey:W.key(rifle()),copy:1};
  assert.throws(()=>W.assign(u,target,["brutal","brutal"]),/two different/);
  assert.throws(()=>W.assign(u,{...target,copy:11},["brutal","master"]),/not currently/);
  const changed=W.assign(u,target,["brutal","master"]);
  assert.throws(()=>W.assign(changed,target,["brutal","heirloom"]),/already has/);
  changed.record.configured.weapons=[];assert.equal(W.profiles(changed).length,0);
});
test("catalogue save/reload retains the individual upgrade without baking bonuses into base equipment",()=>{
  const input=unit();const f=M.createForce({name:"Test force",faction:"Marines",pointsLimit:1000,rosterEntries:[{...input.record,instanceId:"source",selectionKey:"catalogue:unit",name:input.unitType,points:170,keywords:input.keywords,roles:input.roles}]});
  f.units[0]=W.assign(f.units[0],{weaponKey:W.key(rifle()),copy:1},["brutal","master"]);
  const saved=M.applyRosterDocument(f,M.toRosterDocument(f));
  M.validateForce(saved);
  assert.equal(saved.units[0].record.configured.weapons[0].characteristics.S,"4");
  assert.equal(W.profiles(saved.units[0]).find(profile=>profile.crusadeModified).characteristics.S,"5");
  assert.equal(W.profiles(saved.units[0]).find(profile=>!profile.crusadeModified).count,9);
});
test("rolling uses the official D6 order and rerolls BOTH dice on a duplicate",()=>{
  const sequence=[2,2,1,3];const result=W.rollTwo(()=>sequence.shift());
  assert.deepEqual(result.choices,["balanced","piercing"]);assert.deepEqual(result.attempts,[[2,2],[1,3]]);
  assert.deepEqual(W.MODIFICATIONS.map(item=>item.roll),[1,2,3,4,5,6]);
});
test("faction scope excludes other races and sibling Marine chapters",()=>{
  const u=unit(),f=force(u);
  for(const record of data.records.filter(record=>/T'au|Aeldari|Orks|Death Guard/.test(record.faction)))assert.equal(E.assess(record,u,f,data).status,"foreign",record.faction+": "+record.name);
  const bloodAngel=data.records.find(record=>record.name==="Prophetic Gifts"&&/Blood Angels/.test(record.table));
  assert.equal(E.assess(bloodAngel,u,f,data).status,"restricted");
  const champion=data.records.find(record=>record.name==="Adaptable Executioner");
  assert.ok(champion.allowedUnitIds.length);assert.equal(E.assess(champion,u,f,data).status,"restricted");
  const coreMarine=data.records.filter(record=>record.faction.includes("Space Marines")&&record.table.includes("Codex Battle Traits"));
  assert.ok(coreMarine.some(record=>E.assess(record,u,f,data).status!=="foreign"));
});
test("allied units do not inherit their host army's faction awards",()=>{
  const u=unit();u.record.source={catalogueId:"b00-cd86-4b4c-97ba",selectionCatalogueId:"4029-9237-e8db-af55"};u.keywords=["Infantry","Faction: Agents of the Imperium"];
  const marine=data.records.find(record=>record.faction.includes("Space Marines")&&record.table.includes("Codex Battle Traits"));
  assert.equal(E.assess(marine,u,force(u),data).status,"foreign");
});
test("keyword restrictions distinguish Infantry, Character, Mounted and Vehicle tables",()=>{
  const u=unit(),f=force(u);
  const character=data.records.find(record=>record.name==="Deadly Combatant"&&record.pack==="Tyrannic War");
  const infantry=data.records.find(record=>record.name==="Stalwarts"&&record.pack==="Armageddon");
  const vehicle=data.records.find(record=>record.name==="Extra Armour"&&record.pack==="Armageddon");
  assert.equal(E.assess(character,u,f,data).status,"restricted");
  assert.equal(E.assess(infantry,u,f,data).status,"eligible");
  assert.equal(E.assess(vehicle,u,f,data).status,"restricted");
  assert.match(E.tableLabel(infantry,data),/Infantry/);
  u.keywords.push("Character");assert.notEqual(E.assess(character,u,f,data).status,"restricted");
});
test("relics retain rarity, inherited Character restrictions, and Heroic/Legendary gates",()=>{
  const u=unit(),f=force(u);
  for(const rarity of ["Artificer","Antiquity","Legendary"]){
    const relic=data.records.find(record=>record.kind==="relic"&&record.pack==="Tyrannic War"&&record.rarity===rarity);
    assert.ok(relic,rarity);assert.equal(E.assess(relic,u,f,data).status,"restricted");
    u.keywords.push("Character");u.xp=9;
    if(rarity!=="Artificer")assert.equal(E.assess(relic,u,f,data).status,"restricted");
    u.xp=51;assert.notEqual(E.assess(relic,u,f,data).status,"restricted");
    u.keywords=u.keywords.filter(key=>key!=="Character");
  }
});
test("unresolved source conditions are explicitly uncertain rather than silently eligible",()=>{
  const u=unit();const record={id:"unknown",kind:"honour",visibility:[{name:"Unknown requirement",hidden:false,rules:[{value:true,test:{conditions:[{childId:"unknown-id",field:"selections",scope:"unknown",type:"lessThan",value:1}]}}]}]};
  assert.equal(E.assess(record,u,force(u),data).status,"review");
});
