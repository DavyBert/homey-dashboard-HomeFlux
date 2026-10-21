'use strict';

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HomeFluxLayout = api;
})(globalThis, function () {
  const components = ['solar', 'grid', 'battery', 'ev'];
  const slots = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
  const defaults = Object.freeze(Object.fromEntries(components.map((name, i) => [name, slots[i]])));
  const anchors = {
    'top-left': { left: '4.2%', top: '5.8%' },
    'top-right': { right: '4.5%', top: '5.8%' },
    'bottom-left': { left: '3.2%', bottom: '4.5%' },
    'bottom-right': { right: '5.5%', bottom: '4.5%' }
  };
  const routes = {
    'top-left': [[27, 26], [27, 49.5], [39, 49.5]],
    'top-right': [[75, 26], [75, 49.5], [63.9, 49.5]],
    'bottom-left': [[46, 63.5], [46, 81.3], [35.4, 81.3]],
    'bottom-right': [[63.9, 56.5], [73.6, 56.5], [73.6, 75.8]]
  };

  function normalize(input) {
    const result = {}, used = new Set();
    for (const name of components) {
      const value = input && input[name];
      if (slots.includes(value) && !used.has(value)) { result[name] = value; used.add(value); }
    }
    for (const name of components) {
      if (result[name]) continue;
      const value = !used.has(defaults[name]) ? defaults[name] : slots.find(slot => !used.has(slot));
      result[name] = value; used.add(value);
    }
    return Object.fromEntries(components.map(name => [name, result[name]]));
  }

  function swap(input, component, slot) {
    const result = normalize(input);
    if (!components.includes(component) || !slots.includes(slot)) return result;
    const other = components.find(name => result[name] === slot);
    if (other) result[other] = result[component];
    result[component] = slot;
    return result;
  }

  function route(component, slot, cardPoint) {
    const points = (routes[slot] || routes[defaults[component]]).map(point => [...point]);
    const bottom = slot.startsWith('bottom');
    if (cardPoint) {
      if (!bottom) { points[0] = cardPoint; points[1][0] = cardPoint[0]; }
      else {
        points[2] = cardPoint;
        if (slot === 'bottom-left') points[1][1] = cardPoint[1];
        else points[1][0] = cardPoint[0];
      }
    }
    // PV/grid run towards the house; battery/charger run away from the house.
    // Preserve this logical orientation when a component changes corners.
    const fromHouse = component === 'battery' || component === 'ev';
    if (fromHouse !== bottom) points.reverse();
    return points.map((point, i) => `${i ? 'L' : 'M'}${point[0].toFixed(1)} ${point[1].toFixed(1)}`).join(' ');
  }

  function cardPoint(slot, rect) {
    if (slot === 'bottom-left') return [rect.right, (rect.top + rect.bottom) / 2];
    if (slot === 'bottom-right') return [(rect.left + rect.right) / 2, rect.top];
    return [(rect.left + rect.right) / 2, rect.bottom];
  }

  return { components, slots, defaults, anchors, normalize, swap, route, cardPoint };
});
