'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const layout = require('../widgets/dashboard/public/layout');
const Module = require('node:module');
const original = Module._load;
Module._load = function (name, ...args) { return name === 'homey' ? { App: class {} } : original.call(this, name, ...args); };
const App = require('../app');
Module._load = original;
const permutations = values => values.length ? values.flatMap((value, i) => permutations(values.filter((_, j) => i !== j)).map(rest => [value, ...rest])) : [[]];

test('Both embedded Homey pages include the canonical layout factory without external scripts or globals', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'widgets/dashboard/public/layout.js'), 'utf8');
  const factory = source.match(/\}\)\(globalThis, (function \(\) \{[\s\S]*\})\);\s*$/)[1];
  for (const file of ['settings/index.html', 'widgets/dashboard/public/index.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(html.includes('const layout=(' + factory + ')();'), file + ' uses the canonical implementation');
    assert.doesNotMatch(html, /<script[^>]*src=["'][^"']*layout\.js/);
    assert.doesNotMatch(html, /HomeFluxLayout/);
  }
});

test('Default layout and all four original SVG paths are preserved', () => {
  assert.deepEqual(layout.normalize(), layout.defaults);
  const paths = {
    solar: 'M27.0 26.0 L27.0 49.5 L39.0 49.5',
    grid: 'M75.0 26.0 L75.0 49.5 L63.9 49.5',
    battery: 'M46.0 63.5 L46.0 81.3 L35.4 81.3',
    ev: 'M63.9 56.5 L73.6 56.5 L73.6 75.8'
  };
  for (const name of layout.components) assert.equal(layout.route(name, layout.defaults[name]), paths[name]);
  const normalized = new App()._normalizeVisualConfig({});
  assert.equal(normalized.batteryLineEnd, 'device'); assert.deepEqual(normalized.componentPositions, layout.defaults);
});

test('All 24 permutations have unique corners and swap the occupied position', () => {
  for (const slots of permutations(layout.slots)) {
    const positions = Object.fromEntries(layout.components.map((name, i) => [name, slots[i]]));
    assert.deepEqual(layout.normalize(positions), positions);
    for (const name of layout.components) for (const slot of layout.slots) {
      const other = layout.components.find(item => positions[item] === slot);
      const swapped = layout.swap(positions, name, slot);
      assert.equal(swapped[name], slot); assert.equal(swapped[other], positions[name]);
      assert.equal(new Set(Object.values(swapped)).size, 4);
    }
  }
  const invalid = layout.normalize({ solar: 'bad', grid: 'top-left', battery: 'top-left', ev: null });
  assert.equal(new Set(Object.values(invalid)).size, 4);
  assert.ok(Object.values(invalid).every(slot => layout.slots.includes(slot)));
});

test('PV/grid and battery/charger keep opposite logical line orientations in every corner', () => {
  const points = d => d.match(/[-\d.]+/g).map(Number).reduce((all, value, i, numbers) => i % 2 ? all : [...all, [value, numbers[i + 1]]], []);
  for (const slot of layout.slots) {
    assert.equal(layout.route('solar', slot), layout.route('grid', slot));
    assert.equal(layout.route('battery', slot), layout.route('ev', slot));
    assert.deepEqual(points(layout.route('solar', slot)), points(layout.route('battery', slot)).reverse());
    const target = layout.cardPoint(slot, { left: 3, right: 25, top: 75, bottom: 95 });
    assert.deepEqual(points(layout.route('battery', slot, target)).at(-1), target);
  }
});
