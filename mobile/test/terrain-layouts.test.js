"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const source=fs.readFileSync(require.resolve("../ui/play-mode.js"),"utf8");
const manifest=require("../../ui/assets/11th/terrain-layouts/manifest.json");
function runtime(){
  const context={TERRAIN_LAYOUTS:manifest.layouts,normalize:value=>String(value||"").toLowerCase(),session:{setup:{}}};
  vm.runInNewContext(source.slice(source.indexOf("  function terrainOptionsForSession("),source.indexOf("  function bindDoubleTap(")),context);
  return context;
}
test("every ordered disposition matchup has exactly three maps with correct player sides",()=>{
  const c=runtime(),names=[...new Set(manifest.layouts.flatMap(layout=>[layout.redDisposition.name,layout.blueDisposition.name]))];
  for(const you of names)for(const opponent of names){
    c.session.setup={yourDispositionName:you,opponentDispositionName:opponent};
    const layouts=c.terrainOptionsForSession();assert.equal(layouts.length,3,`${you} vs ${opponent}`);
    assert.deepEqual(Array.from(layouts,l=>l.option),['A','B','C']);
    for(const layout of layouts){const sides=c.terrainPlayerSides(layout);assert.equal(layout[sides.you+'Disposition'].name,you);assert.equal(layout[sides.opponent+'Disposition'].name,opponent);assert.notEqual(sides.you,sides.opponent);}
  }
});
test("thumbnail and saved-game image URLs use current content hashes without changing saved records",()=>{
  const c=runtime(),layout=manifest.layouts.find(l=>l.id==='take_and_hold_x_purge_the_foe_option_a');
  const saved={id:layout.id,image:layout.image+'?v=old-june-copy',sourcePage:12};const before=JSON.stringify(saved);
  const expected=layout.image+'?v='+layout.sha256.slice(0,16);
  assert.equal(c.terrainImageSource(layout),expected);assert.equal(c.terrainImageSource(saved),expected);
  assert.equal(JSON.stringify(saved),before);
  assert.equal(c.terrainImageSource({image:'legacy-layout.webp'}),'legacy-layout.webp');
});
