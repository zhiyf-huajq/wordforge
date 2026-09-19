(function(){
  var store = new Map();
  function El(tag){
    this.tagName = (tag||"div").toUpperCase();
    this._html=""; this._text=""; this.value=""; this.id="";
    this.disabled=false; this.checked=false; this.files=null;
    this.childNodes=[]; this.children=[]; this.parentNode=null;
    this._attrs={}; this._cls=new Set(); this.style=new Proxy({},{get:function(){return function(){};},set:function(){return true;}});
    var self=this;
    this.classList={
      add:function(){for(var i=0;i<arguments.length;i++)self._cls.add(arguments[i]);},
      remove:function(){for(var i=0;i<arguments.length;i++)self._cls.delete(arguments[i]);},
      contains:function(c){return self._cls.has(c);},
      toggle:function(c,f){ if(f===undefined){ self._cls.has(c)?self._cls.delete(c):self._cls.add(c);} else if(f){self._cls.add(c);} else {self._cls.delete(c);} }
    };
  }
  Object.defineProperty(El.prototype,"innerHTML",{get:function(){return this._html;},set:function(v){this._html=String(v);}});
  Object.defineProperty(El.prototype,"textContent",{get:function(){return this._text;},set:function(v){this._text=String(v);}});
  El.prototype.setAttribute=function(k,v){this._attrs[k]=String(v); if(k==="id")this.id=String(v);};
  El.prototype.getAttribute=function(k){return k in this._attrs?this._attrs[k]:null;};
  El.prototype.addEventListener=function(){};
  El.prototype.removeEventListener=function(){};
  El.prototype.appendChild=function(c){this.childNodes.push(c); this.children.push(c); c.parentNode=this; return c;};
  El.prototype.insertBefore=function(c){this.childNodes.push(c); this.children.push(c); c.parentNode=this; return c;};
  El.prototype.removeChild=function(c){var i=this.childNodes.indexOf(c); if(i>=0){this.childNodes.splice(i,1);this.children.splice(i,1);} return c;};
  El.prototype.focus=function(){}; El.prototype.blur=function(){};
  El.prototype.click=function(){ if(typeof this.onclick==="function") this.onclick({target:this,stopPropagation:function(){}}); };
  El.prototype.querySelector=function(){return new El("div");};
  El.prototype.querySelectorAll=function(){return [];};
  El.prototype.closest=function(){return null;};
  El.prototype.contains=function(){return false;};

  var cache={};
  globalThis.document={
    readyState:"complete",
    createElement:function(t){return new El(t);},
    getElementById:function(id){ if(!cache[id]){cache[id]=new El("div"); cache[id].id=id;} return cache[id]; },
    querySelector:function(){return new El("div");},
    querySelectorAll:function(){return [];},
    addEventListener:function(){},
    body:new El("body"),
    documentElement:(function(){var e=new El("html"); e.setAttribute=function(k,v){e._attrs[k]=v;}; return e;})()
  };
  globalThis.window=globalThis;
  globalThis.addEventListener=function(){};
  globalThis.removeEventListener=function(){};
  globalThis.confirm=function(){return true;};
  globalThis.localStorage={
    getItem:function(k){return store.has(k)?store.get(k):null;},
    setItem:function(k,v){store.set(k,String(v));},
    removeItem:function(k){store.delete(k);},
    clear:function(){store.clear();},
    __store:store
  };
  globalThis.speechSynthesis=undefined;
  globalThis.URL={createObjectURL:function(){return "blob:x";},revokeObjectURL:function(){}};
  globalThis.Blob=function(){return {};};
  globalThis.FileReader=function(){ this.readAsText=function(){}; };
  globalThis.confirm=function(){return true;};
  globalThis.__EL=El;
})();
