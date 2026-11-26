"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../src/domain/crusade'),X=require('../src/domain/crusade-bookkeeping'),W=require('../src/domain/crusade-weapons');
function force(){return M.createForce({name:'Bookkeeping test',faction:'Space Marines',pointsLimit:1000,rosterEntries:[['Captain',['CHARACTER','INFANTRY']],['Intercessors',['INFANTRY','BATTLELINE']],['Servitors',['INFANTRY']]].map(([name,keywords],i)=>({instanceId:'original'+i,selectionKey:'key'+i,name,points:100,keywords,configured:{units:[{name,characteristics:{M:'6"',T:'4',W:'2'}}],weapons:[{name:'Bolt rifle',count:10,typeName:'Ranged Weapons',characteristics:{A:'2',BS:'3+',S:'4',AP:'-1',D:'1'}}]}}))});}
const award=(id='honour')=>({id,name:id,kind:'honour',description:'A Battle Trait',crusadePoints:1}),scar=(id='scar')=>({id,name:id,kind:'scar',description:'A Battle Scar',crusadePoints:-1});
const wrap=(f,entries,extra={})=>X.wrapUp(f,{date:'2026-11-26',result:'Victory',opponent:'Test opponent',units:entries||f.units.map(u=>({unitId:u.id,kills:0})),...extra});
test('wrap-up combines participation, cumulative kill thresholds, agendas and greatness; RP caps at ten',()=>{
  let f=force(),id=f.units[1].id;f.units[1].kills=2;f.requisitionPoints=10;const before=JSON.stringify(f);f=wrap(f,[{unitId:id,kills:1,agendaXP:2,marked:true}]);const u=f.units[1];assert.equal(u.xp,7);assert.equal(u.kills,3);assert.equal(u.games,1);assert.equal(u.wins,1);assert.equal(u.survived,1);assert.equal(f.requisitionPoints,10);assert.deepEqual(X.pending(u),[1]);assert.ok(u.history.some(h=>h.category==='rank'));const reverted=X.undo(f);assert.deepEqual(reverted.units,JSON.parse(before).units);assert.equal(reverted.battles.length,0);M.validateForce(f);
});
test('failed injuries choose scars, Honour loss, explicit house-rule XP loss, or reversible deferment',()=>{
  let f=force(),id=f.units[0].id;f.units[0].xp=9;f=M.assignAward(f,id,award());let n=wrap(f,[{unitId:id,kills:0,destroyed:true,outOfActionRoll:1,injuryOutcome:'honour-loss',loseHonourId:'honour'}]);assert.equal(n.units[0].awards.length,0);assert.equal(X.undo(n).units[0].awards.length,1);
  n=wrap(f,[{unitId:id,destroyed:true,outOfActionRoll:1,injuryOutcome:'scar',scar:scar()}]);assert.equal(n.units[0].awards.filter(a=>a.kind==='scar').length,1);
  assert.throws(()=>wrap(f,[{unitId:id,destroyed:true,outOfActionRoll:1,injuryOutcome:'xp-loss',xpLoss:4}]),/house rule/);n=wrap(f,[{unitId:id,destroyed:true,outOfActionRoll:1,injuryOutcome:'xp-loss',xpLoss:4,overrideReason:'Our group uses XP loss'}]);assert.equal(n.units[0].xp,6);
  n=wrap(f,[{unitId:id,destroyed:true,outOfActionRoll:1,injuryOutcome:'defer'}]);assert.throws(()=>M.battleDocument(n,[id]),/pending Out of Action/);n=X.resolveInjury(n,id,{injuryOutcome:'scar',scar:scar('later')});assert.equal(n.units[0].progression.pendingInjury,undefined);assert.equal(n.battles[0].wrapUp[0].injury.scar.id,'later');assert.ok(X.undo(n).units[0].progression.pendingInjury);
});
test('invalid wrap-ups are atomic, and additional greatness needs an explicit rule',()=>{
  const f=force(),before=JSON.stringify(f);assert.throws(()=>wrap(f,[{unitId:f.units[0].id,marked:true},{unitId:f.units[1].id,marked:true}]),/additional Marked/);assert.throws(()=>wrap(f,[{unitId:f.units[0].id,destroyed:true}]),/Out of Action D6/);assert.equal(JSON.stringify(f),before);
});
test('ordinary non-Characters stop at 30 XP until Legendary Veterans is purchased',()=>{
  let f=force(),id=f.units[1].id;f.units[1].xp=29;f=wrap(f,[{unitId:id,agendaXP:8}]);assert.equal(f.units[1].xp,30);f=X.requisition(f,{key:'veterans',unitId:id});assert.equal(f.requisitionPoints,3);f=wrap(f,[{unitId:id}]);assert.equal(f.units[1].xp,31);assert.equal(X.limit(f.units[1]),6);
});
test('an Honour consumes an advancement; limits require replacement, and overrides remain labelled',()=>{
  let f=force(),id=f.units[1].id;f.units[1].xp=6;f=X.grant(f,id,award('earned'));assert.deepEqual(X.pending(f.units[1]),[]);assert.throws(()=>X.grant(f,id,award('unearned')),/No unclaimed/);for(const id2 of ['bonus1','bonus2'])f=X.grant(f,id,award(id2),{source:'bonus',bonusConfirmed:true});assert.throws(()=>X.grant(f,id,award('fourth'),{source:'bonus',bonusConfirmed:true}),/Honour limit/);f=X.grant(f,id,award('replacement'),{source:'bonus',bonusConfirmed:true,replaceId:'bonus1'});assert.equal(X.honours(f.units[1]).length,3);f=X.grant(f,id,award('house'),{overrideReason:'Narrative reward ignores cap'});assert.equal(f.units[1].awards.at(-1).houseRule,'Narrative reward ignores cap');assert.ok(X.undo(f).units[1].awards.length===3);
});
test('new named weapon upgrades are frozen in muster and recorded battle snapshots',()=>{
  let f=force(),id=f.units[1].id;f.units[1].xp=6;const profile=f.units[1].record.configured.weapons[0];f=X.modifyWeapon(f,id,{weaponKey:W.key(profile),copy:1,name:'One Fancy Rifle'},['brutal','master']);const roster=M.battleDocument(f,[id]);assert.equal(roster.rosterEntries[0].configured.weapons[1].name,'One Fancy Rifle ★');f=wrap(f,[{unitId:id}],{sourceRoster:roster,sourceGameId:'game-1'});const saved=JSON.stringify(f.battles[0].snapshot);f.units[1].name='Changed later';f.units[1].record.configured.weapons[0].characteristics.S='9';assert.equal(JSON.stringify(f.battles[0].snapshot),saved);assert.throws(()=>wrap(f,[{unitId:id}],{sourceRoster:roster,sourceGameId:'game-1'}),/already been wrapped/);
});
test('requisitions record costs and effects, can be undone, and reject unaffordable purchases',()=>{
  let f=force();f=X.requisition(f,{key:'supply'});assert.equal(f.supplyLimit,1200);assert.equal(f.requisitionPoints,4);assert.equal(f.requisitions[0].name,'Increase Supply Limit');f=X.undo(f);assert.equal(f.supplyLimit,1000);assert.equal(f.requisitionPoints,5);f.requisitionPoints=0;assert.throws(()=>X.requisition(f,{key:'supply'}),/Not enough/);
});
test('equipment requisitions retain progression, lose replaced weapon upgrades and allow undo through the purchase',()=>{
  let f=force(),id=f.units[1].id;f.units[1].xp=9;f=X.modifyWeapon(f,id,{weaponKey:W.key(f.units[1].record.configured.weapons[0]),copy:1,name:'Retired rifle'},['brutal','master']);f=X.requisition(f,{key:'rearm',unitId:id});const old=structuredClone(f.units[1]),doc=M.toRosterDocument(f);doc.rosterEntries[1].configured.weapons=[{name:'New weapon',count:10,characteristics:{S:'5'}}];f=M.applyRosterDocument(f,doc);assert.equal(f.units[1].xp,9);assert.equal(f.units[1].weaponModifications.length,0);assert.equal(f.requisitions[0].state,'Completed');f=X.undo(f);assert.deepEqual(f.units[1],old);assert.equal(f.requisitions[0].state,'Awaiting catalogue change');f=X.undo(f);assert.equal(f.requisitionPoints,5);
});
test('retirement preserves service records and battle references; restoring and undo are safe',()=>{
  let f=wrap(force()),id=f.units[1].id;f=X.retire(f,id,'Veteran returns home');assert.equal(f.units.length,2);assert.equal(f.retiredUnits[0].games,1);M.validateForce(f);f=X.restore(f,id);assert.equal(f.units.find(u=>u.id===id).games,1);f=X.undo(f);assert.equal(f.retiredUnits[0].id,id);const later=M.updateUnit(f,f.units[0].id,{notes:'Unrelated later note'});assert.doesNotThrow(()=>X.undo(later));
});
test('guarded undo refuses to overwrite newer edits to the affected unit',()=>{
  let f=force(),id=f.units[0].id;f=wrap(f,[{unitId:id}]);f=M.updateUnit(f,id,{notes:'Do not erase'});assert.throws(()=>X.undo(f),/Later changes/);
});
test('Blessings calculator uses the supplied books’ exact thresholds and identifies the underdog',()=>{
  for(const [difference,count] of [[0,0],[4,0],[5,1],[9,1],[10,2],[19,2],[20,4],[100,4]]){assert.equal(X.blessings(7,7+difference).blessings,count);assert.equal(X.blessings(7+difference,7).blessings,count);}assert.equal(X.blessings(5,12).underdog,'You');assert.equal(X.blessings(12,5).underdog,'Opponent');assert.equal(X.blessings(-2,3).blessings,1);assert.throws(()=>X.blessings(1.5,4),/whole number/);
});
test('manually removing a mistaken rank Honour releases its claim; injury losses do not',()=>{
  let f=force(),id=f.units[0].id;f.units[0].xp=6;f=X.grant(f,id,award());assert.equal(f.units[0].awards[0].advancementRank,1);const corrected=X.remove(f,id,'honour');assert.deepEqual(X.pending(corrected.units[0]),[1]);const injured=wrap(f,[{unitId:id,destroyed:true,outOfActionRoll:1,injuryOutcome:'honour-loss',loseHonourId:'honour'}]);assert.deepEqual(X.pending(injured.units[0]),[]);
});
test('Renowned Heroes consumes an advancement, and invalid frozen backups are rejected',()=>{
  let f=force(),id=f.units[1].id;f.units[1].xp=6;f=X.requisition(f,{key:'renowned',unitId:id,timingConfirmed:true});assert.deepEqual(X.pending(f.units[1]),[]);assert.equal(f.requisitions[0].advancementConsumed,true);let n=wrap(X.undo(f),[{unitId:id}]);n.battles[0].snapshot.unitRecords[0].id='foreign';assert.throws(()=>M.validateForce(n),/frozen battle roster/);
});
test('core XP-ineligible units auto-pass Out of Action and record participation without gaining XP',()=>{
  const f=force(),u=f.units[2];u.keywords.push('SWARM');const n=wrap(f,[{unitId:u.id,kills:9,marked:true,destroyed:true}]);assert.equal(n.units[2].xp,0);assert.equal(n.units[2].games,1);assert.equal(n.battles[0].wrapUp[0].injury.result,'Automatically passed');assert.deepEqual(X.pending(n.units[2]),[]);
});
test('Blessings bands are present verbatim in every supplied war-zone table',()=>{
  const books=require('../data/manual-rules/wh40k10-local-crusade.json').books.filter(b=>b.pack!=='Core');for(const book of books){const text=JSON.stringify(book.sections);for(const band of ['0-4 0','5-9 1','10-19 2','20+ 4'])assert.ok(text.includes(band),book.pack+' '+band);}
});
test('bookkeeping views expose the calculator, pending claims and escaped service history',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),f=force();f.units[0].xp=6;f.units[0].history.push({name:'<script>bad</script>',at:'2026-11-26'});const window={ArcadienCrusadeBookkeeping:X,ArcadienCrusadeModel:M,ArcadienCrusadeEligibility:require('../src/domain/crusade-eligibility')};vm.runInNewContext(fs.readFileSync(require.resolve('../mobile/ui/crusade-bookkeeping-ui.js'),'utf8'),{window});const ui=window.ArcadienCrusadeBookkeepingUI.create({getForce:()=>f,datasheet:()=>'',formatRules:()=>''});assert.match(ui.toolbar(f),/Crusade Blessings calculator/);assert.match(ui.unit(f.units[0]),/1 unclaimed rank advancement/);assert.match(ui.unit(f.units[0]),/&lt;script&gt;bad/);assert.match(ui.awardOptions(f.units[0]),/House-rule override/);
});
