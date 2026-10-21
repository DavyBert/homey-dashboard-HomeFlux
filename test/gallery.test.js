'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const path = require('node:path');
const { Gallery } = require('../lib/gallery');
const load = Module._load;
Module._load = function (id, ...args) {
  if (id === 'homey') return { App: class {} };
  return load.call(this, id, ...args);
};
const App = require('../app');
const official = process.env.OFFICIAL_GALLERY_PATH;
const GalleryApp = official ? require(path.join(official, 'app')) : null;
const galleryRoutes = official ? require(path.join(official, 'api')) : null;
Module._load = load;

async function fixture() {
  const images = {
    'photo-one': { name: 'My house', type: 'image/jpeg', file: '/userdata/photo-one.jpg' },
    'photo-two': { name: 'My garden', type: 'image/png', file: '/userdata/photo-two.png' }
  };
  const settings = { dataMode: 'flow', visualConfig: { backgroundSet: 'house' },
    energyConfig: { solarCount: 1, batteryCount: 0, chargerCount: 0 }, images };
  const client = new EventEmitter();
  let installed = true, fail = false, reads = 0, instance, ephemeral = 0;
  client.getInstalled = async () => installed;
  client.getVersion = async () => '3.3.1';
  client.get = async route => {
    assert.equal(route, '/image'); reads++;
    if (fail) throw new Error('Unavailable');
    return official ? galleryRoutes.getImages({ homey: instance.homey }) : settings.images;
  };
  const timers = new Set();
  const homey = {
    manifest: { version: '0.9.4' },
    api: { getApiApp: id => { assert.equal(id, 'com.athom.gallery'); return client; },
      realtime: (event, data) => client.emit('realtime', event, data) },
    settings: { get: key => settings[key], set: async (key, value) => { settings[key] = value; } },
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); timers.add(timer); return timer; },
    clearTimeout: timer => { clearTimeout(timer); timers.delete(timer); },
    setInterval: (fn, ms) => { const timer = setInterval(fn, ms); timer.unref(); timers.add(timer); return timer; },
    clearInterval: timer => { clearInterval(timer); timers.delete(timer); },
    flow: { getActionCard: () => ({ registerRunListener() {} }),
      createToken: async () => ({ setValue: async () => {}, unregister: async () => {} }) },
    images: { createImage: async () => ({ id: 'temporary-' + ++ephemeral, setPath: async () => {}, unregister: async () => {} }) }
  };
  async function restartGallery() {
    if (!official) return;
    instance = new GalleryApp(); instance.homey = { ...homey, app: instance };
    instance.log = () => {}; instance.error = () => {};
    await instance.onInit();
  }
  await restartGallery();
  function app() {
    const app = new App(); app.homey = homey; app.log = () => {}; app.error = () => {};
    app._refreshHomeyTimezone = async () => {};
    return app;
  }
  return { homey, settings, client, app, restartGallery, reads: () => reads, ephemeral: () => ephemeral,
    fail: value => { fail = value; }, installed: value => { installed = value; },
    remove: async id => {
      if (official) await galleryRoutes.deleteImage({ homey: instance.homey, params: { id } });
      else { delete settings.images[id]; client.emit('realtime', 'image.delete', { id }); }
    }, close: () => { for (const timer of timers) clearTimeout(timer); } };
}

test('Gallery list contract, shared cache, stable identity across restart', async () => {
  const f = await fixture(); const service = new Gallery(f.homey, () => {}, () => {});
  try {
    const results = await Promise.all([service.list(), service.list(), service.list()]);
    assert.equal(f.reads(), 1); assert.equal(results[0].images.length, 2);
    const image = results[0].images.find(x => x.id === 'photo-one');
    assert.equal(image.name, 'My house'); assert.equal(image.url, '/app/com.athom.gallery/userdata/photo-one.jpg');
    const before = f.ephemeral(); await f.restartGallery();
    if (official) assert.ok(f.ephemeral() > before, 'Gallery registered new temporary image IDs');
    const again = await service.list(true); assert.deepEqual(again.images, results[0].images);
  } finally { service.close(); f.close(); }
});

test('House and Garden do not initialize Gallery or change existing settings', async () => {
  const f = await fixture();
  try {
    for (const set of ['house', 'garden']) {
      f.settings.visualConfig = { backgroundSet: set, dayNightMode: 'hours' };
      const before = JSON.stringify(f.settings);
      const app = f.app(); await app.onInit();
      assert.equal(app._galleryService, null); assert.equal(app._galleryTimer, null);
      for (let i = 0; i < 1000; i++) assert.equal(app.getDashboard().visualConfig.backgroundSet, set);
      assert.equal(f.reads(), 0); assert.equal(JSON.stringify(f.settings), before);
      await app.onUninit();
    }
  } finally { f.close(); }
});

test('All 14 modes, concurrent per-scene saves, shared photos, persistence and fallback', async () => {
  const f = await fixture(); let app = f.app();
  try {
    await app.onInit(); app._markDashboardDirty = () => {};
    const result = await app.getOwnPhotos(); assert.equal(result.scenes.length, 14);
    assert.ok(result.scenes.includes('night-thunder')); assert.ok(result.scenes.includes('day-partly-cloudy'));
    await Promise.all(result.scenes.map(scene => app.saveOwnPhoto({ scene, id: 'photo-one' })));
    assert.equal(Object.keys(f.settings.photoMappings).length, 14);
    const old = f.settings.photoMappings;
    app.visualConfig.backgroundSet = 'custom'; app._syncGalleryRuntime();
    assert.equal(app._activeGalleryPhoto('night-thunder').id, 'photo-one');
    await app.onUninit(); app = f.app(); await app.onInit(); app._markDashboardDirty = () => {};
    await app.getOwnPhotos(); assert.deepEqual(app._photoMappings, old);
    assert.equal(app._activeGalleryPhoto('day-clear').id, 'photo-one');
    await f.remove('photo-one'); await app._gallery().list();
    assert.equal(app._activeGalleryPhoto('day-clear'), null);
    assert.equal(f.settings.photoMappings['day-clear'].id, 'photo-one', 'missing selection is preserved');
    await app.saveOwnPhoto({ scene: 'day-clear', id: '' });
    assert.equal(app._activeGalleryPhoto('day-clear'), null); assert.equal(Object.keys(app._photoMappings).length, 13);
    await assert.rejects(app.saveOwnPhoto({ scene: '__proto__', id: 'photo-two' }));
    await assert.rejects(app.saveOwnPhoto({ scene: 'day-clear', id: 'missing' }));
  } finally { await app.onUninit(); f.close(); }
});

test('Temporary outage and recovery, uninstall, zero Gallery reads on energy updates', async () => {
  const f = await fixture(); const app = f.app();
  try {
    await app.onInit(); app._markDashboardDirty = () => {};
    await app.saveOwnPhoto({ scene: 'day-clear', id: 'photo-two' });
    app.visualConfig.backgroundSet = 'custom'; app._syncGalleryRuntime();
    const reads = f.reads();
    for (let i = 0; i < 10000; i++) app.getDashboard();
    assert.equal(f.reads(), reads);
    f.fail(true); await app._gallery().list(true); assert.equal(app._activeGalleryPhoto('day-clear'), null);
    assert.equal(app._photoMappings['day-clear'].id, 'photo-two');
    f.fail(false); await app._gallery().list(true); assert.equal(app._activeGalleryPhoto('day-clear').id, 'photo-two');
    f.installed(false); assert.equal((await app.getOwnPhotos(true)).gallery.status, 'not-installed');
    assert.equal(app._activeGalleryPhoto('day-clear'), null);
    f.installed(true); await app.getOwnPhotos(true); assert.equal(app._activeGalleryPhoto('day-clear').id, 'photo-two');
  } finally { await app.onUninit(); f.close(); }
});

test('Reject unsafe file paths, unsupported version and invalid metadata', async () => {
  const f = await fixture(); const service = new Gallery(f.homey, () => {}, () => {});
  try {
    f.client.get = async () => ({ bad: { type: 'image/png', file: '/userdata/../secret.png' },
      remote: { type: 'image/png', file: 'https://example.org/photo.png' } });
    assert.equal((await service.list(true)).images.length, 0);
    f.client.getVersion = async () => '3.2.0'; assert.equal((await service.list(true)).status, 'unsupported');
    f.client.getVersion = async () => '3.3.1'; f.client.get = async () => [];
    assert.equal((await service.list(true)).status, 'unavailable');
  } finally { service.close(); f.close(); }
});

test('Gallery timeout is bounded and does not block the dashboard', async () => {
  const f = await fixture();
  const homey = { ...f.homey, setTimeout: fn => setTimeout(fn, 10), clearTimeout };
  f.client.get = () => new Promise(() => {});
  const service = new Gallery(homey, () => {}, () => {});
  try { assert.equal((await service.list()).status, 'unavailable'); }
  finally { service.close(); f.close(); }
});

test('Panel positions and battery line endpoint survive restart without altering photo mappings', async () => {
  const f = await fixture(); let app = f.app();
  f.settings.photoMappings = { 'day-clear': { id: 'photo-one', name: 'My house' } };
  try {
    await app.onInit();
    const positions = { solar: 'bottom-left', grid: 'top-right', battery: 'bottom-right', ev: 'top-left' };
    const originalPhotos = JSON.stringify(f.settings.photoMappings);
    await app.saveConfig({ energyConfig: app.energyConfig, selection: app.selection, dataMode: 'flow',
      visualConfig: { ...app.visualConfig, componentPositions: positions, batteryLineEnd: 'card' } });
    await app.onUninit(); app = f.app(); await app.onInit();
    assert.deepEqual(app.visualConfig.componentPositions, positions); assert.equal(app.visualConfig.batteryLineEnd, 'card');
    assert.equal(JSON.stringify(f.settings.photoMappings), originalPhotos);
    assert.equal(f.reads(), 0, 'layout-only changes do not initialize Gallery');
  } finally { await app.onUninit(); f.close(); }
});
