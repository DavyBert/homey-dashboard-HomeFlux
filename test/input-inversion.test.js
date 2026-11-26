'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Module=require('node:module');
const original=Module._load;Module._load=function(id,...args){return id==='homey'?{App:class{}}:original.call(this,id,...args);};
const App=require('../app');Module._load=original;
const fields=Array.from({length:10},(_,i)=>{const n=i+1,s=i?String(n):'';return[i?'solar'+n:'solar',`battery${s}Soc`,`battery${s}Power`,`ev${s}Power`];}).flat().concat(['gridPower','homePower']);
async function fixture(config={}){
 const settings={dataMode:'flow',energyConfig:{solarCount:2,batteryCount:1,chargerCount:1,...config},visualConfig:{backgroundMode:'manual',periodMode:'day',weather:'clear'}},listeners={};
 const app=new App();app.homey={manifest:{version:'1.0.4'},settings:{get:k=>settings[k],set:async(k,v)=>{settings[k]=v;}},api:{realtime(){}},flow:{getActionCard:id=>({registerRunListener:fn=>{listeners[id]=fn;}})},setTimeout,clearTimeout,setInterval,clearInterval,i18n:{getLanguage:()=> 'de'},__:k=>k};
 app.log=app.error=()=>{};app._refreshHomeyTimezone=async()=>{};await app.onInit();app._markDashboardDirty=()=>{};
 return{app,settings,send:(field,value)=>listeners.set_flow_input({target:field,value}),close:()=>app.onUninit()};
}
test('Two PV devices with opposite meter signs are corrected individually before their total and house balance',async()=>{
 const f=await fixture();try{
  f.app._setFlowInput('solar',1000);f.app._setFlowInput('solar2',-500);f.app._setFlowInput('gridPower',200);f.app._setFlowInput('batteryPower',0);
  assert.equal(f.app.getDashboard().energy.solar.rawValue,.5);
  f.app.energyConfig.inputInversions={solar2:true};const d=f.app.getDashboard();
  assert.equal(d.energy.solar.rawValue,1.5);assert.equal(d.energy.homePower.rawValue,1.7);assert.equal(f.app.sourceCache.get('flow:solar2').value,-500);
  assert.equal(f.app.getFlowStatus().inputs.solar2.value,-500,'received input remains the original meter value');
 }finally{await f.close();}
});
test('All 42 numeric inputs support per-field inversion in both input modes without changing cached sources',async()=>{
 const f=await fixture({solarCount:10,batteryCount:10,chargerCount:10});try{
  for(const mode of ['flow','integrated']){
   f.app._activeDataMode=mode;
   for(const field of fields){
    const key=mode==='flow'?'flow:'+field:'device:meter:'+field;if(mode==='integrated')f.app.energyConfig[field]=key;
    const source={value:-12.75,unit:field.endsWith('Soc')?'%':'W',label:field};f.app.sourceCache.set(key,source);
    f.app.energyConfig.inputInversions={};assert.equal(f.app._inputData(field).rawValue,-12.75);
    f.app.energyConfig.inputInversions={[field]:true};assert.equal(f.app._inputData(field).rawValue,12.75);assert.equal(f.app._inputData(field).value,'12.75');assert.equal(source.value,-12.75);
    for(const value of [null,'-12.75',false,NaN,Infinity]){source.value=value;assert(Object.is(f.app._inputData(field).rawValue,value));}
    source.value=0;assert(Object.is(f.app._inputData(field).rawValue,0));source.value=12.75;assert.equal(f.app._inputData(field).rawValue,-12.75);
   }
  }
 }finally{await f.close();}
});
test('Battery power normalization, line interpretation and motion settings retain their independent meanings',async()=>{
 const f=await fixture();try{
  f.app._setFlowInput('batteryPower',1000);assert.equal(f.app._batteryPowerWatts(),-1000);assert.equal(f.app._batteryFlowState(),'discharge');
  f.app.energyConfig.batteryDirection='positive_charge';assert.equal(f.app._batteryPowerWatts(),1000);assert.equal(f.app._batteryFlowState(),'charge');
  f.app.energyConfig.batteryLineDirection='positive_discharge';assert.equal(f.app._batteryLineFlowState(),'discharge');assert.equal(f.app._batteryPowerWatts(),1000);
  const motion=f.app._batteryLineMotionReverse();f.app.energyConfig.batteryLineMotion='follow_flow';assert.notEqual(f.app._batteryLineMotionReverse(),motion);assert.equal(f.app._batteryPowerWatts(),1000);
  f.app.energyConfig.inputInversions={batteryPower:true};assert.equal(f.app._batteryPowerWatts(),-1000);assert.equal(f.app._batteryLineWatts(),1000);assert.equal(f.app.sourceCache.get('flow:batteryPower').value,1000);
 }finally{await f.close();}
});
test('Grid, direct home consumption, charger totals and weighted SOC use corrected values',async()=>{
 const f=await fixture({batteryCount:2,chargerCount:2,batteryCapacityKwh:10,battery2CapacityKwh:5});try{
  for(const [field,value]of Object.entries({gridPower:-900,homePower:-700,evPower:1000,ev2Power:-500,batterySoc:-50,battery2Soc:80}))f.app._setFlowInput(field,value);
  f.app.energyConfig.inputInversions={gridPower:true,homePower:true,ev2Power:true,batterySoc:true};const d=f.app.getDashboard();
  assert.equal(d.energy.gridPower.rawValue,900);assert.equal(d.energy.gridFlow,'import');assert.equal(d.energy.homePower.rawValue,700);assert.equal(d.energy.homePower.derived,false);assert.equal(d.energy.evPower.rawValue,1.5);assert.equal(d.energy.batterySoc.rawValue,60);
 }finally{await f.close();}
});
test('Switches default off, validate field names, persist across saves/restarts and retain battery settings',async()=>{
 const f=await fixture();let second;try{
  assert.deepEqual(f.app.energyConfig.inputInversions,{});
  const cfg=f.app._normalizeEnergyConfig({...f.app.energyConfig,inputInversions:{solar2:true,gridPower:'true',weatherSource:true,batteryStatus:true,unknown:true}});assert.deepEqual(cfg.inputInversions,{solar2:true});
  cfg.batteryDirection='positive_charge';cfg.batteryLineDirection='positive_discharge';cfg.batteryLineMotion='follow_flow';
  await f.app.saveConfig({energyConfig:cfg,visualConfig:f.app.visualConfig,selection:[],dataMode:'flow'});
  assert.deepEqual(f.settings.energyConfig.inputInversions,{solar2:true});
  second=await fixture(JSON.parse(JSON.stringify(f.settings.energyConfig)));
  assert.deepEqual(second.app.energyConfig.inputInversions,{solar2:true});assert.equal(second.app.energyConfig.batteryDirection,'positive_charge');assert.equal(second.app.energyConfig.batteryLineDirection,'positive_discharge');assert.equal(second.app.energyConfig.batteryLineMotion,'follow_flow');
 }finally{await second?.close();await f.close();}
});
test('Locale-aware Flow number parsing runs before inversion and the source is not inverted twice',async()=>{
 const f=await fixture();try{
  f.app.energyConfig.inputInversions={solar:true};await f.send('solar','-1.234,50');assert.equal(f.app._inputData('solar').rawValue,1234.5);assert.equal(f.app.sourceCache.get('flow:solar').value,-1234.5);
  for(let i=0;i<1000;i++)assert.equal(f.app.getDashboard().energy.solar.rawValue,1.2345);
  assert.equal(f.app.sourceCache.get('flow:solar').value,-1234.5);
 }finally{await f.close();}
});

test('One source reused in two fields can be inverted in just one field',async()=>{
 const f=await fixture();try{
  f.app._activeDataMode='integrated';f.app.energyConfig.solar=f.app.energyConfig.solar2='variable:shared';f.app.sourceCache.set('variable:shared',{value:1000,unit:'W'});f.app.energyConfig.inputInversions={solar2:true};
  assert.equal(f.app._inputData('solar').rawValue,1000);assert.equal(f.app._inputData('solar2').rawValue,-1000);assert.equal(f.app._combinedSolarData().rawValue,0);assert.equal(f.app.sourceCache.get('variable:shared').value,1000);
 }finally{await f.close();}
});
test('SOC history applies the same per-input sign correction before capacity weighting',async()=>{
 const f=await fixture({batteryCount:2,batteryCapacityKwh:10,battery2CapacityKwh:5,batterySoc:'variable:soc1',battery2Soc:'variable:soc2'});try{
  f.app._activeDataMode='integrated';f.app.energyConfig.inputInversions={batterySoc:true};const ts=Date.now()-86400000;
  f.app._fetchSoc24hInsight=async key=>({value:key==='variable:soc1'?-50:80,ts});
  const sample=await f.app._refreshBattery24hFromInsights(true);assert.equal(sample.value,60);assert.equal(sample.ts,ts);
 }finally{await f.close();}
});
