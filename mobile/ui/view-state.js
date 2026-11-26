"use strict";
(function install(global) {
  // A redraw must not move the reader or discard an expanded reference.
  function capture(root) {
    if (!root?.querySelectorAll) return () => {};
    function signature(node) {
      return {tag:node.tagName,id:node.id || '',className:typeof node.className==='string'?node.className.split(/\s+/).find(name=>name&&!/^(?:active|selected|open|collapsed|buttonFeedback.*)$/.test(name))||'':'',data:Object.entries(node.dataset || {})};
    }
    function matches(node, key) {
      if(key.id)return node.tagName===key.tag&&node.id===key.id;
      return node.tagName===key.tag
        && (!key.className || node.classList.contains(key.className))
        && key.data.every(([name,value])=>node.dataset?.[name]===value);
    }
    function path(node) {
      const result=[];
      while(node && node!==root) {
        const parent=node.parentElement;if(!parent)return null;
        const key=signature(node);key.index=Array.from(parent.children).filter(child=>matches(child,key)).indexOf(node);
        result.unshift(key);node=parent;
      }
      return node===root?result:null;
    }
    function resolve(keys) {
      if(!keys)return null;let node=root;
      for(const key of keys){node=Array.from(node.children).filter(child=>matches(child,key))[key.index];if(!node)return null;}
      return node;
    }
    const positions=[root,...root.querySelectorAll('*')].filter(node=>node.scrollTop || node.scrollLeft)
      .map(node=>({path:path(node),top:node.scrollTop,left:node.scrollLeft}));
    const ancestors=[];for(let node=root.parentElement;node;node=node.parentElement)if(node.scrollTop || node.scrollLeft)ancestors.push({node,top:node.scrollTop,left:node.scrollLeft});
    const open=Array.from(root.querySelectorAll('details[open]')).map(path);
    const active=root.ownerDocument?.activeElement,focus=active&&root.contains(active)?path(active):null;
    return () => {
      for(const keys of open){const node=resolve(keys);if(node?.tagName==='DETAILS')node.open=true;}
      const target=resolve(focus);target?.focus?.({preventScroll:true});
      for(const position of positions){const node=resolve(position.path);if(node){node.scrollTop=position.top;node.scrollLeft=position.left;}}
      for(const position of ancestors){position.node.scrollTop=position.top;position.node.scrollLeft=position.left;}
    };
  }
  global.ArcadienViewState={capture};
  if(typeof module!=='undefined'&&module.exports)module.exports={capture};
})(typeof window!=='undefined'?window:globalThis);
