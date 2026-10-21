'use strict';
// Developer-only browser test. Requires Playwright; no app dependency is added.
const fs = require('fs');
const http = require('http');
const path = require('path');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { chromium } = require('playwright');
const layout = require('../widgets/dashboard/public/layout');
const Module = require('module');
const original = Module._load;
Module._load = function (id, ...args) { return id === 'homey' ? { App: class {} } : original.call(this, id, ...args); };
const App = require('../app');
const routes = require('../api');
Module._load = original;

(async () => {
  const root = path.resolve(__dirname, '..');
  const gallery = new EventEmitter();
  let files = { one: true, two: true }, corrupt = false, requests = 0, reads = 0;
  const photos = {
    one: { name: 'My house', type: 'image/jpeg', file: '/userdata/one.jpg' },
    two: { name: 'My garden', type: 'image/png', file: '/userdata/two.png' }
  };
  gallery.getInstalled = async () => true; gallery.getVersion = async () => '3.3.1';
  gallery.get = async url => { assert.equal(url, '/image'); reads++; return photos; };
  const values = { dataMode: 'flow', energyConfig: { solarCount: 1, batteryCount: 1, chargerCount: 1 },
    visualConfig: { backgroundSet: 'house', backgroundMode: 'manual', periodMode: 'day', weather: 'clear' } };
  const app = new App();
  const homey = { manifest: { version: '0.9.4' }, settings: { get: k => values[k], set: async (k, v) => { values[k] = v; } },
    api: { getApiApp: () => gallery, realtime() {} }, setTimeout, clearTimeout, setInterval, clearInterval,
    flow: { getActionCard: () => ({ registerRunListener() {} }) } };
  app.homey = homey; homey.app = app; app.log = app.error = () => {}; app._refreshHomeyTimezone = async () => {};
  await app.onInit(); app._setFlowInput('solar', 1500);app._setFlowInput('batterySoc',50);app._setFlowInput('batteryPower',-500);app._setFlowInput('evPower',1000);
  const scenes = (await app.getOwnPhotos()).scenes;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        const name = url.pathname.slice(4); let body = '';
        for await (const part of req) body += part;
        const args = { homey, body: body ? JSON.parse(body) : {}, query: Object.fromEntries(url.searchParams) };
        const names = { '/config': req.method === 'GET' ? 'getConfig' : 'saveConfig', '/photos': 'getOwnPhotos',
          '/photo-mapping': 'saveOwnPhoto', '/weather-mapping': 'getWeatherMappings', '/flow-status': 'getFlowStatus' };
        const result = name === '/dashboard' ? app.getDashboard() : await routes[names[name]](args);
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result)); return;
      }
      if (url.pathname === '/homey.js') { res.end('document.addEventListener("DOMContentLoaded",()=>onHomeyReady(Homey));'); return; }
      if (url.pathname.startsWith('/app/com.athom.gallery/userdata/')) {
        requests++;
        const id = path.basename(url.pathname).split('.')[0];
        if (!files[id]) { res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end(); return; }
        res.setHeader('Cache-Control', 'public, max-age=3600'); res.setHeader('Content-Type', 'image/jpeg');
        res.end(corrupt ? Buffer.from('not an image') : fs.readFileSync(path.join(root, 'assets/images/small.png'))); return;
      }
      let relative = url.pathname === '/embedded-settings' ? 'settings/index.html' : url.pathname.replace(/^\/app\/com\.dashboard\.homeflux\//, '');
      relative = relative.replace(/^\//, '');
      const file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep)) throw new Error('Invalid path');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.end(fs.readFileSync(file));
    } catch (err) { res.statusCode = 500; res.end(JSON.stringify({ error: err.message })); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const errors = [];
  let externalLayoutRequests = 0;
  async function page(locale) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/layout.js', route => { externalLayoutRequests++; return route.abort(); });
    await page.addInitScript(locale => {
      // Some embedded hosts define CommonJS globals. The page must not rely on
      // a UMD export or on a relative external layout.js request succeeding.
      window.module = { exports: {} };
      window.events = {}; window.alerts = [];
      window.Homey = { __: (key, tokens = {}) => {
        let value = key.split('.').reduce((o, k) => o?.[k], locale) || key;
        for (const [key, item] of Object.entries(tokens)) value = value.replaceAll('__' + key + '__', item);
        return value;
      }, on: (name, cb) => { events[name] = cb; }, ready: () => { window.ready = true; }, setHeight() {},
      alert: message => alerts.push(message), confirm: (m, i, cb) => cb(null, true),
      api: (method, url, body, cb) => {
        if (typeof body === 'function') { cb = body; body = undefined; }
        const promise = fetch('/api' + url, { method, headers: { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body) }).then(async response => {
            const data = await response.json(); if (!response.ok) throw new Error(data.error); return data;
          });
        if (cb) promise.then(value => cb(null, value), error => cb(error)); return promise;
      } };
    }, locale);
    return page;
  }
  try {
    const locale = JSON.parse(fs.readFileSync(path.join(root, 'locales/nl.json')));
    const english = await page(JSON.parse(fs.readFileSync(path.join(root, 'locales/en.json'))));
    await english.goto(origin + '/embedded-settings');
    await english.waitForFunction(() => window.ready); await english.locator('#tabPhotos').click();
    assert.equal(externalLayoutRequests, 0, 'embedded settings initializes without requesting layout.js');
    await english.waitForSelector('.photo-row');
    assert.equal(await english.locator('#tabPhotos').textContent(), 'Own photos');
    assert.equal(await english.locator('.photo-row').count(), 14);
    assert.ok((await english.locator('.photo-row .title').first().textContent()).startsWith('Day'));
    assert.equal(await english.locator('.photo-row select option').first().textContent(), 'Default image');
    await english.close();
    const settings = await page(locale);
    await settings.goto(origin + '/app/com.dashboard.homeflux/settings/index.html');
    await settings.waitForFunction(() => window.ready);
    await settings.locator('#tabSettings').click();
    assert.equal(await settings.locator('#batteryLineEnd').inputValue(), 'device');
    await settings.locator('#positionSolar').selectOption('bottom-left');
    assert.equal(await settings.locator('#positionBattery').inputValue(), 'top-left');
    await settings.locator('#positionEv').selectOption('top-left');
    assert.equal(await settings.locator('#positionBattery').inputValue(), 'bottom-right');
    await settings.locator('#batteryLineEnd').selectOption('card');
    await settings.locator('#save').click();
    await settings.waitForFunction(() => document.getElementById('status').textContent.includes('opgeslagen'));
    await settings.reload();await settings.waitForFunction(() => window.ready);await settings.locator('#tabSettings').click();
    assert.equal(await settings.locator('#positionSolar').inputValue(), 'bottom-left');
    assert.equal(await settings.locator('#batteryLineEnd').inputValue(), 'card');
    await settings.locator('#resetPositions').click();
    assert.equal(await settings.locator('#positionBattery').inputValue(), 'bottom-left');
    assert.equal(await settings.locator('#batteryLineEnd').inputValue(), 'card', 'position reset preserves endpoint choice');
    await settings.locator('#batteryLineEnd').selectOption('device');
    assert.equal(await settings.locator('#backgroundSet option').count(), 3);
    await settings.locator('#backgroundSet').selectOption('custom');
    await settings.locator('#save').click();
    await settings.waitForFunction(() => document.getElementById('status').textContent.includes('opgeslagen'));
    assert.equal(values.visualConfig.backgroundSet, 'custom');
    await settings.locator('#tabPhotos').click(); await settings.waitForSelector('.photo-row');
    assert.equal(await settings.locator('#tabPhotos').textContent(), "Eigen foto's");
    assert.equal(await settings.locator('.photo-row').count(), 14);
    assert.equal(await settings.locator('.photo-row select').first().locator('option').count(), 3);
    await settings.locator('.photo-row[data-scene="day-clear"] select').selectOption('one');
    await settings.waitForFunction(() => document.getElementById('photosStatus').textContent.includes('opgeslagen'));
    await settings.locator('.photo-row[data-scene="night-clear"] select').selectOption('one');
    await settings.waitForFunction(() => document.getElementById('photosStatus').textContent.includes('opgeslagen'));
    assert.equal(values.photoMappings['day-clear'].id, 'one'); assert.equal(values.photoMappings['night-clear'].id, 'one');
    const before = reads; await settings.locator('#refreshPhotos').click();
    await settings.waitForFunction(() => !document.getElementById('refreshPhotos').disabled);
    assert.equal(reads, before + 1);
    await settings.setViewportSize({ width: 390, height: 844 });
    assert.ok(await settings.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await settings.reload(); await settings.waitForFunction(() => window.ready); await settings.locator('#tabPhotos').click();
    await settings.waitForSelector('.photo-row');
    assert.equal(await settings.locator('.photo-row[data-scene="day-clear"] select').inputValue(), 'one');
    for (const scene of scenes) await app.saveOwnPhoto({ scene, id: 'one' });
    const widget = await page(locale); await widget.clock.install();
    await widget.goto(origin + '/widgets/dashboard/public/index.html');
    const background = () => widget.locator('#energy').evaluate(el => el.style.backgroundImage);
    await widget.waitForFunction(() => document.getElementById('energy').style.backgroundImage.includes('userdata/one.jpg'));
    async function emit(set, scene, photo) {
      app.visualConfig.backgroundSet = set; app.visualConfig.periodMode = scene.startsWith('night') ? 'night' : 'day';
      app.visualConfig.weather = scene.replace(/^(day|night)-/, '');
      const data = app.getDashboard(); if (photo !== undefined) data.galleryPhoto = photo;
      await widget.evaluate(data => events['dashboard.updated'](data), data);
    }
    const classes = await widget.evaluate(() => Object.fromEntries(['solar','grid','battery','ev'].map(name=>[name,document.getElementById(name+'FlowOverlay').getAttribute('class')])));
    const perms = values => values.length ? values.flatMap((value,i)=>perms(values.filter((_,j)=>i!==j)).map(rest=>[value,...rest])) : [[]];
    for(const slots of perms(layout.slots)){
      const positions=Object.fromEntries(layout.components.map((name,i)=>[name,slots[i]]));app.visualConfig.componentPositions=positions;
      await emit('custom','day-clear');
      const geometry=await widget.evaluate(()=>{
        const e=document.getElementById('energy').getBoundingClientRect();
        return Object.fromEntries(['solar','grid','battery','ev'].map(name=>{
          const card=document.querySelector('.callout.'+name).getBoundingClientRect();
          return [name,{x:(card.left+card.right)/2-e.left,y:(card.top+card.bottom)/2-e.top,w:e.width,h:e.height,
            path:document.querySelector('#'+name+'FlowOverlay .flow-core').getAttribute('d'),style:document.getElementById(name+'FlowOverlay').getAttribute('class')}];
        }));
      });
      for(const name of layout.components){const g=geometry[name],slot=positions[name];
        assert.equal(g.path,layout.route(name,slot));assert.equal(g.style,classes[name]);
        assert.equal(g.x<g.w/2,slot.endsWith('left'));assert.equal(g.y<g.h/2,slot.startsWith('top'));
      }
    }
    app.visualConfig.batteryLineEnd='card';
    for(const width of [320,390,1000])for(const slot of layout.slots){
      app.visualConfig.componentPositions=layout.swap(layout.defaults,'battery',slot);
      await widget.setViewportSize({width,height:850});await emit('custom','day-clear');await widget.clock.runFor(100);
      const endpoint=await widget.evaluate(()=>{
        const e=document.getElementById('energy'),er=e.getBoundingClientRect(),r=document.querySelector('.callout.battery').getBoundingClientRect();
        const x=er.left+e.clientLeft,y=er.top+e.clientTop;
        const box={left:(r.left-x)/e.clientWidth*100,right:(r.right-x)/e.clientWidth*100,top:(r.top-y)/e.clientHeight*100,bottom:(r.bottom-y)/e.clientHeight*100};
        const numbers=document.querySelector('#batteryFlowOverlay .flow-core').getAttribute('d').match(/[-\d.]+/g).map(Number);
        return {box,actual:numbers.slice(-2)};
      });
      layout.cardPoint(slot,endpoint.box).forEach((value,i)=>assert.ok(Math.abs(value-endpoint.actual[i])<=.06,JSON.stringify(endpoint)));
    }
    for(const scale of [50,110])for(const comparison of [true,false]){
      app.visualConfig.widgetTextScale=scale;app.visualConfig.showBattery24h=comparison;
      await emit('custom','day-clear');await widget.clock.runFor(100);
      assert.ok(await widget.evaluate(()=>{
        const e=document.getElementById('energy'),er=e.getBoundingClientRect(),b=document.querySelector('.callout.battery').getBoundingClientRect();
        const end=document.querySelector('#batteryFlowOverlay .flow-core').getAttribute('d').match(/[-\d.]+/g).map(Number).slice(-2);
        return Math.abs(end[0]-((b.left+b.right)/2-er.left-e.clientLeft)/e.clientWidth*100)<.06
          &&Math.abs(end[1]-(b.top-er.top-e.clientTop)/e.clientHeight*100)<.06;
      }),'line follows battery text size / 24-hour visibility');
    }
    app.visualConfig.widgetTextScale=90;app.visualConfig.showBattery24h=true;await emit('custom','day-clear');
    // Let native ResizeObserver delivery settle after the last viewport change.
    await widget.clock.runFor(200);await widget.waitForTimeout(50);await widget.clock.runFor(100);
    await widget.evaluate(()=>{window.geometryReads=0;const card=document.querySelector('.callout.battery'),read=card.getBoundingClientRect.bind(card);card.getBoundingClientRect=()=>{geometryReads++;return read();};});
    await widget.evaluate(data=>{for(let i=0;i<1000;i++)events['dashboard.updated'](data);},app.getDashboard());await widget.clock.runFor(100);
    assert.equal(await widget.evaluate(()=>geometryReads),0,'unchanged energy updates do not measure line geometry');
    app.visualConfig.batteryLineEnd='device';app.visualConfig.componentPositions=layout.normalize();
    await widget.setViewportSize({width:1000,height:850});await emit('custom','day-clear');
    for (const set of ['house', 'garden', 'custom']) for (const scene of scenes) {
      await emit(set, scene);
      if (set === 'custom') await widget.waitForFunction(() => document.getElementById('energy').style.backgroundImage.includes('userdata/one.jpg'));
      else assert.ok((await background()).includes('scene-' + (set === 'garden' ? 'garden-' : '') + scene + '.jpg'));
    }
    await emit('custom', 'day-clear');
    await widget.waitForFunction(() => document.getElementById('energy').style.backgroundImage.includes('userdata/one.jpg'));
    const requestCount = requests; await widget.evaluate(data => { for (let i = 0; i < 1000; i++) { data.revision++; events['dashboard.updated'](data); } }, app.getDashboard());
    assert.equal(requests, requestCount, 'energy updates do not reload a photo');
    delete photos.one; gallery.emit('realtime', 'image.delete', { id: 'one' }); await app._gallery().list();
    await emit('custom', 'day-clear'); assert.ok(!(await background()).includes('userdata'));
    assert.ok((await background()).includes('scene-day-clear.jpg')); assert.equal(values.photoMappings['day-clear'].id, 'one');
    await app.saveOwnPhoto({ scene: 'day-clear', id: 'two' }); files.two = false;
    await emit('custom', 'day-clear'); await widget.clock.runFor(200);
    await widget.waitForFunction(() => !document.getElementById('energy').style.backgroundImage.includes('userdata'));
    assert.ok((await background()).includes('scene-day-clear.jpg'));
    files.two = true; await widget.clock.runFor(31000);
    await widget.waitForFunction(() => document.getElementById('energy').style.backgroundImage.includes('userdata/two.png'));
    // A stalled image times out while the correct fallback remains visible;
    // a late response must never overwrite a subsequently selected scene.
    let releaseSlow;
    const slow = new Promise(resolve => { releaseSlow = resolve; });
    await widget.route('**/userdata/slow.jpg', async route => { await slow; await route.abort(); });
    await emit('custom', 'night-rain', { url: '/app/com.athom.gallery/userdata/slow.jpg' });
    await widget.clock.runFor(16000);
    assert.ok((await background()).includes('scene-night-rain.jpg'));
    await emit('garden', 'day-clear'); releaseSlow(); await widget.clock.runFor(100);
    assert.ok((await background()).includes('scene-garden-day-clear.jpg'));
    // A new URL with corrupt data must not replace the matching fallback.
    files.corrupt = true; corrupt = true; await emit('custom', 'night-snow', { url: '/app/com.athom.gallery/userdata/corrupt.jpg' });
    await widget.clock.runFor(200);
    assert.ok((await background()).includes('scene-night-snow.jpg')); assert.ok(!(await background()).includes('userdata'));
    const attempts = requests; await widget.evaluate(data => { for (let i = 0; i < 1000; i++) events['dashboard.updated'](data); },
      { ...app.getDashboard(), galleryPhoto: { url: '/app/com.athom.gallery/userdata/corrupt.jpg' } });
    assert.equal(requests, attempts, 'failed photo does not retry on energy updates');
    const retried = widget.waitForResponse(response => response.url().includes('corrupt.jpg?hf_retry='));
    await widget.clock.runFor(31000); await retried;
    assert.ok(requests <= attempts + 1, 'one bounded retry');
    await emit('house', 'night-snow'); const afterSwitch = requests; await widget.clock.runFor(61000);
    assert.equal(requests, afterSwitch, 'switching back to House cancels custom retries');
    assert.equal(externalLayoutRequests, 0, 'settings and widget never request an external layout script');
    assert.deepEqual(errors, []); assert.deepEqual(await settings.evaluate(() => alerts), []);
    console.log('PASS: embedded settings on a different base path and widget initialize with external layout scripts blocked and CommonJS globals present.');
    console.log('PASS: all 24 panel permutations; line orientation/colour retained; battery panel endpoints at 320/390/1000 px; settings swap/reset/persistence; no geometry reads for unchanged updates.');
    console.log('PASS: all 14 modes × 3 sets; NL/EN settings, 3 choices, per-scene/shared photos, refresh, previews, persistence, mobile width; missing/corrupt/stalled images, timed recovery, late response, cancelled retry, 1000 updates without reloads; no browser errors.');
  } finally { await browser.close(); await app.onUninit(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
