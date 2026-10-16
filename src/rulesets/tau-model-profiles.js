'use strict';
// Crisis leaders reuse their squadmates' linked stat profile in the catalogue.
// Give the leader a distinct identity so both rows and bearer bonuses survive.
function correctCrisisModelProfiles(definition) {
  if (definition.faction !== "Xenos - T'au Empire" || !/^(Crisis |Strike Team$|Breacher Team$|Pathfinder Team$)/.test(definition.name)) return definition;
  const unit=structuredClone(definition);
  function visit(node, bearer = null) {
    if (node.kind === 'model') bearer = node;
    if (node.kind === 'model' && /Shas[’']vre\b/i.test(node.name || '')) {
      node.profiles=(node.profiles || []).map(profile=> profile.typeName === 'Unit' && /Shas[’']ui\b/i.test(profile.name || '')
        ? {...profile,id:profile.id+'-shasvre',name:node.name} : profile);
    }
    if (node.kind === 'upgrade' && /^(Gun|Shield|Marker|Guardian) Drone$/i.test(node.name || '')) {
      node.constraints=(node.constraints || []).map(c=>c.type === 'max' && c.field === 'selections'
        ? {...c,value:1,...(c.raw ? {raw:{...c.raw,value:1}} : {})} : c);
    }
    if (node.name === 'Shield Drone' && bearer) {
      const ids=(bearer.profiles || []).filter(p=>p.typeName==='Unit').map(p=>p.id).filter(Boolean);
      node.profiles=(node.profiles || []).map(p=>({...p,bearerProfileIds:ids}));
    }
    for (const child of node.children || []) visit(child,bearer);
  }
  visit(unit.selectionTree);
  if (unit.name === 'Strike Team') {
    const nodes=[];function collect(n){nodes.push(n);for(const c of n.children || [])collect(c)}collect(unit.selectionTree);
    const leader=nodes.find(n=>n.kind==='model' && /Shas[’']ui/.test(n.name));
    const wargear=leader?.children.find(n=>n.kind==='group' && n.name==='Wargear');
    const rifle=wargear?.children.find(n=>n.name==='Pulse rifle');
    const template=nodes.find(n=>n.kind==='upgrade' && n.name==='Pulse carbine');
    if (rifle && template) {
      const groupId=leader.id+'-primary-weapon';
      const carbine=structuredClone(template);carbine.id=groupId+'-pulse-carbine';
      for(const option of [rifle,carbine])option.constraints=option.constraints.map(c=>({...c,value:c.type==='min'?0:1}));
      wargear.children=wargear.children.filter(n=>n!==rifle);
      wargear.children.push({id:groupId,sourceId:groupId,definitionId:groupId,targetId:null,name:'Primary weapon',kind:'group',points:0,collective:false,hidden:false,forceVisible:false,defaultSelectionId:rifle.id,constraints:['min','max'].map(type=>({id:groupId+'-'+type,type,field:'selections',scope:'parent',value:1,childId:null,includeChildSelections:false,includeChildForces:false})),modifiers:[],profiles:[],rules:[],children:[rifle,carbine]});
    }
  }
  return unit;
}
module.exports={correctCrisisModelProfiles};
