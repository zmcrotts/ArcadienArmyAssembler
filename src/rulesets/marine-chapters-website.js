'use strict';
const fs = require('fs');
const {updateUnit, family} = require('./blood-angels-website');
const clone = x => JSON.parse(JSON.stringify(x));
const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/\[legends\]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const singular = s => norm(s).replace(/wolves/g, 'wolf').replace(/\b([a-z]{4,})s\b/g, '$1');
function walk(n, fn) { fn(n); for (const c of n.children || []) walk(c, fn); }
function node(id, name, kind, min = 0, max = 1) {
  return {id, sourceId:id, definitionId:id, name, kind, points:0, hidden:false, collective:false,
    constraints:['min','max'].map((type,i)=>({id:id+'-'+type,type,field:'selections',scope:'parent',value:i?max:min,includeChildSelections:false})),
    modifiers:[], profiles:[], rules:[], categories:[], children:[]};
}
function readMarineChaptersWebsite(file) {
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (d.schemaVersion !== 1 || d.rosters.length !== 6 || d.units.length !== 161) throw Error('Invalid chapter website snapshot');
  return d;
}
function weaponKey(name, sheet, n, model) {
  let key = family(name).replace(/^the /,'').replace(/\bcorvus hammers\b/,'corvus hammer');
  if (key === 'black knight combat weapon') key='corvus hammer';
  if (key === 'relic great axe') key='relic greataxe';
  if (key === 'combat blade' && sheet.name === 'Wolf Scouts') key='combat knife';
  if (key === 'artificer crozius arcanum' && sheet.name === 'Ulrik the Slayer') key = 'artificer crozius';
  if (key === 'teeth and claws' && sheet.name === 'Thunderwolf Cavalry') key = 'crushing teeth and claws';
  if (key === 'close combat weapon' && ['Land Speeder Vengeance','Ravenwing Darkshroud'].includes(sheet.name)) key = 'armoured hull';
  if (key === 'close combat weapon' && sheet.name === 'Wardens of Ultramar') key = /Gadriel/.test(model || '') ? 'ceramite fist' : 'ultramarian combat weapons';
  if (key === 'combat weapon' && sheet.name === 'Wolf Scouts') key = 'combat knife';
  return key;
}
function modelFor(profile, parentName, sheet) {
  const id = singular(parentName || profile.name).replace(/kornelius/g,'komelius');
  const score = m => {
    const name = singular(m.name), a = new Set(id.split(' ')), b = name.split(' ');
    let value = b.filter(t=>a.has(t)).length / new Set([...a,...b]).size;
    if (name === id) value += 10;
    for (const role of ['sergeant','servitor','champion','ancient','hunting','wolf']) {
      if (new RegExp('\\b'+role+'\\b').test(id) !== new RegExp('\\b'+role+'\\b').test(name)) value -= 1;
    }
    return value;
  };
  return [...sheet.models].sort((a,b)=>score(b)-score(a))[0];
}
function prepareTree(unit, sheet) {
  const u = clone(unit), root = u.selectionTree;
  if(sheet.name==='Wardens of Ultramar') {
    walk(root,n=>{n.profiles=(n.profiles||[]).filter(p=>p.typeName!=='Unit');});
    walk(root,n=>{if(n.kind==='model')n.profiles.push({id:n.id+'-website-model',name:n.name,typeName:'Unit',characteristics:{}});});
  }
  if (sheet.name === 'Wolf Guard Headtakers') {
    let heads, wolves;
    walk(root,n=>{if(n.kind==='group'&&/^3-6 Wolf Guard Headtakers$/.test(n.name))heads=n;if(n.kind==='model'&&n.name==='Hunting Wolves')wolves=n;});
    if(!heads||!wolves)throw Error('Missing Headtaker composition');
    heads=clone(heads);wolves=clone(wolves);const groupId=heads.definitionId;
    wolves.constraints=['min','max'].map(type=>({id:wolves.id+'-website-'+type,type,field:'selections',scope:'parent',value:3}));
    wolves.modifiers=wolves.constraints.map(c=>({type:'set',field:c.id,value:6,conditions:[{childId:groupId,field:'selections',scope:'unit',includeChildSelections:true,type:'atLeast',value:6}],conditionGroups:[],repeats:[]}));
    const add=node(root.id+'-hunting-wolves','Add Hunting Wolves','upgrade',0,1);add.activateWhenDescendantSelected=true;add.children=[wolves];root.children=[heads,add];
    u.composition=u.composition.map(c=>/Hunting Wolves/.test(c.name)?{...c,min:0,max:null,defaultCount:0}:c);
    u.compositionConstraints=u.compositionConstraints.filter(c=>c.selectionIds.every(id=>id!==wolves.definitionId));
  }
  if (sheet.name === 'Tarantula Sentry Battery') {
    const model = node(root.id+'-battery-model', 'Tarantula Sentry Battery', 'model', 1, 3);
    model.profiles = root.profiles.filter(p=>p.typeName === 'Unit');
    model.children = root.children;
    root.profiles = root.profiles.filter(p=>p.typeName !== 'Unit'); root.children = [model];
    u.composition = [{id:model.id,name:model.name,min:1,max:3,defaultCount:1,points:0,source:'model'}]; u.compositionConstraints=[];
  }
  return u;
}
function kaius(faction, catalogue, rulesetId) {
  const id='website-kaius-konorius', root=node(id,'Kaius Konorius','unit',1,1);
  root.constraints=[]; // The root unit is implicit; selectable constraints belong on child models.
  root.profiles=[{id:id+'-model',name:'Kaius Konorius',typeName:'Unit',characteristics:{}}];
  return {schemaVersion:1,id,selectionKey:catalogue+':'+id,name:'Kaius Konorius',faction,rulesetId,
    source:{catalogueId:catalogue,selectionCatalogueId:catalogue,sourceFile:'40k.app Ultramarines',targetId:id},
    rosterSelectable:true,sourceDisposition:'priced-roster-unit',keywords:[],categories:[],categoryIds:[],conditionalKeywords:[],roles:{},
    rosterRules:{canBeWarlord:true,maxCopies:1,leaderTargetNames:[],leaderTargetSelectionKeys:[],leaderTargetPredicates:[]},
    composition:[{id,name:'Kaius Konorius',min:1,max:1,defaultCount:1,points:0,source:'self-model'}],compositionConstraints:[],pricing:{},selectionTree:root};
}
function sourceForPackage(sheet, unit) {
  const s=clone(sheet);
  if(s.name==='Cato Sicarius'){
    s.attachments=[{role:'Leads',names:[...new Set(s.attachments.flatMap(a=>a.names))]}];
    s.core=s.core.filter(name=>name!=='SUPPORT');
  }
  // Nested relic/aura entries are already printed inside the parent choice rule.
  // Keeping them as independent static effects would grant every choice at once.
  s.abilities = s.abilities.filter(a=>!s.abilities.some(parent=>parent !== a && !/psyker level/i.test(parent.name)
    && parent.description.includes(a.name) && parent.description.includes(a.description)));
  for (const a of s.abilities) {
    a.description = a.description.replace(/\[SUSTAINED HITS 1: non-\[Monster\/vehicle\]\]\(#kw\)/g,'[SUSTAINED HITS 1: NON-MONSTER/VEHICLE]');
  }
  return s;
}
function attachModelSpecificInvulnerables(u, s) {
  // Some old sheets baked equipped shields into the statline. The source now
  // gives their bonus through a selected equipment ability.
  walk(u.selectionTree,n=>{
    const p=n.profiles?.find(p=>p.typeName==='Unit'); if (!p) return;
    if (/storm shield/i.test(n.name) && s.abilities.some(a=>a.name==='Storm Shield')) {
      const has = n.children.some(c=>/storm shield/i.test(c.name));
      if (!has) {
        const shield=node(n.id+'-source-shield','Storm Shield','upgrade',1,1);
        n.children.push(shield);
      }
    }
  });
}
function applyMarineChaptersWebsite(units, armies, source, rulesetId='wh40k-11e-vflam') {
  let updated = units.slice(); const armyDefs=armies.map(clone);
  const diagnostics={updated:[],unmatchedModels:[],unmatchedWeapons:[],unmatchedEquipment:[],removedWeapons:[]};
  const perFaction=[];
  for (const roster of source.rosters) {
    const faction='Imperium - Adeptus Astartes - '+roster.name;
    const factionUnits=updated.filter(u=>u.faction===faction);
    const catalogue=factionUnits[0].selectionKey.split(':')[0];
    const added=[]; const matched=new Set(); const detail=[];
    for (const url of roster.units) {
      const sheet=source.units.find(s=>s.url===url); if (!sheet) throw Error('Missing source sheet '+url);
      let wanted=norm(sheet.name);
      if (wanted==='sicaran') wanted='sicaran battle tank';
      if (wanted==='tarantula air defence battery') wanted='tarantula air defense battery';
      if (wanted==='marneus calgar') wanted='marneus calgar in armour of antilochus';
      let candidates=factionUnits.filter(u=>norm(u.name)===wanted);
      const specific=url.startsWith(roster.url+'/units/');
      const preferred=candidates.filter(u=>specific?!u.source?.importedFromFaction:!!u.source?.importedFromFaction);
      if (preferred.length) candidates=preferred;
      if (candidates.some(u=>!u.name.includes('[Legends]'))) candidates=candidates.filter(u=>!u.name.includes('[Legends]'));
      if (sheet.name==='Wolf Guard Headtakers'&&candidates.length>1)candidates=candidates.slice(0,1);
      if (!candidates.length && sheet.name==='Kaius Konorius') {const u=kaius(faction,catalogue,rulesetId);candidates=[u];added.push(u.selectionKey);}
      if (!candidates.length) throw Error(faction+': no match for '+sheet.name);
      for (const original of candidates) {
        let u=prepareTree(original,sheet); const s=sourceForPackage(sheet,u);
        attachModelSpecificInvulnerables(u,s);
        const before=diagnostics.updated.length;
        u=updateUnit(u,s,source,diagnostics,{chapter:roster.name,sourceField:'marineChaptersWebsiteSource',modelFor,weaponKey});
        if(roster.name==='Dark Angels'){
          const tags=new Set(u.keywords.map(norm)),grants=[];
          // Internal spelling alias used by the photographed enhancement limiter.
          if(sheet.name==='Land Speeder Vengeance')grants.push('Landspeeder Vengeance');
          if(tags.has('mounted')||(tags.has('vehicle')&&tags.has('fly')))grants.push('Ravenwing');
          if(tags.has('terminator')||/dreadnought/i.test(sheet.name)||['Bladeguard Ancient','Bladeguard Veteran Squad','Sternguard Veteran Squad','Vanguard Veteran Squad with Jump Packs','Land Raider','Land Raider Crusader','Land Raider Redeemer','Repulsor','Repulsor Executioner'].includes(sheet.name))grants.push('Deathwing');
          u.keywords=[...new Set([...u.keywords,...grants])];u.categories=[...new Set([...u.categories,...grants])];
          u.marineChaptersWebsiteSource.armyKeywordRulesUrl='https://www.40k.app/factions/dark-angels/army-rules';
        }
        if(sheet.name==='Cato Sicarius')u.rosterRules.supportWhenUnitNames=['Marneus Calgar','Marneus Calgar in Armour of Antilochus'];
        if(sheet.name==='Wolf Guard Headtakers') {
          const rows=[];const comps=u.composition;const shield=comps.find(c=>/Storm Shield/.test(c.name)),paired=comps.find(c=>/paired/.test(c.name)),wolf=comps.find(c=>/Hunting Wolves/.test(c.name));
          for(const heads of [3,6])for(const withWolves of [false,true])for(let count=0;count<=heads;count++)for(const later of [false,true]){
            rows.push({source:sheet.url,context:null,costBand:'YOUR UNIT COSTS',label:(heads*(withWolves?2:1))+' models',modelCount:null,
              composition:[{name:shield.name,count},{name:paired.name,count:heads-count},{name:wolf.name,count:withWolves?heads:0}],
              points:(heads===3?(withWolves?115:85):(withWolves?230:170))+(later?10:0),copies:{min:later?2:0,max:later?null:1}});
          }u.pricing.mfmRows=rows;
        }
        if (sheet.name==='Kaius Konorius') {
          // All three profiles belong to his two fixed weapons, including both melee modes.
          const root=u.selectionTree;
          for (const [i,w]of s.weapons.entries()) if (!root.profiles.some(p=>p.name===w.name&&p.typeName===w.typeName)) {
            root.profiles.push({...clone(w),id:root.id+'-fixed-weapon-'+i});
            diagnostics.unmatchedWeapons=diagnostics.unmatchedWeapons.filter(x=>x.unit!==s.name||x.name!==w.name);
          }
        }
        if (specific && sheet.name==='Venerable Dreadnought' && u.name.includes('[Legends]')) {
          u.previousNames=[...(u.previousNames||[]),u.name];u.name=sheet.name;
          u.keywords=u.keywords.filter(k=>k!=='Legends');u.categories=u.categories.filter(k=>k!=='Legends');
        }
        const index=updated.findIndex(v=>v.faction===faction&&v.selectionKey===u.selectionKey);
        if (index<0) updated.push(u); else updated[index]=u;
        matched.add(u.selectionKey);detail.push({name:sheet.name,key:u.selectionKey,url,updated:diagnostics.updated.length>before});
      }
    }
    const head=updated.find(u=>u.faction===faction&&u.name==='Wolf Guard Headtakers'&&u.marineChaptersWebsiteSource);
    if(head){const old=updated.filter(u=>u.faction===faction&&u.name===head.name&&u.selectionKey!==head.selectionKey);head.previousSelectionKeys=[...(head.previousSelectionKeys||[]),...old.map(u=>u.selectionKey)];for(const u of old){u.rosterSelectable=false;u.sourceDisposition='consolidated-website-datasheet';}}
    for (const [canonical,aliases]of [['Sicaran Battle Tank [Legends]',['Sicaran Arcus [Legends]','Sicaran Omega [Legends]','Sicaran Punisher [Legends]','Sicaran Venator [Legends]']],['Captain on Bike',['Captain on Bike [Legends]']]]) {
      const target=updated.find(u=>u.faction===faction&&u.name===canonical);if (!target)continue;
      const old=updated.filter(u=>u.faction===faction&&aliases.includes(u.name));
      target.previousSelectionKeys=[...(target.previousSelectionKeys||[]),...old.map(u=>u.selectionKey)];
      target.previousNames=[...(target.previousNames||[]),...old.map(u=>u.name)];
      for(const u of old){u.rosterSelectable=false;u.sourceDisposition='consolidated-website-datasheet';}
      if(canonical.startsWith('Sicaran')){target.previousNames.push(target.name);target.name='Sicaran [Legends]';}
    }
    const live=updated.filter(u=>u.faction===faction&&u.rosterSelectable!==false);
    for(const u of live.filter(u=>u.marineChaptersWebsiteSource)){
      const targets=new Set(u.rosterRules.leaderTargetNames.map(norm));
      u.rosterRules.leaderTargetSelectionKeys=live.filter(t=>targets.has(norm(t.name))||t.previousNames?.some(n=>targets.has(norm(n)))).map(t=>t.selectionKey);
    }
    for(const army of armyDefs)if(army.faction===faction||army.name===faction||army.id===faction){army.allowedSelectionKeys=[...new Set([...(army.allowedSelectionKeys||[]),...live.filter(u=>u.marineChaptersWebsiteSource).map(u=>u.selectionKey)])];}
    perFaction.push({faction,listedSheets:roster.units.length,updatedPackages:matched.size,added,details:detail});
  }
  if(diagnostics.unmatchedWeapons.length||diagnostics.unmatchedEquipment.length)throw Error('Incomplete website mapping: '+JSON.stringify({weapons:diagnostics.unmatchedWeapons,equipment:diagnostics.unmatchedEquipment}));
  return {units:updated,armies:armyDefs,summary:{...diagnostics,perFaction}};
}
module.exports={readMarineChaptersWebsite,applyMarineChaptersWebsite};
