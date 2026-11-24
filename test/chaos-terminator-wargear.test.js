
"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const context={window:{}};
vm.runInNewContext(fs.readFileSync(require.resolve("../ui/engine-runtime.js"),"utf8"),context);
const engines=[["server",require("../src/domain/loadout")],["browser",context.window.RosterEngine]];
const units=[];
for(const faction of ["chaos-world-eaters","chaos-chaos-space-marines","chaos-chaos-daemons"]){
 const c={window:{}};
 vm.runInNewContext(fs.readFileSync(require.resolve("../ui/engine-data/"+faction+".js"),"utf8"),c);
 units.push(...Object.values(c.window.ROSTER_ENGINE_FACTIONS).flat().filter(u=>/^Chaos Terminators?(?: Squad)?$/i.test(u.name)));
}
function initial(engine,u,size){return engine.setUnitSize(u.definition,engine.createDefaultRosterEntry(u.definition),size);}
function model(engine,u,entry,pattern){const result=engine.getOptionStates(u.definition,entry).find(o=>o.kind==="model"&&pattern.test(o.name));assert(result,String(pattern));return result;}
function ruleErrors(engine,u,entry,rule){return engine.validateLoadout(u.definition,entry).filter(e=>e.constraintId==="arcadien-chaos-terminators-"+rule);}
for(const [runtime,engine] of engines)for(const u of units)for(const size of [5,10]){
 const label=runtime+" "+u.faction+" "+size;
 test(label+": power fists share one limit across bolters and combi-weapons",()=>{
  let entry=initial(engine,u,size),limit=size/5*3;
  const bolter=model(engine,u,entry,/power fist.*combi-bolter|combi-bolter.*power fist/i);
  const combi=model(engine,u,entry,/power fist.*combi-weapon|combi-weapon.*power fist/i);
  assert.equal(bolter.maximum,limit);assert.equal(combi.maximum,limit);
  entry=engine.setSelection(u.definition,entry,bolter.id,limit-1);
  entry=engine.setSelection(u.definition,entry,combi.id,1);
  assert.equal(engine.validateLoadout(u.definition,entry).length,0);
  assert.equal(engine.getOptionStates(u.definition,entry).find(o=>o.id===combi.id).maximum,1);
  assert.throws(()=>engine.setSelection(u.definition,entry,combi.id,2),/Option count/);
  const invalid=engine.setSelection(u.definition,entry,combi.id,2,false);
  const errors=ruleErrors(engine,u,invalid,"power-fists");
  assert(errors.length);assert.equal(errors[0].actual,limit+1);assert.equal(errors[0].limit,limit);
  const loaded=engine.normalizeRosterEntry(u.definition,JSON.parse(JSON.stringify(invalid)));
  assert(ruleErrors(engine,u,loaded,"power-fists").length,"invalid saved fists stay visible as warnings");
 });
 test(label+": chainfists and paired accursed weapons scale by five",()=>{
  let entry=initial(engine,u,size),limit=size/5;
  const chain=model(engine,u,entry,/chainfist.*combi-bolter|combi-bolter.*chainfist/i);
  assert.equal(chain.maximum,limit);
  entry=engine.setSelection(u.definition,entry,chain.id,limit);
  assert.equal(engine.validateLoadout(u.definition,entry).length,0);
  const other=model(engine,u,entry,/chainfist.*combi-weapon|combi-weapon.*chainfist/i);
  entry=engine.setSelection(u.definition,entry,other.id,1,false);
  assert.equal(ruleErrors(engine,u,entry,"chainfists")[0].actual,limit+1);
  entry=initial(engine,u,size);
  const paired=model(engine,u,entry,/^Paired accursed weapons$/i);
  assert.equal(paired.maximum,limit);
  entry=engine.setSelection(u.definition,entry,paired.id,limit);
  assert.equal(engine.validateLoadout(u.definition,entry).length,0);
  entry=engine.setSelection(u.definition,entry,paired.id,limit+1,false);
  assert.equal(ruleErrors(engine,u,entry,"paired-accursed-weapons")[0].limit,limit);
 });
 test(label+": heavy flamer and reaper autocannon share their allowance",()=>{
  let entry=initial(engine,u,size),limit=size/5;
  const heavy=model(engine,u,entry,/^Heavy weapon$/i);
  assert.equal(heavy.maximum,limit);
  entry=engine.setSelection(u.definition,entry,heavy.id,limit);
  assert.equal(engine.validateLoadout(u.definition,entry).length,0);
  const full=engine.getConfiguredProfiles(u.definition,entry).weapons.filter(w=>/^(Heavy flamer|Reaper autocannon)$/i.test(w.name));
  assert.equal(full.reduce((n,w)=>n+w.count,0),limit);
  if(size===10){
   const flamer=engine.getOptionStates(u.definition,entry).find(o=>o.name==="Heavy flamer"&&o.id.startsWith(heavy.id));
   entry=engine.setSelection(u.definition,entry,flamer.id,1);
   const weapons=engine.getConfiguredProfiles(u.definition,entry).weapons;
   assert.equal(weapons.find(w=>/^Heavy flamer$/i.test(w.name)).count,1);
   assert.equal(weapons.find(w=>/^Reaper autocannon$/i.test(w.name)).count,1);
  }
  entry=engine.setSelection(u.definition,entry,heavy.id,limit+1,false);
  assert.equal(ruleErrors(engine,u,entry,"heavy-weapons")[0].actual,limit+1);
 });
 test(label+": every model can take a combi-weapon",()=>{
  let entry=initial(engine,u,size);
  const combi=model(engine,u,entry,/accursed weapon.*combi-weapon|combi-weapon.*accursed weapon/i);
  const champion=engine.getOptionStates(u.definition,entry).find(o=>o.name==="Terminator Champion"&&o.active&&o.current>0);
  entry=engine.setSelection(u.definition,entry,combi.id,size-(champion?1:0));
  if(champion){
   const options=engine.getOptionStates(u.definition,entry).filter(o=>o.kind==="upgrade"&&o.id.startsWith(champion.id));
   const option=options.find(o=>o.name==="Combi-weapon, accursed weapon") || options.find(o=>o.name==="Combi-weapon");
   assert(option,"Champion combi-weapon choice");
   entry=engine.setSelection(u.definition,entry,option.id,1);
  }
  assert.equal(engine.validateLoadout(u.definition,entry).length,0);
  const weapon=engine.getConfiguredProfiles(u.definition,entry).weapons.find(w=>/^combi-weapon$/i.test(w.name));
  assert.equal(weapon.count,size);
 });
}
for(const [runtime,engine]of engines)test(runtime+": World Eaters Champion and heavy weapon model count towards the same fist allowance",()=>{
 const u=units.find(u=>u.faction==="Chaos - World Eaters");
 let entry=initial(engine,u,5),bolter=model(engine,u,entry,/combi-bolter.*power fist/i);
 entry=engine.setSelection(u.definition,entry,bolter.id,3);
 const champion=engine.getOptionStates(u.definition,entry).find(o=>o.kind==="upgrade"&&o.name==="Combi-bolter, power fist");
 assert.equal(champion.maximum,0);
 let invalid=engine.setSelection(u.definition,entry,champion.id,1,false);
 assert.equal(ruleErrors(engine,u,invalid,"power-fists")[0].actual,4);
 const heavy=model(engine,u,entry,/^Heavy weapon$/i);
 entry=engine.setSelection(u.definition,entry,heavy.id,1);
 const fist=engine.getOptionStates(u.definition,entry).find(o=>o.name==="Power fist"&&o.id.includes(heavy.id));
 assert.equal(fist.maximum,0);
 invalid=engine.setSelection(u.definition,entry,fist.id,1,false);
 assert.equal(ruleErrors(engine,u,invalid,"power-fists")[0].actual,4);
});
