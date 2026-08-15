import assert from 'node:assert/strict';
import { STORAGE } from '../extension/js/shared/constants.js';

const store = {};
const writes = [];
globalThis.chrome = {
  storage: { local: {
    async get(keys) {
      const list = typeof keys === 'string' ? [keys] : keys;
      const out = {};
      for (const key of list) if (Object.prototype.hasOwnProperty.call(store, key)) out[key] = structuredClone(store[key]);
      return out;
    },
    async set(values) { writes.push(structuredClone(values)); Object.assign(store, structuredClone(values)); }
  } }
};

const { ensurePreloadedUserMedia } = await import(`../extension/js/background/preloaded-media.js?qa=${Date.now()}`);
await ensurePreloadedUserMedia(true);
assert.equal(store[STORAGE.PRELOADED_MEDIA_VERSION], 1);
assert.equal(store[STORAGE.MEDIA_HINTS]['builtin.rice'], 'preloaded-cover');
assert.equal(store[STORAGE.MEDIA_HINTS]['builtin.rice::background'], 'none');
assert.equal(store[STORAGE.MEDIA_HINTS]['builtin.nocturne'], 'none');
assert.equal(store[STORAGE.MEDIA_HINTS]['builtin.nocturne::background'], 'none');
assert.equal(writes.length, 1);

// The one-time migration must not rewrite user choices on later starts.
store[STORAGE.MEDIA_HINTS]['builtin.rice'] = 'none';
await ensurePreloadedUserMedia();
assert.equal(store[STORAGE.MEDIA_HINTS]['builtin.rice'], 'none');
assert.equal(writes.length, 1);

console.log('preloaded_media.test.mjs: PASS');
