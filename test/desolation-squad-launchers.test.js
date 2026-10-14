'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {readSpaceMarineUnits}=require('../src/rulesets/space-marine-units');
const {applyMfmPoints,readMfmPoints}=require('../src/rulesets/mfm-points');
const {calculateEntryPoints}=require('../src/domain/pricing');
const server=require('../src/domain/loadout');
const context={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../ui/engine-runtime'),'utf8'),context);
const browser=context.window.RosterEngine;
const source=readSpaceMarineUnits(require.resolve('../data/manual-rules/wh40k-11e-space-marine-units.json.gz'));
const units=applyMfmPoints(source.units,[],readMfmPoints(require.resolve('../data/manual-rules/wh40k-11e-mfm-points.json'))).units.filter(u=>u.name==='Desolation Squad');
function groups(u){const all=[];function visit(n){if(n.squadWeaponChoice)all.push(n);for(const c of n.children||[])visit(c)}visit(u.selectionTree);return {marines:all.find(g=>!g.squadWeaponExceptions.length),sergeant:all.find(g=>g.squadWeaponExceptions.length)}}
const option=(group,name)=>group.children.find(c=>c.name===name);
for(const [name,engine] of [['server',server],['browser',browser]]){
 test(name+': Desolation launchers switch together in every chapter and preserve Vengor',()=>{
  assert.equal(units.length,12);
  for(const u of units){const {marines,sergeant}=groups(u),frag='Superfrag Rocket Launcher',krak='Superkrak Rocket Launcher',vengor=option(sergeant,'Vengor launcher');let e=engine.createDefaultRosterEntry(u);
   const valid=()=>assert.equal(engine.validateLoadout(u,e).length,0,u.faction);
   const count=(group,weapon)=>Number(e.selections[option(group,weapon).id]||0);
   valid();e=engine.setSelection(u,e,option(marines,krak).id,1);assert.equal(count(marines,krak),4);assert.equal(count(sergeant,krak),1);assert.equal(count(marines,frag),0);valid();
   e=engine.setSelection(u,e,vengor.id,1);const points=calculateEntryPoints(u,e).points;valid();
   e=engine.setSelection(u,e,option(marines,frag).id,1);assert.equal(count(marines,frag),4);assert.equal(e.selections[vengor.id],1);assert.equal(calculateEntryPoints(u,e).points,points);valid();
   e=engine.setSelection(u,e,option(marines,krak).id,1);assert.equal(e.selections[vengor.id],1);valid();
   e=engine.setSelection(u,e,vengor.id,0);assert.equal(count(sergeant,krak),1);assert.equal(count(sergeant,frag),0);valid();
   e=engine.setSelection(u,e,option(sergeant,frag).id,1);assert.equal(count(marines,frag),4);assert.equal(count(marines,krak),0);valid();
   e=engine.setSelection(u,e,option(marines,frag).id,0);assert.equal(count(marines,krak),4);assert.equal(count(sergeant,krak),1);valid();
   const states=engine.getOptionStates(u,e);for(const g of [marines,sergeant])for(const o of g.children){const state=states.find(s=>s.id===o.id);assert(state.active);assert(state.squadWideChoice);}
   const weapons=engine.getConfiguredProfiles(u,e).weapons.filter(w=>w.name===krak);assert.equal(weapons.reduce((sum,w)=>sum+w.count,0),5);
  }
 });
 test(name+': old mixed and mismatched launcher saves are flagged and can be corrected',()=>{
  const u=units[0],{marines,sergeant}=groups(u),frag=option(marines,'Superfrag Rocket Launcher'),krak=option(marines,'Superkrak Rocket Launcher');let e=engine.createDefaultRosterEntry(u);e.selections[frag.id]=3;e.selections[krak.id]=1;
  e=engine.normalizeRosterEntry(u,e);assert.equal(e.selections[frag.id],3);assert(engine.validateLoadout(u,e).some(error=>error.type==='squad-weapon'));
  e=engine.setSelection(u,e,krak.id,1);assert.equal(e.selections[krak.id],4);assert.equal(engine.validateLoadout(u,e).length,0);
  e.selections[option(sergeant,'Superfrag Rocket Launcher').id]=1;e.selections[option(sergeant,'Superkrak Rocket Launcher').id]=0;assert(engine.validateLoadout(u,e).some(error=>error.type==='squad-weapon'));
 });
}
