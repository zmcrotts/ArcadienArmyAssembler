"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const M=require('../src/domain/crusade'),T=require('../src/domain/crusade-trackers'),D=require('../src/domain/crusade-death-guard');
function force(){const f=M.createForce({name:'Source verification',faction:'Death Guard',pointsLimit:2000,rosterEntries:[['Lord of Contagion',['CHARACTER','INFANTRY']],['Plague Marines',['INFANTRY','BATTLELINE']],['Poxwalkers',['INFANTRY','POXWALKERS']],['Plagueburst Crawler',['VEHICLE']],['Death Guard Chaos Spawn',['DAEMON','BEAST']],['Death Guard Daemon Prince',['CHARACTER','DAEMON','MONSTER']]].map(([name,keywords],i)=>({instanceId:'source'+i,selectionKey:'key'+i,name,points:100,keywords,roles:{character:keywords.includes('CHARACTER')},configured:{units:[{name,characteristics:{T:'5',W:'6',LD:'6+'}}],weapons:[]}}))});return f;}
function game(f,result='Victory'){const next=structuredClone(f),b={id:M.uid(),date:'2026-11-25',opponent:'Test opponent',result,unitIds:next.units.map(u=>u.id),survivedUnitIds:next.units.map(u=>u.id)};next.battles||=[];next.battles.push(b);return {f:next,b};}
function world(f=force(),method='Hive World',extra={}){return D.apply(f,'world',{name:'The Sevenfold Offering',world:'Mordant III',method,...extra});}
function review(f,agendas=[],result='Victory'){const g=game(f,result);const n=D.apply(g.f,'review',{battleId:g.b.id,agendas});return {f:n,id:T.records(n,'dgBattles').at(-1).id};}
function step(f,id,input={}){return D.apply(f,'step',{reviewId:id,...input});}
function completePairs(f){return T.transact(f,'Prior recorded progress',(_n,s)=>{const p=s.panels.plagues.at(-1);p.values.reproduction=7-p.values.fecundity;p.values.survival=7-p.values.population;p.values.adaptability=7-p.values.vulnerability;});}
function entitlement(f,type='tailor'){const r=review(f);let next=D.apply(r.f,'requisition',{reviewId:r.id,key:type==='tailor'?'fruits':'tainted'});return {f:next,id:r.id,op:T.records(next,'dgBattles').at(-1).operations.at(-1).id};}
test('active plague characteristics can be edited directly, persist and undo without changing initial suitability',()=>{
  let f=world(),id=D.active(f).id;const original=JSON.stringify(f);assert.throws(()=>D.apply(f,'adjustPlague',{plagueId:id,characteristic:'suitability',value:3}),/Choose a world/);assert.throws(()=>D.apply(f,'adjustPlague',{plagueId:id,characteristic:'reproduction',value:7}),/from 1 to 6/);assert.equal(JSON.stringify(f),original);
  f=D.apply(f,'adjustPlague',{plagueId:id,characteristic:'reproduction',value:4});assert.equal(D.active(f).values.reproduction,4);assert.equal(D.active(f).values.suitability,10);assert.deepEqual(D.active(f).initialWorld,[3,5,2]);M.validateForce(JSON.parse(JSON.stringify(f)));f=T.undo(f);assert.equal(D.active(f).values.reproduction,1);
  f=D.apply(f,'editPlague',{plagueId:id,name:'Renamed plague',world:'New world name',fecundity:4,population:4,vulnerability:2,reproduction:3,survival:3,adaptability:5});assert.equal(D.active(f).name,'Renamed plague');assert.deepEqual(D.totals(D.active(f)),[7,7,7]);assert.equal(D.active(f).values.suitability,10);assert.equal(D.active(f).reward,undefined);
});
test('setting population to zero through the editor fails the attempt and closes its open review',()=>{
  let {f,id}=review(world()),plagueId=D.active(f).id;f=D.apply(f,'adjustPlague',{plagueId,characteristic:'population',value:0});assert.equal(D.active(f),null);assert.equal(T.records(f,'plagues')[0].outcome,'Failed');assert.equal(T.records(f,'dgBattles')[0].phase,'done');assert.throws(()=>D.apply(f,'adjustPlague',{plagueId,characteristic:'population',value:1}),/Only the active/);f=T.undo(f);assert.ok(D.active(f));assert.equal(T.records(f,'dgBattles')[0].phase,'reap');
});
test('clicking a plague circle saves and refreshes its displayed value immediately',async()=>{
  const vm=require('node:vm'),window={ArcadienDeathGuard:D,ArcadienCrusadeTrackers:T};vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../mobile/ui/crusade-death-guard-ui.js'),'utf8'),{window});let f=world(),refreshes=0;const ui=window.ArcadienDeathGuardUI.create({getForce:()=>f,commit:async next=>{f=next;},refresh:()=>refreshes++,formatRules:()=>''});assert.match(ui.render(f),/Set Rate of Reproduction to 2/);await ui.handle({dataset:{dgAction:'adjust-plague',plague:D.active(f).id,characteristic:'reproduction',value:'2'}});assert.equal(refreshes,1);assert.equal(D.active(f).values.reproduction,2);assert.match(ui.render(f),/Rate of Reproduction: 2/);await ui.handle({dataset:{dgAction:'adjust-plague',plague:D.active(f).id,characteristic:'reproduction',value:'2'}});assert.equal(refreshes,1);
});
test('source graphics and world presets are audited against the supplied HTML',()=>{
  const manifest=require('../ui/assets/crusade/death-guard/source-manifest.json');assert.equal(manifest.sourceSha256,D.SOURCE.htmlSha256);assert.deepEqual(manifest.presets,D.PRESETS);assert.equal(manifest.assets.length,10);
  for(const a of manifest.assets){const bytes=fs.readFileSync(path.resolve(__dirname,'../ui/assets/crusade/death-guard',a.name));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),a.sha256);}
  assert.equal(D.PROPERTIES.length,5);assert.equal(D.PROPERTIES.filter(p=>p.drawback).length,3);assert.equal(D.STEPS.length,6);
});
test('world creation uses printed presets, fixed suitability, and one active plague',()=>{
  for(const [method,values] of Object.entries(D.PRESETS)){const f=world(force(),method),p=D.active(f);assert.deepEqual([p.values.fecundity,p.values.population,p.values.vulnerability],values);assert.deepEqual([p.values.reproduction,p.values.survival,p.values.adaptability],[1,1,1]);assert.equal(p.values.suitability,10);assert.throws(()=>world(f),/current plague/);M.validateForce(f);}
  const f=force();f.units=f.units.filter(u=>!D.character(u));assert.throws(()=>world(f),/Character/);
});
test('Path of Contagion enforces order, victory modifiers and both adverse rolls',()=>{
  let {f,id}=review(world());assert.throws(()=>step(f,id,{roll:6}),/no dice step/);f=D.apply(f,'reap',{reviewId:id});f=step(f,id);assert.equal(T.records(f,'dgBattles').at(-1).phase,'cultivation');
  f=step(f,id,{roll:2,characteristic:'adaptability',delta:1});assert.equal(D.active(f).values.adaptability,2);
  f=step(f,id,{roll:6});assert.equal(D.active(f).values.vulnerability,1);
  f=step(f,id,{roll:6});assert.equal(D.active(f).values.population,4);
  f=step(f,id);assert.equal(T.records(f,'dgBattles').at(-1).phase,'done');assert.equal(D.active(f).values.suitability,10);assert.throws(()=>step(f,id),/no dice step/);M.validateForce(f);
});
test('first breakthrough immediately awards the correct tier without later dice',()=>{
  let {f,id}=review(completePairs(world()));f=D.apply(f,'reap',{reviewId:id});f=step(f,id);const p=T.records(f,'plagues')[0];assert.equal(p.reward.name,'A Mighty Pestilence');assert.equal(p.values.status,'Completed');assert.equal(T.records(f,'dgBattles')[0].phase,'reward');assert.throws(()=>step(f,id,{roll:6}),/No active plague/);
  f=D.apply(f,'reward',{reviewId:id,unitId:f.units[0].id,blessingId:'endless-harvest'});assert.equal(f.units[0].xp,3);assert.equal(T.blessingClaims(f).find(b=>b.id==='endless-harvest').claims.length,1);assert.throws(()=>D.apply(f,'reward',{reviewId:id,unitId:f.units[0].id}),/current Path/);M.validateForce(f);
});
test('population zero fails before the final check and previous attempts remain archived',()=>{
  let f=world(force(),'Agri World');f=T.transact(f,'Previous attrition',(_n,s)=>s.panels.plagues[0].values.population=1);let r=review(f,[],'Defeat');f=D.apply(r.f,'reap',{reviewId:r.id});f=step(f,r.id);f=step(f,r.id,{roll:1});f=step(f,r.id,{roll:1});f=step(f,r.id,{roll:6});assert.equal(D.active(f),null);assert.equal(T.records(f,'plagues')[0].outcome,'Failed');assert.equal(T.records(f,'dgBattles')[0].phase,'done');f=world(f,'Forge World');assert.equal(T.records(f,'plagues').length,2);
});
test('Careful Cultivation resolves twice and Casket of Corruption checks the participating bearer',()=>{
  let {f,id}=review(world());f.units[0].awards.push({id:'casket',name:'Casket of Corruption',kind:'relic',description:'Source reference'});f=D.apply(f,'requisition',{reviewId:id,key:'careful'});assert.equal(f.requisitionPoints,3);f=D.apply(f,'reap',{reviewId:id});f=step(f,id);f=step(f,id,{roll:6,characteristic:'reproduction',delta:1});assert.equal(T.records(f,'dgBattles')[0].phase,'cultivation');f=step(f,id,{roll:6,characteristic:'survival',delta:1});assert.equal(T.records(f,'dgBattles')[0].phase,'counteragents');assert.throws(()=>step(f,id,{skip:true}),/deployment zone/);f=step(f,id,{skip:true,casketPosition:true});assert.equal(D.active(f).values.vulnerability,2);assert.equal(T.records(f,'dgBattles')[0].phase,'deathtoll');
});
test('research counts every kill but caps XP per unit and grants one or two Tailor uses',()=>{
  let {f,id}=review(world(),['seed','research']);const unit=f.units[1].id,pox=f.units[2].id;f=D.apply(f,'reap',{reviewId:id,seed:[unit,'',unit],seedRoll:4,research:{[unit]:4,[pox]:2}});assert.equal(f.units[1].xp,7);assert.equal(f.units[2].xp,0);const r=T.records(f,'dgBattles')[0];assert.equal(r.researchTally,6);assert.equal(r.operations.length,2);assert.equal(D.active(f).values.fecundity,4);assert.throws(()=>D.apply(f,'reap',{reviewId:id}),/current Path/);
});
test('Viral Harvest caps each unit XP while all successful exhumations count for Adaptability',()=>{
  let {f,id}=review(world(),['viral']);f=D.apply(f,'reap',{reviewId:id,viral:{[f.units[1].id]:5},viralRoll:2});assert.equal(f.units[1].xp,3);assert.equal(D.active(f).values.adaptability,2);
});
test('Vectors validates every enemy die, applies the wounded modifier, and requires a surviving recipient',()=>{
  let {f,id}=review(world(),['vectors']);assert.throws(()=>D.apply(f,'reap',{reviewId:id,vectors:[{roll:6},{roll:8}],vectorUnit:f.units[1].id}),/D6 result/);f.battles[0].survivedUnitIds=[f.units[1].id];assert.throws(()=>D.apply(f,'reap',{reviewId:id,vectors:[{roll:4,belowStrength:true}],vectorUnit:f.units[0].id}),/survived/);f=D.apply(f,'reap',{reviewId:id,vectors:[{roll:4,belowStrength:true}],vectorUnit:f.units[1].id});assert.equal(f.units[1].xp,3);assert.equal(D.active(f).values.survival,2);
});
test('the already-recorded XP option avoids duplication while retaining research entitlements',()=>{
  const g=game(world());let f=D.apply(g.f,'review',{battleId:g.b.id,agendas:['research'],agendaXPAlreadyRecorded:true}),id=T.records(f,'dgBattles')[0].id;f=D.apply(f,'reap',{reviewId:id,research:{[f.units[1].id]:1}});assert.equal(f.units[1].xp,0);assert.equal(T.records(f,'dgBattles')[0].operations.length,1);assert.throws(()=>D.apply(f,'review',{battleId:g.b.id}),/already has/);
});
test('Pathogen Potency is derived from Duration, Properties and suppressed Drawbacks',()=>{
  let f=D.apply(force(),'restorePathogen',{duration:2,properties:['putridity','hypervector','lurid-flux'],suppressed:['putridity','hypervector']});assert.equal(D.pathogen(f).potency,7);assert.throws(()=>D.apply(f,'restorePathogen',{duration:3,properties:['putridity','hypervector','lurid-flux'],suppressed:['putridity','hypervector']}),/Potency 7/);assert.throws(()=>D.apply(f,'restorePathogen',{duration:1,properties:['lurid-flux'],suppressed:['lurid-flux']}),/valid printed/);M.validateForce(f);
});
test('earned Brew and Tailor uses are consumed once with atomic reductions and improvements',()=>{
  let f=D.apply(force(),'restorePathogen',{duration:2,properties:['putridity','hypervector','lurid-flux'],suppressed:['putridity','hypervector']});const r=entitlement(f,'brew');f=r.f;const before=JSON.stringify(f);assert.throws(()=>D.apply(f,'brew',{reviewId:r.id,operationId:r.op,brew:'duration'}),/requires a reduction/);assert.equal(JSON.stringify(f),before);
  f=D.apply(f,'brew',{reviewId:r.id,operationId:r.op,reduce:'property:putridity',brew:'duration'});assert.equal(D.pathogen(f).duration,3);assert.equal(D.pathogen(f).potency,6);assert.ok(!D.pathogen(f).properties.some(p=>p.definition.id==='putridity'));assert.throws(()=>D.apply(f,'brew',{reviewId:r.id,operationId:r.op,brew:'duration'}),/unused/);M.validateForce(f);
});
test('a Tailor may restore a drawback and then select another printed improvement',()=>{
  let f=D.apply(force(),'restorePathogen',{duration:1,properties:['putridity'],suppressed:['putridity']});const r=entitlement(f);f=D.apply(r.f,'brew',{reviewId:r.id,operationId:r.op,reduce:'suppression:putridity',brew:'property:hypervector'});assert.equal(D.pathogen(f).potency,3);assert.equal(D.pathogen(f).properties.find(p=>p.definition.id==='putridity').record.values.suppressed,false);
});
test('new worlds can use Acceptable Offering rerolls and keep an immutable suitability',()=>{
  let {f,id}=review(completePairs(world(force(),'Random',{rolls:[6,6,4]})));f=D.apply(f,'reap',{reviewId:id});f=step(f,id);assert.equal(T.records(f,'plagues')[0].reward.name,'Acceptable Offering');f=D.apply(f,'reward',{reviewId:id,unitId:f.units[0].id});assert.equal(f.units[0].xp,2);assert.throws(()=>world(f,'Random',{rolls:[3,5,6],rerolls:[1,2,3]}),/initial 5s or 6s/);f=world(f,'Random',{rolls:[5,6,2],rerolls:[1,3,'']});assert.equal(D.active(f).values.suitability,6);assert.deepEqual(D.active(f).initialWorld,[1,3,2]);
});
test('Boons use D33; duplicates cause Spawndom; pending replacements cannot muster',()=>{
  let f=force(),id=f.units[0].id;f=D.apply(f,'boon',{unitId:id,tens:1,units:1,eligibleForHonour:true});assert.equal(f.units[0].awards[0].name,'Febrile Vitality');f=D.apply(f,'boon',{unitId:id,tens:1,units:1,eligibleForHonour:true});assert.equal(f.units[0].deathGuard.pendingSpawndom,true);assert.throws(()=>M.battleDocument(f,[id]),/pending awards/);const target=f.units[4].id;f=D.apply(f,'replace',{unitId:id,replacementId:target,kind:'spawn'});assert.equal(f.retiredUnits[0].id,id);assert.equal(f.units.find(u=>u.id===target).deathGuard.pendingHonours,1);assert.throws(()=>M.battleDocument(f,[target]),/pending awards/);M.validateForce(f);
});
test('Putrid Ascension spends RP, preserves XP and selected Boons, and defers replacement Honours',()=>{
  let f=force(),id=f.units[0].id;f=M.updateUnit(f,id,{xp:31});for(const units of [1,2,3])f=D.apply(f,'boon',{unitId:id,tens:1,units,eligibleForHonour:true});const rp=f.requisitionPoints,target=f.units[5].id;
  assert.throws(()=>D.apply(f,'replace',{unitId:id,replacementId:target,kind:'ascension'}),/just reached/);
  f=D.apply(f,'replace',{unitId:id,replacementId:target,kind:'ascension',rankJustGained:true,keepBoons:true});const prince=f.units.find(u=>u.id===target);assert.equal(prince.xp,31);assert.equal(prince.awards.length,3);assert.equal(prince.deathGuard.pendingScars,0);assert.equal(f.requisitionPoints,rp-2);assert.throws(()=>D.apply(f,'boon',{unitId:target,tens:2,units:1,eligibleForHonour:true}),/non-Daemon-Prince/);M.validateForce(f);
});
test('Poxwalkers remain immune to ordinary progression; Wretched Might and Spreading Pox are explicit exceptions',()=>{
  let f=force(),id=f.units[2].id;assert.throws(()=>M.updateUnit(f,id,{xp:1}),/cannot gain XP/);assert.throws(()=>M.assignAward(f,id,{id:'scar',name:'Scar',kind:'scar',description:'Scar'}),/cannot gain ordinary/);
  const trait={id:'trait',name:'Spatterfilth',kind:'honour',description:'Printed Infantry trait'};f=D.apply(f,'wretched',{unitId:id,mustered:true,trait});assert.equal(f.requisitionPoints,3);assert.equal(M.battleDocument(f,[id]).crusade.deathGuard.temporaryTraits[0].id,'trait');assert.throws(()=>D.apply(f,'wretched',{unitId:id,mustered:true,trait}),/already has/);
  f=D.apply(f,'restorePathogen',{duration:1,properties:['spreading-pox'],suppressed:[]});const r=review(f);f=D.apply(r.f,'spreading',{reviewId:r.id,unitId:id,qualifyingKills:true,firstNewUnit:true});assert.equal(f.units[2].xp,6);assert.throws(()=>M.battleDocument(f,[id]),/pending awards/);f=M.assignAward(f,id,trait);assert.equal(f.units[2].deathGuard.spreadingHonourPending,false);assert.throws(()=>D.apply(f,'spreading',{reviewId:r.id,unitId:id,qualifyingKills:true,firstNewUnit:true}),/already resolved/);
});
test('Vile Possession affects only newly added Vehicles and counts each Blessing once at muster',()=>{
  let f=T.claimBlessing(force(),'vile-possession','Existing reward'),ids=new Set(f.units.map(u=>u.id));const u=structuredClone(f.units[3]);u.id=M.uid();u.record.instanceId=u.id;f.units.push(u);D.afterNewUnits(f,ids);assert.equal(f.units.at(-1).xp,6);assert.ok(f.units.at(-1).keywords.includes('DAEMON'));assert.equal(f.units[3].xp,0);assert.equal(M.summary(f).crusadePoints,1);assert.equal(M.battleDocument(f,[f.units[0].id]).crusade.extraCrusadePoints,1);assert.throws(()=>M.battleDocument(f,[u.id]),/pending awards/);M.validateForce(f);
});
test('post-battle Blessings resolve once, validate survivors and avoid recording XP twice',()=>{
  let f=force();for(const id of ['eye-of-nurgle','fecund-fervour','endless-harvest','burgeoning-fortitude'])f=T.claimBlessing(f,id,'Existing reward');const r=review(f);f=r.f;const before=f.requisitionPoints;f=D.apply(f,'blessing',{reviewId:r.id,blessingId:'endless-harvest',roll:4});assert.equal(f.requisitionPoints,before+1);assert.throws(()=>D.apply(f,'blessing',{reviewId:r.id,blessingId:'endless-harvest',roll:6}),/already been resolved/);
  f=D.apply(f,'blessing',{reviewId:r.id,blessingId:'eye-of-nurgle',roll:5,unitId:f.units[1].id});assert.equal(f.units[1].xp,3);f=D.apply(f,'blessing',{reviewId:r.id,blessingId:'fecund-fervour',xpAlreadyRecorded:true});assert.equal(f.units[1].xp,3);f=D.apply(f,'blessing',{reviewId:r.id,blessingId:'burgeoning-fortitude',firstFailedTest:true,unitId:f.units[0].id});M.validateForce(f);
});
test('Pathogen activation expires on the correct own Command phase and permits a later activation',()=>{
  const base={status:'active',round:1,turn:'you',phase:'Command',setup:{firstTurn:'opponent'},roster:{crusade:{deathGuard:{duration:2}}}};let s=D.activatePathogen(base);assert.equal(base.deathGuardBattle,undefined);assert.ok(D.pathogenActive(s));assert.throws(()=>D.activatePathogen(s),/already recorded/);s.round=2;s.turn='opponent';assert.ok(D.pathogenActive(s));s.round=3;assert.ok(D.pathogenActive(s));s.turn='you';assert.equal(D.pathogenActive(s),false);s=D.activatePathogen(s);assert.equal(s.deathGuardBattle.activations.length,2);s.phase='Shooting';assert.throws(()=>D.activatePathogen(s),/Command phase/);s.status='final';s.phase='Command';assert.throws(()=>D.activatePathogen(s),/Command phase/);
});
test('dedicated Death Guard views expose fixed choices, source graphics and escape saved names',async()=>{
  const vm=require('node:vm'),window={ArcadienDeathGuard:D,ArcadienCrusadeTrackers:T};vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../mobile/ui/crusade-death-guard-ui.js'),'utf8'),{window});let f=world();f.factionProgression.panels.plagues[0].name='<script>unsafe</script>';const ui=window.ArcadienDeathGuardUI.create({getForce:()=>f,refresh(){},formatRules:()=>''});let html=ui.render(f);assert.match(html,/&lt;script&gt;unsafe/);assert.match(html,/dgMatrix/);assert.match(html,/512fbec781cc8bca20.png/);assert.doesNotMatch(html,/New tracker/);await ui.handle({dataset:{dgAction:'tab',tab:'pathogen'}});html=ui.render(f);for(const p of D.PROPERTIES)assert.ok(html.includes(p.name));assert.match(html,/Suppressed/);await ui.handle({dataset:{dgAction:'tab',tab:'reference'}});assert.match(ui.render(f),/d9a30e411641a0b6af.png/);
});
test('completed reviews keep their characteristic snapshot through later battles and imported copies',()=>{
  let {f,id}=review(world());f=D.apply(f,'reap',{reviewId:id});for(const input of [{},{roll:2,characteristic:'survival',delta:1},{roll:1},{roll:1},{}])f=step(f,id,input);const snapshot=T.records(f,'dgBattles')[0].finalPlague;assert.equal(snapshot.values.survival,2);
  const next=review(f);f=D.apply(next.f,'reap',{reviewId:next.id});f=step(f,next.id);f=step(f,next.id,{roll:2,characteristic:'survival',delta:1});assert.equal(D.active(f).values.survival,3);assert.equal(T.records(f,'dgBattles')[0].finalPlague.values.survival,2);M.validateForce(JSON.parse(JSON.stringify(f)));
});
