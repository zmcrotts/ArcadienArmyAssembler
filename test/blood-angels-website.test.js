'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {readSpaceMarineUnits}=require('../src/rulesets/space-marine-units');
const {readBloodAngelsWebsite,applyBloodAngelsWebsite}=require('../src/rulesets/blood-angels-website');
const engine=require('../src/domain/loadout'),sheets=require('../src/domain/sheets');
const source=readBloodAngelsWebsite(require.resolve('../data/manual-rules/wh40k-11e-blood-angels-website.json'));
const original=readSpaceMarineUnits(require.resolve('../data/manual-rules/wh40k-11e-space-marine-units.json.gz')).units;
const result=applyBloodAngelsWebsite(original,[],source),units=result.units;
const get=name=>{const u=units.find(u=>u.faction.endsWith(' - Blood Angels')&&u.name===name);assert.ok(u,name);return u;};
const profiles=u=>engine.buildTreeIndex(u).all.flatMap(n=>n.profiles||[]);
test('all 111 source datasheets have current stats, weapons, rules and valid default loadouts',()=>{
 assert.equal(new Set(result.summary.updated).size,111);assert.deepEqual(result.summary.unmatchedModels,[]);assert.deepEqual(result.summary.unmatchedWeapons,[]);assert.deepEqual(result.summary.unmatchedEquipment,[]);
 for(const s of source.units){const u=units.find(u=>u.bloodAngelsWebsiteSource?.url===s.url&&u.rosterSelectable!==false);assert.ok(u,s.name);const ps=profiles(u);
  for(const p of ps.filter(p=>p.typeName==='Unit'))assert.ok(s.models.some(m=>JSON.stringify(m.characteristics)===JSON.stringify(p.characteristics)),s.name+': '+p.name);
  for(const w of s.weapons)assert.ok(ps.some(p=>p.name===w.name&&JSON.stringify(p.characteristics)===JSON.stringify(w.characteristics)),s.name+': '+w.name);
  for(const a of s.abilities)assert.ok(ps.some(p=>p.name===a.name),s.name+': '+a.name);
  const entry=engine.createDefaultRosterEntry(u);assert.deepEqual(engine.validateLoadout(u,entry),[],s.name);assert.ok(engine.getConfiguredProfiles(u,entry).units.length,s.name);
 }
 for(const u of original.filter(u=>!u.faction.endsWith(' - Blood Angels')))assert.equal(units.find(v=>v.selectionKey===u.selectionKey&&v.faction===u.faction),u);
});
test('Sanguinary Guard have OC2, one merged melee weapon and one inferno pistol per three',()=>{
 const u=get('Sanguinary Guard');for(const size of [3,6]){let e=engine.setUnitSize(u,engine.createDefaultRosterEntry(u),size);const opts=engine.getOptionStates(u,e),inferno=opts.find(o=>o.name==='Inferno Pistol');assert.equal(inferno.maximum,size/3);e=engine.setSelection(u,e,inferno.id,size/3);assert.deepEqual(engine.validateLoadout(u,e),[]);const p=engine.getConfiguredProfiles(u,e);assert.equal(p.units[0].characteristics.OC,'2');assert.equal(p.weapons.filter(w=>w.typeName==='Melee Weapons').reduce((n,w)=>n+w.count,0),size);assert.ok(p.weapons.some(w=>w.name==='Encarmine Weapon'&&w.characteristics.Keywords==='LANCE'));assert.ok(!p.abilities.some(a=>/banner/i.test(a.name)));}
});
test('Death Company jump captain shield bundles replace both base weapons and add one wound',()=>{
 const u=get('Death Company Captain with Jump Pack');let base=engine.createDefaultRosterEntry(u);assert.equal(engine.getConfiguredProfiles(u,base).weapons.length,2);assert.ok(!engine.getConfiguredProfiles(u,base).abilities.some(a=>a.name==='Relic Shield'));
 for(const [id,name] of [['ba-dccjp-shield-0','Thunder Hammer'],['ba-dccjp-shield-1','Chainsword']]){let e=engine.setSelection(u,base,id,1);assert.deepEqual(engine.validateLoadout(u,e),[]);const p=engine.getConfiguredProfiles(u,e);assert.deepEqual(p.weapons.map(w=>w.name),[name]);assert.equal(sheets.applyUnitEffectsToProfiles(p.units,p.abilities)[0].characteristics.W,'6');}
});
test('foot Death Company independent pistols, melee weapons and rifle choices stay legal',()=>{
 const u=get('Death Company Marines');for(const size of [5,10]){let e=engine.setUnitSize(u,engine.createDefaultRosterEntry(u),size);e=engine.setSelection(u,e,'ba-dc-power-fist',1);e=engine.setSelection(u,e,'ba-dc-inferno-pistol',1);e=engine.setSelection(u,e,'ba-dc-eviscerator',size/5);assert.deepEqual(engine.validateLoadout(u,e),[]);let p=engine.getConfiguredProfiles(u,e);assert.equal(p.weapons.filter(w=>w.typeName==='Melee Weapons').reduce((n,w)=>n+w.count,0),size);assert.equal(engine.getOptionStates(u,e).find(o=>o.id==='ba-dc-eviscerator').maximum,size/5);e=engine.setSelection(u,e,'ba-dc-rifle',size);assert.deepEqual(engine.validateLoadout(u,e),[]);p=engine.getConfiguredProfiles(u,e);assert.equal(p.weapons.find(w=>w.name==='Combat Blade').count,size);}
});
test('Priest uses Blood Chalice and healing rather than the previous FNP and AP buffs',()=>{
 const u=get('Sanguinary Priest'),p=engine.getConfiguredProfiles(u,engine.createDefaultRosterEntry(u));assert.equal(sheets.applyUnitEffectsToProfiles(p.units,p.abilities)[0].characteristics.T,'6');assert.ok(p.abilities.some(a=>a.name==='Narthecium (Once per turn, per unit)'&&a.characteristics.Description.includes('D3+1')));assert.ok(!p.abilities.some(a=>/feel no pain/i.test(a.name+' '+a.characteristics.Description)));assert.ok(u.rosterRules.leaderTargetNames.includes('COMPANY HEROES'));
});
test('Scout exception follows the website, conditional keywords remain conditional, and aliases recover units',()=>{
 assert.ok(profiles(get('Scout Squad')).filter(p=>p.typeName==='Unit').every(p=>p.characteristics.T==='4'));assert.ok(profiles(get('Astorath')).find(p=>p.name==='Mass of Doom').characteristics.Description.includes('If this unit made a charge move'));assert.ok(profiles(get('Death Company Dreadnought')).filter(p=>p.name==='Blood Talons').every(p=>p.characteristics.Keywords.includes('SUSTAINED HITS 1: NON-MONSTER/VEHICLE')));assert.ok(get('Sicaran [Legends]').previousNames.includes('Sicaran Arcus [Legends]'));assert.ok(get('Death Company Marines').previousNames.includes('Death Company Marines with Bolt Rifles'));
});

test('conditional invulnerable saves retain their restriction and source prices scale by size and copies',()=>{
 const pricing=require('../src/domain/pricing');for(const [name,save,condition] of [['Judiciar','4+*','melee'],['Astraeus','5+*','ranged']]){const u=get(name);assert.ok(profiles(u).some(p=>p.typeName==='Unit'&&p.characteristics.InSv===save));assert.ok(profiles(u).some(p=>p.name.startsWith('Invulnerable Save')&&p.characteristics.Description.includes(condition)));}
 for(const [name,size,base,later] of [['Sanguinary Guard',3,135,150],['Sanguinary Guard',6,275,290],['Death Company Marines',10,170,185],['Death Company Marines with Jump Packs',10,260,290]]){const u=get(name);let e=engine.setUnitSize(u,engine.createDefaultRosterEntry(u),size);assert.equal(pricing.calculateEntryPoints(u,e).points,base);e={...e,context:{previousCopies:2}};assert.equal(pricing.calculateEntryPoints(u,e).points,later);}
});
test('grenade launchers need rifle bearers and cap at one per five models',()=>{
 const u=get('Death Company Marines');for(const size of [5,10]){let e=engine.setUnitSize(u,engine.createDefaultRosterEntry(u),size);assert.equal(engine.getOptionStates(u,e).find(o=>o.id==='ba-dc-grenade-launcher').maximum,0);e=engine.setSelection(u,e,'ba-dc-rifle',1);assert.equal(engine.getOptionStates(u,e).find(o=>o.id==='ba-dc-grenade-launcher').maximum,1);e=engine.setSelection(u,e,'ba-dc-rifle',size);assert.equal(engine.getOptionStates(u,e).find(o=>o.id==='ba-dc-grenade-launcher').maximum,size/5);}
});


test('mixed Assault Terminators give the shield wound only to shield bearers',()=>{
 const u=get('Terminator Assault Squad');let e=engine.createDefaultRosterEntry(u);const claw=engine.getOptionStates(u,e).find(o=>o.name==='Assault Terminator w/ Twin Lightning Claws');assert.ok(claw);e=engine.setSelection(u,e,claw.id,2);assert.deepEqual(engine.validateLoadout(u,e),[]);const p=engine.getConfiguredProfiles(u,e),stats=sheets.applyUnitEffectsToProfiles(p.units,p.abilities);assert.ok(stats.some(p=>/Lightning Claws/.test(p.name)&&p.characteristics.W==='3'&&p.count===2));assert.ok(stats.some(p=>/Storm Shield/.test(p.name)&&p.characteristics.W==='4'));
});

test('consolidated unit keys hydrate into live units instead of becoming unavailable',()=>{
 const {hydrateRosterDocument}=require('../src/domain/roster-document');const packages=units.filter(u=>u.faction.endsWith(' - Blood Angels')&&u.rosterSelectable!==false).map(definition=>({id:definition.id,selectionKey:definition.selectionKey,name:definition.name,definition}));
 for(const [oldName,newName]of [['Sicaran Arcus [Legends]','Sicaran [Legends]'],['Death Company Marines with Bolt Rifles','Death Company Marines']]){const old=original.find(u=>u.faction.endsWith(' - Blood Angels')&&u.name===oldName);assert.ok(old);const loaded=hydrateRosterDocument({rosterEntries:[{name:oldName,selectionKey:old.selectionKey,entry:engine.createDefaultRosterEntry(old)}]},{unitPackages:packages,createDefaultRosterEntry:engine.createDefaultRosterEntry,normalizeRosterEntry:engine.normalizeRosterEntry});assert.equal(loaded.roster.length,1);assert.equal(loaded.roster[0].unitPackage.name,newName);assert.ok(!loaded.warnings.some(w=>w.code==='SAVED_UNIT_NOT_FOUND'));}
});
