'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const effects=require('../widgets/dashboard/public/effects'),layout=require('../widgets/dashboard/public/layout');
test('Migration preserves the old green colours and view; transition default is 350ms',()=>{
 const c=effects.normalize();assert.equal(c.lineStyle,'classic');assert.equal(c.powerEffect,'fixed');assert.equal(c.lineCycleMs,1150);assert.equal(c.lineWidthScale,1);assert.equal(c.cornerRounding,0);assert.equal(c.valueTransition,'live');assert.equal(c.transitionMs,350);assert.equal(c.pvLineColor,'green');assert.equal(c.pvValueColor,'green');
 assert.equal(effects.normalize({lineCycleMs:Infinity}).lineCycleMs,1150);assert.equal(effects.normalize({powerLimits:{solar:0}}).powerLimits.solar,5000);
});
test('Speed and thickness use shared power limits; thickness never changes selected speed',()=>{
 const fixed=effects.normalize({lineCycleMs:750});assert.deepEqual(effects.metrics(fixed,'grid',10),{cycleMs:750,width:1});
 const speed=effects.normalize({...fixed,powerEffect:'speed'});assert(effects.metrics(speed,'grid',50).cycleMs>effects.metrics(speed,'grid',3500).cycleMs);assert.equal(effects.metrics(speed,'grid',3500).cycleMs,750);
 const width=effects.normalize({...fixed,powerEffect:'thickness'});assert(effects.metrics(width,'grid',50).width<effects.metrics(width,'grid',3500).width);for(const watts of [0,50,-1500,3500,10000])assert.equal(effects.metrics(width,'grid',watts).cycleMs,750);
 assert.deepEqual(effects.metrics(width,'grid',-1500),effects.metrics(width,'grid',1500));
});
test('Rounded corners keep original endpoints; zero rounding preserves exact paths in all slots',()=>{
 for(const name of layout.components)for(const slot of layout.slots){
  const path=layout.route(name,slot);assert.equal(effects.roundedPath(path,0),path);
  const rounded=effects.roundedPath(path,100),endpoints=p=>p.match(/-?[\d.]+/g).map(Number);
  const old=endpoints(path),now=endpoints(rounded);assert.deepEqual(now.slice(0,2),old.slice(0,2));assert.deepEqual(now.slice(-2),old.slice(-2));assert(rounded.includes('Q'));
 }
});
function fixture(){
 let counter=0,time=0;const frames=new Map(),events={};
 class Element{
  constructor(){this.attrs={};this.style={setProperty:(key,value)=>{this.style[key]=value;},removeProperty:key=>{delete this.style[key]}};this.children=[];this.animations=[];this._text='';}
  get textContent(){return this.children.length?this.children.map(c=>c.textContent).join(''):this._text;}
  set textContent(v){this.children=[];this._text=String(v);}
  replaceChildren(...children){this.children=children;this._text='';}
  setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k]||null;}
  appendChild(el){this.children.push(el);return el;}
  getTotalLength(){return 40;}getPointAtLength(n){return{x:n,y:n};}
  animate(keyframes,opts){const animation={keyframes,opts,currentTime:0,rate:1,cancel(){this.oncancel?.();this.cancelled=true;},pause(){this.paused=true;},play(){this.paused=false;},updatePlaybackRate(rate){this.rate=rate;}};this.animations.push(animation);return animation;}
 }
 const svgs={};
 for(const name of layout.components){
  const svg=new Element(),core=new Element(),glow=new Element();core.setAttribute('d',layout.route(name,layout.defaults[name]));glow.setAttribute('d',core.getAttribute('d'));svg.core=core;svg.glow=glow;svg.classes=new Set([name==='solar'?'solar-active':name==='grid'?'grid-import':name==='battery'?'charge':'ev-grid']);svg.dataset={};svg.classList={contains:c=>svg.classes.has(c)};svg.querySelector=s=>s==='.flow-core'?core:glow;svgs[name+'FlowOverlay']=svg;
 }
 const doc={hidden:false,createElement:()=>new Element(),createElementNS:()=>new Element(),getElementById:id=>svgs[id],addEventListener:(e,fn)=>{(events[e]||=[]).push(fn);},removeEventListener:(e,fn)=>events[e]=events[e].filter(x=>x!==fn)};
 doc.defaultView={requestAnimationFrame:fn=>{const id=++counter;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),performance:{now:()=>time}};
 return {doc,svgs,frames,element:()=>new Element(),tick:t=>{time=t;const callbacks=[...frames.values()];frames.clear();for(const fn of callbacks)fn(t);},hide:()=>{doc.hidden=true;for(const fn of events.visibilitychange||[])fn();}};
}
test('Changing speed updates the existing animation playback rate without restarting its phase',()=>{
 const f=fixture(),lines=effects.createLines(f.doc),powers={solar:1000,grid:200,battery:-1000,ev:1000};
 lines.update({powerEffect:'speed'},powers);const core=f.svgs.solarFlowOverlay.core,animation=core.animations[0];animation.currentTime=470;const oldRate=animation.rate;
 lines.update({powerEffect:'speed'},{...powers,solar:5000});assert.equal(core.animations.length,1);assert.equal(animation.currentTime,470);assert.notEqual(animation.rate,oldRate);assert.equal(f.frames.size,0);
 lines.destroy();
});
test('Comets use native animations, preserve speed phase, support 1/2/3 heads and pause hidden/idle',()=>{
 const f=fixture(),lines=effects.createLines(f.doc),powers={solar:1000,grid:200,battery:-1000,ev:1000};
 for(const count of [1,2,3]){lines.update({lineStyle:'comet',cometCount:count},powers);assert.equal(f.frames.size,0);assert.equal(f.svgs.solarFlowOverlay.children.filter(c=>c.attrs.class==='effect-head'&&c.style.display!=='none').length,count);}
 const head=f.svgs.gridFlowOverlay.children.find(c=>c.attrs.class==='effect-head'),a=head.animations.at(-1);a.currentTime=470;
 lines.update({lineStyle:'comet',cometCount:3,lineCycleMs:750},powers);assert.equal(head.animations.at(-1),a);assert.equal(a.currentTime,470);assert.equal(a.rate,1150/750);
 f.svgs.gridFlowOverlay.classes=new Set(['grid-export']);lines.update({lineStyle:'comet',cometCount:3},powers);
 const reverse=head.animations.at(-1);assert.equal(reverse.keyframes[1].strokeDashoffset,'100');assert(reverse.rate>0,'reverse loops use forward playback so they cannot stop at time zero');
 lines.update({lineStyle:'comet'},{solar:0,grid:0,battery:0,ev:0});assert(reverse.paused);
 lines.update({lineStyle:'comet'},powers);f.hide();assert(head.animations.at(-1).paused);assert.equal(f.frames.size,0);lines.destroy();assert(head.animations.at(-1).cancelled);
});
test('Count finishes at the target; crossfade interruptions do not concatenate numbers; hidden values settle',()=>{
 const f=fixture(),values=effects.createValues(f.doc),el=f.element();values.set(el,'100');values.configure({valueTransition:'count',transitionMs:350});values.set(el,'200');f.tick(175);assert(Number(el.textContent)>100&&Number(el.textContent)<200);values.set(el,'300');f.tick(525);assert.equal(el.textContent,'300');assert.equal(f.frames.size,0);
 values.configure({valueTransition:'crossfade'});values.set(el,'400');values.set(el,'500');assert.equal(el.children[0].textContent,'400');assert.equal(el.children[1].textContent,'500');
 f.hide();assert.equal(el.textContent,'500');assert.equal(f.frames.size,0);values.destroy();
});
test('Embedded effects factory is identical to its canonical source',()=>{
 const source=fs.readFileSync(require.resolve('../widgets/dashboard/public/effects'),'utf8'),factory=source.slice(source.indexOf('function(){'),source.lastIndexOf('});')+1);
 const widget=fs.readFileSync(require.resolve('../widgets/dashboard/public/index.html'),'utf8');assert(widget.includes('const effects=('+factory+')();'));
});
test('A W/kW display-unit change settles immediately instead of interpolating incompatible values',()=>{
 const f=fixture(),values=effects.createValues(f.doc),el=f.element();values.configure({valueTransition:'count'});values.set(el,'1500','W');values.set(el,'1600','W');values.set(el,'1.6','kW');assert.equal(el.textContent,'1.6');assert.equal(f.frames.size,0);values.destroy();
});
test('Explicit PV line and value colour choices survive normalization independently',()=>{
 for(const line of ['green','yellow'])for(const value of ['green','yellow']){
  const c=effects.normalize({pvLineColor:line,pvValueColor:value,lineStyle:'comet',lineCycleMs:750});
  assert.equal(c.pvLineColor,line);assert.equal(c.pvValueColor,value);assert.equal(c.lineStyle,'comet');assert.equal(c.lineCycleMs,750);
  assert.deepEqual(effects.normalize(JSON.parse(JSON.stringify(c))),c);
 }
});
test('Comet segments fade and taper behind the head without SVG sampling or a frame loop',()=>{
 const f=fixture();for(const svg of Object.values(f.svgs)){svg.core.getPointAtLength=()=>{throw Error('SVG sampling is not needed');};svg.core.getTotalLength=()=>{throw Error('SVG measurement is not needed');};}
 const lines=effects.createLines(f.doc),powers={solar:1000,grid:1000,battery:1000,ev:1000};lines.update({lineStyle:'comet'},powers);
 const svg=f.svgs.solarFlowOverlay,segments=svg.children.filter(c=>c.attrs.class==='effect-tail').slice(0,10),head=svg.children.find(c=>c.attrs.class==='effect-head');
 assert.equal(head.attrs.pathLength,'100');assert.equal(head.style.strokeDasharray,'.01 99.99');
 for(let i=0;i<10;i++){assert.equal(segments[i].attrs.pathLength,'100');assert.equal(segments[i].style.strokeDasharray,'3.2 96.8');assert.equal(segments[i].attrs.d,svg.core.attrs.d);if(i){assert(Number(segments[i].style.opacity)<Number(segments[i-1].style.opacity));assert(Number(segments[i].style.strokeWidth)<Number(segments[i-1].style.strokeWidth));}}
 assert.equal(segments[0].animations.at(-1).keyframes[0].strokeDashoffset,'3.2','positive offset puts forward tail behind head');
 svg.classes.add('motion-reverse');lines.update({lineStyle:'comet'},powers);
 assert.equal(segments[0].animations.at(-1).keyframes[0].strokeDashoffset,'0');assert.equal(segments[1].animations.at(-1).keyframes[0].strokeDashoffset,'-3.2','negative offsets put reverse tails behind head');assert.equal(f.frames.size,0);lines.destroy();
});
test('Every effect layer follows rounded routes in all four positions, after layout and rounding changes',()=>{
 const f=fixture(),lines=effects.createLines(f.doc),powers={solar:1000,grid:1000,battery:1000,ev:1000};
 for(const style of ['classic','ribbon','comet'])for(const amount of [60,100,0]){
  lines.update({lineStyle:style,cornerRounding:amount},powers);
  for(const name of layout.components)for(const slot of layout.slots){
   const route=layout.route(name,slot),svg=f.svgs[name+'FlowOverlay'];lines.geometry(name,route);
   const expected=effects.roundedPath(route,amount);for(const el of [svg.core,svg.glow,...svg.children])assert.equal(el.attrs.d,expected);
  }
 }lines.destroy();
});
test('Ribbon uses one broad glow pulse; changing speed preserves its animation',()=>{
 const f=fixture(),lines=effects.createLines(f.doc),powers={solar:1000,grid:1000,battery:1000,ev:1000};lines.update({lineStyle:'ribbon',powerEffect:'speed'},powers);
 const svg=f.svgs.solarFlowOverlay,spark=svg.children.find(c=>c.attrs.class==='effect-spark'),animation=spark.animations[0];
 const length=effects.pathLength(svg.core.attrs.d);assert.deepEqual(spark.style.strokeDasharray.split(' ').map(Number),[length*.24,length*.76]);assert(animation.keyframes.every(k=>k.opacity>=.7),'glow stays soft instead of flashing on/off');
 animation.currentTime=490;lines.update({lineStyle:'ribbon',powerEffect:'speed'},{...powers,solar:5000});assert.equal(spark.animations.length,1);assert.equal(animation.currentTime,490);lines.destroy();
});

test('Ribbon glow defaults to the current appearance and adjusts without restarting animation',()=>{
 assert.equal(effects.normalize().ribbonGlow,100);assert.equal(effects.normalize({ribbonGlow:-1}).ribbonGlow,0);assert.equal(effects.normalize({ribbonGlow:500}).ribbonGlow,200);
 const f=fixture(),lines=effects.createLines(f.doc),powers={solar:1000,grid:1000,battery:1000,ev:1000};
 lines.update({lineStyle:'ribbon'},powers);const svg=f.svgs.solarFlowOverlay,spark=svg.children.find(c=>c.attrs.class==='effect-spark'),a=spark.animations[0];a.currentTime=450;
 for(const glow of [0,50,100,200]){lines.update({lineStyle:'ribbon',ribbonGlow:glow},powers);assert.equal(svg.style['--ribbon-glow'],String(glow/100));assert.equal(spark.animations.length,1);assert.equal(a.currentTime,450);}lines.destroy();
});

test('Standby uses the selected style with frozen rounded effects and keeps hidden lines hidden',()=>{
 const f=fixture(),lines=effects.createLines(f.doc),powers={solar:0,grid:0,battery:0,ev:0};
 for(const style of ['classic','ribbon','comet']){
  for(const svg of Object.values(f.svgs))svg.classes=new Set(['standby','standby-greenblue','standby-blink']);
  lines.update({lineStyle:style,cornerRounding:100,cometCount:3},powers);
  for(const svg of Object.values(f.svgs)){
   assert.equal(svg.dataset.effectStyle,style);assert(svg.core.attrs.d.includes('Q'));
   for(const el of [svg.core,...svg.children])for(const a of el.animations)if(!a.cancelled)assert(a.paused,'standby never advances the flow');
   assert.equal(svg.children.filter(e=>e.attrs.class==='effect-head'&&e.style.display!=='none').length,style==='comet'?3:0);
   assert.equal(svg.children.find(e=>e.attrs.class==='effect-spark').style.display,style==='ribbon'?'':'none');
  }
  for(const svg of Object.values(f.svgs))svg.classes=new Set(['flow-hidden']);
  lines.update({lineStyle:style},powers);for(const svg of Object.values(f.svgs))for(const el of svg.children)if(el.attrs.class!=='effect-spark')assert.equal(el.style.display,'none');
 }lines.destroy();
});

test('Standby thickness scales every selected-style layer independently and preserves existing defaults',()=>{
 assert.equal(effects.normalize().standbyWidthScale,1);
 for(const value of [null,'',Infinity,'invalid'])assert.equal(effects.normalize({standbyWidthScale:value}).standbyWidthScale,1);
 assert.equal(effects.normalize({standbyWidthScale:-1}).standbyWidthScale,.25);assert.equal(effects.normalize({standbyWidthScale:8}).standbyWidthScale,3);
 const f=fixture(),lines=effects.createLines(f.doc),powers={solar:0,grid:0,battery:0,ev:0};
 const widths=()=>Object.values(f.svgs).flatMap(svg=>[svg.core,svg.glow,...svg.children]).filter(el=>el.style.display!=='none').map(el=>Number(el.style.strokeWidth)).filter(Number.isFinite);
 const close=(a,b)=>{assert.equal(a.length,b.length);a.forEach((v,i)=>assert(Math.abs(v-b[i])<1e-10));};
 for(const lineStyle of ['classic','ribbon','comet'])for(const lineWidthScale of [.5,2]){
  for(const svg of Object.values(f.svgs))svg.classes=new Set(['standby','standby-blue']);
  const config={lineStyle,lineWidthScale,powerEffect:'thickness',cometCount:3};lines.update(config,powers);const base=widths();
  lines.update({...config,standbyWidthScale:1},powers);close(widths(),base);
  for(const factor of [.25,3]){lines.update({...config,standbyWidthScale:factor},powers);close(widths(),base.map(w=>w*factor));}
  for(const mode of ['fixed','speed']){lines.update({...config,powerEffect:mode,standbyWidthScale:1},powers);const unchanged=widths();lines.update({...config,powerEffect:mode,standbyWidthScale:3},powers);close(widths(),unchanged);}
  for(const svg of Object.values(f.svgs))svg.classes=new Set(['solar-active']);
  const active={solar:1000,grid:1000,battery:1000,ev:1000};lines.update({...config,standbyWidthScale:.25},active);const unchanged=widths();lines.update({...config,standbyWidthScale:3},active);close(widths(),unchanged);
 }lines.destroy();
});
