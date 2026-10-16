'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {readMarineChaptersWebsite,applyMarineChaptersWebsite}=require('../src/rulesets/marine-chapters-website');
const {readSpaceMarineUnits}=require('../src/rulesets/space-marine-units');
const engine=require('../src/domain/loadout'),pricing=require('../src/domain/pricing'),sheets=require('../src/domain/sheets'),army=require('../src/domain/army');
const source=readMarineChaptersWebsite(require.resolve('../data/manual-rules/wh40k-11e-marine-chapters-website.json'));
const original=readSpaceMarineUnits(require.resolve('../data/manual-rules/wh40k-11e-space-marine-units.json.gz')).units;
const armies=source.rosters.map(r=>({faction:'Imperium - Adeptus Astartes - '+r.name,allowedSelectionKeys:[]}));
const result=applyMarineChaptersWebsite(original,armies,source),units=result.units;
const get=(chapter,name)=>{const u=units.find(u=>u.faction.endsWith(' - '+chapter)&&u.name===name&&u.marineChaptersWebsiteSource);assert.ok(u,chapter+': '+name);return u;};
const profiles=u=>engine.buildTreeIndex(u).all.flatMap(n=>n.profiles||[]);
test('all 635 roster sheets import every source model and weapon with valid default loadouts',()=>{
 assert.equal(result.summary.perFaction.reduce((n,f)=>n+f.listedSheets,0),635);assert.deepEqual(result.summary.unmatchedWeapons,[]);assert.deepEqual(result.summary.unmatchedEquipment,[]);
 for(const r of source.rosters){const faction='Imperium - Adeptus Astartes - '+r.name;for(const url of r.units){const s=source.units.find(s=>s.url===url),u=units.find(u=>u.faction===faction&&u.marineChaptersWebsiteSource?.url===url&&u.rosterSelectable!==false);assert.ok(u,url);assert.ok(result.armies.find(a=>a.faction===faction).allowedSelectionKeys.includes(u.selectionKey),url+": selectable");const ps=profiles(u);for(const p of ps.filter(p=>p.typeName==='Unit'))assert.ok(s.models.some(m=>JSON.stringify(m.characteristics)===JSON.stringify(p.characteristics)),url+': '+p.name);for(const w of s.weapons)assert.ok(ps.some(p=>p.name===w.name&&JSON.stringify(p.characteristics)===JSON.stringify(w.characteristics)),url+': '+w.name);for(const a of s.abilities)assert.ok(JSON.stringify(u.selectionTree).includes(a.name),url+': '+a.name);assert.deepEqual(engine.validateLoadout(u,engine.createDefaultRosterEntry(u)),[],url);}}
 const targets=new Set(source.rosters.map(r=>'Imperium - Adeptus Astartes - '+r.name));for(const u of original.filter(u=>!targets.has(u.faction)))assert.equal(units.find(v=>v.selectionKey===u.selectionKey&&v.faction===u.faction),u);
});
test('Kaius is a selectable 100-point Support with both melee modes',()=>{
 const u=get('Ultramarines','Kaius Konorius'),e=engine.createDefaultRosterEntry(u);assert.ok(u.roles.support);assert.ok(result.armies.find(a=>a.faction===u.faction).allowedSelectionKeys.includes(u.selectionKey));assert.equal(pricing.calculateEntryPoints(u,e).points,100);const p=engine.getConfiguredProfiles(u,e);assert.equal(p.weapons.length,3);assert.deepEqual(p.units[0].characteristics,{M:'6"',T:'5',SV:'2+',W:'5',LD:'6+',OC:'1',InSv:'4+'});
});
test('major chapter changes use the website profiles and rules',()=>{
 const lion=get('Dark Angels',"Lion El'Jonson");assert.ok(profiles(lion).some(p=>p.typeName==='Unit'&&p.characteristics.T==='10'&&p.characteristics.W==='16'));
 assert.ok(profiles(get('Space Wolves','Bjorn the Fell-Handed')).some(p=>p.typeName==='Unit'&&p.characteristics.T==='10'));
 for(const [c,n,a,part]of [['Space Wolves','Wolf Priest','Healing Balms','D3+1'],['Salamanders',"Vulkan He'stan",'Forgefather','+2 S'],['Raven Guard','Kayvaan Shrike','Trifold Path of Shadow','detection range']])assert.ok(profiles(get(c,n)).some(p=>p.name===a&&p.characteristics.Description.includes(part)));
 const sword=profiles(get('Ultramarines','Roboute Guilliman')).find(p=>/Emperor.s Sword/.test(p.name));assert.equal(sword.characteristics.A,'10');assert.equal(sword.characteristics.S,'10');
});
test('Crusaders build valid 10- and 20-model squads at the correct price',()=>{
 const u=get('Black Templars','Crusader Squad');let e=engine.createDefaultRosterEntry(u);for(const [size,cost]of [[20,305],[10,160],[20,305]]){e=engine.setUnitSize(u,e,size);assert.equal(engine.getUnitSizeState(u,e).current,size);assert.deepEqual(engine.validateLoadout(u,e),[]);assert.equal(pricing.calculateEntryPoints(u,e).points,cost);}
});
test('optional Hunting Wolves use mixed composition prices and preserve saved selections',()=>{
 const u=get('Space Wolves','Wolf Guard Headtakers');for(const [size,without,withWolves]of [[3,85,115],[6,170,230]]){let e=engine.setUnitSize(u,engine.createDefaultRosterEntry(u),size);assert.equal(pricing.calculateEntryPoints(u,e).points,without);const add=engine.getOptionStates(u,e).find(o=>o.name==='Add Hunting Wolves');e=engine.setSelection(u,e,add.id,1);assert.deepEqual(engine.validateLoadout(u,e),[]);assert.equal(pricing.calculateEntryPoints(u,e).points,withWolves);const p=engine.getConfiguredProfiles(u,e);assert.equal(p.units.find(p=>p.name==='Hunting Wolves').count,size);assert.equal(p.units.find(p=>p.name==='Hunting Wolves').characteristics.T,'4');e.context={previousCopies:2};assert.equal(pricing.calculateEntryPoints(u,e).points,withWolves+10);delete e.selections[add.id];const recovered=engine.normalizeRosterEntry(u,e);assert.equal(recovered.selections[add.id],1);assert.equal(pricing.calculateEntryPoints(u,recovered).points,withWolves+10);}
});
test('Tarantula batteries can take all three source sizes',()=>{
 for(const c of source.rosters.map(r=>r.name)){const u=get(c,'Tarantula Sentry Battery [Legends]');for(const size of [1,2,3]){const e=engine.setUnitSize(u,engine.createDefaultRosterEntry(u),size);assert.equal(engine.getUnitSizeState(u,e).current,size);assert.deepEqual(engine.validateLoadout(u,e),[]);assert.equal(pricing.calculateEntryPoints(u,e).points,size*30);}}
});
test('Wardens keep separate human and Marine profiles; chosen relics are not all granted at once',()=>{
 const u=get('Ultramarines','Wardens of Ultramar'),p=engine.getConfiguredProfiles(u,engine.createDefaultRosterEntry(u));assert.equal(p.units.length,6);assert.equal(p.units.find(p=>p.name==='Gaius Silva').characteristics.InSv,'5+');assert.equal(p.units.find(p=>p.name==='Veteran Sergeant Metaurus').characteristics.InSv,'4+');assert.equal(p.units.find(p=>p.name==='Ancient Gadriel').characteristics.InSv,'');assert.equal(p.units.find(p=>p.name==='Ancient Gadriel').characteristics.OC,'2');
 const g=get('Black Templars','Chaplain Grimaldus'),gp=engine.getConfiguredProfiles(g,engine.createDefaultRosterEntry(g));assert.ok(!gp.abilities.some(a=>a.name==='Column from the Major Altar'));assert.equal(sheets.applyUnitEffectsToProfiles(gp.units,gp.abilities).find(p=>p.name==='Chaplain Grimaldus').characteristics.T,'5');
});
test('Sicarius becomes Support when Calgar is in the roster',()=>{
 const cato=get('Ultramarines','Cato Sicarius'),calgar=get('Ultramarines','Marneus Calgar in Armour of Antilochus');assert.equal(army.allowsAdditionalLeaderInRoster(cato,[]),false);assert.equal(army.allowsAdditionalLeaderInRoster(cato,[{name:calgar.name}]),true);
});

test('Dark Angels retain keyword grants from the website army rules',()=>{
 assert.ok(get('Dark Angels','Outrider Squad').keywords.includes('Ravenwing'));
 assert.ok(get('Dark Angels','Land Raider').keywords.includes('Deathwing'));
 assert.ok(get('Dark Angels','Terminator Squad').keywords.includes('Deathwing'));
 assert.ok(get('Dark Angels','Sternguard Veteran Squad').keywords.includes('Deathwing'));
});

test('browser runtime builds 20 Crusaders and prices optional Hunting Wolves like the server',()=>{
 const fs=require('fs'),vm=require('vm'),ctx={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../ui/engine-runtime'),'utf8'),ctx);const b=ctx.window.RosterEngine;
 const kaius=get('Ultramarines','Kaius Konorius');assert.equal(b.validateLoadout(kaius,b.createDefaultRosterEntry(kaius)).length,0);
 const crusader=get('Black Templars','Crusader Squad');const e=b.setUnitSize(crusader,b.createDefaultRosterEntry(crusader),20);assert.equal(b.getUnitSizeState(crusader,e).current,20);assert.equal(b.validateLoadout(crusader,e).length,0);assert.equal(b.calculateEntryPoints(crusader,e).points,305);
 const head=get('Space Wolves','Wolf Guard Headtakers');let h=b.setUnitSize(head,b.createDefaultRosterEntry(head),6);const add=b.getOptionStates(head,h).find(o=>o.name==='Add Hunting Wolves');h=b.setSelection(head,h,add.id,1);assert.equal(b.calculateEntryPoints(head,h).points,230);delete h.selections[add.id];h=b.normalizeRosterEntry(head,h);assert.equal(h.selections[add.id],1);assert.equal(b.calculateEntryPoints(head,h).points,230);
});
