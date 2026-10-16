'use strict';
const fs=require('fs');
const FACTION='Imperium - Adeptus Astartes - Blood Angels';
const clone=x=>JSON.parse(JSON.stringify(x));
const norm=s=>String(s||'').toLowerCase().replace(/\[legends\]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const slug=s=>norm(s).replace(/ /g,'-');
function walk(n,fn){fn(n);for(const c of n.children||[])walk(c,fn)}
function family(s){return norm(String(s).replace(/\[[^\]]*\]/g,'').replace(/\s*\([^)]*\)/g,'').replace(/\s+-\s+.*$/,'')).replace(/^astartes /,'').replace(/fists$/,'fist').replace(/^ceramite fist$/,'ceramite fist').replace(/^perdition$/,'perdition pistol').replace(/^relic fist$/,'relic power fist').replace(/^dreadnought combat weapon$/,'dreadnought fist').replace(/^lancer laser destroyer$/,'laser destroyer').replace(/astareus/g,'astraeus').replace(/^encarmine (blade|spear)$/,'encarmine weapon').replace(/^master crafted power weapon$/,'master crafted power sword').replace(/^godhammer lascannons$/,'godhammer lascannon').replace(/^vanguard veteran weapon$/,'heirloom weapon').replace(/^kratos battlecannon$/,'kratos battle cannon').replace(/^➤\s*/,'').replace(/ hunter.*$/,'');}
function readBloodAngelsWebsite(file){const d=JSON.parse(fs.readFileSync(file,'utf8'));if(d.schemaVersion!==1||d.units.length!==111||new Set(d.units.map(u=>u.name)).size!==111)throw Error('Invalid Blood Angels website snapshot');return d;}
function ability(id,name,description){return {id:id+'-'+slug(name),name,typeName:'Abilities',characteristics:{Description:description}};}
function constraint(id,type,value,scope='parent'){return {id:id+'-'+type,type,field:'selections',scope,value,includeChildSelections:false};}
function node(id,name,kind='upgrade',min=0,max=1,scope='parent'){return {id,sourceId:id,definitionId:id,name,kind,points:0,hidden:false,collective:false,defaultSelectionId:null,constraints:[constraint(id,'min',min,scope),constraint(id,'max',max,scope)],modifiers:[],profiles:[],rules:[],categories:[],children:[]};}
function cap(n,value,step,modelId,threshold){n.constraints=n.constraints.filter(c=>c.type!=='max');const c=constraint(n.id,'max',value,'unit');n.constraints.push(c);n.modifiers=step?[{type:'increment',field:c.id,value:step,conditions:[{childId:modelId,field:'selections',scope:'unit',includeChildSelections:true,type:'atLeast',value:threshold}],conditionGroups:[],repeats:[]}]:[];return n;}
function sourceWeapons(s,name){return s.weapons.filter(w=>family(w.name)===family(name));}
function weaponNode(id,name,s,min=0,max=1){const n=node(id,name,'upgrade',min,max);n.profiles=sourceWeapons(s,name).map((w,i)=>({...clone(w),id:id+'-weapon-'+i}));if(!n.profiles.length)throw Error(s.name+': missing weapon '+name);return n;}
function repairTrees(u,s){
 const root=u.selectionTree;
 if(s.name==='Sicaran'){walk(root,n=>{if(n.id==='ba-sicaran-turret')return;const i=(n.children||[]).findIndex(c=>family(c.name)==='herakles pattern autocannon');if(i<0)return;const old=n.children[i];old.constraints=old.constraints.map(c=>c.type==='min'?{...c,value:0}:c);const choice=node('ba-sicaran-turret','Main weapon','group',1,1);choice.children=[old,...['Arcus Multi-launcher','Omega Plasma Array','Punisher Rotary Cannon','Venator Neutron Laser'].map(name=>weaponNode('ba-sicaran-'+slug(name),name,s))];choice.defaultSelectionId=old.id;n.children[i]=choice;});}
 if(s.name==='Sanguinary Guard'){
  walk(root,n=>{n.children=(n.children||[]).filter(c=>!/^Sanguinary Banner$|^Terminator Honours/.test(c.name));if(n.name==='Melee Weapon'){const blade=n.children.find(c=>/encarmine blade/i.test(c.name));const spear=n.children.find(c=>/encarmine spear/i.test(c.name));if(blade){blade.legacySelectionIds=[...(blade.legacySelectionIds||[]),...(spear?[spear.id]:[])];blade.name='Encarmine Weapon';blade.profiles=sourceWeapons(s,'Encarmine Weapon').map((w,i)=>({...clone(w),id:blade.id+'-weapon-'+i}));n.children=[blade];n.defaultSelectionId=blade.id;}}});
  let model;walk(root,n=>{if(n.kind==='model'&&/Sanguinary Guard/.test(n.name))model=n});walk(root,n=>{if(/inferno pistol/i.test(n.name)&&n.kind==='upgrade')cap(n,1,1,model.id,6)});
 }
 if(s.name==='Death Company Captain with Jump Pack'){
  const war=root.children.find(n=>n.name==='Wargear');if(war&&!war.children.some(n=>n.id==='ba-dccjp-loadout')){
   const standard=node('ba-dccjp-standard','Pistol and melee weapon','upgrade',0,1);standard.children=war.children;
   const bundles=['Thunder Hammer','Chainsword'].map((name,i)=>{const n=weaponNode('ba-dccjp-shield-'+i,name+'',s);n.name=name+' and Relic Shield';n.profiles.push(ability(n.id,'Relic Shield','This model has +1 W.'));return n});
   const choice=node('ba-dccjp-loadout','Equipment','group',1,1);choice.children=[standard,...bundles];choice.defaultSelectionId=standard.id;war.children=[choice];
  }
 }
 if(s.name==='Death Company Marines'){
  let oldModel;walk(root,n=>{if(n.kind==='model'&&/^Death Company Marine$/.test(n.name))oldModel=n});
  const model=node(oldModel?.id||'ba-dc-marine','Death Company Marine','model',5,10);model.profiles=clone(oldModel?.profiles||[]);
  const melee=node('ba-dc-melee','Melee weapon','group',1,1),pistol=node('ba-dc-pistol','Pistol','group',1,1);
  const chain=weaponNode('ba-dc-chainsword','Chainsword',s),bolt=weaponNode('ba-dc-heavy-bolt-pistol','Heavy Bolt Pistol',s);
  const rifle=weaponNode('ba-dc-rifle','Bolt Rifle',s);rifle.name='Bolt Rifle and Combat Blade';rifle.profiles.push(...sourceWeapons(s,'Combat Blade').map((w,i)=>({...clone(w),id:rifle.id+'-blade-'+i})));
  const evis=cap(weaponNode('ba-dc-eviscerator','Eviscerator',s),1,1,model.id,10);
  const specialMelee=node('ba-dc-special-melee','Special melee weapon','group',0,1,'unit');specialMelee.children=['Power Fist','Power Weapon','Thunder Hammer'].map(n=>weaponNode('ba-dc-'+slug(n),n,s));
  const specialPistol=node('ba-dc-special-pistol','Special pistol','group',0,1,'unit');specialPistol.children=['Hand Flamer','Inferno Pistol','Plasma Pistol'].map(n=>weaponNode('ba-dc-'+slug(n),n,s));
  melee.children=[chain,rifle,evis,specialMelee];melee.defaultSelectionId=chain.id;pistol.children=[bolt,specialPistol];pistol.defaultSelectionId=bolt.id;
  const gl=cap(weaponNode('ba-dc-grenade-launcher','Grenade Launcher',s),0,0,model.id,10);const glMax=gl.constraints.find(c=>c.type==='max');gl.modifiers=[1,2].map(count=>({type:'increment',field:glMax.id,value:1,conditions:[{childId:model.id,field:'selections',scope:'unit',type:'atLeast',value:count*5},{childId:rifle.id,field:'selections',scope:'unit',type:'atLeast',value:count}],conditionGroups:[],repeats:[]}));
  // Launcher bearers must have rifles; the quota itself is per five models in the unit.
  const glGroup=node('ba-dc-rifle-launcher','Rifle grenade launcher','group',0,1);glGroup.children=[gl];
  gl.modifiers.push({type:'set',field:gl.constraints.find(c=>c.type==='max').id,value:0,conditions:[{childId:rifle.id,field:'selections',scope:'unit',type:'lessThan',value:1}],conditionGroups:[],repeats:[]});
  model.children=[melee,pistol,glGroup];root.children=[model];u.composition=[{id:model.id,name:model.name,min:5,max:10,defaultCount:5,points:0,source:'model'}];u.compositionConstraints=[];
 }
}
function updateUnit(original,s,source,diagnostics,options={}){
 const u=clone(original),root=u.selectionTree;repairTrees(u,s);
 const used=new Set(),removed=[];
 function visit(n,parentModel){
  const modelName=n.kind==='model'?n.name:parentModel;
  const old=n.profiles||[],weapons=old.filter(p=>/Weapons$/.test(p.typeName)),done=new Set();
  n.profiles=old.filter(p=>p.typeName==='Unit').map(p=>{const identity=norm(modelName||p.name);const m=options.modelFor?.(p,modelName,s)||s.models.find(m=>norm(m.name)===identity)||s.models.find(m=>norm(m.name).replace(' with ',' w ')===identity)||s.models.find(m=>/sergeant/.test(norm(m.name))===/sergeant/.test(identity))||s.models[0];if(!m)throw Error(s.name+': no source model');return {...p,name:modelName||m.name,characteristics:clone(m.characteristics),modifiers:[]};});
  for(const p of weapons){let key=options.weaponKey?options.weaponKey(p.name,s,n,modelName):family(p.name);if(key==='close combat weapon'&&/^(?:Venerable )?Dreadnought$/.test(s.name))key='crushing feet';if(key==='close combat weapon'&&s.name==='Rapier Carrier')key='armoured hull';if(key==='close combat weapon'&&['Heavy Intercessor Squad','Hellblaster Squad'].includes(s.name))key='ceramite fist';if(key==='storm bolter'&&s.name==='Terrax-pattern Termite')key='combi weapon';const matches=s.weapons.filter(w=>(options.weaponKey?options.weaponKey(w.name,s):family(w.name))===key&&w.typeName===p.typeName);if(!matches.length){removed.push(p.name);continue}const k=key+'|'+p.typeName;if(done.has(k))continue;done.add(k);for(const [i,w] of matches.entries()){used.add(s.weapons.indexOf(w));n.profiles.push({...clone(w),id:p.id+'-website-'+i,countMultiplier:p.countMultiplier||1});}}
  // Source profiles replace obsolete stat and keyword modifiers from the old sheet.
  n.modifiers=(n.modifiers||[]).filter(m=>n.constraints.some(c=>c.id===m.field)||m.field==='hidden');
  n.rules=[];for(const c of n.children||[]){const hadWeapon=(c.profiles||[]).some(p=>/Weapons$/.test(p.typeName));visit(c,modelName);c.obsoleteWebsiteWeapon=hadWeapon&&!c.profiles.length&&!c.children?.length;}n.children=(n.children||[]).filter(c=>!c.obsoleteWebsiteWeapon);for(const c of n.children)delete c.obsoleteWebsiteWeapon;if(n.defaultSelectionId&&!n.children.some(c=>c.id===n.defaultSelectionId))n.defaultSelectionId=n.children.find(c=>!c.hidden)?.id||null;
 }
 visit(root);
 // Some new sheets introduce a mandatory weapon that did not exist in the old tree.
 for(const [i,w] of s.weapons.entries())if(!used.has(i)){
  if((s.composition[0]?.toLowerCase().includes(w.name.toLowerCase())||(options.weaponKey&&norm(s.composition[0]).includes(norm(w.name.replace(/ \(.*/,'')))))&&s.models.length===1){root.profiles.push({...clone(w),id:root.id+'-new-weapon-'+i});used.add(i)}
  else diagnostics.unmatchedWeapons.push({unit:s.name,name:w.name});
 }
 for(const a of s.abilities){let description=a.description.replace('[DEVASTATING WOUNDS:non[-MONSTER/VEHICLE]](#kw)','[DEVASTATING WOUNDS: NON-MONSTER/VEHICLE]');
  if(a.name.startsWith('Chief Librarian')||(options.weaponKey&&/^(?:High Rune Priest|Librarian|Rune Priest) \(psyker/.test(a.name)))description=description.split('\n\n')[0];
  const matches=[];walk(root,n=>{if((n.kind==='upgrade'||n.kind==='model')&&(family(n.name)===family(a.name.replace(/ \(.*/,''))||family(n.name).replace(/s$/,'')===family(a.name).replace(/s$/,'')||n.name.endsWith(' and '+a.name)))matches.push(n)});
  const equipment=/^(Relic Shield|Storm Shield|Combat Shield|Shield Dome|Orbital Comms Array|Helix Gauntlet|Grav-chutes|Grapnel Launchers)$/.test(a.name);const targets=matches.length?matches:(equipment&&s.composition.some(t=>new RegExp('(?:replaced|equipped).*'+a.name,'i').test(t))?[]:[root]);if(equipment&&!targets.length)diagnostics.unmatchedEquipment.push({unit:s.name,name:a.name});for(const n of targets)n.profiles.push(ability(n.id,a.name,description));
 }
 for(const m of s.models)if(m.saveCondition)root.profiles.push(ability(root.id,'Invulnerable Save ('+m.name+')',m.characteristics.InSv.replace('*','')+' – '+m.saveCondition));
 const factionRules=require('../../data/manual-rules/wh40k-11e-space-marines-codex.json').armyRules||[];
 for(const name of [...s.core,...s.factionAbilities]){let existing;walk(original.selectionTree,n=>{existing=existing||(n.profiles||[]).find(p=>norm(p.name)===norm(name))||(n.rules||[]).find(p=>norm(p.name)===norm(name))});const rule=factionRules.find?.(r=>norm(r.name)===norm(name));root.profiles.push(ability(root.id,name,/^(LEADER|SUPPORT)$/.test(name)?s.attachments.map(a=>a.role+': '+a.names.join(', ')).join('\n'):rule?.description||existing?.characteristics?.Description||existing?.description||name));}
 root.profiles.push(ability(root.id,'Unit composition and wargear options',s.composition.join('\n\n')));
 const tags=[...s.keywords.map(k=>k.toLowerCase().replace(/\b\w/g,c=>c.toUpperCase())),'Faction: Adeptus Astartes','Faction: '+(options.chapter||'Blood Angels')];if(/\[Legends\]/.test(u.name))tags.push('Legends');u.keywords=tags;u.categories=tags;u.conditionalKeywords=[];
 const has=k=>s.keywords.includes(k);u.roles={...u.roles,character:has('CHARACTER'),epicHero:has('EPIC HERO'),battleline:has('BATTLELINE'),dedicatedTransport:has('DEDICATED TRANSPORT'),leader:s.attachments.length>0,support:s.attachments.some(a=>a.role==='Supports')};
 u.rosterRules={...u.rosterRules,leaderTargetNames:s.attachments.flatMap(a=>a.names),leaderTargetSelectionKeys:[],leaderTargetPredicates:[],allowsAdditionalLeader:u.roles.support,mfmAttachmentRole:u.roles.support?'SUPPORT':u.roles.leader?'LEADER':null,mfmAttachmentSource:s.url};
 const sizeCosts=s.costs.map(t=>t.match(/^(\d+) models?\n(\d+) pts$/)).filter(Boolean).map(m=>({count:+m[1],points:+m[2]}));const extra=s.costs.map(t=>t.match(/^(\d+)(?:st|nd|rd|th)\+ in your army\n\+(\d+) pts$/)).find(Boolean);
 if(sizeCosts.length){const rows=[];for(const c of sizeCosts){const base={source:s.url,context:null,costBand:'YOUR UNIT COSTS',label:c.count+' models',points:c.points,copies:{min:0,max:extra?+extra[1]-2:null},modelCount:c.count,composition:null};rows.push(base);if(extra)rows.push({...base,points:c.points+(+extra[2]),copies:{min:+extra[1]-1,max:null}})}u.pricing={base:sizeCosts[0].points,baseSource:s.url,unitBase:sizeCosts[0].points,modifiers:[],mfmRows:rows};root.points=sizeCosts[0].points;walk(root,n=>{if(n!==root)n.points=0});}
 u[options.sourceField||'bloodAngelsWebsiteSource']={date:source.date,url:s.url};diagnostics.updated.push(s.name);if(removed.length)diagnostics.removedWeapons.push({unit:s.name,names:[...new Set(removed)]});return u;
}
function applyBloodAngelsWebsite(units,armies,source){
 const diagnostics={updated:[],unmatchedModels:[],unmatchedWeapons:[],removedWeapons:[],unmatchedEquipment:[]};const lookup=new Map(source.units.map(s=>[norm(s.name),s]));lookup.set('tarantula air defense battery',lookup.get('tarantula air defence battery'));lookup.set('sicaran battle tank',lookup.get('sicaran'));
 const canonicalBike=units.find(u=>u.faction===FACTION&&u.name==='Captain on Bike');
 const updated=units.map(u=>u.faction===FACTION&&lookup.has(norm(u.name))?updateUnit(u.name==='Captain on Bike [Legends]'?{...canonicalBike,id:u.id,selectionKey:u.selectionKey,name:u.name}:u,lookup.get(norm(u.name)),source,diagnostics):u);
 for(const [canonical,aliases] of [['Death Company Marines',['Death Company Marines with Bolt Rifles','Death Company Intercessors']],['Sicaran Battle Tank [Legends]',['Sicaran Arcus [Legends]','Sicaran Omega [Legends]','Sicaran Punisher [Legends]','Sicaran Venator [Legends]']],['Captain on Bike',['Captain on Bike [Legends]']]]){const target=updated.find(u=>u.faction===FACTION&&u.name===canonical);if(!target)continue;const old=updated.filter(u=>u.faction===FACTION&&aliases.includes(u.name));target.previousSelectionKeys=[...(target.previousSelectionKeys||[]),...old.map(u=>u.selectionKey)];target.previousNames=[...(target.previousNames||[]),...old.map(u=>u.name)];for(const u of old){u.rosterSelectable=false;u.sourceDisposition='consolidated-website-datasheet';}if(canonical.startsWith('Sicaran')){target.previousNames.push(target.name);target.name='Sicaran [Legends]';}}
 const ba=updated.filter(u=>u.faction===FACTION);for(const u of ba.filter(u=>u.bloodAngelsWebsiteSource)){const targets=new Set(u.rosterRules.leaderTargetNames.map(norm));u.rosterRules.leaderTargetSelectionKeys=ba.filter(t=>targets.has(norm(t.name))).map(t=>t.selectionKey);}
 for(const s of source.units)if(!diagnostics.updated.includes(s.name))throw Error('Website datasheet was not applied: '+s.name);
 if(diagnostics.unmatchedWeapons.length||diagnostics.unmatchedModels.length||diagnostics.unmatchedEquipment.length)throw Error('Incomplete website mapping: '+JSON.stringify(diagnostics));
 return {units:updated,armies,summary:diagnostics};
}
module.exports={readBloodAngelsWebsite,applyBloodAngelsWebsite,family,updateUnit};
