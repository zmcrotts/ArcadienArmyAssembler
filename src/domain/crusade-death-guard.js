"use strict";
(function install(global){
  const clone=v=>JSON.parse(JSON.stringify(v));
  const uid=()=>global.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const normal=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const tracker=()=>global.ArcadienCrusadeTrackers||(typeof require==='function'?require('./crusade-trackers'):null);
  const SOURCE={edition:10,htmlSha256:'8c0f9981cb6bd2ed7fa55ff2eafe88a01154678988ce3c106c4587c93a9dc0a5',sheet:'https://wahapedia.ru/wh40k10ed/factions/death-guard/AGrandPlague.pdf',graphics:'assets/crusade/death-guard/'};
  const PRESETS={'Hive World':[3,5,2],'Agri World':[5,2,3],'Forge World':[2,3,5]};
  // Mechanical summaries of the five printed sheet entries; the supplied HTML is the rules reference.
  const PROPERTIES=[
    {id:'putridity',name:'Putridity',effect:'With Lethal Hits weapons, critical hits occur on an unmodified 5+.',drawback:'Lethal Hits weapon Strength −3.'},
    {id:'hypervector',name:'Hypervector',effect:'After shooting, a target hit by a Lethal Hits attack becomes Afflicted for the battle. Once per unit per turn.',drawback:'Ranged Lethal Hits weapon Attacks −1.'},
    {id:'parasitic-implantation',name:'Parasitic Implantation',effect:'Lethal Hits weapons also receive Sustained Hits 1.',drawback:'Hit rerolls are unavailable for Lethal Hits attacks.'},
    {id:'lurid-flux',name:'Lurid Flux',effect:'After fighting, force a Battle-shock test on a target hit by a Lethal Hits attack. Once per unit per turn.',drawback:null},
    {id:'spreading-pox',name:'Spreading Pox',effect:'After qualifying kills during activation, the first new Poxwalkers unit receives 6 XP and a Battle Honour.',drawback:null}
  ];
  const STEPS=[{id:'reap',name:'Reap the Rewards',image:'4e155d4236681b1c59.png'},{id:'first',name:'First Check for a Breakthrough',image:'fb9e65fcd4edfd1db9.png'},{id:'cultivation',name:'Cultivation',image:'d5fd574ea805cf85d3.png'},{id:'counteragents',name:'Counteragents',image:'f05cb70a053de40fc3.png'},{id:'deathtoll',name:'Death Toll',image:'88c76ae3ece093e655.png'},{id:'final',name:'Final Check for a Breakthrough',image:'3166638c045d1f4414.png'}];
  const BOONS=[{roll:11,name:'Febrile Vitality'},{roll:12,name:'Slitherswift Limbs'},{roll:13,name:'Writhing Tentacles'},{roll:21,name:'Grossly Swollen'},{roll:22,name:'Leprous Insensibility'},{roll:23,name:'Veil of Flies'},{roll:31,name:'Touch of Rot'},{roll:32,name:'Plaguesight'},{roll:33,name:'Billowing Miasma'}];
  const TRAITS={infantry:['Spatterfilth','Choking Mist','Bone Horns','Stolid Bulk','Cackling Plague Mites','Quivering Cilia'],daemon:['Infectious Buboes','Sporebelch','Lambent Taint'],vehicle:['Plated Growths','Masterwork Maladies','Skittering Limbs']};
  function int(v,label,min=0,max=1000000){if(v===''||v==null||typeof v==='boolean'||!Number.isSafeInteger(Number(v))||Number(v)<min||Number(v)>max)throw new Error(`${label} must be a whole number from ${min} to ${max}.`);return Number(v);}
  const d6=v=>int(v,'D6 result',1,6);
  function text(v,label='Name',max=200){if(typeof v!=='string'||!v.trim()||v.length>max)throw new Error(`Enter ${label.toLowerCase()} (${max} characters maximum).`);return v.trim();}
  const has=(u,k)=>(u.keywords||[]).some(x=>normal(x)===normal(k))||Boolean(u.roles?.[k]);
  const belongs=u=>{const keys=(u.keywords||[]).filter(k=>/^faction:/i.test(k));return !keys.length||keys.some(k=>/deathguard/i.test(normal(k)));};
  const character=u=>belongs(u)&&has(u,'character');
  const immune=u=>has(u,'poxwalkers')||/poxwalkers/i.test(u.unitType)||has(u,'plaguelegions');
  const canXP=u=>!immune(u)&&!has(u,'epichero');
  function getUnit(n,id){const u=n.units.find(u=>u.id===id);if(!u)throw new Error('Choose an active unit.');return u;}
  function xp(n,id,amount){const u=getUnit(n,id);if(canXP(u))u.xp+=amount;}
  function panel(s,key){return s.panels[key]||=[];}
  function row(s,key,id){const r=panel(s,key).find(r=>r.id===id);if(!r)throw new Error('This record no longer exists.');return r;}
  function record(name,values,extra={}){return {id:uid(),name,values,notes:'',createdAt:new Date().toISOString(),...extra};}
  function properties(force){return (force.factionProgression?.panels.properties||[]).map(r=>({record:r,definition:PROPERTIES.find(p=>p.id===r.propertyId||normal(p.name)===normal(r.values.property)||normal(p.name)===normal(r.name))}));}
  function pathogen(force){const r=force.factionProgression?.panels.pathogen?.[0],ps=properties(force),known=ps.filter(p=>p.definition);return {record:r,duration:r?.values.duration||1,potency:(r?.values.duration||1)+known.length+known.filter(p=>p.definition.drawback&&p.record.values.suppressed).length,properties:known,unknown:ps.filter(p=>!p.definition)};}
  function active(force){return (force.factionProgression?.panels.plagues||[]).find(r=>r.values.status==='Active')||null;}
  const totals=r=>[r.values.fecundity+r.values.reproduction,r.values.population+r.values.survival,r.values.vulnerability+r.values.adaptability];
  function reward(score){return score>=15?{name:'Acceptable Offering',xp:2,reroll:true}:score>=11?{name:'Foul Bounty',xp:2,trait:true}:score>=7?{name:'A Mighty Pestilence',xp:3,blessing:true}:{name:'Malign Masterpiece',xp:5,blessing:true};}
  function syncPathogen(n,s){let r=panel(s,'pathogen')[0];if(!r){r=record('Alchemical Pathogen',{duration:1,potency:1},{mechanicsVersion:1});s.panels.pathogen.push(r);}const p=pathogen(n);if(p.unknown.length)throw new Error('Restore the old custom Property entries to the printed sheet options before brewing.');if(p.potency>7)throw new Error('The recorded pathogen exceeds Potency 7; restore its configuration first.');r.values.potency=p.potency;r.mechanicsVersion=1;return r;}
  function battle(n,id){const b=(n.battles||[]).find(b=>b.id===id);if(!b||!b.id)throw new Error('Record the game first, then select that battle.');return b;}
  function review(s,id){return row(s,'dgBattles',id);}
  function phase(r,expected){if(r.phase!==expected)throw new Error('Resolve the current Path of Contagion step first.');}
  function plague(s,r){return r.plagueId?row(s,'plagues',r.plagueId):null;}
  function latest(n,r){if((n.battles||[]).at(-1)?.id!==r.battleId)throw new Error('This action belongs at the end of the most recently recorded battle.');}
  function modify(r,key,delta){const min=key==='population'?0:1;r.values[key]=Math.max(min,Math.min(6,r.values[key]+delta));}
  function spend(n,cost){if(n.requisitionPoints<cost)throw new Error('Not enough Requisition Points.');n.requisitionPoints-=cost;}
  function participants(n,r,id,kind){if(!r.unitIds.includes(id))throw new Error('Choose a unit that fought in this battle.');const u=getUnit(n,id);if(!belongs(u)||kind==='infantry'&&!has(u,'infantry'))throw new Error('Choose an eligible Death Guard '+(kind||'unit')+'.');return u;}
  function grantOperation(r,type,source){r.operations||=[];r.operations.push({id:uid(),type,source,used:false});}
  function boonName(award){return BOONS.find(b=>normal(b.name)===normal(award.name));}
  function traitEligible(u,name){return Object.entries(TRAITS).some(([key,names])=>has(u,key)&&names.includes(name));}
  function award(n,u,a,replaceId){
    if(!a?.id||!a.name||typeof a.description!=='string')throw new Error('Choose an eligible Battle Honour.');
    if(immune(u)&&!u.deathGuard?.spreadingHonourPending)throw new Error('Poxwalkers and Plague Legions cannot gain Battle Honours.');
    if(u.awards.some(x=>x.id===a.id))throw new Error('The unit already has that Honour.');
    const max=has(u,'character')?6:3,existing=u.awards.filter(a=>a.kind!=='scar');
    if(existing.length>=max){if(!existing.some(a=>a.id===replaceId))throw new Error('Select an existing Honour to replace at the unit’s Honour limit.');u.awards=u.awards.filter(a=>a.id!==replaceId);}
    u.awards.push(clone(a));if(u.deathGuard?.spreadingHonourPending)u.deathGuard.spreadingHonourPending=false;
  }
  function complete(s,r,p){p.values.status='Completed';p.outcome='Concocted';p.reward={...reward(p.values.suitability),claimed:false};r.phase='reward';r.values.status='Active';}
  function nextAfterCheck(s,r,p){if(p&&totals(p).every(x=>x===7))complete(s,r,p);else {r.phase=r.phase==='first'?'cultivation':'done';if(r.phase==='done')r.values.status='Completed';}}
  function setupWorld(n,s,input){
    if(!n.units.some(character))throw new Error('A Death Guard Character is required to begin concocting a plague.');
    if(panel(s,'plagues').some(p=>p.values.status==='Active'))throw new Error('Finish or abandon the current plague first.');
    if(panel(s,'plagues').some(p=>p.reward&&!p.reward.claimed))throw new Error('Resolve the previous plague’s reward first.');
    const previous=[...panel(s,'plagues')].reverse().find(p=>p.reward?.reroll&&!p.reward.rerollUsed),method=input.method;
    let stats=PRESETS[method];if(!stats){if(method!=='Random'||!Array.isArray(input.rolls)||input.rolls.length!==3)throw new Error('Choose a printed world preset or roll three D6.');stats=input.rolls.map(d6);stats=stats.map((v,i)=>{if(input.rerolls?.[i]!=null&&input.rerolls[i]!==''){if(!previous||v<5)throw new Error('Only initial 5s or 6s may be rerolled using Acceptable Offering.');return d6(input.rerolls[i]);}return v;});}
    const [fecundity,population,vulnerability]=stats;
    panel(s,'plagues').push(record(text(input.name,'Plague name'),{world:text(input.world,'World name'),fecundity,population,vulnerability,reproduction:1,survival:1,adaptability:1,suitability:stats.reduce((a,b)=>a+b,0),status:'Active'},{mechanicsVersion:1,worldType:method,initialWorld:[...stats]}));
    if(previous)previous.reward.rerollUsed=true;
  }
  function startReview(n,s,input){
    const b=battle(n,input.battleId);if(panel(s,'dgBattles').some(r=>r.battleId===b.id))throw new Error('This battle already has a Death Guard review.');
    if(panel(s,'dgBattles').some(r=>!['done'].includes(r.phase)))throw new Error('Finish the open battle review first.');
    const agendas=input.agendas||[];if(!Array.isArray(agendas)||agendas.length>2||new Set(agendas).size!==agendas.length||agendas.some(a=>!['seed','vectors','viral','research'].includes(a)))throw new Error('Choose up to two different Death Guard Agendas used in this battle.');
    const p=active(n),r=record(`${b.date} · ${b.opponent||'Opponent'}`,{status:'Active'},{mechanicsVersion:1,battleId:b.id,plagueId:p?.id||null,unitIds:clone(b.unitIds),result:b.result,agendas,phase:'reap',operations:[],agendaXPAlreadyRecorded:Boolean(input.agendaXPAlreadyRecorded),log:[],cultivations:1,usedRequisitions:[],blessings:tracker().blessingClaims(n).filter(b=>b.claims.length).map(b=>b.id)});
    panel(s,'dgBattles').push(r);
  }
  function reap(n,s,r,input){
    phase(r,'reap');const p=plague(s,r);r.reap=clone(input);const ledger={};const add=(id,v)=>{ledger[id]=(ledger[id]||0)+v;};
    if(r.agendas.includes('seed')){
      const seeded=input.seed||[];if(!Array.isArray(seeded)||seeded.length!==3)throw new Error('Record the three selected objective markers.');let count=0;
      for(const id of seeded)if(id){participants(n,r,id,'infantry');count++;add(id,2);}
      if(count===2&&p){if(d6(input.seedRoll)>=4)modify(p,'fecundity',1);}else if(count===3&&p)modify(p,'fecundity',1);
    }
    if(r.agendas.includes('vectors')){
      const rolls=input.vectors||[];if(!Array.isArray(rolls)||rolls.length>100)throw new Error('Record the enemy survivors’ rolls.');const results=rolls.map(x=>d6(x.roll)+(x.belowStrength?2:0)),triggered=results.some(x=>x>=6);
      if(triggered){const u=participants(n,r,input.vectorUnit);const b=battle(n,r.battleId);if(Array.isArray(b.survivedUnitIds)?!b.survivedUnitIds.includes(u.id):!input.vectorSurvived)throw new Error('Choose a Death Guard unit that survived.');if(p)modify(p,'survival',1);add(u.id,3);}
    }
    for(const [name,key] of [['viral','viral'],['research','research']])if(r.agendas.includes(name)){
      const counts=input[key]||{};let total=0;for(const [id,count] of Object.entries(counts)){const c=int(count,'Agenda tally');if(!c)continue;participants(n,r,id,name==='viral'?'infantry':null);total+=c;add(id,Math.min(3,c));}
      if(name==='viral'&&p&&d6(input.viralRoll)+total>=7)modify(p,'adaptability',1);
      if(name==='research'){r.researchTally=total;for(let i=0;i<(total>=4?2:total>=1?1:0);i++)grantOperation(r,'tailor','Vile Research');}
    }
    r.agendaXP=ledger;if(!r.agendaXPAlreadyRecorded)for(const [id,amount] of Object.entries(ledger))xp(n,id,amount);
    r.log.push('Reap the Rewards resolved.');r.phase=p?'first':'done';if(!p)r.values.status='Completed';
  }
  function resolveStep(n,s,r,input){
    const p=plague(s,r);if(!p||p.values.status!=='Active')throw new Error('No active plague for this review.');
    if(r.phase==='first'||r.phase==='final'){nextAfterCheck(s,r,p);return;}
    if(r.phase==='cultivation'){
      const roll=d6(input.roll),total=roll+(r.result==='Victory'?2:0);if(total>=4&&input.characteristic&&input.characteristic!=='none'){if(!['reproduction','survival','adaptability'].includes(input.characteristic))throw new Error('Choose a plague characteristic.');const delta=int(input.delta,'Characteristic change',-1,1);if(![-1,1].includes(delta))throw new Error('Choose +1 or −1.');const next=p.values[input.characteristic]+delta;if(next<1||next>6)throw new Error('Plague characteristics stay between 1 and 6.');p.values[input.characteristic]=next;}
      r.log.push(`Cultivation: D6 ${roll}${r.result==='Victory'?' +2 for victory':''} = ${total}.`);r.cultivations--;if(!r.cultivations)r.phase='counteragents';return;
    }
    if(r.phase==='counteragents'){
      if(input.skip){const eligible=r.unitIds.some(id=>{const u=n.units.find(u=>u.id===id);return u?.awards.some(a=>normal(a.name)==='casketofcorruption');});if(!eligible||!input.casketPosition)throw new Error('A participating Casket of Corruption bearer must have ended wholly in the opponent’s deployment zone.');r.log.push('Counteragents skipped using Casket of Corruption.');}
      else {const roll=d6(input.roll);if(roll>p.values.adaptability)modify(p,'vulnerability',-1);r.log.push(`Counteragents: D6 ${roll} vs Adaptability ${p.values.adaptability}.`);}r.phase='deathtoll';return;
    }
    if(r.phase==='deathtoll'){
      const roll=d6(input.roll);if(roll>p.values.survival)modify(p,'population',-1);r.log.push(`Death Toll: D6 ${roll} vs Survival Rate ${p.values.survival}.`);
      if(p.values.population===0){p.values.status='Abandoned';p.outcome='Failed';r.phase='done';r.values.status='Completed';}else r.phase='final';return;
    }
    throw new Error('This review has no dice step to resolve.');
  }
  function restorePathogen(n,s,input){
    const duration=int(input.duration,'Duration',1,5),selected=input.properties||[],suppressed=input.suppressed||[];
    if(!Array.isArray(selected)||new Set(selected).size!==selected.length||selected.some(id=>!PROPERTIES.some(p=>p.id===id))||suppressed.some(id=>!selected.includes(id)||!PROPERTIES.find(p=>p.id===id)?.drawback))throw new Error('Choose valid printed Properties and Drawbacks.');
    if(duration+selected.length+suppressed.length>7)throw new Error('The printed marks exceed Potency 7.');
    let r=panel(s,'pathogen')[0];if(!r){r=record('Alchemical Pathogen',{duration:1,potency:1});s.panels.pathogen.push(r);}r.mechanicsVersion=1;r.values.duration=duration;r.legacyProperties=[...(r.legacyProperties||[]),...clone(panel(s,'properties'))];s.panels.properties=selected.map(id=>{const p=PROPERTIES.find(p=>p.id===id);return record(p.name,{property:p.name,drawback:p.drawback||'',suppressed:suppressed.includes(id)},{propertyId:id});});syncPathogen(n,s);
  }
  function brew(n,s,input){
    const r=review(s,input.reviewId);latest(n,r);const op=(r.operations||[]).find(o=>o.id===input.operationId&&!o.used);if(!op)throw new Error('Choose an unused Brew or Tailor entitlement.');syncPathogen(n,s);
    const before=pathogen(n),settings=panel(s,'pathogen')[0],reduce=op.type==='tailor'||before.potency===7;
    if(reduce){const reduction=input.reduce;
      if(reduction==='duration'){if(settings.values.duration<=1)throw new Error('Duration cannot fall below 1.');settings.values.duration--;}
      else if(reduction?.startsWith('property:')){const id=reduction.slice(9),found=properties(n).find(p=>p.definition?.id===id);if(!found)throw new Error('Choose an added Property.');s.panels.properties=s.panels.properties.filter(p=>p.id!==found.record.id);}
      else if(reduction?.startsWith('suppression:')){const id=reduction.slice(12),found=properties(n).find(p=>p.definition?.id===id&&p.record.values.suppressed);if(!found)throw new Error('Choose a suppressed Drawback.');found.record.values.suppressed=false;}
      else throw new Error('Tailor the Toxins requires a reduction before brewing.');
    }
    if(pathogen(n).potency>=7)throw new Error('Reduce Potency before brewing.');
    if(input.brew==='duration'){if(settings.values.duration>=5)throw new Error('Duration cannot exceed 5.');settings.values.duration++;}
    else if(input.brew?.startsWith('property:')){const id=input.brew.slice(9),p=PROPERTIES.find(p=>p.id===id);if(!p||properties(n).some(x=>x.definition?.id===id))throw new Error('Choose an unselected printed Property.');panel(s,'properties').push(record(p.name,{property:p.name,drawback:p.drawback||'',suppressed:false},{propertyId:id}));}
    else if(input.brew?.startsWith('suppression:')){const id=input.brew.slice(12),p=properties(n).find(x=>x.definition?.id===id&&x.definition.drawback&&!x.record.values.suppressed);if(!p)throw new Error('Choose an active printed Drawback.');p.record.values.suppressed=true;}
    else throw new Error('Choose one Brew Your Batch improvement.');
    syncPathogen(n,s);op.used=true;op.resolution={reduce:reduce?input.reduce:null,brew:input.brew};
  }
  function requisition(n,s,input){
    const r=review(s,input.reviewId);latest(n,r);const p=plague(s,r),key=input.key;
    if(['tainted','remissive'].includes(key)&&r.result!=='Victory')throw new Error('This Requisition requires a victory.');
    if(key==='tainted'){spend(n,1);grantOperation(r,'brew','Tainted Tinkering');}
    else if(key==='fruits'){spend(n,1);grantOperation(r,'tailor','Fruits of the Cauldron');}
    else if(key==='remissive'){if(!p||p.values.status!=='Active'||p.values.population>=6)throw new Error('Choose an active world below Population Density 6.');spend(n,1);modify(p,'population',1);}
    else if(key==='careful'){phase(r,'reap');if(!p||r.cultivations!==1)throw new Error('Careful Cultivation is unavailable.');spend(n,2);r.cultivations=2;}
    else throw new Error('Choose a post-battle Requisition.');r.usedRequisitions.push(key);
  }
  function claimReward(n,s,input){
    const r=review(s,input.reviewId),p=plague(s,r);phase(r,'reward');if(!p?.reward||p.reward.claimed)throw new Error('No unclaimed plague reward.');const u=getUnit(n,input.unitId);if(!character(u)||!canXP(u))throw new Error('Choose an eligible Death Guard Character for the XP.');
    if(p.reward.blessing){const choices=tracker().blessingClaims(n).filter(b=>!b.claims.length);if(choices.length){const b=choices.find(b=>b.id===input.blessingId);if(!b)throw new Error('Choose an unclaimed Blessing.');panel(s,'blessings').push(record(b.name,{effect:b.description},{blessingId:b.id,origin:p.name}));}}
    if(p.reward.trait){const target=getUnit(n,input.traitUnitId);if(!belongs(target)||!traitEligible(target,input.trait?.name)||input.trait?.kind!=='honour')throw new Error('Choose an eligible Death Guard Battle Trait and unit.');award(n,target,input.trait,input.replaceId);}
    u.xp+=p.reward.xp;p.reward.claimed=true;p.reward.recipient=u.id;r.phase='done';r.values.status='Completed';
  }
  function rollBoon(n,s,input){
    if(!input.eligibleForHonour)throw new Error('Confirm that this model is currently eligible to gain a Battle Honour.');
    const u=getUnit(n,input.unitId);if(!character(u)||has(u,'epichero')||/daemonprince/i.test(normal(u.unitType)))throw new Error('Choose a non-Daemon-Prince Death Guard Character eligible for a Battle Honour.');
    if(u.deathGuard?.pendingSpawndom)throw new Error('Resolve Spawndom first.');
    const existing=u.awards.filter(boonName);if(existing.length>=3)throw new Error('A model cannot have more than three Boons of Nurgle.');
    const roll=int(input.tens,'First D3',1,3)*10+int(input.units,'Second D3',1,3),b=BOONS.find(b=>b.roll===roll);u.deathGuard||={};
    if(existing.some(a=>normal(a.name)===normal(b.name))){u.deathGuard.pendingSpawndom=true;u.deathGuard.spawndomRoll=roll;}
    else award(n,u,{id:`dg-boon:${roll}`,name:b.name,kind:'honour',description:String(input.description||b.name),pack:'Faction',table:'Boons of Nurgle',crusadePoints:1},input.replaceId);
  }
  function replaceUnit(n,s,input){
    if(!['spawn','ascension'].includes(input.kind))throw new Error('Choose Spawndom or Putrid Ascension.');
    const old=getUnit(n,input.unitId),target=getUnit(n,input.replacementId),spawn=input.kind==='spawn';
    if(old.id===target.id||target.games||target.xp||target.awards.length||target.weaponModifications?.length||!belongs(target)||!target.record?.configured?.units?.length)throw new Error('Choose a newly configured, unused Death Guard replacement.');
    if(spawn){if(!old.deathGuard?.pendingSpawndom||!/chaosspawn/i.test(normal(target.unitType)))throw new Error('Spawndom requires a new Death Guard Chaos Spawn unit.');}
    else {if(!character(old)||has(old,'daemon')||old.awards.filter(boonName).length!==3||old.xp<31||!/daemonprince/i.test(normal(target.unitType)))throw new Error('Putrid Ascension requires a non-Daemon Character with three Boons, at Heroic or Legendary advancement.');if(!input.rankJustGained)throw new Error('Confirm the Character has just reached Heroic or Legendary rank.');}
    const within=n.units.filter(u=>u.id!==old.id).reduce((sum,u)=>sum+u.points,0)<=n.supplyLimit;
    if(!within&&!spawn)throw new Error('The Daemon Prince would exceed Supply Limit.');
    if(!within&&spawn&&!input.removeIfNoRoom)throw new Error('Increase Supply Limit first, or confirm removal without adding a Spawn.');
    if(!spawn)spend(n,2);
    n.retiredUnits||=[];n.retiredUnits.push(old);n.units=n.units.filter(u=>u.id!==old.id);
    if(!within){old.deathGuard.unusedReplacement=clone(target);n.units=n.units.filter(u=>u.id!==target.id);return;}
    const honours=old.awards.filter(a=>a.kind!=='scar'),scars=old.awards.filter(a=>a.kind==='scar'),keep=!spawn&&input.keepBoons?honours.filter(boonName):[];
    target.xp=old.xp;target.name=old.name;target.awards=clone(keep);target.deathGuard={replacedUnitId:old.id,pendingHonours:honours.length-keep.length,pendingScars:spawn?scars.length:0,replacement:spawn?'Spawndom':'Putrid Ascension'};
  }
  function temporaryTrait(n,s,input){
    const u=getUnit(n,input.unitId),a=input.trait;if(!belongs(u)||!immune(u)||!/poxwalkers/i.test(normal(u.unitType)))throw new Error('Select a Poxwalkers unit in the mustered army.');
    if(!input.mustered||a?.kind!=='honour'||!(TRAITS.infantry.includes(a.name)||/battle.?traits?/i.test(a.table||''))||!a.id||typeof a.description!=='string')throw new Error('Choose the generated Battle Trait and confirm this unit is mustered.');
    if(u.deathGuard?.temporaryTrait)throw new Error('This unit already has a pending Wretched Might trait.');spend(n,2);u.deathGuard||={};u.deathGuard.temporaryTrait=clone(a);
  }
  function spreadingPox(n,s,input){
    const r=review(s,input.reviewId);latest(n,r);if(r.spreadingPoxApplied)throw new Error('Spreading Pox was already resolved for this battle.');
    if(!pathogen(n).properties.some(p=>p.definition.id==='spreading-pox')||!input.qualifyingKills||!input.firstNewUnit)throw new Error('Confirm qualifying Lethal Hits kills while Spreading Pox was active, and the first newly added Poxwalkers unit.');
    const u=getUnit(n,input.unitId);if(!/poxwalkers/i.test(normal(u.unitType))||u.games||u.xp||u.awards.length)throw new Error('Choose a new Poxwalkers unit with no existing progression.');
    u.xp=6;u.deathGuard||={};u.deathGuard.spreadingHonourPending=true;u.deathGuard.spreadingPoxBattleId=r.battleId;r.spreadingPoxApplied=u.id;
  }
  function afterNewUnits(force,previousIds){
    const claims=tracker().blessingClaims(force);if(!claims.find(b=>b.id==='vile-possession')?.claims.length)return;
    for(const u of force.units)if(!previousIds.has(u.id)&&belongs(u)&&has(u,'vehicle')&&!u.deathGuard?.vilePossession){u.deathGuard||={};u.deathGuard.vilePossession=true;u.deathGuard.pendingHonours=1;u.xp=6;if(!has(u,'daemon'))u.keywords.push('DAEMON');if(u.record)u.record.keywords=clone(u.keywords);}
  }
  function ownCommandIndex(session){if(!session.turn)return 0;return session.turn==='you'||session.setup.firstTurn==='you'?session.round:session.round-1;}
  function pathogenActive(session){const a=session.deathGuardBattle?.activation;return Boolean(a&&ownCommandIndex(session)<a.command+a.duration);}
  function activatePathogen(session){
    const recipe=session.roster?.crusade?.deathGuard;
    if(!recipe||session.status!=='active'||session.turn!=='you'||session.phase!=='Command')throw new Error('Activate the Alchemical Pathogen in your Command phase.');
    const command=ownCommandIndex(session);if(session.deathGuardBattle?.activation?.command===command)throw new Error('Activation is already recorded for this Command phase.');
    const next=clone(session);next.deathGuardBattle||={};next.deathGuardBattle.activation={command,duration:int(recipe.duration,'Duration',1,5),round:session.round};next.deathGuardBattle.activations||=[];next.deathGuardBattle.activations.push(clone(next.deathGuardBattle.activation));return next;
  }
  function resolveBlessing(n,s,input){
    const r=review(s,input.reviewId);latest(n,r);const id=input.blessingId;
    if(!(r.blessings||[]).includes(id))throw new Error('This Blessing was not recorded for this battle.');
    r.blessingResolutions||={};if(r.blessingResolutions[id])throw new Error('This Blessing has already been resolved for this battle.');
    const result={};
    if(id==='eye-of-nurgle'){result.roll=d6(input.roll);result.success=result.roll+(r.result==='Victory'?1:0)>=6;if(result.success){const u=participants(n,r,input.unitId);if(!canXP(u))throw new Error('Choose an eligible additional Marked for Greatness unit.');result.unitId=u.id;if(!input.xpAlreadyRecorded)xp(n,u.id,3);}}
    else if(id==='endless-harvest'){result.roll=d6(input.roll);result.success=result.roll>=4;if(result.success)n.requisitionPoints=Math.min(10,n.requisitionPoints+1);}
    else if(id==='fecund-fervour'){const b=battle(n,r.battleId),survivors=b.survivedUnitIds||input.survivedUnitIds;if(!Array.isArray(survivors)||survivors.some(id=>!r.unitIds.includes(id)))throw new Error('Confirm which participating units survived.');result.unitIds=survivors.filter(id=>{const u=getUnit(n,id);return has(u,'battleline')&&canXP(u);});if(!input.xpAlreadyRecorded)for(const id of result.unitIds)xp(n,id,2);}
    else if(id==='burgeoning-fortitude'){if(!input.firstFailedTest)throw new Error('Confirm that this is the first failed Out of Action test.');result.unitId=participants(n,r,input.unitId).id;result.ignored=true;}
    else throw new Error('This Blessing is applied when adding a Vehicle or modifying a weapon.');
    result.xpAlreadyRecorded=Boolean(input.xpAlreadyRecorded);r.blessingResolutions[id]=result;
  }
  function validate(force){
    const s=force.factionProgression;if(!s)return;for(const p of s.panels.plagues||[])if(p.mechanicsVersion===1){if(!PRESETS[p.worldType]&&p.worldType!=='Random')throw new Error('Invalid plague-world type.');if(!Array.isArray(p.initialWorld)||p.initialWorld.length!==3||p.initialWorld.some(v=>!Number.isInteger(v)||v<1||v>6)||p.initialWorld.reduce((a,b)=>a+b,0)!==p.values.suitability)throw new Error('The initial world and fixed Suitability Score disagree.');}
    const ids=new Set();for(const r of s.panels.dgBattles||[]){if(r.mechanicsVersion!==1||!r.battleId||ids.has(r.battleId)||!Array.isArray(r.unitIds)||!Array.isArray(r.operations)||!Array.isArray(r.log)||!['reap','first','cultivation','counteragents','deathtoll','final','reward','done'].includes(r.phase))throw new Error('Invalid Death Guard battle review.');ids.add(r.battleId);}
    const p=s.panels.pathogen?.[0];if(p?.mechanicsVersion===1&&(pathogen(force).unknown.length||pathogen(force).potency!==p.values.potency||p.values.potency>7))throw new Error('Pathogen Potency must equal its printed marks.');
  }
  function apply(force,action,input={}){
    const T=tracker();if(T.factionKey(force)!=='deathGuard')throw new Error('Death Guard rules only.');
    const label=action==='requisition'?({tainted:'Tainted Tinkering',fruits:'Fruits of the Cauldron',careful:'Careful Cultivation',remissive:'Remissive Ruse'})[input.key]:action==='wretched'?'Wretched Might':action==='replace'&&input.kind==='ascension'?'Putrid Ascension':action;
    return T.transact(force,`Death Guard: ${label}`,(n,s)=>{
      if(action==='world')setupWorld(n,s,input);
      else if(action==='editPlague'||action==='adjustPlague'){
        const p=row(s,'plagues',input.plagueId);if(p.values.status!=='Active')throw new Error('Only the active plague can be edited.');
        const fields=['fecundity','population','vulnerability','reproduction','survival','adaptability'];
        if(action==='editPlague'){p.name=text(input.name,'Plague name');p.values.world=text(input.world,'World name');for(const key of fields)p.values[key]=int(input[key],key,key==='population'?0:1,6);}
        else {if(!fields.includes(input.characteristic))throw new Error('Choose a world or plague characteristic.');p.values[input.characteristic]=int(input.value,input.characteristic,input.characteristic==='population'?0:1,6);}
        if(p.values.population===0){p.values.status='Abandoned';p.outcome='Failed';for(const r of panel(s,'dgBattles').filter(r=>r.plagueId===p.id&&r.phase!=='done')){r.phase='done';r.values.status='Completed';}}
      }
      else if(action==='abandon'){const p=row(s,'plagues',input.plagueId);if(p.values.status!=='Active')throw new Error('No active plague to abandon.');p.values.status='Abandoned';p.outcome='Abandoned';for(const r of panel(s,'dgBattles').filter(r=>r.plagueId===p.id&&r.phase!=='done')){r.phase='done';r.values.status='Completed';}}
      else if(action==='review')startReview(n,s,input);
      else if(action==='reap')reap(n,s,review(s,input.reviewId),input);
      else if(action==='step')resolveStep(n,s,review(s,input.reviewId),input);
      else if(action==='restorePathogen')restorePathogen(n,s,input);
      else if(action==='brew')brew(n,s,input);
      else if(action==='requisition')requisition(n,s,input);
      else if(action==='reward')claimReward(n,s,input);
      else if(action==='boon')rollBoon(n,s,input);
      else if(action==='replace')replaceUnit(n,s,input);
      else if(action==='wretched')temporaryTrait(n,s,input);
      else if(action==='spreading')spreadingPox(n,s,input);
      else if(action==='blessing')resolveBlessing(n,s,input);
      else throw new Error('Unknown Death Guard action.');
      for(const r of panel(s,'dgBattles'))if(r.phase==='done'&&r.plagueId&&(!r.finalPlague||r.battleId===(n.battles||[]).at(-1)?.id)){const p=plague(s,r);if(p)r.finalPlague=clone(p);}
      validate(n);
    });
  }
  const api={SOURCE,PRESETS,PROPERTIES,STEPS,BOONS,TRAITS,normal,has,belongs,character,immune,canXP,pathogen,active,totals,reward,properties,traitEligible,validate,apply,afterNewUnits,ownCommandIndex,pathogenActive,activatePathogen};
  global.ArcadienDeathGuard=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
