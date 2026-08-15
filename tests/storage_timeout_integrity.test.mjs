import assert from 'node:assert/strict';
import { AppearanceService } from '../extension/js/popup/appearance/appearance-service.js';
import { PresetUI } from '../extension/js/popup/preset-ui.js';
import * as S from '../extension/js/shared/index.js';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function installAppearanceEnv(seed, delayMs = 400) {
  const store = structuredClone(seed);
  const writes = [];
  globalThis.document = {
    documentElement: {
      dataset: {}, classList: { remove() {} },
      style: { setProperty() {} }
    },
    createElement() { return { dataset:{}, className:'', value:'', textContent:'', setAttribute(){}, appendChild(){}, click(){} }; }
  };
  globalThis.localStorage = { setItem(){}, getItem(){ return null; } };
  globalThis.chrome = {
    runtime: { getURL: (p) => `chrome-extension://test/${p}`, async sendMessage(){ return { ok:true }; } },
    storage: {
      local: {
        async get(keys) {
          await sleep(delayMs);
          const list = typeof keys === 'string' ? [keys] : keys;
          const out = {};
          for (const key of list) if (Object.prototype.hasOwnProperty.call(store, key)) out[key] = structuredClone(store[key]);
          return out;
        },
        async set(values) { writes.push(structuredClone(values)); Object.assign(store, structuredClone(values)); }
      }
    }
  };
  return { store, writes };
}

// A 400ms read exceeds the 280ms startup budget. It may cause a temporary Rice
// fallback, but it must never "repair" a perfectly valid stored custom choice.
{
  const env = installAppearanceEnv({
    [S.STORAGE.APPEARANCE]: { schemaVersion:1, themeId:'user.safe', layoutId:'rice' },
    [S.STORAGE.CUSTOM_THEMES]: [{ schemaVersion:1, id:'user.safe', name:'Safe', extends:'builtin.rice', preferredLayout:'rice', tokens:{} }]
  });
  const service = new AppearanceService();
  await service.load();
  assert.equal(service.currentState.themeId, 'builtin.rice');
  await sleep(450);
  assert.equal(env.store[S.STORAGE.APPEARANCE].themeId, 'user.safe');
  assert.equal(env.writes.some((entry) => Object.prototype.hasOwnProperty.call(entry, S.STORAGE.APPEARANCE)), false,
    'timeout fallback must not overwrite appearance selection');
}

// A surface edit after degraded startup must re-read the authoritative map and
// preserve overrides belonging to other themes.
{
  const env = installAppearanceEnv({
    [S.STORAGE.APPEARANCE]: { schemaVersion:1, themeId:'builtin.rice', layoutId:'rice' },
    [S.STORAGE.SURFACE_OVERRIDES]: {
      'builtin.rice': { mainOpacity:0.77 },
      'builtin.nocturne': { toolsColor:'#123456', toolsOpacity:0.55 }
    },
    [S.STORAGE.MEDIA_HINTS]: { 'builtin.rice':'preloaded-cover' }
  });
  const service = new AppearanceService();
  await service.load();
  await service.setSurfaceAppearance({ mainOpacity:0.22 });
  assert.equal(env.store[S.STORAGE.SURFACE_OVERRIDES]['builtin.rice'].mainOpacity, 0.22);
  assert.equal(env.store[S.STORAGE.SURFACE_OVERRIDES]['builtin.nocturne'].toolsColor, '#123456');
  assert.equal(env.store[S.STORAGE.MEDIA_HINTS]['builtin.rice'], 'preloaded-cover', 'degraded startup must not normalize preloaded media to none');
}

function fakeElement() {
  return {
    hidden:true, value:'', textContent:'', disabled:false, dataset:{}, className:'', files:null,
    classList:{ toggle(){}, add(){}, remove(){} },
    addEventListener(){}, appendChild(){}, setAttribute(){}, focus(){}, click(){}, contains(){ return false; },
    querySelectorAll(){ return []; }, querySelector(){ return null; }
  };
}

// Presets: timeout shows bundled defaults in RAM, but saving later must first
// recover the real user map instead of replacing it with those defaults.
{
  const mine = S.audioStateToPreset('Mine', S.defaultAudioState());
  const store = { [S.STORAGE.PRESETS]: { Mine: mine } };
  const writes = [];
  globalThis.document = { createElement: () => fakeElement(), addEventListener(){} };
  globalThis.confirm = () => true;
  globalThis.requestAnimationFrame = (fn) => { fn(); return 1; };
  globalThis.chrome = {
    runtime: { async sendMessage(){ return { ok:true }; } },
    storage: {
      local: {
        async get(keys) {
          await sleep(400);
          const list = typeof keys === 'string' ? [keys] : keys;
          const out = {};
          for (const key of list) if (Object.prototype.hasOwnProperty.call(store, key)) out[key] = structuredClone(store[key]);
          return out;
        },
        async set(values) { writes.push(structuredClone(values)); Object.assign(store, structuredClone(values)); }
      }
    }
  };
  const elements = new Proxy({}, { get(target, key) { if (!(key in target)) target[key] = fakeElement(); return target[key]; } });
  const ui = new PresetUI({
    elements,
    getState: () => S.defaultAudioState(),
    setState() {}, getActiveTabId: () => 1,
    async onStateChange() {}, onStatus() {}, onError() {}
  });
  await ui.loadPresets();
  assert.equal(writes.length, 0, 'timed-out preset read must not write bundled defaults');
  await sleep(450);
  await ui.saveCurrentEqAs('New', false);
  assert.ok(store[S.STORAGE.PRESETS].Mine, 'existing user preset must survive retry');
  assert.ok(store[S.STORAGE.PRESETS].New, 'new preset should be added after authoritative retry');
}

console.log('storage_timeout_integrity.test.mjs: PASS');
