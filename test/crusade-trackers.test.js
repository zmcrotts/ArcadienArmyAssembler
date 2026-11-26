"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../src/domain/crusade'),T=require('../src/domain/crusade-trackers');
function force(faction='Tyranids',types=['Hive Tyrant']){return M.createForce({faction,pointsLimit:1000,rosterEntries:types.map((name,i)=>({instanceId:'u'+i,selectionKey:'selection:'+i,name,points:100,keywords:i?[]:['CHARACTER'],roles:{character:!i},configured:{units:[{name,characteristics:{T:'4'}}],weapons:[]}}))});}
const defaults=p=>Object.fromEntries(p.fields.map(f=>[f.key,f.initial]));
test('every supplied bespoke faction and Marine supplement has persistent, validated panels',()=>{
  for(const name of ['Adepta Sororitas','Adeptus Custodes','Adeptus Mechanicus','Aeldari','Astra Militarum','Chaos Knights','Chaos Space Marines','Death Guard','Drukhari','Emperor’s Children','Genestealer Cults','Grey Knights','Imperial Agents','Imperial Knights','Leagues of Votann','Necrons','Orks','Space Marines','Thousand Sons','Tyranids','T’au Empire','World Eaters','Black Templars','Dark Angels','Blood Angels','Space Wolves','Ultramarines']){
    let f=force(name);const schema=T.schema(f);assert.ok(schema.panels.length,name);
    for(const p of schema.panels.filter(p=>p.fields.length)){
      const values=defaults(p);if(p.id==='logistics')Object.assign(values,{lex:1,materiel:1,tithe:1,morale:1});
      f=T.saveRecord(f,p.id,{name:p.name,values,notes:'A retained note'});
    }
    assert.deepEqual(M.validateForce(JSON.parse(JSON.stringify(f))),f,name);
    assert.deepEqual(M.applyRosterDocument(f,M.toRosterDocument(f)).factionProgression,f.factionProgression,name);
  }
});
test('old forces remain byte-for-byte unchanged by viewing tracker schemas',()=>{
  const f=force(),before=JSON.stringify(f);T.state(f);T.schema(f);T.records(f,'worlds');assert.equal(JSON.stringify(f),before);assert.equal(f.factionProgression,undefined);
  assert.equal(T.schema(force('Chaos Daemons')).panels.length,0);
});
test('prey world generation uses cumulative biomass and stage-local battles for every world type',()=>{
  assert.deepEqual(T.generateWorld('Industrial World',()=>0),{type:'Industrial World',thresholds:[{biomass:3,battles:2},{biomass:4,battles:4},{biomass:7,battles:5}]});
  assert.deepEqual(T.generateWorld('Rural World',()=>0).thresholds,[{biomass:3,battles:2},{biomass:5,battles:1},{biomass:7,battles:1}]);
  assert.deepEqual(T.generateWorld('Hive World',()=>0).thresholds,[{biomass:4,battles:1},{biomass:6,battles:1},{biomass:7,battles:1}]);
  for(const type of T.WORLD_TYPES)for(const rng of [()=>0,()=>.999]){const g=T.generateWorld(type,rng);assert.ok(g.thresholds[2].biomass>g.thresholds[1].biomass);}
});
function world(){let f=T.createWorld(force(),'Prey',T.generateWorld('Industrial World',()=>0));return {f,id:T.records(f,'worlds')[0].id};}
test('Tyranid advancement checks both requirements, keeps biomass, and records reversible spending',()=>{
  let {f,id}=world();assert.throws(()=>T.createWorld(f,'Second',T.generateWorld('Hive World')),/active world/);assert.throws(()=>T.worldAction(f,id,'advance'),/Both/);
  f=T.worldAction(f,id,'adjust',{biomass:12,battles:2});f=T.worldAction(f,id,'advance');assert.equal(T.records(f,'worlds')[0].values.biomass,12);assert.equal(T.records(f,'worlds')[0].values.battles,0);
  for(const battles of [4,5]){f=T.worldAction(f,id,'adjust',{biomass:12,battles});f=T.worldAction(f,id,'advance');}
  const before=JSON.stringify(f);const grown=T.worldAction(f,id,'grow');assert.equal(grown.supplyLimit,1100);assert.equal(T.records(grown,'worlds')[0].values.biomass,10);assert.equal(JSON.stringify(f),before);
  const undone=T.undo(grown);assert.equal(undone.supplyLimit,1000);assert.equal(T.records(undone,'worlds')[0].values.biomass,12);
  f=T.worldAction(f,id,'enhance',{unitId:f.units[0].id});assert.equal(f.units[0].xp,5);assert.throws(()=>T.worldAction(f,id,'enhance',{unitId:f.units[0].id}),/already enhanced/);
  assert.throws(()=>T.createWorld(f,'New',T.generateWorld('Hive World')),/Finish Biogenesis/);f=T.worldAction(f,id,'close');f=T.createWorld(f,'New',T.generateWorld('Hive World'));assert.equal(T.records(f,'worlds').length,2);assert.equal(T.records(f,'worlds')[1].values.biomass,0);
});
test('undo does not overwrite later unit edits or unrelated unit progression',()=>{
  let f=force('Adepta Sororitas',['Canoness','Battle Sisters Squad']);const p=T.schema(f).panels[0];f=T.saveRecord(f,p.id,{name:'Saint',values:{...defaults(p),unitId:f.units[0].id,saint:10}});const id=T.records(f,p.id)[0].id;
  f=T.saintAction(f,id,'claim',{description:'Actual reward reference'});assert.equal(f.units[0].awards.length,1);const changed=M.updateUnit(f,f.units[0].id,{xp:9});assert.throws(()=>T.undo(changed),/changed after/);
  const other=M.updateUnit(f,f.units[1].id,{xp:8});const undone=T.undo(other);assert.equal(undone.units.find(u=>u.unitType==='Battle Sisters Squad').xp,8);assert.equal(undone.units.find(u=>u.unitType==='Canoness').awards.length,0);
});
test('Saint completion is unique, resets points and can begin another Trial',()=>{
  let f=force('Adepta Sororitas',['Canoness']);const p=T.schema(f).panels[0];f=T.saveRecord(f,p.id,{name:'Saint',values:{...defaults(p),unitId:f.units[0].id,saint:10}});const id=T.records(f,p.id)[0].id;
  f=T.saintAction(f,id,'claim',{description:'Boundless Faith'});assert.equal(T.records(f,p.id)[0].values.saint,0);assert.throws(()=>T.saintAction(f,id,'claim'),/uncompleted/);
  f=T.saintAction(f,id,'trial',{trial:'Purity'});assert.equal(T.records(f,p.id)[0].values.trial,'Purity');f=T.saintAction(f,id,'martyr',{roll:6});assert.equal(T.records(f,p.id)[0].lastTest.martyred,true);
});
test('five Saintly Rewards replace Saint Potentia with Living Saint',()=>{
  let f=force('Adepta Sororitas'),p=T.schema(f).panels[0];f=T.saveRecord(f,p.id,{name:'Saint',values:{...defaults(p),unitId:f.units[0].id}});const id=T.records(f,p.id)[0].id;
  for(const trial of T.TRIALS){const r=T.records(f,p.id)[0];f=T.saveRecord(f,p.id,{...r,values:{...r.values,trial,saint:10}});f=T.saintAction(f,id,'claim');}
  assert.ok(f.units[0].keywords.includes('LIVING SAINT'));assert.ok(!f.units[0].keywords.includes('SAINT POTENTIA'));assert.equal(f.units[0].awards.length,5);M.validateForce(f);
});
test('redemption uses a chosen configured replacement, spends RP and retains the retired record',()=>{
  let f=force('Adepta Sororitas',['Repentia Squad','Paragon Warsuits','Seraphim Squad']);const p=T.schema(f).panels.find(p=>p.id==='redemption');f.units[0].awards=[{id:'scar',kind:'scar',name:'Scar',description:'Text'}];f.units[0].name='Named penitents';
  f=T.saveRecord(f,p.id,{name:'Redemption',values:{unitId:f.units[0].id,points:3}});const id=T.records(f,p.id)[0].id,sourceId=f.units[0].id,replacementId=f.units[1].id;
  const redeemed=T.redeem(f,id,replacementId);assert.equal(redeemed.requisitionPoints,4);assert.equal(redeemed.units.length,2);assert.equal(redeemed.retiredUnits[0].id,sourceId);assert.equal(redeemed.units.find(u=>u.id===replacementId).unitType,'Paragon Warsuits');assert.equal(redeemed.units.find(u=>u.id===replacementId).name,'Named penitents');assert.deepEqual(redeemed.units.find(u=>u.id===replacementId).awards,f.units[0].awards);M.validateForce(redeemed);
  const restored=T.undo(redeemed);assert.equal(restored.units.length,3);assert.equal(restored.requisitionPoints,5);assert.equal(restored.retiredUnits.length,0);
  const oversized=structuredClone(f);oversized.supplyLimit=100;assert.throws(()=>T.redeem(oversized,id,replacementId),/Supply Limit/);
});
test('T’au system generation preserves planet types, temperament effects and a single Core World',()=>{
  for(const temperament of T.TEMPERAMENTS){const g=T.generateSystem(6,temperament,()=>0);assert.equal(g.planets.length,6);assert.equal(g.planets.filter(p=>p.core).length,1);assert.equal(g.planets[0].type,'Mining World');assert.equal(g.planets[0].diplomat,temperament==='Ideologues'?4:temperament==='Corrupt And Decadent'?5:3);assert.equal(g.planets[0].military,temperament==='Warlike'?5:temperament==='Dictatorship'?6:4);}
  assert.throws(()=>T.generateSystem(5,'Warlike'),/4, 6 or 8/);
});
test('takeovers require an unused recorded victory and gate the Core World',()=>{
  let f=force('T’au Empire');f=T.createSystem(f,'System',T.generateSystem(4,'Trade Contacts',()=>0));const r=T.records(f,'systems')[0],id=r.id,core=r.values.planets[0].id,planet=r.values.planets[1].id;
  f=T.systemAction(f,id,'resources',{diplomat:30,military:30});assert.throws(()=>T.systemAction(f,id,'takeover',{planetId:planet,method:'Diplomatic'}),/Trade Contacts/);f=T.systemAction(f,id,'trade',{planetId:planet});assert.equal(T.records(f,'systems')[0].values.planets[1].diplomat,2);
  f.battles=[{id:'victory',date:'2026-11-25',result:'Victory',unitIds:[f.units[0].id]}];assert.throws(()=>T.systemAction(f,id,'takeover',{planetId:core,battleId:'victory',method:'Diplomatic'}),/cannot be taken/);
  f=T.systemAction(f,id,'takeover',{planetId:planet,battleId:'victory',method:'Military',roll:2});assert.equal(T.records(f,'systems')[0].values.planets[1].razed,true);assert.equal(T.records(f,'systems')[0].values.military,26);
  assert.throws(()=>T.systemAction(f,id,'takeover',{planetId:r.values.planets[2].id,battleId:'victory',method:'Diplomatic'}),/not already used/);assert.throws(()=>T.systemAction(f,id,'close'),/Assimilate all/);M.validateForce(f);
});
test('invalid counters, foreign panels and broken tracker imports are rejected atomically',()=>{
  const f=force('World Eaters'),p=T.schema(f).panels[0],before=JSON.stringify(f);assert.throws(()=>T.saveRecord(f,'saints',{name:'Invalid',values:{}}),/dedicated/);assert.throws(()=>T.saveRecord(f,p.id,{name:'Invalid',values:{...defaults(p),battleSkulls:6}}),/0 to 5/);assert.equal(JSON.stringify(f),before);
  const good=T.saveRecord(f,p.id,{name:'Skulls',values:defaults(p)}),broken=structuredClone(good);broken.factionProgression.panels.skulls[0].values.skulls=-1;assert.throws(()=>M.validateForce(broken),/0 to/);
  const necron=force('Necrons'),np=T.schema(necron).panels[0],values=defaults(np);Object.keys(values).slice(0,4).forEach(k=>values[k]=true);assert.throws(()=>T.saveRecord(necron,np.id,{name:'Tomb',values}),/three Awakening/);
});
test('generated Tour, Endeavour and plague setup follows faction requirements',()=>{
  const tour=T.generateValues(force('Astra Militarum'),'tours',()=>0);assert.equal(tour.battles,5);assert.equal(tour.victories,3);
  const end=T.generateValues(force('Adeptus Custodes'),'endeavours',()=>0);assert.equal(new Set([end.first,end.second,end.third]).size,3);assert.equal(end.battles,0);
  const plague=T.generateValues(force('Death Guard'),'plagues',()=>.999);assert.equal(plague.suitability,18);assert.equal(plague.population,6);assert.equal(plague.reproduction,1);
  assert.equal(T.factionKey(force('Xenos - Craftworlds')),'aeldari');assert.equal(T.factionKey(force('Chaos - Emperor’s Children')),'emperorsChildren');
});
test('martyr retirement preserves the character and rewards only selected witnesses',()=>{
  let f=force('Adepta Sororitas',['Canoness','Battle Sisters Squad','Seraphim Squad','Palatine']),p=T.schema(f).panels[0];f.units[3].keywords.push('CHARACTER');f=T.saveRecord(f,p.id,{name:'Saint',values:{...defaults(p),unitId:f.units[0].id,saint:10}});let id=T.records(f,p.id)[0].id;
  f=T.saintAction(f,id,'claim');f=T.saintAction(f,id,'martyr',{roll:6});const sourceId=f.units[0].id,witnessId=f.units[1].id;
  f=T.retireSaint(f,id,[witnessId]);assert.equal(f.units.find(u=>u.id===witnessId).xp,1);assert.equal(f.units.find(u=>u.unitType==='Seraphim Squad').xp,0);assert.equal(f.retiredUnits[0].id,sourceId);M.validateForce(f);
  f=T.saveRecord(f,p.id,{name:'Successor',values:{...defaults(p),unitId:f.units.find(u=>u.unitType==='Palatine').id}});assert.equal(T.records(f,p.id).length,2);
});
test('battle application to a prey world is one-time and reversible',()=>{
  let {f,id}=world();f.battles=[{id:'a',date:'2026-11-25',result:'Victory',unitIds:[f.units[0].id]}];f=T.applyWorldBattle(f,id,'a',2);assert.equal(T.records(f,'worlds')[0].values.biomass,3);assert.equal(T.records(f,'worlds')[0].values.battles,1);assert.throws(()=>T.applyWorldBattle(f,id,'a'),/already applied/);f=T.undo(f);assert.equal(T.records(f,'worlds')[0].values.biomass,0);assert.equal(f.battles.length,1);
});
test('supply lines deduct the chosen planet cost and retain their effect',()=>{
  let f=force('T’au Empire'),generated=T.generateSystem(4,'Warlike',()=>0);generated.planets.forEach(p=>p.method='Diplomatic');generated.planets[0].type='Military Base';f=T.createSystem(f,'Assimilated system',generated);const r=T.records(f,'systems')[0];f=T.supplyLines(f,r.id,r.values.planets[0].id);assert.equal(f.requisitionPoints,4);assert.equal(f.supplyLimit,1400);assert.equal(T.records(f,'supplylines').length,1);assert.throws(()=>T.supplyLines(f,r.id,r.values.planets[1].id),/once/);M.validateForce(f);f=T.undo(f);assert.equal(f.supplyLimit,1000);assert.equal(T.records(f,'supplylines').length,0);
});
test('World Eater offering records the correct judgement and spends both skull pools',()=>{
  let f=force('World Eaters'),p=T.schema(f).panels[0];f=T.saveRecord(f,p.id,{name:'Harvest',values:{...defaults(p),unitId:f.units[0].id,skulls:9,legendary:1}});const r=T.records(f,'skulls')[0];f=T.skullOffering(f,r.id,4);const v=T.records(f,'skulls')[0].values;assert.equal(v.skulls,0);assert.equal(v.legendary,0);assert.match(v.judgement,/4 \+ 4 = 8/);assert.match(v.judgement,/Mighty Offering/);f=T.undo(f);assert.equal(T.records(f,'skulls')[0].values.skulls,9);
});
test('battle snapshots lock faction progression without copying the mutable action log',()=>{
  let {f,id}=world();f=T.worldAction(f,id,'adjust',{biomass:2,battles:1});const game=M.battleDocument(f,[f.units[0].id]);assert.equal(game.crusade.factionProgression.panels.worlds[0].values.biomass,2);assert.equal(game.crusade.factionProgression.history,undefined);f=T.worldAction(f,id,'adjust',{biomass:9,battles:2});assert.equal(game.crusade.factionProgression.panels.worlds[0].values.biomass,2);
});
test('all faction panels render accessible edit controls and escape saved content',()=>{
  const vm=require('node:vm'),fs=require('node:fs');const sandbox={window:{ArcadienCrusadeTrackers:T}};vm.runInNewContext(fs.readFileSync(require.resolve('../mobile/ui/crusade-trackers-ui.js'),'utf8'),sandbox);
  const UI=sandbox.window.ArcadienCrusadeTrackerUI;
  for(const definition of Object.values(T.SCHEMAS).filter(s=>s.panels.length)){
    let f=force(definition.name);const p=T.schema(f).panels.find(p=>p.fields.length);if(p){const values=defaults(p);if(p.id==='logistics')Object.assign(values,{lex:1,materiel:1,tithe:1,morale:1});f=T.saveRecord(f,p.id,{name:'<script>unsafe</script>',values});}
    const ui=UI.create({formatRules:()=>'',getForce:()=>f});const html=ui.render(f);assert.match(html,/Faction tracker panels/);assert.ok(!html.includes('<script>unsafe</script>'));assert.ok(!html.includes('undefined'));
  }
});
test('rolling plague setup retains the user’s world name, notes and existing pathogen attributes',async()=>{
  const vm=require('node:vm'),fs=require('node:fs'),sandbox={window:{ArcadienCrusadeTrackers:T}};vm.runInNewContext(fs.readFileSync(require.resolve('../mobile/ui/crusade-trackers-ui.js'),'utf8'),sandbox);
  const fields={world:{value:'Mordant III'},notes:{value:'Keep this narrative'},reproduction:{value:4}},random={},notice={};
  const ui=sandbox.window.ArcadienCrusadeTrackerUI.create({getForce:()=>force('Death Guard'),modal:()=>({querySelector:selector=>{if(selector==='[data-ct-roll-fields]')return random;if(selector==='[data-ct-rolled]')return notice;const name=/name="([^"]+)"/.exec(selector)?.[1];return fields[name]||=( {value:''} );}})});
  await ui.handle({dataset:{ctAction:'new',panel:'plagues'}});random.onclick();assert.equal(fields.world.value,'Mordant III');assert.equal(fields.notes.value,'Keep this narrative');assert.equal(fields.reproduction.value,4);assert.ok(fields.suitability.value>=3);assert.match(notice.textContent,/retained/);
});
test('Nurgle Blessings are six unique permanent unlocks rather than repeatable records',()=>{
  let f=force('Death Guard');const before=JSON.stringify(f);
  assert.equal(T.blessingClaims(f).length,6);assert.ok(T.blessingClaims(f).every(b=>!b.claims.length));assert.equal(JSON.stringify(f),before);
  for(const b of T.NURGLE_BLESSINGS){f=T.claimBlessing(f,b.id,'The completed plague','Award note');assert.throws(()=>T.claimBlessing(f,b.id),/already been claimed/);}
  assert.equal(T.blessingClaims(f).filter(b=>b.claims.length).length,6);assert.equal(f.requisitionPoints,5);assert.equal(T.records(f,'blessings')[0].origin,'The completed plague');M.validateForce(f);
  assert.throws(()=>T.claimBlessing(force('Orks'),T.NURGLE_BLESSINGS[0].id),/Death Guard/);
});
test('legacy Blessings are recognized by name and correcting a claim preserves other entries',()=>{
  let f=force('Death Guard');f=T.saveRecord(f,'blessings',{name:'Endless Harvest',values:{effect:'Previously saved rules'}});f=T.saveRecord(f,'blessings',{name:'Personal house rule',values:{effect:'Keep this entry'},notes:'An older custom entry'});
  assert.equal(T.blessingClaims(f).find(b=>b.id==='endless-harvest').claims.length,1);assert.throws(()=>T.claimBlessing(f,'endless-harvest'),/already been claimed/);
  f=T.removeBlessing(f,'endless-harvest');assert.equal(T.records(f,'blessings').length,1);assert.equal(T.records(f,'blessings')[0].name,'Personal house rule');f=T.undo(f);assert.equal(T.records(f,'blessings').length,2);assert.equal(T.blessingClaims(f).find(b=>b.id==='endless-harvest').claims.length,1);
});
test('Death Guard rewards render as a fixed collection and properties live within the Pathogen panel',async()=>{
  const vm=require('node:vm'),fs=require('node:fs'),sandbox={window:{ArcadienCrusadeTrackers:T}};vm.runInNewContext(fs.readFileSync(require.resolve('../mobile/ui/crusade-trackers-ui.js'),'utf8'),sandbox);
  let f=force('Death Guard');const ui=sandbox.window.ArcadienCrusadeTrackerUI.create({getForce:()=>f,refresh:()=>{},formatRules:()=>''});
  await ui.handle({dataset:{ctAction:'panel',panel:'blessings'}});let html=ui.render(f);
  for(const b of T.NURGLE_BLESSINGS)assert.ok(html.includes(b.name));assert.equal((html.match(/data-ct-action="claim-blessing"/g)||[]).length,6);assert.ok(!html.includes('New tracker'));assert.ok(!html.includes('No tracker started'));
  f=T.claimBlessing(f,'eye-of-nurgle');html=ui.render(f);assert.equal((html.match(/data-ct-action="claim-blessing"/g)||[]).length,5);assert.match(html,/Claimed · permanent/);assert.match(html,/Award details/);
  await ui.handle({dataset:{ctAction:'panel',panel:'pathogen'}});html=ui.render(f);assert.match(html,/Properties &amp; drawbacks/);assert.match(html,/Prepare pathogen/);assert.ok(!html.includes('Pathogen Properties <small>'));
});
