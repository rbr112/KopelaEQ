import assert from 'node:assert/strict';
import * as S from '../extension/js/shared/index.js';

const store = {};
let listener = null;
let readCount = 0;

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const list = typeof keys === 'string' ? [keys] : keys;
        if ((Array.isArray(list) ? list : []).includes?.(S.STORAGE.SELECTED_PRESETS) || keys === S.STORAGE.SELECTED_PRESETS) {
          readCount += 1;
          // Force overlap pressure: without serialized read-modify-write both
          // callers can observe the same empty map and one tab selection is lost.
          await new Promise((resolve) => setTimeout(resolve, readCount === 1 ? 25 : 1));
        }
        const out = {};
        for (const key of (typeof keys === 'string' ? [keys] : keys)) if (key in store) out[key] = structuredClone(store[key]);
        return out;
      },
      async set(values) {
        await new Promise((resolve) => setTimeout(resolve, 2));
        Object.assign(store, structuredClone(values));
      }
    }
  },
  offscreen: { async hasDocument(){ return false; }, async createDocument(){}, async closeDocument(){} },
  runtime: {
    getURL: (path) => path,
    onInstalled: { addListener(){} },
    onMessage: { addListener(fn){ listener = fn; } },
    async sendMessage(){ return { ok:true, active:false, activeTabs:[], pendingTabs:[] }; }
  },
  tabCapture: { async getCapturedTabs(){ return []; }, onStatusChanged: { addListener(){} } },
  tabs: { async get(id){ return { id, audible:false }; }, onRemoved:{ addListener(){} }, onUpdated:{ addListener(){} } }
};

await import(`../extension/js/background/index.js?concurrency=${Date.now()}`);
assert.equal(typeof listener, 'function');

function invoke(msg, sender={}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 1500);
    listener(msg, sender, (value) => { clearTimeout(timer); resolve(value); });
  });
}

const [a,b] = await Promise.all([
  invoke({ type:S.MessageType.PresetSelectionSet, name:'Bass Tight (bass3)' }, { tab:{ id:11 } }),
  invoke({ type:S.MessageType.PresetSelectionSet, name:'Vivid (111)' }, { tab:{ id:22 } })
]);
assert.equal(a.ok, true); assert.equal(b.ok, true);
assert.deepEqual(store[S.STORAGE.SELECTED_PRESETS], {
  '11':'Bass Tight (bass3)',
  '22':'Vivid (111)'
});
console.log('selected_preset_concurrency.test.mjs: PASS');
