"use strict";
const test=require("node:test");const assert=require("node:assert/strict");const path=require("node:path");
const {readSpaceMarinesCodex,applySpaceMarinesCodex}=require("../src/rulesets/space-marines-codex");
const {extractNormalizedRuleset}=require("../src/rulesets/sources");
const {createArmyState,setSelectedDetachments,availableForceDispositions,getUnitAssignmentState,eligibleStratagemsForEntry,validateArmyState}=require("../src/domain/army");
const doc=readSpaceMarinesCodex(path.join(__dirname,"../data/manual-rules/wh40k-11e-space-marines-codex.json"));
let cached;function ruleset(){return cached ||= extractNormalizedRuleset();}function marine(){return ruleset().armies.find(a=>a.faction.endsWith(" - Space Marines"));}
const normal=v=>v.toLowerCase().replace(/[’']/g,"").replace(/\s*\((?:upgrade|aura)\)/g,"").replace(/[^a-z0-9]+/g," ").trim();
test("photographed rules replace obsolete shared sources across every Chapter",()=>{
 const r=ruleset();for(const a of r.armies.filter(a=>a.faction.includes("Astartes"))){
  assert.equal(a.armyRules.filter(x=>x.name==="Combat Doctrines").length,1,a.faction);assert(!a.armyRules.some(x=>x.name==="Oath of Moment"));
  assert(!a.detachments.some(x=>["Anvil Siege Force","Vengeful Hosts","Librarius Conclave"].includes(x.name)));
  for(const d of doc.detachments){const actual=a.detachments.find(x=>x.name===d.name);assert(actual,a.faction+" "+d.name);assert.equal(actual.stratagems.length,d.stratagems.length);assert.equal(actual.detachmentPoints,d.detachmentPoints);assert(actual.rules.every(x=>x.source===doc.source));}
 }
 const da=r.armies.find(a=>a.faction.endsWith(" - Dark Angels"));assert(da.detachments.some(d=>d.name==="Inner Circle Task Force"));
 assert(r.armies.find(a=>a.faction==="Xenos - Orks").armyRules.some(x=>x.name==="Waaagh!"));
});
test("all 32 photographed enhancements survive eligibility filtering and use current digital costs",()=>{
 const a=marine();for(const d of doc.detachments){const det=a.detachments.find(x=>x.name===d.name);for(const e of d.enhancements){const actual=a.enhancements.find(x=>normal(x.name)===normal(e.name)&&x.detachmentIds.includes(det.id));assert(actual,d.name+" / "+e.name);assert.equal(actual.points,e.points);assert.equal(actual.kind,e.kind);assert(actual.eligibleSelectionKeys.length);assert.equal(actual.profiles[0].characteristics.Description,e.description);}}
});
test("upgrades allow non-character bearers while enhancements exclude epic heroes and wrong armour",()=>{
 const a=marine(),r=ruleset();const unit=n=>r.units.find(u=>u.faction===a.faction&&u.name===n);const e=n=>a.enhancements.find(e=>e.name===n);
 const canBearEnhancement=(enh,u)=>{assert(u);const entry={...u,instanceId:"test-bearer"};const state=setSelectedDetachments(a,createArmyState(a),enh.detachmentIds);return getUnitAssignmentState(a,state,[entry],entry).enhancements.some(x=>x.id===enh.id);};
 assert(canBearEnhancement(e("Artificer Sarcophagus"),unit("Redemptor Dreadnought")));
 assert(!canBearEnhancement(e("Artificer Sarcophagus"),unit("Intercessor Squad")));
 assert(canBearEnhancement(e("Auspex Triangulation Shrines"),unit("Storm Speeder Hailstrike")));
 assert(!canBearEnhancement(e("Redoubtable Machine Spirit"),unit("Redemptor Dreadnought")));
 assert(!canBearEnhancement(e("Redoubtable Machine Spirit"),unit("Impulsor")));
 assert(!canBearEnhancement(e("Corporeum Reliquary"),unit("Captain")));
});
test("Gladius has both live dispositions and doctrine detachments cannot be combined",()=>{
 const a=marine();const gladius=a.detachments.find(d=>d.name==="Gladius Task Force");const state=setSelectedDetachments(a,createArmyState(a),[gladius.id]);assert.deepEqual(availableForceDispositions(a,state).map(x=>x.name),["Take and Hold","Priority Assets"]);
 const doctrine=doc.detachments.filter(d=>d.uniqueTags.includes("DOCTRINES")).map(d=>a.detachments.find(x=>x.name===d.name).id);
 const conflict=setSelectedDetachments(a,createArmyState(a),doctrine.slice(0,2));assert(validateArmyState(a,conflict,[]).some(x=>x.code==="DETACHMENT_UNIQUE_TAG_CONFLICT"));
});
test("confirmed wording, weapon and CP costs survive normalization",()=>{
 const a=marine();assert.match(a.enhancements.find(e=>e.name==="Standard of the Emperor Ascendant").profiles[0].characteristics.Description,/\+1 OC and Ld/);
 const assault=a.armyRules.find(r=>r.name==="Assault Disembark Move");assert(!/not eligible to declare a charge/.test(assault.description));assert(/not eligible to declare a charge/.test(a.armyRules.find(r=>r.name==="Shock Disembark Move").description));
 assert.equal(a.detachments.find(d=>d.name==="Stormlance Task Force").stratagems.find(s=>s.name==="Wind-swift Evasion").cpCost,"1");assert.equal(a.detachments.find(d=>d.name==="Devastator Brethren").stratagems.find(s=>s.name==="Hail of Vengeance").cpCost,"2");assert.equal(a.enhancements.find(e=>e.name==="Imperium’s Sword").profiles.find(p=>p.typeName==="Melee Weapons").characteristics.D,"3");
});

test("unit references include the replacement stratagems and granted weapon",()=>{
 const a=marine(),r=ruleset(),det=a.detachments.find(d=>d.name==="Assault Brethren");const captain=r.units.find(u=>u.faction===a.faction&&u.name==="Captain");const state=setSelectedDetachments(a,createArmyState(a),[det.id]);assert(eligibleStratagemsForEntry(a,state,captain).some(s=>s.name==="Gene-wrought Might"));
 const sword=a.enhancements.find(e=>e.name==="Imperium’s Sword");const sheet=require("../src/domain/sheets").buildRosterSheets({rosterEntries:[{instanceId:"captain",name:"Captain",keywords:captain.keywords,configured:{weapons:[],units:[],abilities:[]}}],enhancements:[{...sword,bearerInstanceId:"captain"}]}).combinedUnitSheets[0];assert(sheet.meleeWeapons.some(w=>w.name==="Imperium’s Sword"&&w.characteristics.D==="3"));
});

const chapterDoc=require('../data/manual-rules/wh40k-11e-space-marine-chapters.json');
test('Chapter sources completely replace retired detachments and enhancement lists',()=>{
 const r=ruleset();for(const [chapter,config] of Object.entries(chapterDoc.chapters)){
  const a=r.armies.find(a=>a.faction.endsWith(' - '+chapter));
  const expected=[...doc.detachments.map(d=>d.name),'Deathwatch Support',...chapterDoc.detachments.filter(d=>d.chapter===chapter).map(d=>d.name)];
  assert.deepEqual([...new Set(a.detachments.map(d=>d.name))].sort(),[...new Set(expected)].sort(),chapter);
  assert.deepEqual(a.armyRules.map(r=>r.name).sort(),[...doc.armyRules,...config.armyRules].map(r=>r.name).sort(),chapter);
  for(const d of chapterDoc.detachments.filter(d=>d.chapter===chapter)){
   const actual=a.detachments.find(x=>x.name===d.name);assert.equal(actual.detachmentPoints,d.detachmentPoints);
   assert.deepEqual(actual.forceDispositions.map(x=>x.name),d.forceDispositions);
   assert.deepEqual(actual.stratagems.map(x=>[x.name,x.cpCost,x.when,x.targetText,x.effect]),d.stratagems.map(x=>[x.name,String(x.cpCost),x.when,x.target,x.effect]));
   const enhancements=a.enhancements.filter(e=>e.detachmentIds.includes(actual.id));assert.equal(enhancements.length,d.enhancements.length,d.name);
   for(const e of d.enhancements){const found=enhancements.find(x=>x.name===e.name);assert(found,e.name);assert.equal(found.points,e.points);assert.equal(found.profiles[0].characteristics.Description,e.description);assert(found.eligibleSelectionKeys.length,e.name);}
  }
 }
});
test('Chapter army restrictions exclude prohibited units and Dark Angels gain army-wide wing keywords',()=>{
 const r=ruleset(),unitByKey=new Map(r.units.map(u=>[u.selectionKey,u]));
 for(const chapter of ['Black Templars','Space Wolves']){
  const a=r.armies.find(a=>a.faction.endsWith(' - '+chapter));const config=chapterDoc.chapters[chapter];
  const selected=a.allowedSelectionKeys.map(k=>unitByKey.get(k));
  for(const banned of config.excludedKeywords)assert(!selected.some(u=>(u.keywords||[]).some(k=>k.toLowerCase()===banned.toLowerCase())));
  for(const banned of config.excludedCoreDatasheets||[])assert(!selected.some(u=>u.name===banned));
 }
 const da=r.armies.find(a=>a.faction.endsWith(' - Dark Angels'));const units=r.units.filter(u=>u.faction===da.faction);
 for(const name of ['Bladeguard Veteran Squad','Sternguard Veteran Squad','Land Raider','Repulsor','Redemptor Dreadnought'])assert(units.find(u=>u.name===name).keywords.includes('Deathwing'),name);
 assert(units.find(u=>u.name==='Outrider Squad').keywords.includes('Ravenwing'));
 const assault=da.enhancements.find(e=>e.name==='Deathwing Assault');assert(assault.eligibleSelectionKeys.every(k=>/deep strike/i.test(JSON.stringify(unitByKey.get(k).selectionTree))));
 assert(!/has Deep Strike/.test(assault.profiles[0].characteristics.Description));
});
test('unit-only enhancements remain enhancements and source-labelled upgrades remain repeatable',()=>{
 const r=ruleset();for(const chapter of ['Black Templars','Imperial Fists']){
  const a=r.armies.find(a=>a.faction.endsWith(' - '+chapter));
  for(const name of chapter==='Black Templars'?['Oathbound Exemplar']:['Castellum Omnivox','Spy Skull Data Link']){
   const e=a.enhancements.find(e=>e.name===name);assert.equal(e.kind,'enhancement');assert.equal(e.maxSelections,1);
   const u=r.units.find(u=>u.name==='Intercessor Squad'&&u.faction===a.faction);const entry={...u,instanceId:'bearer'};const state=setSelectedDetachments(a,createArmyState(a),e.detachmentIds);
   assert(getUnitAssignmentState(a,state,[entry],entry).enhancements.some(x=>x.id===e.id),name);
  }
 }
 const bt=r.armies.find(a=>a.faction.endsWith(' - Black Templars'));const e=bt.enhancements.find(e=>e.name==='Righteous Fervour (Upgrade)');assert.equal(e.kind,'upgrade');assert.equal(e.maxSelections,3);
 assert.equal(r.spaceMarinesCodexSource.pendingRetainedRules.length,0);
});
