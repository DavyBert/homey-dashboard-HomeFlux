'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseNumericInput:parse}=require('../lib/numeric-input');
const Module=require('node:module'),load=Module._load;
Module._load=function(id,...args){return id==='homey'?{App:class{}}:load.call(this,id,...args);};
const App=require('../app');Module._load=load;
test('Numbers, decimal commas, international grouping, signs, exponents and invalid inputs',()=>{
 for(const [input,value] of [[0,0],[1.234,1.234],['1,5',1.5],['-1.234,56',-1234.56],['1,234.56',1234.56],['1 234,56',1234.56],['1\u202f234,56',1234.56],['1,5e3',1500],['.5',.5],['+25',25]])assert.equal(parse(input).value,value,String(input));
 for(const input of ['',null,undefined,true,NaN,Infinity,'1.2.3','12,34,567','1 23','10 W','0x10','1e999'])assert.equal(parse(input).invalid,true,String(input));
 for(const input of ['1.234','1,234','-1.234'])assert.equal(parse(input).choices.length,2);
});
function fixture(lang='de',settings={}){
 const app=new App();let listener;const values=[];
 app.homey={i18n:{getLanguage:()=>lang},__:k=>k,settings:{get:k=>settings[k],set:async(k,v)=>settings[k]=v},flow:{getActionCard:()=>({registerRunListener:fn=>listener=fn})}};
 app._isFlowMode=()=>true;app._setFlowInput=(field,value)=>values.push({field,value});app._registerFlowInputCards();
 return {app,values,settings,send:(target,value)=>listener({target,value})};
}
test('Ambiguous Flow waits for confirmation, applies and remembers rule per field; reset and stale selection',async()=>{
 const f=fixture();await f.send('gridPower',100);
 await assert.rejects(f.send('gridPower','1.234'),/number_ambiguous/);assert.equal(f.values.at(-1).value,100);
 const entry=f.app.getNumericInputs().pending[0];assert.equal(entry.choices[entry.suggested].value,1234);
 const choice=entry.choices.find(c=>c.kind==='grouped');
 await f.app.resolveNumericInput({field:'gridPower',raw:entry.raw,...choice});assert.equal(f.values.at(-1).value,1234);
 await f.send('gridPower','2.345');assert.equal(f.values.at(-1).value,2345);
 const restarted=fixture('de',f.settings);await restarted.send('gridPower','3.456');assert.equal(restarted.values.at(-1).value,3456);
 await assert.rejects(f.send('homePower','1.234'),/number_ambiguous/);
 await f.app.resolveNumericInput({field:'gridPower',reset:true});await assert.rejects(f.send('gridPower','4.567'),/number_ambiguous/);
 await assert.rejects(f.app.resolveNumericInput({field:'gridPower',raw:'1,234',...choice}),/number_changed/);
 await f.send('gridPower',4.567);assert.equal(f.values.at(-1).value,4.567);assert.equal(f.app.getNumericInputs().pending.some(p=>p.field==='gridPower'),false);
});
test('Suggestions follow language and numeric tokens never need confirmation',async()=>{
 for(const lang of ['en','nl','de','fr','es']){
  const f=fixture(lang);await f.send('solar',1.234);assert.equal(f.values[0].value,1.234);
  await assert.rejects(f.send('solar','1.234'));
  const p=f.app.getNumericInputs().pending[0];assert.equal(p.choices[p.suggested].value,lang==='en'?1.234:1234);
 }
});
test('A newer measurement in the confirmed format is applied, not the old proposal',async()=>{
 const f=fixture();await assert.rejects(f.send('gridPower','1.234'));
 const entry=f.app.getNumericInputs().pending[0],choice=entry.choices.find(c=>c.kind==='grouped');
 await assert.rejects(f.send('gridPower','2.345'));
 await f.app.resolveNumericInput({field:'gridPower',raw:entry.raw,...choice});
 assert.equal(f.values.at(-1).value,2345);
});
test('Concurrent confirmations persist both input rules; a failed request does not block the queue',async()=>{
 const f=fixture();
 f.app.homey.settings.set=async(k,v)=>{await new Promise(resolve=>setTimeout(resolve,5));f.settings[k]=v;};
 for(const field of ['gridPower','homePower'])await assert.rejects(f.send(field,'1.234'));
 const pending=f.app.getNumericInputs().pending;
 await Promise.all(pending.map(p=>f.app.resolveNumericInput({field:p.field,raw:p.raw,...p.choices.find(c=>c.kind==='grouped')})));
 assert.deepEqual(Object.keys(f.settings.numericInputRules).sort(),['gridPower','homePower']);
 await assert.rejects(f.app.resolveNumericInput({field:'invalid'}));
 await f.app.resolveNumericInput({field:'homePower',reset:true});
 assert.equal(f.settings.numericInputRules.homePower,undefined);
});
test('A fresh numeric token during persistence cannot be overwritten by an older proposal',async()=>{
 const f=fixture();await assert.rejects(f.send('gridPower','1.234'));
 const p=f.app.getNumericInputs().pending[0];
 f.app.homey.settings.set=async(k,v)=>{f.settings[k]=v;await f.send('gridPower',999);};
 await f.app.resolveNumericInput({field:p.field,raw:p.raw,...p.choices.find(c=>c.kind==='grouped')});
 assert.equal(f.values.at(-1).value,999);
});
test('An updated ambiguous value during persistence is applied using the confirmed format',async()=>{
 const f=fixture();await assert.rejects(f.send('gridPower','1.234'));
 const p=f.app.getNumericInputs().pending[0];
 f.app.homey.settings.set=async(k,v)=>{await assert.rejects(f.send('gridPower','5.678'));f.settings[k]=v;};
 await f.app.resolveNumericInput({field:p.field,raw:p.raw,...p.choices.find(c=>c.kind==='grouped')});
 assert.equal(f.values.at(-1).value,5678);assert.equal(f.app.getNumericInputs().pending.length,0);
});
test('Charger display setting is normalized, survives serialization and defaults to hide at zero',()=>{
 const f=fixture();
 assert.equal(f.app._normalizeVisualConfig({}).evDisplayMode,'hide_zero');
 assert.equal(f.app._normalizeVisualConfig({evDisplayMode:'invalid'}).evDisplayMode,'hide_zero');
 const persisted=JSON.parse(JSON.stringify(f.app._normalizeVisualConfig({evDisplayMode:'always'})));
 assert.equal(f.app._normalizeVisualConfig(persisted).evDisplayMode,'always');
});
