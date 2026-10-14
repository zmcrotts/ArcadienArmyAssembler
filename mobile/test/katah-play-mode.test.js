const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('mobile/ui/play-mode.js','utf8');
const codex=require('../../data/manual-rules/wh40k-11e-custodes-codex.json');
const martial=codex.armyRules.find(x=>x.name==="Martial Ka'tah");
function harness(first='you'){
 const context={window:{},document:{getElementById:()=>null,addEventListener(){}},structuredClone};
 const injection=`window.testApi={set:s=>session=s,get:()=>session,groups:playRosterGroups,refreshKatah,katahChoices,katahReady,hasKatah,useKatah,correctKatah,canRefreshKatah,useAbility,useStratagem,abilityTracker,undoLastAction,normalizeSession,selectFirstTurn,nextPhase,setBattleState,renderKatahBadge,renderKatah,renderArmyGroup};persist=()=>{};render=()=>{};openUnit=()=>{};closeModal=()=>{};showAbilityFeedback=()=>{};showStratagemFeedback=()=>{};`;
 vm.runInNewContext(source.replace('  window.ArcadienPlayMode =',injection+'\n  window.ArcadienPlayMode ='),context);
 const entry=(id,name,abilities=[])=>({instanceId:id,name,configured:{abilities,units:[{name,characteristics:{W:4}}]},unitSize:{current:1}});
 const s={schemaVersion:6,status:'active',round:1,turn:first,phase:'Command',setup:{firstTurn:first},roster:{rosterEntries:[entry('guard','Guard',[martial]),entry('captain','Captain',[martial]),entry('sisters','Sisters'),entry('tank','Tank')],armyState:{attachments:[{leaderInstanceId:'captain',targetInstanceId:'guard'}]},detachments:codex.detachments},katahState:{},katahCommandPhases:[],abilityUses:[],stratagemUses:[],battleShockedGroups:{},undoHistory:[],cp:{you:5,opponent:5},cpAwarded:[],cpHistory:[],ledger:[],modelState:{},decks:{},notes:''};
 const api=context.window.testApi;api.set(s);return {api,s,group:api.groups()[0]};
}
test('attached unit has one READY flag; Sisters and tanks have none',()=>{
 const {api,s,group}=harness();api.refreshKatah();assert.equal(api.groups().length,3);assert.equal(api.katahReady(group),true);assert.equal(Object.keys(s.katahState).length,1);for(const g of api.groups().slice(1)){assert.equal(api.hasKatah(g),false);assert.equal(api.renderKatahBadge(g),'');}assert.match(api.renderArmyGroup(group),/● READY/);
});
test('all six timings, including opponent Fight, are gated correctly',()=>{
 const {api,s,group}=harness();for(const turn of ['you','opponent'])for(const phase of ['Command','Movement','Shooting','Charge','Fight']){s.turn=turn;s.phase=phase;const choices=api.katahChoices(group);assert.equal(choices.length,6);assert.equal(choices.filter(x=>x.available).map(x=>x.name).join(','),phase==='Fight'?'DACATARAI,KAPTARIS,RENDAX':turn==='you'?({Command:'CONSERVAI',Movement:'CALISTUS',Shooting:'SALVUS'}[phase]||''):'');}const choices=api.katahChoices(group);assert.match(choices[0].when,/Start of the Fight/);assert.match(choices[2].when,/selected to fight/);assert.equal(choices.every(x=>x.bonuses.length===1),true);
});
test('readiness spends once, persists across turns, resets next own Command and supports Undo',()=>{
 const {api,s,group}=harness();api.refreshKatah();api.useKatah(group,'CONSERVAI');assert.equal(api.katahReady(group),false);assert.match(api.renderKatahBadge(group),/NOT READY.*CONSERVAI/);api.refreshKatah();assert.equal(api.katahReady(group),false);s.turn='opponent';s.phase='Fight';api.useKatah(group,'RENDAX');assert.equal(s.katahState[group.id].used,'CONSERVAI');s.round=2;s.turn='you';s.phase='Command';api.refreshKatah();assert.equal(api.katahReady(group),true);api.useKatah(group,'CONSERVAI');api.undoLastAction();assert.equal(api.katahReady(group),true);const saved=JSON.parse(JSON.stringify(s));api.set(saved);api.normalizeSession();assert.equal(api.katahReady(group),true);
});
test('opponent first leaves units unready until own Command; selecting backwards does not refresh',()=>{
 const {api,s,group}=harness('opponent');api.refreshKatah();assert.equal(api.katahReady(group),false);s.phase='Fight';api.nextPhase();assert.equal(s.turn,'you');assert.equal(api.katahReady(group),true);api.useKatah(group,'CONSERVAI');api.setBattleState('phase','Movement');api.setBattleState('phase','Command');assert.equal(api.katahReady(group),false);
});
test('Master of Ka’tahs and Superhuman Focus restore readiness and enforce round limits',()=>{
 const {api,s,group}=harness();api.refreshKatah();const master={key:'master',name:"Master of Ka'tahs (Once per battle round, per unit)",tracker:api.abilityTracker('','Once per battle round')};api.useAbility(group,master);assert.equal(s.abilityUses.length,0);api.useKatah(group,'CONSERVAI');api.useAbility(group,master);assert.equal(api.katahReady(group),true);api.useKatah(group,'CONSERVAI');api.useAbility(group,master);assert.equal(api.katahReady(group),false);const focus={id:'focus',name:'Superhuman Focus',cpCost:'1'};api.useStratagem(group,focus);assert.equal(api.katahReady(group),true);assert.equal(s.cp.you,4);api.useKatah(group,'CONSERVAI');s.phase='Movement';api.useStratagem(group,focus);assert.equal(api.katahReady(group),false);assert.equal(s.cp.you,4);s.round=2;api.useStratagem(group,focus);assert.equal(api.katahReady(group),true);
});
test('existing sessions migrate without skipping the upcoming own Command refresh',()=>{
 const {api,s,group}=harness('opponent');s.round=2;delete s.katahState;delete s.katahCommandPhases;api.normalizeSession();api.correctKatah(group);assert.equal(api.katahReady(group),false);s.turn='you';api.refreshKatah();assert.equal(api.katahReady(group),true);
});
