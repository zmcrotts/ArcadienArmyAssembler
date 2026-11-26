"use strict";
// Reads only user-supplied files. Saved page scripts are never executed.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {XMLParser}=require("fast-xml-parser");
const decoder=new XMLParser({htmlEntities:true,parseTagValue:false,trimValues:false});
const ROOT=path.resolve(__dirname,"..");
const BOOKS=[{name:"Core Crusade Rules",pack:"Core",slug:"crusade-rules"},...['Tyrannic War','Pariah Nexus','Nachmund Gauntlet','Armageddon'].map(name=>({name,pack:name,slug:name.toLowerCase().replace(/ /g,'-')}))];
function decode(value){
  return String(decoder.parse(`<text>${String(value).replace(/</g,"&lt;")}</text>`).text || "");
}
function parseHtml(html){
  const root={tag:"root",attrs:{},children:[],parent:null,index:0},stack=[root];
  const source=html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,"");
  const tokens=source.matchAll(/<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][^<>]*>|[^<]+/gi);
  const voids=new Set(["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"]);
  for(const token of tokens){
    const value=token[0];
    if(value.startsWith("<!"))continue;
    if(!value.startsWith("<")){stack.at(-1).children.push({tag:"text",value:decode(value),parent:stack.at(-1),index:token.index});continue;}
    const tag=/^<\/?([\w-]+)/.exec(value)?.[1].toLowerCase(); if(!tag)continue;
    if(value.startsWith("</")){const i=stack.findLastIndex(node=>node.tag===tag);if(i>0)stack.length=i;continue;}
    const attrs={};
    for(const match of value.slice(tag.length+1,-1).matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))attrs[match[1].toLowerCase()]=decode(match[2]??match[3]??match[4]??"");
    const node={tag,attrs,children:[],parent:stack.at(-1),index:token.index};node.parent.children.push(node);
    if(!voids.has(tag)&&!value.endsWith("/>"))stack.push(node);
  }
  return root;
}
const classes=node=>String(node.attrs?.class||"").split(/\s+/);
const has=(node,name)=>classes(node).includes(name);
function descendants(node,predicate){const out=[];for(const child of node.children||[]){if(predicate(child))out.push(child);out.push(...descendants(child,predicate));}return out;}
function ancestors(node){const out=[];for(let n=node.parent;n;n=n.parent)out.push(n);return out;}
function text(node){
  if(node.tag==="text")return node.value;
  if(["script","style","noscript","button","input","select"].includes(node.tag)||classes(node).some(c=>/^(?:page_ads|noprint|ezoic|tooltip_templates)/.test(c)))return "";
  if(node.tag==="br"||node.tag==="hr")return "\n";
  if(node.tag==="img")return node.attrs.alt||"";
  const value=(node.children||[]).map(text).join("");
  if(node.tag==="td"||node.tag==="th")return `${value}\t`;
  if(node.tag==="li")return `\n• ${value}\n`;
  return /^(?:div|p|h[1-6]|tr|table|ul|ol)$/.test(node.tag)?`\n${value}\n`:value;
}
const clean=node=>text(node).replace(/\u00a0/g," ").replace(/[ \t]+/g," ").replace(/ *\n */g,"\n").replace(/\n{3,}/g,"\n\n").trim();
const slug=value=>String(value).normalize("NFKD").replace(/[’']/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
function ruleBlocks(node){
  const blocks=[];let inline="";
  const flush=()=>{const value=inline.replace(/\u00a0/g," ").replace(/[ \t]+/g," ").replace(/ *\n */g,"\n").trim();inline="";if(value)for(const paragraph of value.split(/\n{2,}/))blocks.push({type:"paragraph",text:paragraph});};
  for(const child of node.children||[]){
    if(["script","style","noscript","button","input","select"].includes(child.tag)||classes(child).some(c=>/^(?:page_ads|noprint|ezoic|tooltip_templates)/.test(c)))continue;
    if(child.tag==="br"){inline+="\n";continue;}
    if(child.tag==="a"&&!clean(child))continue;
    if(classes(child).some(c=>/^stratName/.test(c))){flush();const rolls=descendants(child,n=>classes(n).some(c=>/^cruD[1-6]w?$/.test(c))).map(n=>Number(classes(n).find(c=>/^cruD[1-6]w?$/.test(c)).match(/[1-6]/)[0]));blocks.push({type:"heading",text:clean(child),level:4,cardTitle:true,...(rolls.length?{rolls}:{})});continue;}
    if(/^h[1-6]$/.test(child.tag)){flush();blocks.push({type:"heading",text:clean(child),level:Number(child.tag[1]),section:has(child,"outline_header")});continue;}
    if(child.tag==="table"){
      flush();const rows=descendants(child,n=>n.tag==="tr"&&!ancestors(n).some(parent=>parent.tag==="table"&&parent!==child&&ancestors(parent).includes(child))).map(row=>({cells:row.children.filter(cell=>cell.tag==="td"||cell.tag==="th").map(cell=>({text:clean(cell),header:cell.tag==="th",colspan:Math.max(1,Math.min(20,Number(cell.attrs.colspan)||1)),rowspan:Math.max(1,Math.min(30,Number(cell.attrs.rowspan)||1))}))})).filter(row=>row.cells.length);
      if(rows.length)blocks.push({type:"table",rows});continue;
    }
    if(child.tag==="ul"||child.tag==="ol"){flush();blocks.push({type:"list",ordered:child.tag==="ol",items:child.children.filter(n=>n.tag==="li").map(clean)});continue;}
    if(has(child,"stratWrapper_CS")){
      flush();blocks.push({type:"card",title:"",blocks:ruleBlocks(child)});continue;
    }
    if(child.tag==="p"){flush();const value=clean(child);if(value)blocks.push({type:"paragraph",text:value,flavour:has(child,"ShowFluff")});continue;}
    if(["div","section","article","blockquote"].includes(child.tag)){flush();blocks.push(...ruleBlocks(child));continue;}
    inline+=text(child);
  }
  flush();return blocks;
}
function extractPage(html,file,book=null){
  const tree=parseHtml(html),all=descendants(tree,()=>true);
  const faction=book?.name || path.basename(file).replace(/ - 10th Edition\.html?$/i,"");
  const factionSlug=faction==="Imperial Agents"?"imperial-agents":slug(faction);
  const url=book?`https://wahapedia.ru/wh40k10ed/the-rules/${book.slug}/`:`https://wahapedia.ru/wh40k10ed/factions/${factionSlug}/`;
  let crusadeBlocks=all.filter(node=>has(node,"sCrusadeRules")&&!ancestors(node).some(parent=>has(parent,"sCrusadeRules"))&&!ancestors(node).some(parent=>classes(parent).some(c=>/tooltip/i.test(c)))&&descendants(node,child=>/^h[1-6]$/.test(child.tag)&&has(child,"outline_header")).length);
  if(book){
    const wrapper=all.find(node=>node.attrs?.id==='wrapper');
    const first=wrapper&&descendants(wrapper,node=>/^h[1-6]$/.test(node.tag)&&has(node,'outline_header')&&clean(node)!=='Books')[0];
    if(!first)throw new Error(`Book has no main rule content: ${file}`);
    const start=first.index,end=all.find(node=>node.index>start&&has(node,'tooltip_templates'))?.index ?? Infinity;
    // Some saved books have unmatched closing tags that end #wrapper early.
    // Select the complete main-content range, including its following siblings.
    const within=node=>node.index>=start&&node.index<end;
    crusadeBlocks=[{tag:'div',attrs:{},children:all.filter(node=>within(node)&&!ancestors(node).some(within)),parent:null,index:start}];
  }
  const includedNodes=new Set(crusadeBlocks.flatMap(root=>[root,...descendants(root,()=>true)]));
  const included=node=>includedNodes.has(node);
  const anchors=all.filter(node=>node.tag==="a"&&node.attrs.name);
  const nearestAnchor=node=>anchors.findLast(anchor=>anchor.index<=node.index)?.attrs.name||"Crusade-Rules";
  const agendas=[];
  for(const nameNode of all.filter(node=>has(node,"stratAgenda")&&included(node))){
    const wrapper=ancestors(nameNode).find(node=>has(node,"stratWrapper_CS"));if(!wrapper)throw new Error(`Agenda without wrapper: ${file}`);
    const name=clean(nameNode.children.find(node=>node.tag==="span")||nameNode);
    const bodies=descendants(wrapper,node=>has(node,"stratText_CS"));
    const description=bodies.filter(node=>!ancestors(node).some(parent=>bodies.includes(parent))).map(clean).filter(Boolean).join("\n\n");
    if(!name||!description)throw new Error(`Incomplete agenda: ${file}: ${name}`);
    const scope=[...new Set([wrapper,...ancestors(wrapper)].filter(node=>has(node,"sCrusadeRules")).flatMap(classes).filter(c=>!['clFl','sCrusadeRules'].includes(c)))];
    const anchor=nearestAnchor(nameNode);
    const block=crusadeBlocks.find(root=>root===wrapper||descendants(root,node=>node===wrapper).length);
    const heading=descendants(block,child=>/^h[1-6]$/.test(child.tag)&&has(child,"outline_header"))[0];
    const chapter=/^(Black Templars|Dark Angels|Blood Angels|Space Wolves)/i.exec(clean(heading))?.[1] || null;
    const sourceTable=anchor.replace(/-\d+$/,"").replace(/-/g," ");
    const restriction=description.startsWith('You can only select this Agenda if your Crusade army does not contain any TYRANIDS units.')?{excludesFaction:'Tyranids'}:description.startsWith('You can only select this Agenda if your Crusade army contains one or more TYRANIDS units.')?{requiresFaction:'Tyranids'}:{};
    agendas.push({id:`local-waha-10:${factionSlug}:${anchor}:${slug(name)}`,name,description,blocks:bodies.filter(node=>!ancestors(node).some(parent=>bodies.includes(parent))).flatMap(ruleBlocks),flavour:descendants(wrapper,node=>has(node,"ShowFluff")).map(clean).join("\n\n"),faction,factionSlug,chapter,scope,section:anchor,table:sourceTable,conditional:/Bonus|Trail|Hunt|Strategic|Alliance|Tactical/i.test(anchor),edition:10,...(book?{pack:book.pack}:{}),...restriction,source:`${chapter||faction} · ${sourceTable} · 10th edition`,sourceUrl:`${url}#${anchor}`,sourceFile:file});
  }
  const sections=crusadeBlocks.map((node,index)=>{
    const heading=descendants(node,child=>/^h[1-6]$/.test(child.tag)&&has(child,"outline_header"))[0];
    const name=heading?clean(heading):"Crusade rules";
    return {id:`local-waha-10:${factionSlug}:reference:${index}`,name,description:clean(node),blocks:ruleBlocks(node),sourceUrl:`${url}#${heading?nearestAnchor(heading):nearestAnchor(node)}`,scope:classes(node).filter(c=>!['clFl','sCrusadeRules'].includes(c))};
  }).filter(section=>section.description);
  return {faction,factionSlug,...(book?{kind:'book',pack:book.pack}:{}),sourceFile:file,sourceUrl:url,edition:10,sha256:crypto.createHash("sha256").update(html).digest("hex"),agendas,sections};
}
function importDirectory(directory){
  const pages=fs.readdirSync(directory).filter(file=>/\.html?$/i.test(file)&&file!=="index.html"&&!BOOKS.some(book=>file===`${book.name} - 10th Edition.html`)).sort().map(file=>extractPage(fs.readFileSync(path.join(directory,file),"utf8"),file));
  if(!pages.length)throw new Error("No supplied faction HTML files found.");
  function files(folder){return fs.readdirSync(folder,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(path.join(folder,entry.name)):entry.isFile()&&/\.html?$/i.test(entry.name)?[path.join(folder,entry.name)]:[]);}
  const supplied=files(directory),books=[];
  for(const book of BOOKS){const matches=supplied.filter(file=>path.basename(file)===`${book.name} - 10th Edition.html`);if(matches.length>1)throw new Error(`More than one supplied copy of ${book.name}; keep one source file.`);if(matches.length)books.push(extractPage(fs.readFileSync(matches[0],'utf8'),path.relative(directory,matches[0]).replace(/\\/g,'/'),book));}
  const ids=[...pages,...books].flatMap(page=>page.agendas.map(item=>item.id));if(new Set(ids).size!==ids.length)throw new Error("Duplicate agenda source IDs.");
  return {schemaVersion:1,edition:10,source:"User-supplied saved Wahapedia HTML",importedAt:new Date().toISOString(),missing:BOOKS.filter(book=>!books.some(page=>page.pack===book.pack)).map(book=>book.name==='Core Crusade Rules'?'Standalone core Crusade rules':book.name),pages,books};
}
if(require.main===module){
  if(!process.argv[2])throw new Error("Usage: node scripts/import-local-crusade-html.js <supplied-folder>");
  const data=importDirectory(path.resolve(process.argv[2]));
  const output=path.join(ROOT,"data/manual-rules/wh40k10-local-crusade.json");
  fs.writeFileSync(output,JSON.stringify(data,null,2)+"\n");
  console.log(JSON.stringify({output,pages:data.pages.length,agendas:data.pages.reduce((sum,page)=>sum+page.agendas.length,0),books:data.books.map(book=>({name:book.faction,agendas:book.agendas.length,sections:book.sections.length,characters:book.sections.reduce((n,s)=>n+s.description.length,0)})),missing:data.missing},null,2));
}
module.exports={parseHtml,extractPage,importDirectory,clean,has,descendants,ancestors,ruleBlocks};
