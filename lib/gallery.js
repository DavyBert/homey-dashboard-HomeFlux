'use strict';

const APP_ID = 'com.athom.gallery';
const CACHE_MS = 60000;
const TIMEOUT_MS = 6000;
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
    this.invalidate = () => {
      this.expiresAt = 0;
      this.generation += 1;
      if (!this.closed) this.onInvalidate();
    };
    this.realtime = event => {
      const name = typeof event === 'string' ? event : event?.event;
      if (['image.create', 'image.delete', 'image.update'].includes(name)) this.invalidate();
    };
  }

  async timed(operation) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise((resolve, reject) => {
          timer = this.homey.setTimeout(() => reject(new Error('Gallery timeout')), TIMEOUT_MS);
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
      const match = /^\/userdata\/([a-zA-Z0-9-]+)\.(jpg|jpeg|png|gif)$/.exec(entry.file || '');
      if (!match || match[1] !== id || !['image/jpeg', 'image/jpg', 'image/png', 'image/gif'].includes(entry.type)) continue;
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

  close() {
    this.closed = true;
    if (this.client) {
      this.client.removeListener('realtime', this.realtime);
      this.client.removeListener('install', this.invalidate);
      this.client.removeListener('uninstall', this.invalidate);
      this.client.unregister?.();
    }
  }
}

module.exports = { Gallery, safeId };
