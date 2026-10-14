'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {readSpaceMarineUnits}=require('../src/rulesets/space-marine-units');
const unit=readSpaceMarineUnits(require.resolve('../data/manual-rules/wh40k-11e-space-marine-units.json.gz')).units.find(u=>u.name==='Deathwatch Terminator Squad');
const context={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../ui/engine-runtime'),'utf8'),context);
const expected={
'assault cannon':['6','3+','6','-2','1','Sustained Hits 1'],'heavy flamer':['3','-','5','-1','1','Blast 2, Torrent'],
'storm bolter':['2','3+','5','-1','1','Rapid Fire 2'],'plasma cannon - standard':['3','3+','9','-2','2','Blast 1'],
'plasma cannon - supercharge':['3','3+','10','-3','3','Blast 1, Hazardous'],'cyclone missile launcher - frag':['8','3+','4','-1','1','Blast 2'],
'cyclone missile launcher - krak':['2','3+','10','-2','D3+3',''],'chainfist - standard':['2','4+','8','-2','2',''],
'chainfist - hunter':['3','3+','12','-2','3','Hunter'],'power fist':['3','3+','8','-2','2',''],
'power weapon':['5','3+','5','-2','1',''],'thunder hammer':['3','3+','8','-2','3','Devastating Wounds'],'twin lightning claws':['6','3+','5','-2','1','Twin-linked']};
test('every Deathwatch Terminator weapon branch matches supplied datasheets',()=>{const seen=new Set();function visit(n){for(const p of n.profiles||[]){if(p.typeName==='Unit')assert.equal(p.characteristics.T,'6');if(/Weapons$/.test(p.typeName)){const key=p.name.replace(/^➤\s*/,'').toLowerCase();assert(expected[key],key);const c=p.characteristics;assert.deepEqual([c.A,c.WS||c.BS,c.S,c.AP,c.D,c.Keywords],expected[key],key);seen.add(key)}if(p.name==='Teleport Homer'){assert.match(p.characteristics.Description,/cost by 1/);assert.match(p.characteristics.Description,/within 8"/);assert.match(p.characteristics.Description,/ends a move within 1"/);assert.doesNotMatch(p.characteristics.Description,/0CP|9"|deployment zone/)}if(p.name==='Storm Shield')assert.equal(p.characteristics.Description,'This model has +1 W.')}for(const c of n.children||[])visit(c)}visit(unit.selectionTree);assert.equal(seen.size,Object.keys(expected).length)});
for(const [name,engine] of [['server',require('../src/domain/loadout')],['browser',context.window.RosterEngine]]){
 test(name+': shields grant four wounds only to equipped models, including Play tracking',()=>{
  let entry=engine.createDefaultRosterEntry(unit);const choices=engine.getOptionStates(unit,entry);const hammer=choices.find(o=>o.name==='Thunder Hammer & Storm Shield');entry=engine.setSelection(unit,entry,hammer.id,2);
  assert.equal(engine.validateLoadout(unit,entry).length,0);
  const configured=engine.getConfiguredProfiles(unit,entry);assert.equal(configured.units.filter(p=>p.characteristics.W==='4').reduce((a,p)=>a+p.count,0),2);assert.equal(configured.units.filter(p=>p.characteristics.W==='3').reduce((a,p)=>a+p.count,0),3);
  const models=engine.getConfiguredModels(unit,entry);assert.equal(models.reduce((a,m)=>a+m.count,0),5);assert.equal(models.find(m=>m.wounds===4).count,2);
  const source=fs.readFileSync(require.resolve('../mobile/ui/play-mode.js'),'utf8');const start=source.indexOf('  function createModelState('),end=source.indexOf('  function normalizeSession(',start);const play={normalize:x=>String(x||'').toLowerCase()};vm.runInNewContext(source.slice(start,end)+'\nthis.create=createModelState',play);const wounds=Object.values(play.create({rosterEntries:[{instanceId:'squad',models,configured}]}));assert.equal(wounds.filter(w=>w===4).length,2);assert.equal(wounds.filter(w=>w===3).length,3);
 });
 test(name+': both squad sizes retain one sergeant and a unit-wide maximum of three heavy specialists',()=>{for(const size of [5,10]){const entry=engine.setUnitSize(unit,engine.createDefaultRosterEntry(unit),size),options=engine.getOptionStates(unit,entry),models=engine.getConfiguredModels(unit,entry);assert.equal(models.reduce((a,m)=>a+m.count,0),size);assert.equal(models.find(m=>/Sergeant/.test(m.name)).count,1);const heavy=options.find(o=>o.name==='Deathwatch Terminator w/ Heavy Weapon');assert(heavy,'heavy model option');assert.equal(heavy.maximum,3)}});
}
