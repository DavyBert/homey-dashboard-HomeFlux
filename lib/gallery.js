'use strict';

const APP_ID = 'com.athom.gallery';
const CACHE_MS = 60000;
const TIMEOUT_MS = 6000;
const PHOTO_LIMIT = 8 * 1024 * 1024;
const safeId = id => typeof id === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(id);

// Gallery's own GET /image returns persistent IDs and { name, type, file }.
// Use those IDs, never the temporary IDs from ManagerImages.
class Gallery {
  constructor(homey, onChange, onInvalidate) {
    this.homey = homey;
    this.onChange = onChange;
    this.onInvalidate = onInvalidate;
    this.state = { status: 'unavailable', images: [] };
    this.byId = new Map();
    this.expiresAt = 0;
    this.generation = 0;
    this.promise = null;
    this.client = null;
    this.closed = false;
    this.photoCache = null;
    this.photoPending = null;
    this.invalidate = () => {
      this.photoCache = null;
      this.photoPending?.controller.abort();
      this.expiresAt = 0;
      this.generation += 1;
      if (!this.closed) this.onInvalidate();
    };
    this.realtime = event => {
      const name = typeof event === 'string' ? event : event?.event;
      if (['image.create', 'image.delete', 'image.update'].includes(name)) this.invalidate();
    };
  }

  async timed(operation, timeoutMs = TIMEOUT_MS) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise((resolve, reject) => {
          timer = this.homey.setTimeout(() => reject(new Error('Gallery timeout')), timeoutMs);
        })
      ]);
    } finally {
      this.homey.clearTimeout(timer);
    }
  }

  async read() {
    if (!this.client) {
      this.client = this.homey.api.getApiApp(APP_ID);
      this.client.on('realtime', this.realtime);
      this.client.on('install', this.invalidate);
      this.client.on('uninstall', this.invalidate);
    }
    if (!await this.client.getInstalled()) return { status: 'not-installed', images: [] };
    const version = String(await this.client.getVersion());
    const numbers = version.split('.').map(Number);
    if (!/^\d+\.\d+\.\d+$/.test(version)
      || numbers[0] < 3 || (numbers[0] === 3 && (numbers[1] < 3 || (numbers[1] === 3 && numbers[2] < 1)))) {
      return { status: 'unsupported', images: [] };
    }
    const data = await this.client.get('/image');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid Gallery response');
    const images = [];
    for (const [id, entry] of Object.entries(data)) {
      if (!safeId(id) || !entry || typeof entry !== 'object') continue;
      const match = /^\/userdata\/([a-zA-Z0-9-]+)\.([a-zA-Z]+)$/.exec(entry.file || '');
      const type = typeof entry.type === 'string' ? entry.type.toLowerCase() : '';
      if (!match || match[1] !== id || !['jpg', 'jpeg', 'png', 'gif'].includes(match[2].toLowerCase()) || !['image/jpeg', 'image/jpg', 'image/png', 'image/gif'].includes(type)) continue;
      const filename = `${id}.${match[2]}`;
      images.push({ id, name: String(entry.name || filename).slice(0, 256), filename,
        url: `/app/${APP_ID}/userdata/${filename}` });
    }
    images.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return { status: 'ready', images };
  }

  async list(force = false) {
    if (this.closed) return this.state;
    if (this.promise) return this.promise;
    if (!force && Date.now() < this.expiresAt) return this.state;
    this.promise = (async () => {
      let next;
      let generation;
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          generation = this.generation;
          next = await this.timed(() => this.read());
          if (generation === this.generation) break;
        }
      } catch (err) {
        next = { status: 'unavailable', images: [] };
      }
      if (!this.closed) {
        this.expiresAt = generation === this.generation ? Date.now() + CACHE_MS : 0;
        if (JSON.stringify(next) !== JSON.stringify(this.state)) {
          this.state = next;
          this.byId = new Map(next.images.map(image => [image.id, image]));
          this.onChange();
        }
      }
      return this.state;
    })().finally(() => { this.promise = null; });
    return this.promise;
  }

  async photo(id, refresh = false) {
    if (!safeId(id) || this.closed) throw new Error('Gallery photo unavailable');
    await this.list();
    const image = this.byId.get(id);
    if (this.closed || this.state.status !== 'ready' || !image) throw new Error('Gallery photo unavailable');
    const key = `${this.generation}:${image.url}`;
    if (!refresh && this.photoCache?.key === key) return this.photoCache.value;
    if (this.photoPending?.key === key) return this.photoPending.promise;
    this.photoCache = null;
    this.photoPending?.controller.abort();
    const controller = new AbortController();
    const pending = { key, controller, promise: null };
    this.photoPending = pending;
    pending.promise = this.timed(async () => {
      // Resolve Homey's own address on the app side, never the widget's origin.
      const address = await this.homey.cloud.getLocalAddress();
      const base = new URL(address.includes('://') ? address : `http://${address}`);
      if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Invalid Homey address');
      const response = await fetch(new URL(image.url, base), { signal: controller.signal, redirect: 'error' });
      if (!response.ok || !response.body) throw new Error('Gallery photo unavailable');
      if (Number(response.headers.get('content-length')) > PHOTO_LIMIT) throw new Error('Gallery photo too large');
      let size = 0;
      const chunks = [];
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > PHOTO_LIMIT) throw new Error('Gallery photo too large');
        chunks.push(chunk);
      }
      if (!size || this.closed || controller.signal.aborted || key !== `${this.generation}:${this.byId.get(id)?.url}`) throw new Error('Gallery photo unavailable');
      const extension = image.filename.split('.').pop().toLowerCase();
      const type = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : `image/${extension}`;
      const value = { id, dataUrl: `data:${type};base64,${Buffer.concat(chunks, size).toString('base64')}` };
      this.photoCache = { key, value };
      return value;
    }, 12000).finally(() => {
      controller.abort();
      if (this.photoPending === pending) this.photoPending = null;
    });
    return pending.promise;
  }

  close() {
    this.closed = true;
    this.photoCache = null;
    this.photoPending?.controller.abort();
    if (this.client) {
      this.client.removeListener('realtime', this.realtime);
      this.client.removeListener('install', this.invalidate);
      this.client.removeListener('uninstall', this.invalidate);
      this.client.unregister?.();
    }
  }
}

module.exports = { Gallery, safeId };
