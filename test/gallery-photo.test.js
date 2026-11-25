'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { Gallery } = require('../lib/gallery');

async function fixture() {
  const client = new EventEmitter();
  let reads = 0, mode = 'ok', installed = true, addressCalls = 0;
  const requests = [];
  client.getInstalled = async () => installed;
  client.getVersion = async () => '3.3.1';
  client.get = async () => { reads++; return {
    one: { name: 'One', type: 'image/jpeg', file: '/userdata/one.jpg' },
    two: { name: 'Two', type: 'image/png', file: '/userdata/two.png' }
  }; };
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    if (mode === 'hang') return;
    if (mode === 'missing') { res.writeHead(404); res.end(); return; }
    if (mode === 'redirect') { res.writeHead(302, { Location: '/unexpected' }); res.end(); return; }
    if (mode === 'large') { res.writeHead(200, { 'Content-Length': 8 * 1024 * 1024 + 1 }); res.end(); return; }
    if (mode === 'large-stream') { res.writeHead(200); res.end(Buffer.alloc(8 * 1024 * 1024 + 1)); return; }
    if (mode === 'empty') { res.end(); return; }
    res.end(Buffer.from(req.url.endsWith('.png') ? 'png fixture' : 'jpg fixture'));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = '127.0.0.1:' + server.address().port;
  const homey = { api: { getApiApp: () => client }, setTimeout, clearTimeout,
    cloud: { getLocalAddress: async () => { addressCalls++; return address; } } };
  const service = new Gallery(homey, () => {}, () => {});
  return { service, homey, client, requests, requestStarted:()=>new Promise(resolve=>server.once('request',resolve)), reads: () => reads, addressCalls: () => addressCalls,
    mode: value => { mode = value; }, installed: value => { installed = value; },
    close: async () => { service.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

test('Photo transport shares concurrent downloads, caches one image and uses only Homey-local Gallery paths', async () => {
  const f = await fixture();
  try {
    const photos = await Promise.all(Array.from({ length: 14 }, () => f.service.photo('one')));
    assert.equal(f.requests.length, 1); assert.equal(f.reads(), 1);
    assert.equal(f.requests[0], '/app/com.athom.gallery/userdata/one.jpg');
    assert.equal(photos[0].dataUrl, 'data:image/jpeg;base64,' + Buffer.from('jpg fixture').toString('base64'));
    assert(photos.every(photo => photo === photos[0]));
    await f.service.photo('one'); assert.equal(f.requests.length, 1);
    const second = await f.service.photo('two'); assert(second.dataUrl.startsWith('data:image/png;base64,'));
    assert.equal(f.service.photoCache.value.id, 'two');
    await f.service.photo('one'); assert.equal(f.requests.length, 3, 'previous photo was evicted');
    await f.service.photo('one', true); assert.equal(f.requests.length, 4, 'decode retries can bypass the image cache');
    const before = f.addressCalls();
    for (const id of ['../one', 'missing', 'https://other.test/image.png']) await assert.rejects(f.service.photo(id));
    assert.equal(f.addressCalls(), before, 'invalid/unlisted IDs never start a download');
  } finally { await f.close(); }
});

test('Gallery changes invalidate bytes; unavailable, oversized, redirected and empty photos fail cleanly', async () => {
  const f = await fixture();
  try {
    await f.service.photo('one'); f.client.emit('realtime', 'image.update');
    await f.service.photo('one'); assert.equal(f.requests.length, 2);
    for (const mode of ['missing', 'redirect', 'large', 'large-stream', 'empty']) {
      f.mode(mode); await assert.rejects(f.service.photo('one', true)); assert.equal(f.service.photoCache, null);
    }
    f.mode('ok'); await f.service.photo('one', true);
    f.installed(false); f.client.emit('uninstall');
    await assert.rejects(f.service.photo('one')); assert.equal(f.service.photoCache, null);
  } finally { await f.close(); }
});

test('Photo timeout also bounds address lookup, aborts downloads and cleans up after shutdown', async () => {
  const f = await fixture();
  try {
    const getAddress=f.homey.cloud.getLocalAddress;
    f.homey.setTimeout = fn => setTimeout(fn, 100);
    f.homey.cloud.getLocalAddress = () => new Promise(() => {});
    await assert.rejects(f.service.photo('one'), /timeout/);
    assert.equal(f.service.photoPending, null);
    f.homey.cloud.getLocalAddress = async () => { throw Error('offline'); };
    await assert.rejects(f.service.photo('one'), /offline/);
    assert.equal(f.service.photoPending, null);
    f.homey.cloud.getLocalAddress=getAddress;f.mode('hang');
    await assert.rejects(f.service.photo('one'),/timeout/);assert.equal(f.requests.length,1);assert.equal(f.service.photoPending,null);
    const started=f.requestStarted(),pending=f.service.photo('two');await started;
    f.service.close();await assert.rejects(pending);assert.equal(f.service.photoCache,null);
    await assert.rejects(f.service.photo('one'));
  } finally { await f.close(); }
});

test('Widget photo endpoint serves only selected Gallery IDs in the custom set', async () => {
  const Module = require('node:module'), original = Module._load;
  Module._load = function (id, ...args) { return id === 'homey' ? { App: class {} } : original.call(this, id, ...args); };
  let App;
  try { App = require('../app'); } finally { Module._load = original; }
  const calls = [], app = { visualConfig: { backgroundSet: 'custom' }, _photoMappings: { 'day-clear': { id: 'one' } },
    _gallery: () => ({ photo: async (...args) => { calls.push(args); return { id: 'one', dataUrl: 'data:image/jpeg;base64,YQ==' }; } }) };
  app.getGalleryPhotoForWidget = App.prototype.getGalleryPhotoForWidget;
  const route = require('../widgets/dashboard/api').getGalleryPhoto;
  assert.equal((await route({ homey: { app }, params: { id: 'one' }, query: { refresh: '1' } })).id, 'one');
  assert.deepEqual(calls, [['one', true]]);
  await assert.rejects(route({ homey: { app }, params: { id: 'two' } }));
  app.visualConfig.backgroundSet = 'house'; await assert.rejects(route({ homey: { app }, params: { id: 'one' } }));
  assert.equal(calls.length, 1, 'unselected photos and built-in sets never trigger a photo fetch');
});


test('Gallery accepts upper/mixed-case extensions and MIME types, preserving exact file and ID case', async () => {
  const f=await fixture();
  try {
    for(const extension of ['JPG','JPEG','PNG','GIF','JpG','jPeG','PnG','gIf']){
      const type=['JPG','JPEG'].includes(extension.toUpperCase())?'IMAGE/JPEG':'Image/'+extension.toUpperCase();
      f.client.get=async()=>({PhotoOne:{name:'Example',type,file:'/userdata/PhotoOne.'+extension}});
      const state=await f.service.list(true);
      assert.equal(state.images.length,1);assert.equal(state.images[0].url,'/app/com.athom.gallery/userdata/PhotoOne.'+extension);
      const result=await f.service.photo('PhotoOne',true);
      assert.equal(f.requests.at(-1),'/app/com.athom.gallery/userdata/PhotoOne.'+extension);
      const mime=['JPG','JPEG'].includes(extension.toUpperCase())?'jpeg':extension.toLowerCase();
      assert(result.dataUrl.startsWith('data:image/'+mime+';base64,'));
      await assert.rejects(f.service.photo('photoone'));
    }
    f.client.get=async()=>({bad:{type:'image/png',file:'/userdata/bad.SVG'},wrong:{type:'image/png',file:'/userdata/WRONG.PNG'},unsafe:{type:'image/png',file:'/userdata/../unsafe.PNG'}});
    assert.equal((await f.service.list(true)).images.length,0);
  } finally {await f.close();}
});
