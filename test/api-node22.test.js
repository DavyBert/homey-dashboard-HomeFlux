'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {HomeyAPI}=require('homey-api');
const manifest=require('homey-api/package.json');
test('Installed Homey API explicitly supports Node 22 and exposes Dashboard device/Logic APIs',async()=>{
 assert.equal(manifest.version,'3.21.3');assert.equal(manifest.engines.node,'>=22');
 for(const [platform,platformVersion] of [['local',1],['local',2],['cloud',2]]){
  const homey={platform,platformVersion,version:'12.3.0',api:{getOwnerApiToken:async()=> 'test-token',getLocalUrl:async()=> 'http://127.0.0.1:1'},cloud:{getHomeyId:async()=> 'test-homey'}};
  const api=await HomeyAPI.createAppAPI({homey});
  for(const method of ['connect','disconnect','getDevice','getDevices'])assert.equal(typeof api.devices[method],'function',platform+':devices.'+method);
  for(const method of ['connect','disconnect','getVariable','getVariables','on','off'])assert.equal(typeof api.logic[method],'function',platform+':logic.'+method);
 }
});
