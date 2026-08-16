'use strict';

const Homey = require('homey');

const ENERGY_FIELDS = [
  ...Array.from({ length: 10 }, (_, index) => index === 0 ? 'solar' : `solar${index + 1}`),
  ...Array.from({ length: 10 }, (_, index) => {
    const suffix = index === 0 ? '' : String(index + 1);
    return [`battery${suffix}Soc`, `battery${suffix}Power`, `battery${suffix}Status`];
  }).flat(),
  ...Array.from({ length: 10 }, (_, index) => {
    const suffix = index === 0 ? '' : String(index + 1);
    return [`ev${suffix}Power`, `ev${suffix}Status`];
  }).flat(),
  'gridPower', 'homePower'
];

const HISTORY_SAMPLE_MS = 10 * 60 * 1000;
const HISTORY_KEEP_MS = 30 * 60 * 60 * 1000;
const INSIGHTS_REFRESH_MS = 15 * 60 * 1000;
const FALLBACK_REFRESH_MS = 60 * 1000;

class DashboardBridgeApp extends Homey.App {
  async onInit() {
    this.selection = this.homey.settings.get('selection') || [];
    this.energyConfig = this._normalizeEnergyConfig(this.homey.settings.get('energyConfig') || {});
    this.visualConfig = this._normalizeVisualConfig(this.homey.settings.get('visualConfig') || {});
    this.batteryHistory = Array.isArray(this.homey.settings.get('batteryHistory')) ? this.homey.settings.get('batteryHistory') : [];
    this.revision = Number(this.homey.settings.get('revision') || 1);
    this.sourceCache = new Map();
    this._ownerToken = null;
    this._localUrl = null;
    this._subscriptions = [];
    this._refreshTimer = null;
    this._refreshDebounce = new Map();
    this._refreshSourcesPromise = null;
    this._lastSourceRefreshAt = 0;
    this._batteryInsights24h = null;
    this._lastInsightsRefreshAt = 0;

    await this._ensureOwnerSession();
    await this._refreshConfiguredSources('initial').catch(err => this.error('Initial source refresh failed:', err));
    await this._refreshBattery24hFromInsights(true).catch(err => this.error('Initial battery Insights refresh failed:', err));
    await this._migrateLegacyDeviceLabels().catch(err => this.error('Label migration failed:', err));
    this._subscribeConfiguredSources();
    this._restartRefreshTimer();
    this.log(`HomeFlux v${this.homey.manifest.version} initialized`);
  }

  _normalizeEnergyConfig(config) {
    const c = config || {};
    const normalized = {
      gridPower: c.gridPower || '',
      gridThresholdW: Number.isFinite(Number(c.gridThresholdW)) ? Math.max(0, Number(c.gridThresholdW)) : 50,
      homePower: c.homePower || '',
      batteryThresholdKw: Number.isFinite(Number(c.batteryThresholdKw)) ? Number(c.batteryThresholdKw) : 0.2,
      batteryLineMotion: c.batteryLineMotion || 'invert_flow'
    };

    let inferredSolarCount = 1;
    let inferredBatteryCount = 1;
    let inferredChargerCount = 1;

    for (let index = 1; index <= 10; index += 1) {
      const suffix = index === 1 ? '' : String(index);
      const solarKey = index === 1 ? 'solar' : `solar${index}`;
      const batteryPrefix = `battery${suffix}`;
      const evPrefix = `ev${suffix}`;

      normalized[solarKey] = c[solarKey] || '';
      if (normalized[solarKey]) inferredSolarCount = index;

      normalized[`${batteryPrefix}Soc`] = c[`${batteryPrefix}Soc`] || '';
      normalized[`${batteryPrefix}Power`] = c[`${batteryPrefix}Power`] || '';
      normalized[`${batteryPrefix}Status`] = c[`${batteryPrefix}Status`] || '';
      normalized[`${batteryPrefix}CapacityKwh`] = Number.isFinite(Number(c[`${batteryPrefix}CapacityKwh`]))
        ? Math.max(0, Number(c[`${batteryPrefix}CapacityKwh`]))
        : 0;
      normalized[`${batteryPrefix}Direction`] = c[`${batteryPrefix}Direction`]
        || (c[`${batteryPrefix}Invert`] ? 'positive_discharge' : 'positive_discharge');
      normalized[`${batteryPrefix}Invert`] = Boolean(c[`${batteryPrefix}Invert`]);
      normalized[`${batteryPrefix}LineDirection`] = c[`${batteryPrefix}LineDirection`] || 'follow_power';
      if (normalized[`${batteryPrefix}Soc`] || normalized[`${batteryPrefix}Power`] || normalized[`${batteryPrefix}Status`]) inferredBatteryCount = index;

      normalized[`${evPrefix}Power`] = c[`${evPrefix}Power`] || '';
      normalized[`${evPrefix}Status`] = c[`${evPrefix}Status`] || '';
      if (normalized[`${evPrefix}Power`] || normalized[`${evPrefix}Status`]) inferredChargerCount = index;
    }

    normalized.solarCount = Math.max(1, Math.min(10, Number(c.solarCount || inferredSolarCount) || 1));
    normalized.batteryCount = Math.max(1, Math.min(10, Number(c.batteryCount || inferredBatteryCount) || 1));
    normalized.chargerCount = Math.max(1, Math.min(10, Number(c.chargerCount || inferredChargerCount) || 1));

    return normalized;
  }

  _normalizeVisualConfig(config) {
    const c = config || {};
    const backgroundMode = ['auto', 'manual'].includes(c.backgroundMode) ? c.backgroundMode : 'auto';
    const periodMode = ['auto', 'day', 'night'].includes(c.periodMode) ? c.periodMode : 'auto';
    const weather = ['clear', 'cloudy', 'rain', 'mist', 'snow', 'thunder'].includes(c.weather) ? c.weather : 'clear';
    const weatherSource = typeof c.weatherSource === 'string' ? c.weatherSource : '';
    const refreshSeconds = Math.min(300, Math.max(1, Number(c.refreshSeconds) || 30));
    return { backgroundMode, periodMode, weather, weatherSource, refreshSeconds };
  }

  _restartRefreshTimer() {
    if (this._refreshTimer) this.homey.clearInterval(this._refreshTimer);

    // Realtime events are the primary update path. The widget itself requests a
    // selective refresh at the configured interval. This slow fallback keeps the
    // cache healthy when no widget is open, without polling every Homey device.
    this._refreshTimer = this.homey.setInterval(() => {
      this._refreshConfiguredSources('fallback').catch(err => this.error('Fallback source refresh failed:', err));
      this._refreshBattery24hFromInsights().catch(err => this.error('Battery Insights refresh failed:', err));
    }, FALLBACK_REFRESH_MS);
  }

  _values(obj) {
    if (!obj) return [];
    return Array.isArray(obj) ? obj : Object.values(obj);
  }

  async _ensureOwnerSession(force = false) {
    if (!force && this._ownerToken && this._localUrl) return;
    this._localUrl = String(await this.homey.api.getLocalUrl()).replace(/\/$/, '');
    this._ownerToken = await this.homey.api.getOwnerApiToken();
  }

  async _apiGet(path, retry = true) {
    await this._ensureOwnerSession();
    const response = await fetch(`${this._localUrl}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this._ownerToken}`,
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (response.status === 401 && retry) {
      await this._ensureOwnerSession(true);
      return this._apiGet(path, false);
    }

    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
    if (!response.ok) {
      const message = body && (body.error_description || body.error)
        ? (body.error_description || body.error)
        : `${response.status} ${response.statusText}`;
      throw new Error(`Homey API ${response.status}: ${message}`);
    }
    return body;
  }

  async testConnection() {
    const devices = await this._apiGet('/api/manager/devices/device');
    let variables = [];
    try { variables = await this._apiGet('/api/manager/logic/variable'); } catch (err) { this.error('Logic test failed:', err); }
    return { ok: true, devices: this._values(devices).length, variables: this._values(variables).length };
  }

  async _getDevices() { return this._values(await this._apiGet('/api/manager/devices/device')); }

  async _getVariables() {
    try { return this._values(await this._apiGet('/api/manager/logic/variable')); }
    catch (err) { this.error('Unable to read Logic variables:', err); return []; }
  }

  _capabilityTitle(capabilityId, cap) {
    if (cap && typeof cap.title === 'string') return cap.title;
    if (cap && cap.title && cap.title.en) return cap.title.en;
    return capabilityId.replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  _translatedTitle(title) {
    if (typeof title === 'string') return title;
    if (!title || typeof title !== 'object') return '';
    const language = String(this.homey.i18n?.getLanguage?.() || '').toLowerCase();
    return title[language] || title.nl || title.en || Object.values(title).find(value => typeof value === 'string') || '';
  }

  _capabilityValueTitle(device, capabilityId, cap, value) {
    // Enum capabilities often expose a machine value/code while Homey's UI
    // displays a translated title (e.g. code 95 with title "Heldere lucht").
    // Prefer that human-readable title for weather mapping.
    const candidates = [
      cap?.values,
      cap?.options?.values,
      cap?.opts?.values,
      device?.capabilitiesOptions?.[capabilityId]?.values
    ];
    const values = candidates.find(Array.isArray) || [];
    const match = values.find(item => {
      if (!item) return false;
      const ids = [item.id, item.value, item.key].filter(v => v !== undefined && v !== null);
      return ids.some(id => String(id) === String(value));
    });
    return match ? this._translatedTitle(match.title || match.label || match.name) : '';
  }

  _deviceSources(device) {
    const sources = [];
    const capsObj = device.capabilitiesObj || {};
    const capabilityIds = device.capabilities || Object.keys(capsObj);
    for (const capabilityId of capabilityIds) {
      const cap = capsObj[capabilityId] || {};
      const value = cap.value !== undefined ? cap.value : (device.state ? device.state[capabilityId] : null);
      sources.push({
        key: `device:${device.id}:${capabilityId}`,
        type: 'device', deviceId: device.id, capabilityId,
        deviceName: device.name || device.id,
        label: `${device.name || device.id} — ${this._capabilityTitle(capabilityId, cap)}`,
        name: this._capabilityTitle(capabilityId, cap),
        value,
        displayValue: this._capabilityValueTitle(device, capabilityId, cap, value),
        unit: cap.units || cap.unit || '',
        valueType: cap.type || typeof cap.value
      });
    }
    return sources;
  }

  _variableSource(variable) {
    return {
      key: `variable:${variable.id}`,
      type: 'variable', variableId: variable.id,
      deviceName: 'Logic', label: `Logic — ${variable.name || variable.id}`,
      name: variable.name || variable.id, value: variable.value, unit: '',
      valueType: variable.type || typeof variable.value
    };
  }

  async listSources() {
    // Source discovery is only used by the settings page. Do NOT copy the full
    // Homey device/capability list into the runtime cache: that cache must stay
    // limited to sources that HomeFlux is actually configured to use.
    const [devices, variables] = await Promise.all([this._getDevices(), this._getVariables()]);
    const sources = [];
    for (const device of devices) sources.push(...this._deviceSources(device));
    for (const variable of variables) sources.push(this._variableSource(variable));
    sources.sort((a, b) => a.label.localeCompare(b.label));
    return sources;
  }

  getConfig() {
    return { energyConfig: this.energyConfig, selection: this.selection, visualConfig: this.visualConfig };
  }

  async saveConfig(config = {}) {
    const energyConfig = this._normalizeEnergyConfig(config.energyConfig || {});
    const selection = Array.isArray(config.selection) ? config.selection : [];
    const visualConfig = this._normalizeVisualConfig(config.visualConfig || {});

    this.energyConfig = energyConfig;
    this.visualConfig = visualConfig;
    this.selection = selection.slice(0, 60).map((item, index) => ({
      key: String(item.key),
      label: String(item.label || item.name || `Item ${index + 1}`),
      sourceLabel: String(item.sourceLabel || ''),
      unit: item.unit ? String(item.unit) : ''
    }));

    // Drop values that belonged to a previous configuration immediately.
    this._pruneSourceCache();

    this.revision += 1;
    await this.homey.settings.set('energyConfig', this.energyConfig);
    await this.homey.settings.set('selection', this.selection);
    await this.homey.settings.set('visualConfig', this.visualConfig);
    await this.homey.settings.set('revision', this.revision);
    await this._refreshConfiguredSources('config-save');
    this._subscribeConfiguredSources();
    this._restartRefreshTimer();
    this._emitDashboard();
    return this.getConfig();
  }

  getSelection() { return this.selection; }
  async saveSelection(selection) { return this.saveConfig({ energyConfig: this.energyConfig, selection, visualConfig: this.visualConfig }); }

  _parseKey(key) {
    if (!key || typeof key !== 'string') return { type: 'unknown' };
    if (key.startsWith('device:')) {
      const parts = key.split(':');
      return { type: 'device', deviceId: parts[1], capabilityId: parts.slice(2).join(':') };
    }
    if (key.startsWith('variable:')) return { type: 'variable', variableId: key.slice('variable:'.length) };
    return { type: 'unknown' };
  }

  _configuredKeys() {
    const keys = new Set(this.selection.map(item => item.key).filter(Boolean));
    for (const field of ENERGY_FIELDS) {
      const key = this.energyConfig[field];
      if (key) keys.add(key);
    }
    if (this.visualConfig.backgroundMode === 'auto' && this.visualConfig.weatherSource) {
      keys.add(this.visualConfig.weatherSource);
    }
    return [...keys];
  }

  _pruneSourceCache() {
    const configured = new Set(this._configuredKeys());
    let removed = 0;
    for (const key of this.sourceCache.keys()) {
      if (!configured.has(key)) {
        this.sourceCache.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  _configuredCapabilitiesForDevice(deviceId) {
    const capabilities = new Set();
    for (const key of this._configuredKeys()) {
      const parsed = this._parseKey(key);
      if (parsed.type === 'device' && parsed.deviceId === deviceId && parsed.capabilityId) {
        capabilities.add(parsed.capabilityId);
      }
    }
    return capabilities;
  }

  async _refreshConfiguredDevice(deviceId, emit = true) {
    const wantedCapabilities = this._configuredCapabilitiesForDevice(deviceId);
    if (!wantedCapabilities.size) return;

    try {
      const device = await this._apiGet(`/api/manager/devices/device/${encodeURIComponent(deviceId)}`);
      for (const source of this._deviceSources(device)) {
        if (wantedCapabilities.has(source.capabilityId)) this.sourceCache.set(source.key, source);
      }
      await this._recordBatteryHistory();
      if (emit) this._emitDashboard();
    } catch (err) {
      this.error(`Unable to refresh device ${deviceId}:`, err);
    }
  }

  async _refreshConfiguredVariable(variableId, emit = true) {
    const key = `variable:${variableId}`;
    if (!this._configuredKeys().includes(key)) return;

    try {
      const variable = await this._apiGet(`/api/manager/logic/variable/${encodeURIComponent(variableId)}`);
      this.sourceCache.set(key, this._variableSource(variable));
      if (emit) this._emitDashboard();
    } catch (err) {
      this.error(`Unable to refresh Logic variable ${variableId}:`, err);
    }
  }

  async _refreshConfiguredVariables(emit = true) {
    const variableIds = [...new Set(this._configuredKeys()
      .map(key => this._parseKey(key))
      .filter(parsed => parsed.type === 'variable')
      .map(parsed => parsed.variableId))];

    await Promise.all(variableIds.map(variableId => this._refreshConfiguredVariable(variableId, false)));
    if (emit && variableIds.length) this._emitDashboard();
  }

  async _refreshConfiguredSources(reason = 'manual') {
    // Collapse overlapping widget, realtime and fallback refreshes into one read.
    if (this._refreshSourcesPromise) return this._refreshSourcesPromise;
    this._refreshSourcesPromise = this._doRefreshConfiguredSources(reason)
      .finally(() => { this._refreshSourcesPromise = null; });
    return this._refreshSourcesPromise;
  }

  async _doRefreshConfiguredSources(reason = 'manual') {
    this._pruneSourceCache();
    const keys = this._configuredKeys();
    if (!keys.length) {
      this._lastSourceRefreshAt = Date.now();
      this._emitDashboard();
      return;
    }

    const parsed = keys.map(key => this._parseKey(key));
    const deviceIds = [...new Set(parsed.filter(x => x.type === 'device').map(x => x.deviceId))];
    const variableIds = [...new Set(parsed.filter(x => x.type === 'variable').map(x => x.variableId))];

    await Promise.all([
      ...deviceIds.map(deviceId => this._refreshConfiguredDevice(deviceId, false)),
      ...variableIds.map(variableId => this._refreshConfiguredVariable(variableId, false))
    ]);

    this._lastSourceRefreshAt = Date.now();
    await this._recordBatteryHistory();
    this._emitDashboard();
  }

  async getDashboardForWidget() {
    const refreshMs = Math.min(300, Math.max(1, Number(this.visualConfig.refreshSeconds) || 30)) * 1000;
    // A small tolerance prevents two widgets that poll at nearly the same moment
    // from causing duplicate device reads. Only configured sources are refreshed.
    const maxAge = Math.max(500, Math.floor(refreshMs * 0.8));
    if (!this._lastSourceRefreshAt || Date.now() - this._lastSourceRefreshAt >= maxAge) {
      await this._refreshConfiguredSources('widget-poll');
    }
    if (Date.now() - this._lastInsightsRefreshAt >= INSIGHTS_REFRESH_MS) {
      this._refreshBattery24hFromInsights().catch(err => this.error('Battery Insights refresh failed:', err));
    }
    return this.getDashboard();
  }

  async _recordBatteryHistory(now = Date.now()) {
    const soc = this._combinedBatterySocData();
    if (!soc || !soc.online || typeof soc.rawValue !== 'number') return;

    const last = this.batteryHistory[this.batteryHistory.length - 1];
    if (last && now - Number(last.ts) < HISTORY_SAMPLE_MS) return;

    const cutoff = now - HISTORY_KEEP_MS;
    this.batteryHistory = this.batteryHistory
      .filter(item => Number(item.ts) >= cutoff && Number.isFinite(Number(item.value)))
      .concat({ ts: now, value: Number(soc.rawValue), unit: soc.unit || '%' });

    try {
      await this.homey.settings.set('batteryHistory', this.batteryHistory);
    } catch (err) {
      this.error('Unable to persist battery history:', err);
    }
  }

  _battery24hAgo(now = Date.now()) {
    if (!Array.isArray(this.batteryHistory) || !this.batteryHistory.length) return null;
    const target = now - (24 * 60 * 60 * 1000);
    let best = null;
    let bestDiff = Infinity;
    for (const sample of this.batteryHistory) {
      const ts = Number(sample.ts);
      const value = Number(sample.value);
      if (!Number.isFinite(ts) || !Number.isFinite(value)) continue;
      const diff = Math.abs(ts - target);
      if (diff < bestDiff) { bestDiff = diff; best = { ts, value, unit: sample.unit || '%' }; }
    }
    if (!best || bestDiff > 45 * 60 * 1000) return null;
    return { ...best, valueFormatted: this._formatValue(best.value) };
  }


  _normalizeInsightEntries(payload) {
    const rows = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.values) ? payload.values : []);
    const out = [];
    for (const row of rows) {
      let ts;
      let value;
      if (Array.isArray(row)) {
        ts = row[0];
        value = row[1];
      } else if (row && typeof row === 'object') {
        ts = row.t ?? row.ts ?? row.time ?? row.date ?? row.datetime ?? row.createdAt;
        value = row.v ?? row.value;
      }
      const parsedTs = typeof ts === 'number' ? ts : Date.parse(ts);
      const parsedValue = Number(value);
      if (Number.isFinite(parsedTs) && Number.isFinite(parsedValue)) out.push({ ts: parsedTs, value: parsedValue });
    }
    return out;
  }

  async _fetchSoc24hInsight(key) {
    const parsed = this._parseKey(key);
    if (parsed.type !== 'device' || !parsed.deviceId || !parsed.capabilityId) return null;

    const uri = `homey:device:${parsed.deviceId}`;
    const ids = [`${uri}:${parsed.capabilityId}`, parsed.capabilityId];
    let payload = null;
    for (const id of ids) {
      try {
        payload = await this._apiGet(`/api/manager/insights/log/${encodeURIComponent(uri)}/${encodeURIComponent(id)}/entry?resolution=last24Hours`);
        if (payload) break;
      } catch (_) {
        // Try the legacy id form before falling back to locally sampled history.
      }
    }

    const entries = this._normalizeInsightEntries(payload);
    if (!entries.length) return null;
    const target = Date.now() - (24 * 60 * 60 * 1000);
    let best = null;
    let bestDiff = Infinity;
    for (const entry of entries) {
      const diff = Math.abs(entry.ts - target);
      if (diff < bestDiff) { bestDiff = diff; best = entry; }
    }
    if (!best || bestDiff > 2 * 60 * 60 * 1000) return null;
    return best;
  }

  async _refreshBattery24hFromInsights(force = false) {
    if (!force && Date.now() - this._lastInsightsRefreshAt < INSIGHTS_REFRESH_MS) return this._batteryInsights24h;
    this._lastInsightsRefreshAt = Date.now();

    const batteries = [];
    for (let index = 1; index <= 10; index += 1) {
      const suffix = index === 1 ? '' : String(index);
      const key = this.energyConfig[`battery${suffix}Soc`];
      if (!key) continue;
      batteries.push({
        key,
        capacity: Number(this.energyConfig[`battery${suffix}CapacityKwh`]) || 0
      });
    }

    if (!batteries.length) {
      this._batteryInsights24h = null;
      return null;
    }

    const insights = await Promise.all(batteries.map(item => this._fetchSoc24hInsight(item.key)));
    if (insights.some(item => !item)) {
      this._batteryInsights24h = null;
      return null;
    }

    let value;
    let ts = Math.min(...insights.map(item => item.ts));
    if (insights.length === 1) {
      value = insights[0].value;
    } else {
      const validCapacities = batteries.every(item => item.capacity > 0);
      if (!validCapacities) {
        this._batteryInsights24h = null;
        return null;
      }
      const totalCapacity = batteries.reduce((sum, item) => sum + item.capacity, 0);
      value = insights.reduce((sum, item, index) => sum + (item.value * batteries[index].capacity), 0) / totalCapacity;
    }

    this._batteryInsights24h = {
      ts,
      value,
      unit: '%',
      valueFormatted: this._formatValue(value),
      source: 'insights'
    };
    return this._batteryInsights24h;
  }

  _battery24hAgoBest() {
    if (this._batteryInsights24h) return this._batteryInsights24h;
    const local = this._battery24hAgo();
    return local ? { ...local, source: 'local' } : null;
  }

  async _migrateLegacyDeviceLabels() {
    let changed = false;
    this.selection = this.selection.map(item => {
      const source = this.sourceCache.get(item.key);
      if (!source || source.type !== 'device') return item;
      const looksLikeOldDefault = !item.label || item.label === source.name;
      if (!looksLikeOldDefault) return item;
      changed = true;
      return { ...item, label: source.deviceName || source.name || item.label };
    });
    if (changed) {
      this.revision += 1;
      await this.homey.settings.set('selection', this.selection);
      await this.homey.settings.set('revision', this.revision);
    }
  }

  _clearSubscriptions() {
    for (const api of this._subscriptions) { try { api.unregister(); } catch (_) {} }
    this._subscriptions = [];
    for (const timer of this._refreshDebounce.values()) this.homey.clearTimeout(timer);
    this._refreshDebounce.clear();
  }

  _debouncedRefresh(key, refreshFn, delay = 150) {
    if (this._refreshDebounce.has(key)) {
      this.homey.clearTimeout(this._refreshDebounce.get(key));
    }
    const timer = this.homey.setTimeout(async () => {
      this._refreshDebounce.delete(key);
      await refreshFn().catch(err => this.error('Realtime refresh failed:', err));
    }, delay);
    this._refreshDebounce.set(key, timer);
  }

  _subscribeConfiguredSources() {
    this._clearSubscriptions();
    const parsed = this._configuredKeys().map(key => this._parseKey(key));
    const deviceIds = [...new Set(parsed.filter(x => x.type === 'device').map(x => x.deviceId))];

    for (const deviceId of deviceIds) {
      try {
        const api = this.homey.api.getApi(`homey:device:${deviceId}`);
        api.on('realtime', () => {
          this._debouncedRefresh(
          `device:${deviceId}`,
          () => this._refreshConfiguredDevice(deviceId)
        );
        });
        this._subscriptions.push(api);
      } catch (err) { this.error(`Unable to subscribe to device ${deviceId}:`, err); }
    }

    if (parsed.some(x => x.type === 'variable')) {
      try {
        const api = this.homey.api.getApi('homey:manager:logic');
        api.on('realtime', () => {
          this._debouncedRefresh(
          'logic',
          () => this._refreshConfiguredVariables(),
          250
        );
        });
        this._subscriptions.push(api);
      } catch (err) { this.error('Unable to subscribe to Logic changes:', err); }
    }
  }

  _formatValue(value) {
    if (typeof value === 'boolean') return value ? 'ON' : 'OFF';
    if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
    if (value === null || value === undefined || value === '') return '—';
    return String(value);
  }

  _sourceData(key) {
    if (!key) return null;
    const source = this.sourceCache.get(key);
    if (!source) return { key, value: '—', rawValue: null, unit: '', online: false, label: '' };
    return {
      key, value: this._formatValue(source.value), rawValue: source.value,
      unit: source.unit || '', online: true, label: source.label,
      deviceName: source.deviceName || '', sourceName: source.name || ''
    };
  }

  _powerToWatts(data) {
    if (!data || !data.online || typeof data.rawValue !== 'number' || !Number.isFinite(data.rawValue)) return null;
    const value = Number(data.rawValue);
    const unit = String(data.unit || '').trim().toLowerCase();
    if (unit === 'kw' || unit.includes('kilowatt')) return value * 1000;
    if (unit === 'mw' || unit.includes('megawatt')) return value * 1000000;
    // Homey power capabilities normally use W. Unknown/empty units are treated as W.
    return value;
  }

  _normalizeBatteryWatts(watts, direction = 'positive_charge') {
    if (watts === null || !Number.isFinite(watts)) return null;
    return direction === 'positive_discharge' ? -watts : watts;
  }

  _resolveBatteryLineDirection(direction, fallbackDirection) {
    return direction === 'follow_power' || !direction ? fallbackDirection : direction;
  }

  _powerDataFromWatts(key, watts, label) {
    if (!Number.isFinite(watts)) return null;
    const kw = watts / 1000;
    return {
      key,
      value: this._formatValue(Math.round(kw * 100) / 100),
      rawValue: kw,
      unit: 'kW',
      online: true,
      label,
      deviceName: 'HomeFlux',
      sourceName: 'Samengesteld'
    };
  }

  _sumPowerSources(keys, label) {
    let total = 0;
    let count = 0;
    for (const key of keys.filter(Boolean)) {
      const watts = this._powerToWatts(this._sourceData(key));
      if (watts === null) continue;
      total += watts;
      count += 1;
    }
    return count ? this._powerDataFromWatts(`derived:${label}`, total, label) : null;
  }

  _combinedSolarData() {
    const keys = Array.from({ length: 10 }, (_, index) => index === 0 ? this.energyConfig.solar : this.energyConfig[`solar${index + 1}`]);
    return this._sumPowerSources(keys, 'Zonnepanelen totaal');
  }

  _batteryPowerWatts() {
    let total = 0;
    let count = 0;
    for (let index = 1; index <= 10; index += 1) {
      const suffix = index === 1 ? '' : String(index);
      const key = this.energyConfig[`battery${suffix}Power`];
      if (!key) continue;
      const direction = this.energyConfig[`battery${suffix}Direction`]
        || (this.energyConfig[`battery${suffix}Invert`] ? 'positive_discharge' : 'positive_discharge');
      let watts = this._powerToWatts(this._sourceData(key));
      if (watts === null) continue;
      watts = this._normalizeBatteryWatts(watts, direction);
      total += watts;
      count += 1;
    }
    return count ? total : null;
  }

  _batteryLineWatts() {
    let total = 0;
    let count = 0;
    for (let index = 1; index <= 10; index += 1) {
      const suffix = index === 1 ? '' : String(index);
      const key = this.energyConfig[`battery${suffix}Power`];
      if (!key) continue;
      const powerDirection = this.energyConfig[`battery${suffix}Direction`]
        || (this.energyConfig[`battery${suffix}Invert`] ? 'positive_discharge' : 'positive_discharge');
      const lineDirection = this.energyConfig[`battery${suffix}LineDirection`] || 'follow_power';
      let watts = this._powerToWatts(this._sourceData(key));
      if (watts === null) continue;
      watts = this._normalizeBatteryWatts(watts, this._resolveBatteryLineDirection(lineDirection, powerDirection));
      total += watts;
      count += 1;
    }
    return count ? total : null;
  }

  _combinedBatteryPowerData() {
    const watts = this._batteryPowerWatts();
    return watts === null ? null : this._powerDataFromWatts('derived:batteryPower', watts, 'Batterijvermogen totaal');
  }

  _combinedBatterySocData() {
    const entries = [];
    for (let index = 1; index <= 10; index += 1) {
      const suffix = index === 1 ? '' : String(index);
      const key = this.energyConfig[`battery${suffix}Soc`];
      if (!key) continue;
      entries.push({ key, capacity: Number(this.energyConfig[`battery${suffix}CapacityKwh`]) || 0 });
    }
    if (!entries.length) return null;

    const available = [];
    for (const entry of entries) {
      const data = this._sourceData(entry.key);
      if (!data || !data.online || typeof data.rawValue !== 'number' || !Number.isFinite(data.rawValue)) continue;
      available.push({ data, capacity: entry.capacity });
    }
    if (!available.length) return null;

    let value;
    if (available.length === 1) {
      value = Number(available[0].data.rawValue);
    } else {
      const validCapacities = available.every(item => item.capacity > 0);
      if (validCapacities) {
        const totalCapacity = available.reduce((sum, item) => sum + item.capacity, 0);
        value = available.reduce((sum, item) => sum + (Number(item.data.rawValue) * item.capacity), 0) / totalCapacity;
      } else {
        value = available.reduce((sum, item) => sum + Number(item.data.rawValue), 0) / available.length;
      }
    }

    return {
      key: 'derived:batterySoc',
      value: this._formatValue(Math.round(value * 10) / 10),
      rawValue: value,
      unit: '%',
      online: true,
      label: available.length > 1 ? 'Gewogen batterij SOC' : 'Batterij SOC',
      deviceName: 'HomeFlux',
      sourceName: available.length > 1 ? 'Gewogen op capaciteit' : available[0].data.sourceName
    };
  }

  _combinedEvPowerData() {
    const keys = Array.from({ length: 10 }, (_, index) => {
      const suffix = index === 0 ? '' : String(index + 1);
      return this.energyConfig[`ev${suffix}Power`];
    });
    return this._sumPowerSources(keys, 'Autoladers totaal');
  }

  _batteryFlowState() {
    const watts = this._batteryPowerWatts();
    if (watts === null) return 'idle';
    const thresholdW = Math.max(0, Number(this.energyConfig.batteryThresholdKw) || 0.2) * 1000;
    if (watts > thresholdW) return 'charge';
    if (watts < -thresholdW) return 'discharge';
    return 'idle';
  }

  _batteryLineFlowState() {
    const watts = this._batteryLineWatts();
    if (watts === null) return 'idle';
    const thresholdW = Math.max(0, Number(this.energyConfig.batteryThresholdKw) || 0.2) * 1000;
    if (watts > thresholdW) return 'charge';
    if (watts < -thresholdW) return 'discharge';
    return 'idle';
  }

  _gridFlowState() {
    const grid = this._sourceData(this.energyConfig.gridPower);
    const watts = this._powerToWatts(grid);
    if (watts === null) return 'idle';
    const thresholdW = Math.max(0, Number(this.energyConfig.gridThresholdW) || 50);
    if (watts > thresholdW) return 'import';
    if (watts < -thresholdW) return 'export';
    return 'idle';
  }

  _derivedHomePower() {
    const solar = this._combinedSolarData();
    const grid = this._sourceData(this.energyConfig.gridPower);

    const solarW = this._powerToWatts(solar);
    const gridW = this._powerToWatts(grid);
    if (solarW === null || gridW === null) return null;

    let batteryW = this._batteryPowerWatts();
    if (batteryW === null) batteryW = 0;

    // Energy balance used by HomeFlux when no direct house-consumption meter is available:
    // house = solar + grid - batteryCharge.
    // Example: 5 kW solar + 0 kW grid - 4 kW battery charging = 1 kW house consumption.
    // Grid export is negative. Battery discharge is negative after polarity normalization, so it adds back into the balance.
    const watts = Math.max(0, solarW + gridW - batteryW);
    const kw = watts / 1000;
    return {
      key: 'derived:homePower',
      value: this._formatValue(Math.round(kw * 100) / 100),
      rawValue: kw,
      unit: 'kW',
      online: true,
      label: 'Berekend huisverbruik',
      deviceName: 'HomeFlux',
      sourceName: 'Energiebalans',
      derived: true
    };
  }

  _homePowerData() {
    const direct = this._sourceData(this.energyConfig.homePower);
    if (direct && direct.online && typeof direct.rawValue === 'number') return { ...direct, derived: false };
    return this._derivedHomePower();
  }

  _batteryStatus() {
    const flow = this._batteryFlowState();
    if (flow === 'charge') return { text: 'Laden', source: 'derived', flow };
    if (flow === 'discharge') return { text: 'Ontladen', source: 'derived', flow };

    const hasSecondBattery = Array.from({ length: 9 }, (_, index) => index + 2).some(index => this.energyConfig[`battery${index}Power`] || this.energyConfig[`battery${index}Soc`] || this.energyConfig[`battery${index}Status`]);
    if (!hasSecondBattery) {
      const explicit = this._sourceData(this.energyConfig.batteryStatus);
      if (explicit && explicit.online && explicit.rawValue !== null && explicit.rawValue !== '') {
        let status = String(explicit.rawValue).trim();
        if (typeof explicit.rawValue === 'boolean') status = explicit.rawValue ? 'Laden' : 'Stand-by';
        return { text: status, source: 'explicit', flow: 'idle' };
      }
    }

    const power = this._combinedBatteryPowerData();
    if (!power) return { text: '—', source: 'unknown', flow: 'idle' };
    return { text: 'Stand-by', source: 'derived', flow: 'idle' };
  }

  _tile(saved, index) {
    const source = this.sourceCache.get(saved.key);
    return {
      id: saved.key,
      label: saved.label || (source && (source.deviceName || source.name)) || `Item ${index + 1}`,
      sourceLabel: saved.sourceLabel || (source && source.label) || saved.key,
      sourceName: source && source.name ? source.name : '',
      deviceName: source && source.deviceName ? source.deviceName : '',
      value: this._formatValue(source ? source.value : null),
      rawValue: source ? source.value : null,
      unit: saved.unit || (source && source.unit) || '',
      kind: source && source.valueType === 'boolean' ? 'boolean' : 'value',
      online: Boolean(source)
    };
  }

  _dayOfYear(date) {
    const start = Date.UTC(date.getUTCFullYear(), 0, 0);
    return Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start) / 86400000);
  }

  _sunTimeUtc(date, latitude, longitude, sunrise) {
    const rad = Math.PI / 180;
    const deg = 180 / Math.PI;
    const normalize = value => ((value % 360) + 360) % 360;
    const n = this._dayOfYear(date);
    const lngHour = longitude / 15;
    const t = n + ((sunrise ? 6 : 18) - lngHour) / 24;
    const m = (0.9856 * t) - 3.289;
    let l = m + (1.916 * Math.sin(m * rad)) + (0.020 * Math.sin(2 * m * rad)) + 282.634;
    l = normalize(l);
    let ra = Math.atan(0.91764 * Math.tan(l * rad)) * deg;
    ra = normalize(ra);
    ra += (Math.floor(l / 90) * 90) - (Math.floor(ra / 90) * 90);
    ra /= 15;
    const sinDec = 0.39782 * Math.sin(l * rad);
    const cosDec = Math.cos(Math.asin(sinDec));
    const cosH = (Math.cos(90.833 * rad) - (sinDec * Math.sin(latitude * rad))) /
      (cosDec * Math.cos(latitude * rad));
    if (cosH > 1 || cosH < -1) return null;
    let h = sunrise ? 360 - (Math.acos(cosH) * deg) : Math.acos(cosH) * deg;
    h /= 15;
    const localMean = h + ra - (0.06571 * t) - 6.622;
    let utcHours = localMean - lngHour;
    utcHours = ((utcHours % 24) + 24) % 24;
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) + (utcHours * 3600000);
  }

  _automaticPeriod(now = new Date()) {
    try {
      const latitude = Number(this.homey.geolocation.getLatitude());
      const longitude = Number(this.homey.geolocation.getLongitude());
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error('Geen geldige Homey locatie');
      const sunrise = this._sunTimeUtc(now, latitude, longitude, true);
      const sunset = this._sunTimeUtc(now, latitude, longitude, false);
      if (sunrise !== null && sunset !== null) {
        const ts = now.getTime();
        return ts >= sunrise && ts < sunset ? 'day' : 'night';
      }
    } catch (err) {
      this.error('Unable to calculate sunrise/sunset, using hour fallback:', err);
    }
    const hour = now.getHours();
    return hour >= 7 && hour < 20 ? 'day' : 'night';
  }

  _weatherFromText(value) {
    const text = String(value ?? '').trim().toLowerCase();
    if (!text) return null;
    if (/(thunder|thunderstorm|storm|onweer|lightning|bliksem)/.test(text)) return 'thunder';
    if (/(snow|sneeuw|blizzard|winter|ice pellets|ijzel)/.test(text)) return 'snow';
    if (/(mist|fog|mistig|nevel|haze)/.test(text)) return 'mist';
    if (/(rain|regen|drizzle|motregen|shower|bui|hail|hagel|sleet)/.test(text)) return 'rain';
    // Specific clear descriptions must precede generic cloud matching because
    // words such as "onbewolkt" contain the substring "bewolk".
    if (/(onbewolkt|onbewolkte|wolkenloos|heldere lucht|heldere hemel|helder|zonnig|clear sky|clear|sunny|sun|fair)/.test(text)) return 'clear';
    if (/(cloud|bewolk|overcast|partly|mostly)/.test(text)) return 'cloudy';
    return null;
  }

  _mapWeatherSource() {
    const key = this.visualConfig.weatherSource;
    if (!key) return { weather: this.visualConfig.weather || 'clear', raw: null, label: '', mapped: false };
    const source = this.sourceCache.get(key);
    if (!source) return { weather: this.visualConfig.weather || 'clear', raw: null, label: '', mapped: false };
    const raw = source.value;
    const context = `${source.name || ''} ${source.label || ''} ${source.capabilityId || ''}`.toLowerCase();

    // Homey's UI can show a translated enum title while the capability value
    // itself is a numeric weather code. Map the displayed condition first;
    // only interpret the numeric code when no meaningful title is available.
    const displayWeather = this._weatherFromText(source.displayValue);
    if (displayWeather) {
      return { weather: displayWeather, raw, label: source.label, mapped: true };
    }

    if (typeof raw === 'boolean') {
      const looksWet = /(rain|regen|precip|neerslag|shower|drizzle|storm|onweer)/.test(context);
      return { weather: looksWet && raw ? 'rain' : (raw ? 'cloudy' : 'clear'), raw, label: source.label, mapped: true };
    }

    if (typeof raw === 'number' && Number.isFinite(raw)) {
      if (/(rain|regen|precip|neerslag|mm)/.test(context)) {
        return { weather: raw > 0.01 ? 'rain' : 'clear', raw, label: source.label, mapped: true };
      }
      if (/(snow|sneeuw)/.test(context)) {
        return { weather: raw > 0.01 ? 'snow' : 'clear', raw, label: source.label, mapped: true };
      }
      if (/(cloud|bewolk|overcast)/.test(context)) {
        return { weather: raw >= 25 ? 'cloudy' : 'clear', raw, label: source.label, mapped: true };
      }
      if (/(weather|weer|condition|code)/.test(context)) {
        // Only interpret 0-99 as WMO when the source explicitly identifies
        // itself as WMO. Generic Homey weather capabilities may use their own
        // small numeric enum codes, so treating every value as WMO can turn a
        // clear condition into snow/thunder.
        const explicitWmo = /(wmo|weather[_ .-]?code|weercode)/.test(context);
        if (explicitWmo && raw >= 0 && raw <= 99) {
          if (raw === 0) return { weather: 'clear', raw, label: source.label, mapped: true };
          if (raw >= 1 && raw <= 3) return { weather: 'cloudy', raw, label: source.label, mapped: true };
          if (raw === 45 || raw === 48) return { weather: 'mist', raw, label: source.label, mapped: true };
          if ((raw >= 51 && raw <= 67) || (raw >= 80 && raw <= 82)) return { weather: 'rain', raw, label: source.label, mapped: true };
          if ((raw >= 71 && raw <= 77) || (raw >= 85 && raw <= 86)) return { weather: 'snow', raw, label: source.label, mapped: true };
          if (raw >= 95 && raw <= 99) return { weather: 'thunder', raw, label: source.label, mapped: true };
        }

        // OpenWeather condition IDs are unambiguous because they occupy the
        // 2xx-8xx ranges.
        if (raw >= 200 && raw <= 232) return { weather: 'thunder', raw, label: source.label, mapped: true };
        if ((raw >= 300 && raw <= 321) || (raw >= 500 && raw <= 531)) return { weather: 'rain', raw, label: source.label, mapped: true };
        if (raw >= 600 && raw <= 622) return { weather: 'snow', raw, label: source.label, mapped: true };
        if (raw >= 701 && raw <= 781) return { weather: 'mist', raw, label: source.label, mapped: true };
        if (raw === 800) return { weather: 'clear', raw, label: source.label, mapped: true };
        if (raw >= 801 && raw <= 804) return { weather: 'cloudy', raw, label: source.label, mapped: true };
      }
    }

    const textWeather = this._weatherFromText(raw);
    if (textWeather) {
      return { weather: textWeather, raw, label: source.label, mapped: true };
    }

    // Log only when the selected weather source/value changes. This lets us
    // identify proprietary Homey weather codes without generating log spam.
    const weatherSignature = JSON.stringify([key, raw, source.displayValue, source.valueType, source.name]);
    if (this._lastWeatherDebugSignature !== weatherSignature) {
      this._lastWeatherDebugSignature = weatherSignature;
    }

    // Unknown small numeric codes are not assumed to be WMO. Keep the visual
    // conservative instead of showing a false snow/thunder scene.
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw < 200) {
      return { weather: 'clear', raw, label: source.label, mapped: false };
    }
    return { weather: this.visualConfig.weather || 'clear', raw, label: source.label, mapped: false };
  }

  _sceneState(now = new Date()) {
    if (this.visualConfig.backgroundMode === 'manual') {
      const period = this.visualConfig.periodMode === 'auto' ? this._automaticPeriod(now) : this.visualConfig.periodMode;
      const weather = this.visualConfig.weather;
      return { period, weather, key: `${period}-${weather}`, mode: 'manual' };
    }
    const period = this._automaticPeriod(now);
    const mapped = this._mapWeatherSource();
    return {
      period,
      weather: mapped.weather,
      key: `${period}-${mapped.weather}`,
      mode: 'auto',
      weatherRaw: mapped.raw,
      weatherSourceLabel: mapped.label,
      weatherMapped: mapped.mapped
    };
  }

  getDashboard() {
    const batteryStatus = this._batteryStatus();
    const energy = {
      solar: this._combinedSolarData(),
      batterySoc: this._combinedBatterySocData(),
      batteryPower: this._combinedBatteryPowerData(),
      batteryStatus: batteryStatus.text,
      batteryStatusSource: batteryStatus.source,
      batteryFlow: batteryStatus.flow || this._batteryFlowState(),
      batteryLineFlow: this._batteryLineFlowState(),
      batteryLineMotion: this.energyConfig.batteryLineMotion || 'invert_flow',
      battery24hAgo: this._battery24hAgoBest(),
      evPower: this._combinedEvPowerData(),
      evChargerCount: this.energyConfig.chargerCount || 1,
      evStatus: this.energyConfig.chargerCount > 1 ? { value: String(this.energyConfig.chargerCount), rawValue: this.energyConfig.chargerCount, unit: '', online: true, synthetic: true } : this._sourceData(this.energyConfig.evStatus),
      gridPower: this._sourceData(this.energyConfig.gridPower),
      gridFlow: this._gridFlowState(),
      homePower: this._homePowerData()
    };
    const tiles = this.selection.map((saved, index) => this._tile(saved, index));
    const configured = ENERGY_FIELDS.some(field => Boolean(this.energyConfig[field])) || this.selection.length > 0;
    return {
      revision: this.revision,
      updatedAt: new Date().toISOString(),
      configured,
      energy,
      tiles,
      scene: this._sceneState(),
      visualConfig: this.visualConfig
    };
  }

  _emitDashboard() {
    const dashboard = this.getDashboard();
    this.homey.api.realtime('dashboard.updated', dashboard);
    return dashboard;
  }

  async onUninit() {
    this._clearSubscriptions();
    if (this._refreshTimer) this.homey.clearInterval(this._refreshTimer);
  }
}

module.exports = DashboardBridgeApp;
