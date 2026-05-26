const CACHE_PREFIX = 'aiCache_';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

export const AICache = {
  _memory: new Map(),

  _key(text, action) {
    return CACHE_PREFIX + simpleHash(text + '::' + action);
  },

  async get(text, action) {
    const key = this._key(text, action);
    if (this._memory.has(key)) {
      const entry = this._memory.get(key);
      if (Date.now() - entry.timestamp < CACHE_TTL_MS) return entry.result;
      this._memory.delete(key);
    }
    return new Promise((resolve) => {
      chrome.storage.local.get(key, (data) => {
        const entry = data[key];
        if (!entry || Date.now() - entry.timestamp > CACHE_TTL_MS) {
          resolve(null);
          return;
        }
        this._memory.set(key, entry);
        resolve(entry.result);
      });
    });
  },

  async set(text, action, result) {
    const key = this._key(text, action);
    const entry = { result, timestamp: Date.now() };
    this._memory.set(key, entry);
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: entry }, resolve);
    });
  },

  async clear() {
    this._memory.clear();
    const all = await chrome.storage.local.get(null);
    const toRemove = Object.keys(all).filter((k) => k.startsWith(CACHE_PREFIX));
    if (toRemove.length) await chrome.storage.local.remove(toRemove);
  }
};
