"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {capture}=require('../ui/view-state');
function node(tag,className='',dataset={}){
  const n={tagName:tag.toUpperCase(),id:'',className,dataset,children:[],parentElement:null,scrollTop:0,scrollLeft:0,open:false};
  n.classList={contains:value=>n.className.split(/\s+/).includes(value)};
  n.append=child=>{child.parentElement=n;child.ownerDocument=n.ownerDocument;n.children.push(child);return child;};
  n.contains=child=>child===n||n.children.some(c=>c.contains(child));
  n.querySelectorAll=selector=>{const all=n.children.flatMap(c=>[c,...c.querySelectorAll('*')]);return selector==='details[open]'?all.filter(c=>c.tagName==='DETAILS'&&c.open):all;};
  n.focus=options=>{n.focusOptions=options;n.ownerDocument.activeElement=n;};return n;
}
function screen(){const outer=node('html');outer.ownerDocument={activeElement:null};const root=outer.append(node('main','startScreen'));const populate=()=>{root.children=[];const pane=root.append(node('section','crusades'));const detail=pane.append(node('details','ctSource'));const button=pane.append(node('button','',{dgAction:'adjust-plague',characteristic:'reproduction',value:'2'}));return {pane,detail,button};};return {outer,root,populate};}
test('a redraw preserves both scroll axes, expanded references, page scroll and focus without scrolling',()=>{
  const {outer,root,populate}=screen(),before=populate();outer.scrollTop=83;before.pane.scrollTop=917;before.pane.scrollLeft=121;before.detail.open=true;before.button.className='buttonFeedbackPulse';root.ownerDocument.activeElement=before.button;const restore=capture(root);
  const after=populate();outer.scrollTop=0;restore();assert.equal(after.pane.scrollTop,917);assert.equal(after.pane.scrollLeft,121);assert.equal(outer.scrollTop,83);assert.equal(after.detail.open,true);assert.equal(root.ownerDocument.activeElement,after.button);assert.deepEqual(after.button.focusOptions,{preventScroll:true});
});
test('restoring a redraw does not reopen closed sections or focus a different numbered button',()=>{
  const {root,populate}=screen(),before=populate();before.pane.scrollTop=460;root.ownerDocument.activeElement=before.button;const restore=capture(root);const after=populate();after.button.dataset.value='3';restore();assert.equal(after.pane.scrollTop,460);assert.equal(after.detail.open,false);assert.equal(after.button.focusOptions,undefined);
});
test('removed panels and unavailable roots can be restored safely',()=>{
  const {root,populate}=screen(),before=populate();before.pane.scrollTop=500;before.detail.open=true;const restore=capture(root);root.children=[];assert.doesNotThrow(restore);assert.doesNotThrow(capture(null));
});
