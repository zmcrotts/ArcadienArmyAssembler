"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const source=fs.readFileSync(require.resolve("../ui/play-mode.js"),"utf8");
function harness(){
  const inputs=[],content={querySelectorAll:()=>inputs},stored=new Map();
  const context={window:{ArcadienDeathGuard:require('../../src/domain/crusade-death-guard')},structuredClone,Date,Math,console,localStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)},document:{getElementById:id=>id==="playModeContent"?content:null,addEventListener(){}}};
  const injection=`window.testApi={set:s=>session=s,createSession,createDeck,compactFinalResult,renderCrusadeAgendas,renderDeathGuardBattle,bindCrusadeAgendas,renderWeapon};`;
  vm.runInNewContext(source.replace("  window.ArcadienPlayMode =",injection+"\n  window.ArcadienPlayMode ="),context);
  return {api:context.window.testApi,inputs,stored};
}
const crusade={forceId:"force",forceName:"Wardens",unitIds:["unit"],units:[{id:"unit",name:"Aurelian"}],agendas:[{id:"agenda",name:"Objective <one>",source:"Custom",description:"Reach the target."}]};
test("Play Mode keeps locked agenda snapshots, saves tallies/notes and retains them in final records",()=>{
  const {api,inputs,stored}=harness(),roster={name:"Wardens",rosterEntries:[],crusade:structuredClone(crusade)};
  const session=api.createSession("crusade:force",roster,{yourMissionMode:"agendas"});api.set(session);
  assert.equal(session.setup.missionMode.you,"agendas");assert.equal(session.decks.you.mode,"agendas");assert.equal(session.decks.you.draw.length,0);
  roster.crusade.agendas[0].name="Changed in OoB";
  assert.equal(session.roster.crusade.agendas[0].name,"Objective <one>");
  inputs.push({dataset:{agenda:"agenda",agendaUnit:"unit"},value:"3"},{dataset:{agenda:"agenda"},value:"Achieved in round 2"});
  api.bindCrusadeAgendas();inputs[0].onchange();inputs[1].onchange();
  assert.equal(session.agendaProgress.agenda.tallies.unit,3);assert.equal(session.agendaProgress.agenda.notes,"Achieved in round 2");
  const resumed=JSON.parse(stored.get("arcadienPlayModeSessionsV1"))["crusade:force"];
  assert.equal(resumed.agendaProgress.agenda.tallies.unit,3);
  const final=api.compactFinalResult(session);
  assert.deepEqual(JSON.parse(JSON.stringify(final.roster.crusade)),crusade);
  assert.equal(final.agendaProgress.agenda.tallies.unit,3);
  const html=api.renderCrusadeAgendas();assert.match(html,/Objective &lt;one&gt;/);assert.match(html,/value="3"/);assert.match(html,/Achieved in round 2/);
  session.status="final";inputs[0].value="99";inputs[0].onchange();assert.equal(session.agendaProgress.agenda.tallies.unit,3);
  assert.match(api.renderCrusadeAgendas(),/disabled/);
});
test("ordinary completed games retain their original compact form for integrity hashes",()=>{
  const {api}=harness(),session=api.createSession("list",{name:"List",rosterEntries:[]},{});
  const final=api.compactFinalResult(session);
  assert.equal(Object.hasOwn(final,"agendaProgress"),false);assert.equal(Object.hasOwn(final.roster,"crusade"),false);
  assert.equal(session.decks.you.mode,"tactical");
});
test("named weapon upgrades remain highlighted with their individual stats in Play Mode",()=>{
  const {api}=harness();
  const html=api.renderWeapon({name:"Fancy Rifle ★",count:1,crusadeBaseName:"Bolt rifle",crusadeModified:true,crusadeChanges:["Brutal","Master-worked"],characteristics:{S:"5",D:"2"}},[]);
  assert.match(html,/1× Fancy Rifle ★/);assert.match(html,/crModifiedWeapon/);assert.match(html,/MODIFIED/);assert.match(html,/<small>S<\/small><b>5<\/b>/);
});
test('Death Guard battle recipe, activation and temporary traits survive the final record without affecting normal games',()=>{
  const {api}=harness(),D=require('../../src/domain/crusade-death-guard'),roster={name:'Laboratory',rosterEntries:[],crusade:structuredClone(crusade)};
  roster.crusade.deathGuard={duration:2,potency:4,properties:[{id:'putridity',name:'Putridity <test>',effect:'Critical hits on 5+',drawback:'Strength −3',suppressed:true}],temporaryTraits:[{unitId:'unit',name:'Spatterfilth',description:'For this battle only'}],blessings:[]};
  let session=api.createSession('crusade:force',roster,{});session.round=1;session.turn='you';session.phase='Command';session.setup.firstTurn='you';session=D.activatePathogen(session);api.set(session);
  const html=api.renderDeathGuardBattle();assert.match(html,/Alchemical Pathogen · ACTIVE/);assert.match(html,/Putridity &lt;test&gt;/);assert.match(html,/Drawback \(suppressed\)/);assert.match(html,/Wretched Might · Aurelian/);assert.match(html,/Command phase 3/);
  const final=api.compactFinalResult(session);assert.equal(final.deathGuardBattle.activation.duration,2);assert.equal(final.roster.crusade.deathGuard.temporaryTraits[0].name,'Spatterfilth');session.status='final';api.set(session);assert.match(api.renderDeathGuardBattle(),/data-pathogen-activate disabled/);
});
test('completed Crusade games retain the full frozen roster and named modified weapon profiles',()=>{
  const {api}=harness(),roster={name:'Frozen force',rosterEntries:[{instanceId:'unit',configured:{weapons:[{name:'One Fancy Rifle ★',count:1,crusadeModified:true,characteristics:{S:'5',D:'2'}}]}}],armyState:{warlordInstanceId:'unit'},crusade:structuredClone(crusade)};
  roster.crusade.unitRecords=[{id:'unit',name:'Veteran',xp:9,weaponModifications:[{name:'One Fancy Rifle'}]}];const session=api.createSession('crusade:force',roster,{}),final=api.compactFinalResult(session);roster.rosterEntries[0].configured.weapons[0].characteristics.S='9';assert.equal(final.roster.rosterEntries[0].configured.weapons[0].characteristics.S,'5');assert.equal(final.roster.armyState.warlordInstanceId,'unit');assert.equal(final.roster.crusade.unitRecords[0].xp,9);assert.deepEqual(JSON.parse(JSON.stringify(api.compactFinalResult(final))),JSON.parse(JSON.stringify(final)));
});
