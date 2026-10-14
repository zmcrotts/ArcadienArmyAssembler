'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {readSpaceMarineUnits}=require('../src/rulesets/space-marine-units');const server=require('../src/domain/loadout');
const unit=readSpaceMarineUnits(require.resolve('../data/manual-rules/wh40k-11e-space-marine-units.json.gz')).units.find(u=>u.name==='Death Company Marines with Jump Packs');
const context={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../ui/engine-runtime'),'utf8'),context);
for(const [name,engine] of [['server',server],['browser',context.window.RosterEngine]])test(name+': independent Death Company jump-pack replacements scale per five models',()=>{
 for(const size of [5,10]){
  let entry=engine.setUnitSize(unit,engine.createDefaultRosterEntry(unit),size);const alternate=engine.getOptionStates(unit,entry).find(o=>o.name==='Death Company Marine w/ alternate weapons');entry=engine.setSelection(unit,entry,alternate.id,size);
  const options=engine.getOptionStates(unit,entry),find=name=>options.find(o=>o.name===name);const caps={'Power fist':size/5,'Hand flamer':size/5,'Power weapon':size*2/5,'Inferno Pistol':size/5,'Plasma pistol':size*2/5,'Eviscerator':size/5};
  for(const [weapon,cap] of Object.entries(caps)){
   assert.equal(find(weapon).maximum,cap,weapon);let changed=engine.setSelection(unit,entry,find(weapon).id,cap);assert.equal(engine.validateLoadout(unit,changed).length,0,weapon);
   const over=JSON.parse(JSON.stringify(changed));over.selections[find(weapon).id]=cap+1;assert(engine.validateLoadout(unit,over).some(e=>e.nodeId===find(weapon).id&&e.type==='max'),weapon+' over cap');
  }
  for(const weapon of ['Power fist','Power weapon','Eviscerator','Hand flamer','Inferno Pistol','Plasma pistol'])entry=engine.setSelection(unit,entry,find(weapon).id,caps[weapon]);
  assert.equal(engine.validateLoadout(unit,entry).length,0);
  const melee=engine.getConfiguredProfiles(unit,entry).weapons.filter(w=>w.typeName==='Melee Weapons').reduce((sum,w)=>sum+w.count,0);assert.equal(melee,size);
  assert.equal(entry.selections[find('Power fist').id],size/5);assert.equal(entry.selections[find('Power weapon').id],size*2/5);assert.equal(entry.selections[find('Plasma pistol').id],size*2/5);
  const chain=engine.getConfiguredProfiles(unit,entry).weapons.find(w=>/chainsword/i.test(w.name));assert.equal(chain.count,size/5);
  const bolt=engine.getConfiguredProfiles(unit,entry).weapons.find(w=>/heavy bolt pistol/i.test(w.name));assert.equal(bolt.count,size/5);
 }
});
for(const [name,engine] of [['server',server],['browser',context.window.RosterEngine]])test(name+': legacy paired Death Company equipment migrates without losing either weapon',()=>{
 let entry=engine.setUnitSize(unit,engine.createDefaultRosterEntry(unit),10);const states=engine.getOptionStates(unit,entry);const alt=states.find(o=>o.name==='Death Company Marine w/ alternate weapons');entry=engine.setSelection(unit,entry,alt.id,4);
 // Old override stored weapon choices only under manual IDs.
 const groups=[];function visit(n){if(n.kind==='group'&&['Pistol Weapon','Melee Weapon'].includes(n.name))groups.push(n);for(const c of n.children||[])visit(c)}visit(unit.selectionTree);for(const g of groups)for(const c of g.children)delete entry.selections[c.id];
 entry.selections['dcjp-inferno-pistol-power-fist']=1;entry.selections['dcjp-plasma-pistol-power-weapon']=2;entry.selections['dcjp-eviscerator-option']=1;
 const normalized=engine.normalizeRosterEntry(unit,entry),statesAfter=engine.getOptionStates(unit,normalized);for(const [weapon,count] of [['Inferno Pistol',1],['Power fist',1],['Plasma pistol',2],['Power weapon',2],['Eviscerator',1]])assert.equal(normalized.selections[statesAfter.find(s=>s.name===weapon).id],count,weapon);
 assert.equal(engine.validateLoadout(unit,normalized).length,0);assert.equal(Object.keys(normalized.selections).some(id=>id.startsWith('dcjp-')),false);
 assert.deepEqual(JSON.parse(JSON.stringify(engine.normalizeRosterEntry(unit,normalized))),JSON.parse(JSON.stringify(normalized)));
});
