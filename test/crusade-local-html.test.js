"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {extractPage}=require("../scripts/import-local-crusade-html");
const E=require("../src/domain/crusade-eligibility");
const localRules=require("../data/manual-rules/wh40k10-local-crusade.json");
function blockText(blocks){return blocks.map(block=>block.type==="card"?`${block.title} ${blockText(block.blocks)}`:block.type==="table"?block.rows.flatMap(row=>row.cells.map(cell=>cell.text)).join(" "):block.type==="list"?block.items.join(" "):block.text).join(" ");}
test("formatted blocks preserve every imported agenda and reference word in order",()=>{
  const normalize=value=>value.replace(/[\s•]+/g,"");
  for(const page of [...localRules.pages,...(localRules.books || [])])for(const record of [...page.agendas,...page.sections])assert.equal(normalize(blockText(record.blocks)),normalize(record.description),`${page.faction}: ${record.name}`);
});
test("rules renderer escapes supplied text while preserving cards, lists and table spans",()=>{
  const vm=require("node:vm"),fs=require("node:fs");
  const sandbox={window:{ArcadienCrusadeModel:require("../src/domain/crusade"),localStorage:{getItem:()=>"[]"}}};
  vm.runInNewContext(fs.readFileSync(require.resolve("../mobile/ui/crusades.js"),"utf8"),sandbox);
  const html=sandbox.window.ArcadienCrusades.formatRules([{type:"card",title:"<script>bad</script>",blocks:[{type:"paragraph",text:"Reward: 3XP"},{type:"list",items:["One & two"]},{type:"table",rows:[{cells:[{text:"D6",header:true,colspan:2},{text:"<img src=x>",rowspan:2}]}]}]}]);
  assert.match(html,/crRuleBox/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|<img/);
  assert.match(html,/<li>One &amp; two<\/li>/);assert.match(html,/colspan="2"/);assert.match(html,/rowspan="2"/);assert.match(html,/crRuleValue">3XP/);
});
test("supplied HTML preserves agenda wording, entities and lists without executing or importing scripts",()=>{
  const html=`<script>throw new Error('Do not execute');</script><style>.ad{}</style>
  <div class="sCrusadeRules"><a name="Crusade-Rules"></a><h2 class="outline_header">Crusade Rules</h2>
  <a name="Agendas"></a><h4 class="outline_header">Agendas</h4><div class="Columns2"><div class="stratWrapper_CS">
  <div class="stratName_CS stratAgenda"><span>FAITH &amp; FIRE</span><span><div class="cruD6wrap"></div></span></div>
  <p class="ShowFluff">A warrior&rsquo;s path.</p><div class="stratText_CS">Choose <b>one</b> unit.<br/>It gains 3XP.<ul><li>First condition.</li><li>Second condition.</li></ul></div></div></div></div>
  <div class="tooltip"><div class="stratAgenda">Duplicate tooltip</div></div>`;
  const page=extractPage(html,"Adepta Sororitas - 10th Edition.html");
  assert.equal(page.agendas.length,1);const agenda=page.agendas[0];
  assert.equal(agenda.name,"FAITH & FIRE");assert.equal(agenda.flavour,"A warrior’s path.");
  assert.equal(agenda.description,"Choose one unit.\nIt gains 3XP.\n\n• First condition.\n\n• Second condition.");
  assert.equal(agenda.sourceUrl,"https://wahapedia.ru/wh40k10ed/factions/adepta-sororitas/#Agendas");
  assert.equal(page.sections.length,1);assert.doesNotMatch(page.sections[0].description,/throw|script|tooltip|\.ad/);
});
test("local import records complete supplied faction coverage and stable IDs",()=>{
  assert.equal(localRules.pages.length,25);assert.equal(localRules.pages.filter(page=>page.agendas.length).length,22);
  const agendas=localRules.pages.flatMap(page=>page.agendas);
  assert.equal(agendas.length,148);assert.equal(new Set(agendas.map(item=>item.id)).size,148);
  assert.ok(agendas.every(item=>item.description&&item.sourceFile&&item.sourceUrl.includes('/wh40k10ed/')&&item.edition===10));
  assert.ok(localRules.pages.every(page=>/^[a-f0-9]{64}$/.test(page.sha256)));
  const sisters=localRules.pages.find(page=>page.faction==='Adepta Sororitas');
  assert.deepEqual(sisters.agendas.map(item=>item.name),['TEST OF FAITH','ATONEMENT IN BATTLE','DEFEND THE SHRINE','PIOUS PURGATION']);
  assert.match(sisters.agendas[0].description,/maximum of 3XP/);assert.match(sisters.agendas[0].description,/Saint point/);
  assert.deepEqual(localRules.missing,[]);
  assert.deepEqual(localRules.pages.filter(page=>!page.sections.length).map(page=>page.faction),['Adeptus Titanicus','Chaos Daemons','Unaligned Forces']);
});
test("all five supplied rulebooks retain full text and distinct campaign agenda identities",()=>{
  assert.deepEqual(localRules.books.map(book=>[book.pack,book.agendas.length]),[['Core',0],['Tyrannic War',11],['Pariah Nexus',12],['Nachmund Gauntlet',5],['Armageddon',23]]);
  const all=[...localRules.pages,...localRules.books].flatMap(page=>page.agendas);
  assert.equal(all.length,199);assert.equal(new Set(all.map(item=>item.id)).size,199);
  for(const book of localRules.books){assert.ok(book.sections[0].description.length>30000);assert.match(book.sourceFile,/^Crusade Rules\//);assert.match(book.sourceUrl,/\/the-rules\//);assert.doesNotMatch(book.sections[0].description,/Disable Ads|Pin code:/);}
  assert.match(localRules.books[0].sections[0].description,/Requisitions/);
  const duplicateNames=all.filter(a=>a.name==='DRIVE HOME THE BLADE');assert.equal(duplicateNames.length,2);assert.notEqual(duplicateNames[0].id,duplicateNames[1].id);
  assert.ok(localRules.books.find(book=>book.pack==='Armageddon').agendas.filter(a=>a.section==='Tactical-Agendas').every(a=>a.conditional));
});
test("core is always readable and campaign agendas follow enabled books and mustered faction",()=>{
  const data={localRules},f={faction:'Tyranids',packs:['Core'],units:[{id:'nid',keywords:['Faction: Tyranids']},{id:'ally',keywords:['Faction: Adepta Sororitas']}]};
  assert.deepEqual(E.crusadeBooks(f,data).map(book=>book.pack),['Core']);
  f.packs.push('Tyrannic War','Armageddon');
  const nid=E.crusadeBooks(f,data,['nid']),sisters=E.crusadeBooks(f,data,['ally']);
  assert.deepEqual(nid.map(book=>book.pack),['Core','Tyrannic War','Armageddon']);
  assert.ok(nid[1].agendas.some(a=>a.name==='SWARM THE PLANET'));assert.ok(!nid[1].agendas.some(a=>a.name==='BATTLEFIELD SURVIVORS'));
  assert.ok(sisters[1].agendas.some(a=>a.name==='BATTLEFIELD SURVIVORS'));assert.ok(!sisters[1].agendas.some(a=>a.name==='SWARM THE PLANET'));
  assert.equal(localRules.books.find(book=>book.pack==='Tyrannic War').agendas.length,11,'filtering must not alter imported data');
});
test("book import includes agenda content after malformed wrapper closures and omits tooltip duplicates",()=>{
  const html=`<body><div id="wrapper"><h2 class="outline_header">Books</h2><a name="Introduction"></a><h3 class="outline_header">Introduction</h3><p>First section.</p></div>
    <a name="Agendas"></a><h3 class="outline_header">Agendas</h3><div class="stratWrapper_CS"><div class="stratName_CS stratAgenda"><span>LATE AGENDA</span></div><div class="stratText_CS">This unit gains 2XP.</div></div>
    <div class="tooltip_templates"><div class="stratWrapper_CS"><div class="stratName_CS stratAgenda"><span>DUPLICATE</span></div><div class="stratText_CS">Tooltip.</div></div></div></body>`;
  const page=extractPage(html,'Crusade Rules/Tyrannic War - 10th Edition.html',{name:'Tyrannic War',pack:'Tyrannic War',slug:'tyrannic-war'});
  assert.deepEqual(page.agendas.map(a=>a.name),['LATE AGENDA']);assert.match(page.sections[0].description,/First section/);assert.match(page.sections[0].description,/This unit gains 2XP/);assert.doesNotMatch(page.sections[0].description,/DUPLICATE|Tooltip/);
});
function force(faction,keywords){return {faction,units:[{id:'u',keywords:keywords.map(name=>'Faction: '+name),record:{source:{}}}]};}
test("agenda selection scopes faction and chapter rules to the actual mustered participants",()=>{
  const data={localRules,catalogues:{}};
  const sisters=E.agendaPages(force('Imperium - Adepta Sororitas',['Adepta Sororitas']),['u'],data);
  assert.deepEqual(sisters.map(page=>page.faction),['Adepta Sororitas']);
  const marine=force('Imperium - Adeptus Astartes - Ultramarines',['Adeptus Astartes','Ultramarines']);
  const generic=E.agendaPages(marine,['u'],data).flatMap(page=>page.agendas);
  assert.ok(generic.some(item=>item.name==='ANGELS OF DEATH'));assert.ok(generic.every(item=>item.chapter===null));
  const templars=E.agendaPages(force('Black Templars',['Adeptus Astartes','Black Templars']),['u'],data).flatMap(page=>page.agendas);
  assert.ok(templars.some(item=>item.name==='FULFIL YOUR VOWS'));assert.ok(templars.every(item=>!item.chapter||item.chapter==='Black Templars'));
  marine.units.push({id:'ally',keywords:['Faction: Agents of the Imperium'],record:{source:{}}});
  assert.deepEqual(E.agendaPages(marine,['ally'],data).map(page=>page.faction),['Imperial Agents']);
  assert.deepEqual(E.agendaPages(force('Tau',['T’au Empire']),['u'],data).map(page=>page.faction),['T’au Empire']);
});
