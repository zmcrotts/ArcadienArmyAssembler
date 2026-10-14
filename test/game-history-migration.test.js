'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const migration=require('../mobile/ui/roster-migration.js');
const app=fs.readFileSync('mobile/ui/engine-app.js','utf8');
const appStart=app.indexOf('let rosterMigrationReady ='),appEnd=app.indexOf('function normalizeImportedRosterRecord',appStart);
const GAME_KEY='arcadienPlayModeResultsV1';
const game=(name='First match',rosterId='army')=>({schemaVersion:1,status:'final',rosterId,startedAt:'2026-10-01T12:00:00Z',endedAt:'2026-10-01T15:00:00Z',roster:{name,faction:'Blood Angels',rosterEntries:[{nickname:'Captain'}]},setup:{yourName:'You',opponentName:'Opponent',yourFaction:'Blood Angels',opponentFaction:'Orks',firstTurn:'you'},round:5,turn:'opponent',phase:'Fight',cp:{you:2,opponent:1},cpHistory:[{round:1,amount:1}],ledger:[{id:'score',round:1,player:'you',category:'primary',amount:5,source:'Reconnaissance'}],notes:'A close game 🎲',archivedDetails:{objective:'centre'}});
const roster=(id='army',name='My army')=>({id,document:{name},savedAt:'2026-10-01T12:00:00Z'});
function environment({rosters=[],games=[],failRoster=false,failHistory=false,cancel=false}={}) {
 const store=new Map([[GAME_KEY,JSON.stringify(games)]]);let saved=structuredClone(rosters),incoming='',handoff='',rosterWrites=0;
 const localStorage={getItem:key=>store.get(key)??null,setItem:(key,value)=>{if(key===GAME_KEY&&failHistory)throw Error('History storage full');store.set(key,value)},removeItem:key=>store.delete(key)};
 const c={structuredClone,Map,Set,TextEncoder,crypto:crypto.webcrypto,btoa:value=>Buffer.from(value,'binary').toString('base64'),localStorage,document:{getElementById:()=>null,addEventListener(){}},window:{},alert:message=>c.alerts.push(message),confirm:()=>!cancel,alerts:[],autosaveCurrentRoster(){},rosterStorageReadFailed:false,savedRosterLibrary:()=>saved,importedRosterRecords:values=>structuredClone(values),validateImportedRosterHydration:async()=>{},saveRosterLibrary:async values=>{rosterWrites++;if(failRoster)throw Error('Roster storage full');saved=values},render(){},appMode:'library',libraryTab:'lists'};
 vm.runInNewContext(fs.readFileSync('mobile/ui/play-mode.js','utf8'),c);
 c.window.ArcadienRosterMigration=migration;c.window.ArcadienRosterStorage={flush:async()=>{}};
 c.window.AndroidMigration={isLegacyApp:()=>true,moveRosters:value=>handoff=value,incomingLength:()=>incoming.length,incomingChunk:offset=>incoming.slice(offset,offset+65536),clearIncoming:()=>incoming=''};
 vm.runInNewContext(app.slice(appStart,appEnd)+'\nrosterMigrationReady=true;this.move=moveRostersToNewApp;this.receive=receiveRosterMigration;',c);
 return {c,store,history:()=>JSON.parse(store.get(GAME_KEY)),rosters:()=>saved,handoff:()=>handoff,incoming:value=>incoming=value,writes:()=>rosterWrites};
}
const plain=value=>JSON.parse(JSON.stringify(value));
test('source transfers full completed history without changing original records or unrelated settings',async()=>{
 const s=environment({rosters:[roster()],games:[game()]});s.store.set('auth-token','private');s.store.set('arcadienPlayModeSessionsV1','active-game');const before=[...s.store];
 await s.c.move();assert.deepEqual([...s.store],before);const transfer=migration.readTransfer(s.handoff());assert.equal(transfer.games.length,1);assert.deepEqual(transfer.games[0].ledger,game().ledger);assert.deepEqual(transfer.games[0].archivedDetails,game().archivedDetails);assert.deepEqual(transfer.games[0].roster,game().roster);assert.equal(transfer.games[0].notes,game().notes);assert.deepEqual(Object.keys(JSON.parse(s.handoff())),['kind','version','rosters','games']);
});
test('history-only transfers work with no saved rosters',async()=>{
 const s=environment({games:[game()]});await s.c.move();const d=environment();d.incoming(s.handoff());await d.c.receive();assert.equal(d.history().length,1);assert.equal(d.writes(),0);assert.equal(d.c.libraryTab,'games');
});
test('existing history is retained and repeated transfers do not duplicate games',async()=>{
 const s=environment({games:[game()]});await s.c.move();const d=environment({games:[game('Destination game','different')]});d.incoming(s.handoff());await d.c.receive();assert.equal(d.history().length,2);assert.equal(d.history()[0].roster.name,'Destination game');d.incoming(s.handoff());await d.c.receive();assert.equal(d.history().length,2);assert.equal(d.history()[1].notes,game().notes);
});
test('roster ID collisions remap the imported game link and retain valid stable game identity',async()=>{
 const s=environment({rosters:[roster()],games:[game()]});await s.c.move();const d=environment({rosters:[roster('army','Destination army')]});d.incoming(s.handoff());await d.c.receive();assert.equal(d.rosters().length,2);assert.equal(d.history()[0].rosterId,d.rosters()[1].id);await d.c.window.ArcadienPlayMode.validateMigrationHistory(d.history());d.incoming(s.handoff());await d.c.receive();assert.equal(d.history().length,1);assert.equal(d.rosters().length,2);
});
test('cancelled or tampered transfers do not alter either destination library',async()=>{
 const s=environment({rosters:[roster()],games:[game()]});await s.c.move();for(const cancel of [true,false]){const d=environment({rosters:[roster('other')],games:[game('Existing')],cancel});const payload=JSON.parse(s.handoff());if(!cancel)payload.games[0].notes='tampered';d.incoming(JSON.stringify(payload));const oldGames=JSON.stringify(d.history()),oldRosters=JSON.stringify(d.rosters());await d.c.receive();assert.equal(JSON.stringify(d.history()),oldGames);assert.equal(JSON.stringify(d.rosters()),oldRosters);assert.equal(d.writes(),0);}
});
test('failed history write leaves rosters untouched and a failed roster write restores exact history',async()=>{
 const s=environment({rosters:[roster()],games:[game()]});await s.c.move();for(const options of [{failHistory:true},{failRoster:true}]){const d=environment({...options,rosters:[roster('other')],games:[game('Existing')]});const previous=d.store.get(GAME_KEY),before=JSON.stringify(d.rosters());d.incoming(s.handoff());await d.c.receive();assert.equal(d.store.get(GAME_KEY),previous);assert.equal(JSON.stringify(d.rosters()),before);assert.match(d.c.alerts[0],/Transfer failed/);}
});
test('corrupt source history is reported and is not silently treated as empty',async()=>{
 const s=environment({rosters:[roster()]});s.store.set(GAME_KEY,'not json');await s.c.move();assert.equal(s.handoff(),'');assert.equal(s.store.get(GAME_KEY),'not json');assert.match(s.c.alerts[0],/Could not move/);
});
test('old roster-only transfers remain supported and leave existing game history alone',async()=>{
 const d=environment({games:[game()]});const before=d.store.get(GAME_KEY);d.incoming(migration.createPayload([roster()]));await d.c.receive();assert.equal(d.rosters().length,1);assert.equal(d.store.get(GAME_KEY),before);
});
test('large Unicode game notes survive chunked transfer',async()=>{
 const source=game();source.notes='🎲'.repeat(40000);const s=environment({games:[source]});await s.c.move();const d=environment();d.incoming(s.handoff());await d.c.receive();assert.equal(d.history()[0].notes,source.notes);
});
test('invalid empty or oversized transfer collections are rejected',()=>{
 assert.throws(()=>migration.createPayload([],[]));assert.throws(()=>migration.createPayload([],Array(501).fill(game())));assert.throws(()=>migration.readTransfer(JSON.stringify({kind:'arcadien.roster-migration',version:2,rosters:[],games:{}})));
});
test('games previously deleted in the destination remain deleted during transfer',async()=>{
 const s=environment({games:[game()]});await s.c.move();const transferred=migration.readTransfer(s.handoff()).games[0];const d=environment();d.store.set('arcadienPlayModeResultTombstonesV1',JSON.stringify([{resultId:transferred.resultId,gameHash:transferred.gameHash,deletedAt:'2026-10-02T12:00:00Z'}]));d.incoming(s.handoff());await d.c.receive();assert.equal(d.history().length,0);assert.match(d.c.alerts[0],/1 game\(s\).*skipped/);
});
