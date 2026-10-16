const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),loadout=require('../src/domain/loadout'),sheets=require('../src/domain/sheets'),{correctCrisisModelProfiles}=require('../src/rulesets/tau-model-profiles');
const w={};vm.runInNewContext(fs.readFileSync(require.resolve('../ui/engine-data/xenos-t-au-empire.js'),'utf8'),{window:w});
for(const pkg of w.ROSTER_ENGINE_FACTIONS["Xenos - T'au Empire"].filter(x=>/^Crisis /.test(x.name))){
 test(pkg.name+' preserves the Shas’vre statline and separates bearer effects',()=>{
  const before=JSON.stringify(pkg.definition),u=correctCrisisModelProfiles(pkg.definition),entry=loadout.createDefaultRosterEntry(u),p=loadout.getConfiguredProfiles(u,entry);
  assert.equal(JSON.stringify(pkg.definition),before);assert.deepEqual(loadout.validateLoadout(u,entry),[]);
  const ui=p.units.find(x=>/Shas[’']ui/.test(x.name)),vre=p.units.find(x=>/Shas[’']vre/.test(x.name));assert.ok(ui);assert.ok(vre);assert.equal(ui.count,2);assert.equal(vre.count,1);assert.notEqual(ui.id,vre.id);assert.deepEqual(ui.characteristics,vre.characteristics);
  const selected=loadout.buildTreeIndex(u).all.find(n=>n.kind==='model'&&/Shas[’']vre/.test(n.name));assert.equal(selected.profiles.find(x=>x.typeName==='Unit').id,vre.id);
  const changed=sheets.applyUnitEffectsToProfiles(p.units,[{name:'Shield Drone',characteristics:{Description: "Add 1 to the bearer's Wounds characteristic."},bearerProfileIds:[vre.id]}]);
  assert.equal(changed.find(x=>x.id===ui.id).characteristics.W,ui.characteristics.W);assert.equal(Number(changed.find(x=>x.id===vre.id).characteristics.W),Number(vre.characteristics.W)+1);
  assert.deepEqual(correctCrisisModelProfiles(u),u);
 });
}

test('Crisis drone limits allow two different drones but only one of each per model',()=>{
 for(const pkg of w.ROSTER_ENGINE_FACTIONS["Xenos - T'au Empire"].filter(x=>/^Crisis /.test(x.name))){
  const u=correctCrisisModelProfiles(pkg.definition),entry=loadout.createDefaultRosterEntry(u),index=loadout.buildTreeIndex(u);
  for(const model of index.all.filter(x=>x.kind==='model')){
   const count=entry.selections[model.id];if(!count)continue;
   const descendants=[];function walk(n){descendants.push(n);for(const c of n.children||[])walk(c)}walk(model);
   const drones=['Gun Drone','Shield Drone','Marker Drone'].map(name=>descendants.find(x=>x.name===name));assert.ok(drones.every(Boolean));
   for(const drone of drones){
    const option=loadout.getOptionStates(u,entry).find(x=>x.id===drone.id);assert.equal(option.maximum,count,pkg.name+'/'+model.name+'/'+drone.name);
    const invalid={...entry,selections:{...entry.selections,[drone.id]:count+1}};assert.ok(loadout.validateLoadout(u,invalid).length,'duplicate drones must be rejected');
   }
   for(const pair of [[0,1],[0,2],[1,2]]){const selections={...entry.selections};for(const d of drones)selections[d.id]=0;for(const i of pair)selections[drones[i].id]=count;
    assert.deepEqual(loadout.validateLoadout(u,loadout.normalizeRosterEntry(u,{...entry,selections})),[],pkg.name+' mixed pair');
   }
   const all={...entry,selections:{...entry.selections}};for(const d of drones)all.selections[d.id]=count;assert.ok(loadout.validateLoadout(u,all).length,'three drones per model must be rejected');
  }
 }
});

test('Strike Team Shas’ui exchanges rifle for carbine without changing the other nine models',()=>{
 const original=w.ROSTER_ENGINE_FACTIONS["Xenos - T'au Empire"].find(x=>x.name==='Strike Team').definition;
 const u=correctCrisisModelProfiles(original),entry=loadout.createDefaultRosterEntry(u),nodes=loadout.buildTreeIndex(u).all;
 const group=nodes.find(n=>n.name==='Primary weapon'),rifle=group.children.find(n=>n.name==='Pulse rifle'),carbine=group.children.find(n=>n.name==='Pulse carbine');
 assert.deepEqual(loadout.validateLoadout(u,entry),[]);assert.equal(entry.selections[rifle.id],1);
 const changed=loadout.setSelection(u,entry,carbine.id,1);assert.equal(changed.selections[rifle.id]||0,0);assert.deepEqual(loadout.validateLoadout(u,changed),[]);
 const weapons=loadout.getConfiguredProfiles(u,changed).weapons;const before=loadout.getConfiguredProfiles(u,entry).weapons;const count=(list,name)=>list.filter(x=>x.name===name).reduce((n,x)=>n+x.count,0);assert.equal(count(weapons,'Pulse carbine'),count(before,'Pulse carbine')+1);assert.equal(count(weapons,'Pulse rifle'),count(before,'Pulse rifle')-1);
 const returned=loadout.setSelection(u,changed,rifle.id,1);assert.equal(returned.selections[carbine.id]||0,0);assert.deepEqual(loadout.validateLoadout(u,returned),[]);
 assert.deepEqual(correctCrisisModelProfiles(u),u);
});
for(const name of ['Strike Team','Breacher Team'])test(name+' allows any two unique drone types',()=>{
 const original=w.ROSTER_ENGINE_FACTIONS["Xenos - T'au Empire"].find(x=>x.name===name).definition,u=correctCrisisModelProfiles(original),entry=loadout.createDefaultRosterEntry(u),nodes=loadout.buildTreeIndex(u).all;
 const drones=['Gun Drone','Marker Drone','Shield Drone','Guardian Drone'].map(name=>nodes.find(n=>n.kind==='upgrade'&&n.name===name));
 for(const d of drones){assert.equal(loadout.getOptionStates(u,entry).find(x=>x.id===d.id).maximum,1);assert.ok(loadout.validateLoadout(u,{...entry,selections:{...entry.selections,[d.id]:2}}).length);}
 for(let a=0;a<4;a++)for(let b=a+1;b<4;b++){
  let e=loadout.setSelection(u,entry,drones[a].id,1);e=loadout.setSelection(u,e,drones[b].id,1);assert.deepEqual(loadout.validateLoadout(u,e),[],name+' pair '+a+b);
 }
 const all={...entry,selections:{...entry.selections}};for(const d of drones)all.selections[d.id]=1;assert.ok(loadout.validateLoadout(u,all).length);
});

test('Pathfinders take two distinct standard drones plus at most one specialist drone',()=>{
 const u=correctCrisisModelProfiles(w.ROSTER_ENGINE_FACTIONS["Xenos - T'au Empire"].find(x=>x.name==='Pathfinder Team').definition),entry=loadout.createDefaultRosterEntry(u),nodes=loadout.buildTreeIndex(u).all;
 const drones=['Gun Drone','Marker Drone','Shield Drone'].map(name=>nodes.find(n=>n.name===name));
 for(const d of drones){assert.equal(loadout.getOptionStates(u,entry).find(x=>x.id===d.id).maximum,1);assert.ok(loadout.validateLoadout(u,{...entry,selections:{...entry.selections,[d.id]:2}}).length);}
 for(let a=0;a<3;a++)for(let b=a+1;b<3;b++){
  let e=loadout.setSelection(u,entry,drones[a].id,1);e=loadout.setSelection(u,e,drones[b].id,1);assert.deepEqual(loadout.validateLoadout(u,e),[]);
  const specialist=nodes.find(n=>n.name==='Pathfinder Drone');
  for(const choice of specialist.children){const equipped=loadout.setSelection(u,e,choice.id,1);assert.deepEqual(loadout.validateLoadout(u,equipped),[],choice.name);}
 }
 const invalid={...entry,selections:{...entry.selections}};for(const d of drones)invalid.selections[d.id]=1;assert.ok(loadout.validateLoadout(u,invalid).length);
 const specialist=nodes.find(n=>n.name==='Pathfinder Drone');assert.equal(specialist.constraints.find(c=>c.type==='max').value,1);
 const tooMany={...entry,selections:{...entry.selections,[specialist.children[0].id]:1,[specialist.children[1].id]:1}};assert.ok(loadout.validateLoadout(u,tooMany).length);
});

test('Shield Drone stat-table effects leave nine Strike/Breacher Fire Warriors at one wound',()=>{
 const source=fs.readFileSync(require.resolve('../mobile/ui/engine-app.js'),'utf8');
 function fn(name){const start=source.indexOf('function '+name+'('),end=source.indexOf('\nfunction ',start+10);return source.slice(start,end);}
 const ctx={escapeHtml:String,renderCharacteristicValue:(p,k,v)=>String(v??''),rosterSheets:sheets};
 vm.runInNewContext(fn('configuredEffectSources')+'\n'+fn('renderUnitProfiles')+'\nthis.effects=configuredEffectSources;this.render=renderUnitProfiles;',ctx);
 for(const name of ['Strike Team','Breacher Team']){
  const u=correctCrisisModelProfiles(w.ROSTER_ENGINE_FACTIONS["Xenos - T'au Empire"].find(x=>x.name===name).definition),nodes=loadout.buildTreeIndex(u).all;
  const drone=nodes.find(n=>n.name==='Shield Drone'),leader=nodes.find(n=>n.kind==='model'&&/Shas[’']ui/.test(n.name));
  assert.deepEqual(drone.profiles[0].bearerProfileIds,leader.profiles.filter(p=>p.typeName==='Unit').map(p=>p.id));
  for(const enabled of [true,false]){
   const entry=loadout.setSelection(u,loadout.createDefaultRosterEntry(u),drone.id,Number(enabled)),configured=loadout.getConfiguredProfiles(u,entry);
   const rows=sheets.applyUnitEffectsToProfiles(configured.units,ctx.effects(configured));
   assert.ok(rows.filter(p=>!/Shas[’']ui/.test(p.name)).every(p=>p.characteristics.W==='1'));
   assert.equal(rows.filter(p=>!/Shas[’']ui/.test(p.name)).reduce((n,p)=>n+p.count,0),9);
   const shasui=rows.find(p=>/Shas[’']ui/.test(p.name));assert.equal(shasui.characteristics.W,enabled?'2':'1');assert.equal(shasui.count,1);
   const html=ctx.render(rows);assert.ok(html.includes(shasui.name));assert.equal((html.match(/<tr>/g)||[]).length,rows.length+1);
  }
 }
});
