(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.HomeFluxEffects=factory();})(globalThis,function(){
  'use strict';
  const names=['solar','grid','battery','ev'];
  function normalize(input={}){
    const c=input||{},number=(key,fallback,min,max)=>{const n=c[key];return n!==null&&n!==''&&Number.isFinite(Number(n))?Math.min(max,Math.max(min,Number(n))):fallback;};
    const one=(key,values,fallback)=>values.includes(c[key])?c[key]:fallback;
    const defaults={solar:5000,grid:3500,battery:6000,ev:3600},limits={};
    for(const name of names){const n=Number(c.powerLimits?.[name]);limits[name]=Number.isFinite(n)&&n>0?Math.min(1000000,n):defaults[name];}
    return {pvLineColor:one('pvLineColor',['green','yellow'],'green'),pvValueColor:one('pvValueColor',['green','yellow'],'green'),lineStyle:one('lineStyle',['classic','ribbon','comet'],'classic'),powerEffect:one('powerEffect',['fixed','speed','thickness'],'fixed'),lineCycleMs:number('lineCycleMs',1150,100,10000),lineWidthScale:number('lineWidthScale',1,.25,3),standbyWidthScale:number('standbyWidthScale',1,.25,3),ribbonGlow:number('ribbonGlow',100,0,200),cornerRounding:number('cornerRounding',0,0,100),cometCount:Math.round(number('cometCount',1,1,3)),valueTransition:one('valueTransition',['live','count','crossfade'],'live'),transitionMs:number('transitionMs',350,50,20000),powerLimits:limits};
  }
  function metrics(options,name,watts){
    const ratio=Math.min(1,Math.max(0,Math.abs(Number(watts)||0)/options.powerLimits[name]));
    return {cycleMs:options.powerEffect==='speed'?options.lineCycleMs+(Math.max(3000,options.lineCycleMs)-options.lineCycleMs)*(1-Math.pow(ratio,.65)):options.lineCycleMs,width:options.lineWidthScale*(options.powerEffect==='thickness'?.35+.65*ratio:1)};
  }
  function roundedPath(path,amount){
    if(!amount)return path;
    const points=[...path.matchAll(/[ML]\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/g)].map(m=>[Number(m[1]),Number(m[2])]);
    if(points.length<3)return path;
    let result=`M${points[0].join(' ')}`;
    for(let i=1;i<points.length;i++){
      const b=points[i];if(i===points.length-1){result+=` L${b.join(' ')}`;continue;}
      const a=points[i-1],c=points[i+1],before=Math.hypot(b[0]-a[0],b[1]-a[1]),after=Math.hypot(c[0]-b[0],c[1]-b[1]);
      if(!before||!after){result+=` L${b.join(' ')}`;continue;}
      const radius=Math.min(before,after)*amount/100*.48;
      const start=b.map((v,j)=>v+(a[j]-v)*radius/before),end=b.map((v,j)=>v+(c[j]-v)*radius/after);
      result+=` L${start.join(' ')} Q${b.join(' ')} ${end.join(' ')}`;
    }
    return result;
  }
  function pathLength(path){
    const tokens=path.match(/[MLQ]|-?(?:\d*\.)?\d+(?:e[+-]?\d+)?/gi)||[],vertices=[];let i=0,current=[0,0];
    const read=()=>[Number(tokens[i++]),Number(tokens[i++])];
    while(i<tokens.length){
      const command=tokens[i++];
      if(command==='M'||command==='L'){current=read();vertices.push(current);}
      else if(command==='Q'){
        const control=read(),end=read(),start=current;
        for(let j=1;j<=24;j++){const t=j/24,u=1-t;vertices.push([u*u*start[0]+2*u*t*control[0]+t*t*end[0],u*u*start[1]+2*u*t*control[1]+t*t*end[1]]);}
        current=end;
      }else return 1;
    }
    let length=0;for(let j=1;j<vertices.length;j++)length+=Math.hypot(vertices[j][0]-vertices[j-1][0],vertices[j][1]-vertices[j-1][1]);
    return Math.max(.001,length);
  }

  function createLines(doc){
    const states={},ns='http://www.w3.org/2000/svg';let options=normalize(),disposed=false;
    for(const name of names){
      const svg=doc.getElementById(name+'FlowOverlay'),core=svg.querySelector('.flow-core'),glow=svg.querySelector('.flow-glow');
      const spark=doc.createElementNS(ns,'path');spark.setAttribute('class','effect-spark');svg.appendChild(spark);
      const trails=[],heads=[];
      for(let i=0;i<3;i++){
        const segments=[];
        for(let j=0;j<10;j++){
          const tail=doc.createElementNS(ns,'path');tail.setAttribute('class','effect-tail');tail.setAttribute('pathLength','100');tail.style.display='none';svg.appendChild(tail);segments.push(tail);
        }
        const head=doc.createElementNS(ns,'path');head.setAttribute('class','effect-head');head.setAttribute('pathLength','100');head.style.display='none';svg.appendChild(head);
        trails.push(segments);heads.push(head);
      }
      states[name]={svg,core,glow,spark,trails,heads,cometAnimations:[],cometKey:'',cometReverse:false,raw:core.getAttribute('d'),phase:0,length:1,animation:null,animationKey:'',sparkAnimation:null,sparkAnimationKey:'',active:false,cycleMs:1150,reverse:false};
    }
    const stateList=Object.values(states);
    function geometry(name,path){
      const s=states[name];if(path!==undefined)s.raw=path;
      const d=roundedPath(s.raw,options.cornerRounding);
      // Geometry belongs to the renderer. Layout only supplies the original route.
      for(const el of [s.core,s.glow,s.spark,...s.trails.flat(),...s.heads])if(el.getAttribute('d')!==d)el.setAttribute('d',d);
      if(s.d!==d){s.d=d;s.length=pathLength(d);}
    }
    function playback(animation,rate,playing){
      animation.updatePlaybackRate(rate);
      if(playing&&!doc.hidden&&!disposed)animation.play();else animation.pause();
    }
    function comets(s,scale){
      const visible=(s.active||s.standby)&&options.lineStyle==='comet',moving=s.active&&visible,key=options.cometCount+':'+s.reverse;
      if(visible&&s.cometKey!==key){
        let phase=s.cometAnimations.length?(Number(s.cometAnimations[0].currentTime)||0)/1150%1:s.phase;
        if(s.cometAnimations.length&&s.cometReverse!==s.reverse)phase=(1-phase)%1;s.cometReverse=s.reverse;
        for(const a of s.cometAnimations)a.cancel();s.cometAnimations=[];s.cometKey=key;
        const step=Math.min(32,80/options.cometCount)/10;
        for(let i=0;i<options.cometCount;i++){
          const offset=-i*100/options.cometCount;
          for(let j=0;j<10;j++){
            const tail=s.trails[i][j],start=offset+(s.reverse?-j*step:(j+1)*step);
            tail.style.strokeDasharray=`${step} ${100-step}`;
            const a=tail.animate([{strokeDashoffset:String(start)},{strokeDashoffset:String(start+(s.reverse?100:-100))}],{duration:1150,iterations:Infinity});a.currentTime=phase*1150;s.cometAnimations.push(a);
          }
          const head=s.heads[i];head.style.strokeDasharray='.01 99.99';
          const a=head.animate([{strokeDashoffset:String(offset)},{strokeDashoffset:String(offset+(s.reverse?100:-100))}],{duration:1150,iterations:Infinity});a.currentTime=phase*1150;s.cometAnimations.push(a);
        }
      }
      for(const a of s.cometAnimations)playback(a,1150/s.cycleMs,moving);
      for(let i=0;i<3;i++){
        const show=visible&&i<options.cometCount;s.heads[i].style.display=show?'':'none';s.heads[i].style.strokeWidth=String(.9*scale);
        for(let j=0;j<10;j++){
          const tail=s.trails[i][j],fade=1-j/10;
          tail.style.display=show?'':'none';tail.style.opacity=String(.92*Math.pow(fade,1.6));tail.style.strokeWidth=String(.85*scale*(.15+.85*fade));
        }
      }
    }
    function update(config,powers){
      options=normalize(config);
      for(const name of names){
        const s=states[name],m=metrics(options,name,powers[name]);s.cycleMs=m.cycleMs;
        const wasStandby=s.standby;
        s.active=Number.isFinite(powers[name])&&Math.abs(powers[name])>0&&!s.svg.classList.contains('flow-hidden')&&!s.svg.classList.contains('standby');
        s.reverse=s.svg.classList.contains('motion-reverse')||s.svg.classList.contains('grid-export');
        s.svg.dataset.effectStyle=options.lineStyle;s.svg.dataset.pvColor=options.pvLineColor;s.svg.style.setProperty('--ribbon-glow',String(options.ribbonGlow/100));
        s.standby=s.svg.classList.contains('standby')&&!s.svg.classList.contains('flow-hidden');
        geometry(name);
        const standbyScale=s.standby&&options.powerEffect==='thickness'?options.standbyWidthScale:1;
        const moving=(s.active||(s.standby&&options.lineStyle==='ribbon'))&&options.lineStyle!=='comet',period=options.lineStyle==='ribbon'?s.length:10.8,direction=s.reverse?1:-1,key=options.lineStyle+':'+period+':'+direction;
        if(moving&&typeof s.core.animate==='function'){
          if(s.animationKey!==key){
            if(s.animation){s.phase=(Number(s.animation.currentTime)||0)/1150%1;s.animation.cancel();}
            s.core.style.animation='none';s.animation=s.core.animate([{strokeDashoffset:'0'},{strokeDashoffset:String(direction*period)}],{duration:1150,iterations:Infinity});s.animation.currentTime=s.phase*1150;s.animationKey=key;
          }
          playback(s.animation,1150/s.cycleMs,s.active);
        }else s.animation?.pause();
        if((s.active||s.standby)&&options.lineStyle==='ribbon'&&typeof s.spark.animate==='function'){
          if(s.sparkAnimationKey!==key){
            s.sparkAnimation?.cancel();s.sparkAnimation=s.spark.animate([{strokeDashoffset:'0',opacity:.72},{offset:.5,strokeDashoffset:String(direction*period/2),opacity:.95},{strokeDashoffset:String(direction*period),opacity:.72}],{duration:1150,iterations:Infinity});s.sparkAnimation.currentTime=s.animation?.currentTime||0;s.sparkAnimationKey=key;
          }
          const pulse=s.length*.24;s.core.style.strokeDasharray=s.spark.style.strokeDasharray=`${pulse} ${s.length-pulse}`;
          playback(s.sparkAnimation,1150/s.cycleMs,s.active);s.spark.style.display='';s.spark.style.strokeWidth=String(.85*m.width*standbyScale);
        }else{s.spark.style.display='none';s.sparkAnimation?.pause();s.core.style.removeProperty('stroke-dasharray');}
        if(!moving){s.core.style.removeProperty('animation');if(s.animation){s.animation.cancel();s.animation=null;s.animationKey='';}}
        if(options.lineStyle==='comet'&&(s.active||s.standby))s.core.style.animation='none';
        const scale=s.active?m.width:options.lineWidthScale*standbyScale,coreWidth=options.lineStyle==='ribbon'&&(s.active||s.standby)?2.1:options.lineStyle==='comet'?.16:1.15;
        s.core.style.strokeWidth=String(coreWidth*(options.lineStyle==='comet'?Math.min(1,s.active?m.width:options.lineWidthScale)*standbyScale:scale));s.glow.style.strokeWidth=String((options.lineStyle==='ribbon'&&(s.active||s.standby)?.55:2.8)*scale);
        comets(s,scale);
        if(s.standby&&!wasStandby){if(s.animation)s.animation.currentTime=575;if(s.sparkAnimation)s.sparkAnimation.currentTime=575;for(const a of s.cometAnimations)a.currentTime=575;}
      }
    }
    function visibility(){for(const s of stateList){
      if(s.animation)playback(s.animation,1150/s.cycleMs,s.active&&options.lineStyle!=='comet');
      if(s.sparkAnimation)playback(s.sparkAnimation,1150/s.cycleMs,s.active&&options.lineStyle==='ribbon');
      for(const a of s.cometAnimations)playback(a,1150/s.cycleMs,s.active&&options.lineStyle==='comet');
    }}
    doc.addEventListener('visibilitychange',visibility);
    function destroy(){disposed=true;for(const s of stateList){s.animation?.cancel();s.sparkAnimation?.cancel();for(const a of s.cometAnimations)a.cancel();}doc.removeEventListener('visibilitychange',visibility);}
    return {update,geometry,destroy};
  }
  function createValues(doc){
    const win=doc.defaultView,states=new Map();let config=normalize(),disposed=false;
    function cancel(s){if(s.raf!==null)win.cancelAnimationFrame(s.raf);s.raf=null;s.animation?.cancel();s.animation=null;}
    function set(el,text,context=''){
      text=String(text??'');let s=states.get(el);
      if(!s){s={text,context,shown:null,raf:null,animation:null};states.set(el,s);el.textContent=text;return;}
      if(s.context!==context){cancel(s);s.context=context;s.text=text;s.shown=null;el.textContent=text;el.style.removeProperty('display');return;}
      if(s.text===text)return;
      const previous=s.text;s.text=text;cancel(s);el.style.removeProperty('display');
      const match=text.match(/^(-?\d+(?:\.\d+)?)(.*)$/),old=previous.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
      if(config.valueTransition==='live'||!match||!old||match[2]!==old[2]||doc.hidden){el.textContent=text;s.shown=match?Number(match[1]):null;return;}
      const target=Number(match[1]),from=s.shown??Number(old[1]);
      if(config.valueTransition==='count'){
        const start=win.performance.now(),duration=config.transitionMs,decimals=(match[1].split('.')[1]||'').length;
        const tick=time=>{if(disposed)return;const p=Math.min(1,Math.max(0,(time-start)/duration));s.shown=from+(target-from)*(1-Math.pow(1-p,3));el.textContent=String(Number(s.shown.toFixed(decimals)))+match[2];if(p<1)s.raf=win.requestAnimationFrame(tick);else{el.textContent=text;s.shown=target;s.raf=null;}};
        s.raf=win.requestAnimationFrame(tick);
      }else if(typeof el.animate==='function'){
        // Overlay spans preserve the original inline box and font metrics.
        const back=doc.createElement('span'),front=doc.createElement('span');
        back.textContent=previous;front.textContent=text;el.replaceChildren(back,front);el.style.display='inline-grid';
        back.style.gridArea=front.style.gridArea='1 / 1';front.style.opacity='0';
        const a=front.animate([{opacity:0},{opacity:1}],{duration:config.transitionMs,fill:'forwards'});
        const b=back.animate([{opacity:1},{opacity:0}],{duration:config.transitionMs,fill:'forwards'});
        const finish=()=>{a.cancel();b.cancel();if(s.animation===a){el.textContent=s.text;el.style.removeProperty('display');s.animation=null;}};
        a.onfinish=finish;s.animation=a;s.shown=target;
        a.oncancel=()=>{b.cancel();};
      }else{el.textContent=text;s.shown=target;}
    }
    function configure(value){const next=normalize(value);if(next.valueTransition!==config.valueTransition){for(const [el,s]of states){cancel(s);el.textContent=s.text;el.style.removeProperty('display');s.shown=null;}}config=next;}
    function visibility(){if(doc.hidden)for(const [el,s] of states){cancel(s);el.textContent=s.text;el.style.removeProperty('display');s.shown=null;}}
    doc.addEventListener('visibilitychange',visibility);
    function destroy(){disposed=true;for(const s of states.values())cancel(s);states.clear();doc.removeEventListener('visibilitychange',visibility);}
    return {set,configure,destroy};
  }
  return {normalize,metrics,roundedPath,pathLength,createLines,createValues};
});
