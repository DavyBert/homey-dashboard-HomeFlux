'use strict';

const Homey = require('homey');

const ENERGY_FIELDS = [
  'solar', 'batterySoc', 'batteryPower', 'batteryStatus',
  'evPower', 'evStatus', 'gridPower', 'homePower'
];

const HISTORY_SAMPLE_MS = 10 * 60 * 1000;
const HISTORY_KEEP_MS = 30 * 60 * 60 * 1000;
const BACKEND_FALLBACK_REFRESH_MS = 60 * 1000;

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

    await this._ensureOwnerSession();
    await this._refreshConfiguredSources('initial').catch(err => this.error('Initial source refresh failed:', err));
    await this._migrateLegacyDeviceLabels().catch(err => this.error('Label migration failed:', err));
    this._subscribeConfiguredSources();
    this._restartRefreshTimer();
    this.log(`HomeFlux v${this.homey.manifest.version} initialized`);
  }

  _normalizeEnergyConfig(config) {
    const c = config || {};
    return {
      solar: c.solar || '',
      batterySoc: c.batterySoc || '',
      batteryPower: c.batteryPower || '',
      batteryStatus: c.batteryStatus || '',
      evPower: c.evPower || '',
      evStatus: c.evStatus || '',
      gridPower: c.gridPower || '',
      homePower: c.homePower || '',
      batteryThresholdKw: Number.isFinite(Number(c.batteryThresholdKw)) ? Number(c.batteryThresholdKw) : 0.2,
      batteryInvert: Boolean(c.batteryInvert)
    };
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

    // The widget refresh interval only controls how often the UI reads HomeFlux' cache.
    // Runtime device polling is deliberately much slower because realtime events are
    // the primary update path. This keeps 1-3 second widget refreshes inexpensive.
    this._refreshTimer = this.homey.setInterval(() => {
      this._refreshConfiguredSources('fallback').catch(err => this.error('Fallback source refresh failed:', err));
    }, BACKEND_FALLBACK_REFRESH_MS);
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

  _deviceSources(device) {
    const sources = [];
    const capsObj = device.capabilitiesObj || {};
    const capabilityIds = device.capabilities || Object.keys(capsObj);
    for (const capabilityId of capabilityIds) {
      const cap = capsObj[capabilityId] || {};
      sources.push({
        key: `device:${device.id}:${capabilityId}`,
        type: 'device', deviceId: device.id, capabilityId,
        deviceName: device.name || device.id,
        label: `${device.name || device.id} — ${this._capabilityTitle(capabilityId, cap)}`,
        name: this._capabilityTitle(capabilityId, cap),
        value: cap.value !== undefined ? cap.value : (device.state ? device.state[capabilityId] : null),
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
    this._pruneSourceCache();
    const keys = this._configuredKeys();
    if (!keys.length) { this._emitDashboard(); return; }

    const parsed = keys.map(key => this._parseKey(key));
    const deviceIds = [...new Set(parsed.filter(x => x.type === 'device').map(x => x.deviceId))];
    const variableIds = [...new Set(parsed.filter(x => x.type === 'variable').map(x => x.variableId))];

    await Promise.all([
      ...deviceIds.map(deviceId => this._refreshConfiguredDevice(deviceId, false)),
      ...variableIds.map(variableId => this._refreshConfiguredVariable(variableId, false))
    ]);

    await this._recordBatteryHistory();
    this._emitDashboard();
  }

  async _recordBatteryHistory(now = Date.now()) {
    const soc = this._sourceData(this.energyConfig.batterySoc);
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

  _derivedHomePower() {
    const solar = this._sourceData(this.energyConfig.solar);
    const grid = this._sourceData(this.energyConfig.gridPower);
    const battery = this._sourceData(this.energyConfig.batteryPower);

    const solarW = this._powerToWatts(solar);
    const gridW = this._powerToWatts(grid);
    if (solarW === null || gridW === null) return null;

    let batteryW = this._powerToWatts(battery);
    if (batteryW === null) batteryW = 0;
    // Internally a positive battery value means charging; batteryInvert normalizes systems that report the opposite.
    if (this.energyConfig.batteryInvert) batteryW *= -1;

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
    const explicit = this._sourceData(this.energyConfig.batteryStatus);
    if (explicit && explicit.online && explicit.rawValue !== null && explicit.rawValue !== '') {
      let status = String(explicit.rawValue).trim();
      if (typeof explicit.rawValue === 'boolean') status = explicit.rawValue ? 'Laden' : 'Stand-by';
      return { text: status, source: 'explicit' };
    }

    const power = this._sourceData(this.energyConfig.batteryPower);
    if (!power || !power.online || typeof power.rawValue !== 'number') return { text: '—', source: 'unknown' };

    let value = Number(power.rawValue);
    const unit = String(power.unit || '').toLowerCase();
    if (unit === 'w' || unit.includes('watt')) value /= 1000;
    if (this.energyConfig.batteryInvert) value *= -1;
    const threshold = Math.max(0, Number(this.energyConfig.batteryThresholdKw) || 0.2);
    if (value > threshold) return { text: 'Laden', source: 'derived' };
    if (value < -threshold) return { text: 'Ontladen', source: 'derived' };
    return { text: 'Stand-by', source: 'derived' };
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

  _mapWeatherSource() {
    const key = this.visualConfig.weatherSource;
    if (!key) return { weather: this.visualConfig.weather || 'clear', raw: null, label: '', mapped: false };
    const source = this.sourceCache.get(key);
    if (!source) return { weather: this.visualConfig.weather || 'clear', raw: null, label: '', mapped: false };
    const raw = source.value;
    const context = `${source.name || ''} ${source.label || ''} ${source.capabilityId || ''}`.toLowerCase();

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
        if (raw === 0) return { weather: 'clear', raw, label: source.label, mapped: true };
        if (raw >= 1 && raw <= 3) return { weather: 'cloudy', raw, label: source.label, mapped: true };
        if (raw === 45 || raw === 48) return { weather: 'mist', raw, label: source.label, mapped: true };
        if ((raw >= 51 && raw <= 67) || (raw >= 80 && raw <= 82)) return { weather: 'rain', raw, label: source.label, mapped: true };
        if ((raw >= 71 && raw <= 77) || (raw >= 85 && raw <= 86)) return { weather: 'snow', raw, label: source.label, mapped: true };
        if (raw >= 95) return { weather: 'thunder', raw, label: source.label, mapped: true };
      }
    }

    const text = String(raw ?? '').trim().toLowerCase();
    if (/(thunder|thunderstorm|storm|onweer|lightning|bliksem)/.test(text)) {
      return { weather: 'thunder', raw, label: source.label, mapped: true };
    }
    if (/(snow|sneeuw|blizzard|winter|ice pellets|ijzel)/.test(text)) {
      return { weather: 'snow', raw, label: source.label, mapped: true };
    }
    if (/(mist|fog|mistig|nevel|haze)/.test(text)) {
      return { weather: 'mist', raw, label: source.label, mapped: true };
    }
    if (/(rain|regen|drizzle|motregen|shower|bui|hail|hagel|sleet)/.test(text)) {
      return { weather: 'rain', raw, label: source.label, mapped: true };
    }
    if (/(cloud|bewolk|overcast|partly|mostly)/.test(text)) {
      return { weather: 'cloudy', raw, label: source.label, mapped: true };
    }
    if (/(clear|sunny|sun|fair|helder|zonnig)/.test(text)) {
      return { weather: 'clear', raw, label: source.label, mapped: true };
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
      solar: this._sourceData(this.energyConfig.solar),
      batterySoc: this._sourceData(this.energyConfig.batterySoc),
      batteryPower: this._sourceData(this.energyConfig.batteryPower),
      batteryStatus: batteryStatus.text,
      batteryStatusSource: batteryStatus.source,
      battery24hAgo: this._battery24hAgo(),
      evPower: this._sourceData(this.energyConfig.evPower),
      evStatus: this._sourceData(this.energyConfig.evStatus),
      gridPower: this._sourceData(this.energyConfig.gridPower),
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
