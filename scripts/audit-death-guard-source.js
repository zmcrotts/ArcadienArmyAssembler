"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {parseHtml,descendants,ancestors,has,clean}=require('./import-local-crusade-html');
const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
function audit(directory,out=path.resolve(__dirname,'../ui/assets/crusade/death-guard')){
  const file=path.join(directory,'Death Guard - 10th Edition.html'),html=fs.readFileSync(file,'utf8'),tree=parseHtml(html);
  const roots=descendants(tree,n=>has(n,'sCrusadeRules')&&!ancestors(n).some(p=>has(p,'sCrusadeRules')));
  const images=[...new Set(roots.flatMap(r=>descendants(r,n=>n.tag==='img').map(n=>n.attrs.src)).filter(s=>/^assets\/[a-f0-9]+\.png$/.test(s)))];
  const presets={};for(const name of ['Hive World','Agri World','Forge World']){
    const header=descendants(tree,n=>has(n,'cruDG_header')&&clean(n)===name)[0];if(!header)throw new Error('Missing world preset: '+name);
    const following=header.parent.children.find(n=>n.index>header.index&&descendants(n,c=>has(c,'cruDG_full')).length);
    const rows=descendants(following,n=>n.tag==='tr'&&!descendants(n,c=>c.tag==='table').length).map(row=>({label:clean(row.children[0]||{}),value:descendants(row,n=>has(n,'cruDG_full')).length})).filter(r=>r.value);
    presets[name]=rows.map(r=>r.value);if(presets[name].length!==3||presets[name].reduce((a,b)=>a+b,0)!==10)throw new Error('Unreadable preset: '+name);
  }
  fs.mkdirSync(out,{recursive:true});const assets=images.map(src=>{const buffer=fs.readFileSync(path.join(directory,src)),name=path.basename(src);fs.writeFileSync(path.join(out,name),buffer);return {name,sha256:hash(buffer),bytes:buffer.length};});
  const pdf=path.resolve(__dirname,'../tmp/pdfs/death-guard-crusade-sheet.pdf');
  const result={version:1,edition:10,sourceFile:path.basename(file),sourceSha256:hash(html),sourceUrl:'https://wahapedia.ru/wh40k10ed/factions/death-guard/',sheetUrl:'https://wahapedia.ru/wh40k10ed/factions/death-guard/AGrandPlague.pdf',sheetSha256:fs.existsSync(pdf)?hash(fs.readFileSync(pdf)):null,presets,assets};
  fs.writeFileSync(path.join(out,'source-manifest.json'),JSON.stringify(result,null,2)+'\n');return result;
}
if(require.main===module){const r=audit(path.resolve(process.argv[2]));console.log(JSON.stringify({presets:r.presets,graphics:r.assets.length,source:r.sourceSha256}));}
module.exports={audit};
