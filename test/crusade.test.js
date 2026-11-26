"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const M = require("../src/domain/crusade");
const { extractCrusadeData } = require("../scripts/build-crusade-data");
const document = {
  name: "Wardens", faction: "Space Marines", subfaction: "Ultramarines", pointsLimit: 1000,
  rosterEntries: [{ instanceId: "source-a", selectionKey:"captain", name: "Captain", points: 80, keywords:["CHARACTER"],roles:{character:true},entry:{instanceId:"source-a",selections:{rifle:1}} },
    { instanceId: "source-b", selectionKey:"intercessors", name: "Intercessor Squad", points: 80, roles:{battleline:true},keywords:["BATTLELINE"] }],
  rosterDisplay:{unitNicknames:{"source-a":"Aurelian"}},
  armyState:{warlordInstanceId:"source-a",enhancements:[{enhancementId:"enhancement-a",bearerInstanceId:"source-a"}],attachments:[{leaderInstanceId:"source-a",targetInstanceId:"source-b"}]},
  enhancements: [{ enhancementId:"enhancement-a",bearerInstanceId:"source-a",name:"Veteran",points:15,description:"Example" }]
};
const force = () => M.createForce(document);

function battleForce() {
  const saved=force();
  for(const u of saved.units)u.record.configured={units:[{name:u.unitType,characteristics:{M:'6"',T:"4",SV:"3+",W:"2",LD:"6+",OC:"2"}}],weapons:[]};
  saved.agendas=[{id:"agenda",name:"A personal objective",source:"Custom",description:"Track a unit's progress."}];
  return saved;
}

test("muster copies only participating units and their references without changing the OoB",()=>{
  const saved=battleForce(),captain=saved.units[0],troopers=saved.units[1],before=JSON.stringify(saved);
  const game=M.battleDocument(saved,[captain.id],saved.agendas,{pointsLimit:500});
  assert.deepEqual(game.rosterEntries.map(item=>item.instanceId),[captain.id]);
  assert.equal(game.enhancements.length,1);
  assert.equal(game.groupedPresentation[0].title,"Aurelian");
  assert.deepEqual(game.armyState.attachments,[]);
  assert.deepEqual(game.crusade.unitIds,[captain.id]);
  assert.equal(game.crusade.units[0].name,"Aurelian");
  assert.equal(game.crusade.agendas[0].name,"A personal objective");
  const other=M.battleDocument(saved,[troopers.id],[]);
  assert.equal(other.enhancements.length,0);assert.equal(other.armyState.warlordInstanceId,null);
  assert.deepEqual(other.rosterDisplay.unitNicknames,{});
  game.crusade.agendas[0].description="Changed in game";
  game.rosterEntries[0].configured.units[0].characteristics.T="9";
  assert.equal(JSON.stringify(saved),before);
});

test("muster rejects empty, unknown, duplicate, oversized or missing-profile selections",()=>{
  const saved=battleForce(),id=saved.units[0].id;
  for(const ids of [[],["missing"],[id,id]])assert.throws(()=>M.battleDocument(saved,ids),/Select at least/);
  assert.throws(()=>M.battleDocument(saved,[id],[],{pointsLimit:90}),/exceeds/);
  assert.throws(()=>M.battleDocument(saved,[id],[saved.agendas[0],saved.agendas[0]]),/distinct agendas/);
  saved.units[0].record.configured=null;
  assert.throws(()=>M.battleDocument(saved,[id]),/Refresh missing unit stats/);
});

test("agenda libraries survive backups and reject corrupt or duplicate entries",()=>{
  const saved=battleForce();assert.deepEqual(M.validateForce(JSON.parse(JSON.stringify(saved))).agendas,saved.agendas);
  for(const agendas of [[{id:"x",name:"",description:"",source:"Custom"}],[null],[saved.agendas[0],saved.agendas[0]]])assert.throws(()=>M.validateForce({...saved,agendas}),/agenda library/);
});

test("Orders of Battle copy independent units, equipment, and enhancement bearers", () => {
  const a = force(), b = force();
  assert.notEqual(a.id,b.id);
  assert.notEqual(a.units[0].id,b.units[0].id);
  assert.equal(a.units[0].points,95);
  assert.equal(a.units[1].enhancements.length,0);
  a.units[0].record.entry.selections.rifle=2;
  assert.equal(document.rosterEntries[0].entry.selections.rifle,1);
  assert.equal(a.units[0].xp,0);
  assert.equal(a.faction,"Ultramarines");
  assert.equal(M.summary(a).points,175);
});
test("ranks and radial progress handle exact boundaries", () => {
  for (const [xp,name,nextAt] of [[0,"Battle-Ready",6],[5,"Battle-Ready",6],[6,"Blooded",16],[15,"Blooded",16],[16,"Battle-Hardened",31],[31,"Heroic",51],[51,"Legendary",null]]) {
    assert.equal(M.rankFor(xp).name,name); assert.equal(M.rankFor(xp).nextAt,nextAt);
  }
  assert.equal(M.rankFor(11).progress,.5);
  assert.equal(M.rankFor(999).progress,1);
  assert.throws(()=>M.rankFor(-1)); assert.throws(()=>M.rankFor(1.5));
});
test("whole-list import preserves nicknames and remaps army references to independent OoB IDs", () => {
  const a=force(), doc=M.toRosterDocument(a);
  assert.equal(a.units[0].name,"Aurelian");
  assert.equal(a.units[0].unitType,"Captain");
  assert.equal(doc.rosterEntries[0].instanceId,a.units[0].id);
  assert.equal(doc.rosterEntries[0].entry.instanceId,a.units[0].id);
  assert.equal(doc.rosterDisplay.unitNicknames[a.units[0].id],"Aurelian");
  assert.equal(doc.armyState.warlordInstanceId,a.units[0].id);
  assert.equal(doc.armyState.enhancements[0].bearerInstanceId,a.units[0].id);
  assert.equal(doc.armyState.attachments[0].targetInstanceId,a.units[1].id);
  assert.equal(doc.enhancements[0].bearerInstanceId,a.units[0].id);
  assert.equal(document.armyState.warlordInstanceId,"source-a");
});
test("catalogue round trips retain progression while updating equipment, points and names", () => {
  let a=force();
  a=M.updateUnit(a,a.units[0].id,{xp:24,games:3,wins:2,survived:3,kills:5});
  a=M.assignAward(a,a.units[0].id,{id:"trait-a",name:"Veteran",kind:"honour",description:"Rules"});
  const doc=M.toRosterDocument(a);
  doc.rosterEntries[0].entry.selections.rifle=2;
  doc.rosterEntries[0].points=90;
  doc.rosterDisplay.unitNicknames[a.units[0].id]="The Ash Warden";
  const b=M.applyRosterDocument(a,doc);
  assert.equal(b.units[0].name,"The Ash Warden");
  assert.equal(b.units[0].unitType,"Captain");
  assert.equal(b.units[0].xp,24); assert.equal(b.units[0].wins,2);
  assert.deepEqual(b.units[0].awards,a.units[0].awards);
  assert.deepEqual(b.units[0].history.slice(0,a.units[0].history.length),a.units[0].history);
  assert.equal(b.units[0].history.at(-1).category,"equipment");
  assert.equal(b.units[0].points,105);
  assert.equal(b.units[0].record.entry.selections.rifle,2);
  assert.deepEqual(M.applyRosterDocument(b,M.toRosterDocument(b)).units,b.units);
});
test("new catalogue units retain stable IDs across successive autosaves", () => {
  const a=force(), doc=M.toRosterDocument(a);
  doc.rosterEntries.push({instanceId:"added-from-catalogue",selectionKey:"intercessors",name:"Intercessor Squad",points:80,roles:{},keywords:[],entry:{instanceId:"added-from-catalogue"}});
  const b=M.applyRosterDocument(a,doc), c=M.applyRosterDocument(b,doc);
  assert.equal(c.units.length,3);
  assert.equal(c.units[2].id,"added-from-catalogue");
  assert.equal(c.units[2].xp,0);
  assert.throws(()=>M.applyRosterDocument(c,{...doc,rosterEntries:[doc.rosterEntries[0],doc.rosterEntries[0]]}),/duplicate/);
});
test("removing a unit from the builder retains its history and battle references as retired", () => {
  const a=force(); a.battles=[{id:"game-1",date:"2026-11-24",result:"Victory",unitIds:[a.units[0].id]}];
  const doc=M.toRosterDocument(a); doc.rosterEntries.shift();
  const b=M.applyRosterDocument(a,doc);
  assert.equal(b.units.length,1); assert.equal(b.retiredUnits[0].id,a.units[0].id);
  assert.deepEqual(b.battles,a.battles);
  assert.equal(M.applyRosterDocument(b,M.toRosterDocument(b)).retiredUnits.length,1);
  M.validateForce(b);
});
test("record changes are atomic, validate tallies, and preserve before/after history", () => {
  const a=force();
  assert.throws(()=>M.updateUnit(a,a.units[0].id,{games:1,wins:2}),/cannot exceed/);
  assert.throws(()=>M.updateUnit(a,a.units[0].id,{xp:"oops"}),/whole number/);
  assert.equal(a.units[0].games,0);
  const b=M.updateUnit(a,a.units[0].id,{name:"Aurelian",games:3,wins:2,survived:1,xp:17,kills:4});
  assert.equal(b.units[0].unitType,"Captain");
  assert.equal(b.units[0].history[0].before.xp,0);
  assert.equal(b.units[0].history[0].after.xp,17);
  assert.equal(a.units[0].history.length,0);
});
test("awards persist their source and descriptions without mutating normal profiles", () => {
  const a=force(); const award={id:"scar-a",name:"Battle-weary",kind:"scar",description:"Example rules",pack:"Core",crusadePoints:-1};
  const b=M.assignAward(a,a.units[0].id,award);
  assert.deepEqual(b.units[0].record,a.units[0].record);
  assert.equal(M.summary(b).scars,1);
  assert.throws(()=>M.assignAward(b,b.units[0].id,award),/already has/);
  assert.equal(M.validateForce(JSON.parse(JSON.stringify(b))).units[0].awards[0].pack,"Core");
});
test("invalid backups and duplicate unit IDs are rejected", () => {
  assert.throws(()=>M.validateForce(document),/supported/);
  const a=force(); a.units[1].id=a.units[0].id; assert.throws(()=>M.validateForce(a),/invalid unit/);
  const b=force(); b.units[0].xp=-1; assert.throws(()=>M.validateForce(b),/whole number/);
});
test("bundled BSData exposes all four requested book pools and actual scar rules", () => {
  const data=extractCrusadeData(path.resolve(__dirname,"../data/rulesets/wh40k-11e-vflam"));
  for(const pack of ["Tyrannic War","Pariah Nexus","Nachmund Gauntlet","Armageddon"]) {
    assert.ok(data.records.some(item=>item.pack===pack && item.kind==="honour"),`${pack} traits`);
    assert.ok(data.records.some(item=>item.pack===pack && item.kind==="relic"),`${pack} relics`);
  }
  const scar=data.records.find(item=>item.name==="Battle-weary" && item.faction==="Core");
  assert.match(scar.description,/Out of Action/);
  assert.equal(scar.crusadePoints,-1);
  assert.equal(new Set(data.records.map(item=>item.id)).size,data.records.length);
  assert.ok(data.records.some(item=>item.pack==="Faction"));
});

function storageHarness(raw, indexedDB) {
  const local = new Map(raw == null ? [] : [["arcadienOrdersOfBattleV1",raw]]);
  const sandbox={window:{ArcadienCrusadeModel:M, ArcadienCrusadeWeapons:require("../src/domain/crusade-weapons"),ArcadienCrusadeData:{records:[]}, localStorage:{getItem:key=>local.get(key)??null,setItem:(key,value)=>local.set(key,value)},indexedDB},console};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,"../mobile/ui/crusades.js"),"utf8"),sandbox);
  return sandbox.window.ArcadienCrusades;
}

async function renderSavedForce(saved) {
  const app=storageHarness(JSON.stringify([saved])); await app.ready;
  const section={querySelector:()=>null};
  app.bind({querySelector:()=>section},{refresh(){}});
  await section.onclick({target:{closest:()=>({dataset:{crAction:"open",force:saved.id}})}});
  return app.render();
}

test("OoB datasheets show mixed model profiles, complete references, and one named modified weapon",async()=>{
  const W=require("../src/domain/crusade-weapons"),saved=force(),u=saved.units[1];
  u.record.configured={units:[
    {name:"Sergeant",characteristics:{M:'6"',T:"4",Sv:"3+",W:"2",Ld:"6+",OC:"2","Invulnerable Save":"5+"}},
    {name:"Trooper",characteristics:{M:'6"',T:"4",SV:"3+",W:"2",LD:"6+",OC:"2"}}
  ],weapons:[{name:"Bolt rifle",typeName:"Ranged Weapons",count:10,characteristics:{Range:'24"',A:"2",BS:"3+",S:"4",AP:"-1",D:"1"}}],
  abilities:[{name:"Objective holders",characteristics:{Description:"Keep control.\nEven after moving."}},{name:"Transport",characteristics:{Capacity:"Six models"}}],
  rules:[{name:"Oath",description:"Choose a target."},"Deep Strike"]};
  u.record.models=[{name:"Sergeant",count:1,equipment:["Bolt rifle"]},{name:"Trooper",count:9,equipment:["Bolt rifle"]}];
  saved.units[1]=W.assign(u,{weaponKey:W.key(u.record.configured.weapons[0]),copy:1,name:'Ash <Reaver>'},["brutal","master"]);
  const before=JSON.stringify(saved),html=await renderSavedForce(saved);
  for(const text of ["Full unit stats &amp; rules","Sergeant","Trooper","5+","Keep control.","Six models","Choose a target.","Deep Strike","BATTLELINE"])assert.ok(html.includes(text),text);
  assert.match(html,/Ash &lt;Reaver&gt; ★/);
  assert.match(html,/<td>9<\/td><td><b>Bolt rifle/);
  assert.match(html,/<td>1<\/td><td><b>Ash &lt;Reaver&gt; ★/);
  assert.match(html,/MODIFIED · Brutal \+ Master-worked/);
  assert.match(html,/<td>5<\/td><td>-1<\/td><td>2<\/td>/);
  assert.equal(JSON.stringify(saved),before,"viewing must not bake modifications into saved profiles");
});

test("legacy OoB without a saved datasheet offers catalogue refresh and still renders progression",async()=>{
  const html=await renderSavedForce(force());
  assert.match(html,/No unit stat profile is saved/);
  assert.match(html,/Edit unit &amp; equipment/);
  assert.match(html,/Aurelian/);
});
test("local fallback reads saved forces and surfaces corrupt data without replacing it", async () => {
  const a=storageHarness(JSON.stringify([force()])); await a.ready; assert.equal(a.count(),1);
  const b=storageHarness("{broken"); await b.ready; assert.match(b.render(),/not been overwritten/);
});
test("a database read failure does not silently fall back to an empty library", async () => {
  const indexedDB={open:()=>{
    const request={result:{transaction:()=>({objectStore:()=>({get:()=>{
      const read={error:new Error("Read denied")}; queueMicrotask(()=>read.onerror()); return read;
    }})})}};
    queueMicrotask(()=>request.onsuccess()); return request;
  }};
  const a=storageHarness(null,indexedDB); await a.ready;
  assert.match(a.render(),/Read denied/); assert.match(a.render(),/not been overwritten/);
});

const appSource = fs.readFileSync(path.resolve(__dirname,"../mobile/ui/engine-app.js"),"utf8");
test("Crusade autosave never writes into the Lists library", async () => {
  let saves=0;
  const c={appMode:"builder",currentFaction:"marines",armyState:{},crusadeEditorId:"oob-1",
    hasUnsavedRosterChanges:()=>true,saveCrusadeEditor:async()=>{saves++},
    savedRosterLibrary:()=>{throw new Error("Lists must not be accessed")},showTransientMessage:()=>{}};
  vm.runInNewContext(appSource.slice(appSource.indexOf("function autosaveCurrentRoster("),appSource.indexOf("function scheduleRosterAutosave(")),c);
  assert.equal(c.autosaveCurrentRoster(),false);
  assert.equal(saves,1);
});
test("Crusade editor queues snapshots and only marks the latest saved snapshot clean", async () => {
  let current={name:"Before"}, release;
  const saved=[];
  const c={crusadeEditorId:"oob-1",armyState:{},crusadeEditorSaveQueue:Promise.resolve(),rosterAutosaveTimer:1,
    window:{clearTimeout(){},ArcadienCrusades:{saveEditorDocument:async(id,doc)=>{
      saved.push([id,doc.name]); if(saved.length===1)await new Promise(resolve=>{release=resolve});
    }}},currentRosterDocument:()=>structuredClone(current),currentRosterSnapshot:()=>JSON.stringify(current),lastSavedRosterSnapshot:"old"};
  vm.runInNewContext(appSource.slice(appSource.indexOf("function saveCrusadeEditor("),appSource.indexOf("function renderCrusadeEditorControls(")),c);
  const first=c.saveCrusadeEditor();
  current={name:"After"}; const second=c.saveCrusadeEditor();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(saved.length,1); assert.equal(c.lastSavedRosterSnapshot,"old");
  release(); await first; await second;
  assert.deepEqual(saved,[["oob-1","Before"],["oob-1","After"]]);
  assert.equal(c.lastSavedRosterSnapshot,JSON.stringify(current));
});
test("a failed Crusade save keeps the editor open and leaves its identity intact", async () => {
  const alerts=[];
  const c={crusadeEditorId:"oob-1",appMode:"builder",saveCrusadeEditor:async()=>{throw new Error("Disk full")},alert:message=>alerts.push(message)};
  vm.runInNewContext(appSource.slice(appSource.indexOf("async function showLibrary("),appSource.indexOf("function showBuilder(")),c);
  await c.showLibrary();
  assert.equal(c.appMode,"builder"); assert.equal(c.crusadeEditorId,"oob-1"); assert.match(alerts[0],/Disk full/);
});
test("Order of Battle validation checks supply and equipment without imposing a mustered army's limits", () => {
  const c={crusadeEditorId:"oob-1",getTotalPoints:()=>1100,pointsLimitInput:{value:1000},
    splitSquadWarnings:()=>[],rosterRecoveryWarnings:[],roster:[{instanceId:"a"}],
    currentArmyDefinition:()=>({}),armyEngine:{validateRosterLegality:()=>{throw new Error("Muster restrictions do not belong here")}},
    entryLoadoutErrors:()=>[]};
  vm.runInNewContext(appSource.slice(appSource.indexOf("function validateRoster("),appSource.indexOf("function currentRosterDocument(")),c);
  const warnings=c.validateRoster();
  assert.equal(warnings.length,1); assert.equal(warnings[0].code,"CRUSADE_SUPPLY_EXCEEDED");
});
