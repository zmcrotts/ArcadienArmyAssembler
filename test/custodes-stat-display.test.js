'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),sheets=require('../src/domain/sheets'),loadout=require('../src/domain/loadout'),data=require('../data/manual-rules/wh40k-11e-custodes-codex.json');
const source=fs.readFileSync(require.resolve('../mobile/ui/engine-app.js'),'utf8'),start=source.indexOf('function renderUnitProfiles(units)'),end=source.indexOf('\nfunction ',start+10);
function render(profiles){const context={escapeHtml:String,renderCharacteristicValue:(p,k,v)=>String(v??'')};vm.runInNewContext(source.slice(start,end)+'\nthis.render=renderUnitProfiles;',context);return context.render(profiles);}
test('every new Custodes datasheet displays printed save and Leadership in previews and sheets',()=>{
 let checked=0;for(const unit of data.units.filter(x=>x.custodesCodexSource)){const raw=loadout.getConfiguredProfiles(unit,loadout.createDefaultRosterEntry(unit)).units;for(const profile of raw){const c=profile.characteristics,save=c.SV??c.Sv,ld=c.LD??c.Ld;assert.ok(save,unit.name);assert.ok(ld,unit.name);assert.ok(render([profile]).includes('<td>'+save+'</td>'),unit.name);assert.ok(render([profile]).includes('<td>'+ld+'</td>'),unit.name);const fixed=sheets.applyUnitEffectsToProfiles([profile])[0].characteristics;assert.equal(fixed.SV,save);assert.equal(fixed.LD,ld);assert.equal(fixed.InSv,c.InSv);checked++;}}
 assert.equal(checked,27);
});
test('mixed-case saved profiles receive canonical fields before modifiers without overwriting existing canonical values',()=>{
 const original={name:'Saved Custodian',characteristics:{Sv:'2+',Ld:'5+',InSv:'4+'}};const fixed=sheets.applyUnitEffectsToProfiles([original],[])[0];assert.equal(fixed.characteristics.SV,'2+');assert.equal(fixed.characteristics.LD,'5+');assert.equal(original.characteristics.SV,undefined);assert.deepEqual(fixed.modifiedCharacteristics,[]);const canonical=sheets.applyUnitEffectsToProfiles([{characteristics:{SV:'3+',Sv:'2+',LD:'6+',Ld:'5+'}}])[0].characteristics;assert.equal(canonical.SV,'3+');assert.equal(canonical.LD,'6+');
});
test('export stat tables retain mixed-case saved native save and Leadership',()=>{
 assert.match(source,/escapeHtml\(c\.SV \?\? c\.Sv \?\? ""\)/);assert.match(source,/escapeHtml\(c\.LD \?\? c\.Ld \?\? ""\)/);
});
