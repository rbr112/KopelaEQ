import assert from 'node:assert/strict';
import { AppearanceService } from '../extension/js/popup/appearance/appearance-service.js';
import { STORAGE } from '../extension/js/shared/constants.js';

function installEnv(seed = {}) {
  const store = structuredClone(seed);
  const writes = [];
  const styles = new Map();
  globalThis.document = {
    documentElement: {
      dataset: {},
      classList: { remove() {}, contains() { return false; } },
      style: { setProperty(name, value) { styles.set(name, String(value)); } }
    }
  };
  globalThis.localStorage = {
    value: null,
    setItem(_key, value) { this.value = value; },
    getItem() { return this.value; }
  };
  globalThis.chrome = {
    runtime: { getURL: (path) => `chrome-extension://test/${path}` },
    storage: {
      local: {
        async get(keys) {
          const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys || {});
          const out = {};
          for (const key of list) if (Object.prototype.hasOwnProperty.call(store, key)) out[key] = structuredClone(store[key]);
          return out;
        },
        async set(values) {
          writes.push(structuredClone(values));
          Object.assign(store, structuredClone(values));
        }
      }
    }
  };
  return { store, writes, styles };
}

{
  const env = installEnv({
    [STORAGE.APPEARANCE]: { schemaVersion: 1, themeId: 'user.missing', layoutId: 'nocturne' },
    [STORAGE.CUSTOM_THEMES]: [{ schemaVersion: 1, id: 'user.broken', name: 'Broken', extends: 'missing.parent', tokens: {} }]
  });
  const service = new AppearanceService();
  await service.load();
  assert.equal(service.currentState.themeId, 'builtin.rice');
  assert.equal(service.currentState.layoutId, 'rice');
  assert.equal(document.documentElement.dataset.theme, 'builtin.rice');
  assert.equal(document.documentElement.dataset.layout, 'rice');
  assert.equal(env.store[STORAGE.APPEARANCE].themeId, 'builtin.rice', 'stale custom selection should be repaired');
}

{
  const env = installEnv({
    [STORAGE.APPEARANCE]: { schemaVersion: 1, themeId: 'user.safe', layoutId: 'rice' },
    [STORAGE.CUSTOM_THEMES]: [{
      schemaVersion: 1,
      id: 'user.safe',
      name: 'Safe',
      extends: 'builtin.rice',
      preferredLayout: 'rice',
      tokens: { colors: { accent: '#123456' } }
    }]
  });
  const service = new AppearanceService();
  await service.load();
  assert.equal(service.currentState.themeId, 'user.safe');
  assert.equal(env.styles.get('--cyan'), '#123456', 'validated custom variables should apply after service load');
  const cached = JSON.parse(globalThis.localStorage.value);
  assert.deepEqual(Object.keys(cached).sort(), ['layoutId', 'themeId'], 'first-paint cache must contain identity only');
}


{
  const env = installEnv({
    [STORAGE.APPEARANCE]: { schemaVersion: 1, themeId: 'builtin.rice', layoutId: 'rice' },
    [STORAGE.SURFACE_OVERRIDES]: {
      'builtin.rice': { mainColor: '#112233', mainOpacity: 0.35, toolsColor: '#334455', toolsOpacity: 0.62 }
    }
  });
  const service = new AppearanceService();
  await service.load();
  assert.equal(service.currentSurfaceAppearance.mainColor, '#112233');
  assert.equal(service.currentSurfaceAppearance.mainOpacity, 0.35);
  assert.equal(service.currentSurfaceAppearance.toolsColor, '#334455');
  assert.equal(service.currentSurfaceAppearance.toolsOpacity, 0.62);
  assert.equal(service.currentSurfaceAppearance.customized, true);
  assert.equal(env.styles.get('--main-surface-color'), '#112233');
  assert.equal(env.styles.get('--main-surface-opacity'), '0.35');
  assert.equal(env.styles.get('--tools-surface-color'), '#334455');
  assert.equal(env.styles.get('--tools-surface-opacity'), '0.62');
  await service.setSurfaceAppearance({ mainOpacity: 0.2, toolsColor: '#abcdef' });
  assert.equal(env.store[STORAGE.SURFACE_OVERRIDES]['builtin.rice'].mainOpacity, 0.2);
  assert.equal(env.store[STORAGE.SURFACE_OVERRIDES]['builtin.rice'].toolsColor, '#abcdef');
  await service.resetSurfaceAppearance();
  assert.equal(service.currentSurfaceAppearance.customized, false);
  assert.equal(service.currentSurfaceAppearance.mainColor, '#101a22');
  assert.equal(service.currentSurfaceAppearance.mainOpacity, 0.89);
}

// theme JSON panel defaults should be first-class; local controls override them.


{
  const env = installEnv({
    [STORAGE.APPEARANCE]: { schemaVersion: 1, themeId: 'user.panels', layoutId: 'rice' },
    [STORAGE.CUSTOM_THEMES]: [{
      schemaVersion: 1, id: 'user.panels', name: 'Panels', extends: 'builtin.rice', preferredLayout: 'rice',
      tokens: { surface: { main: { color: '#223344', opacity: 0.44 }, tools: { color: '#334455', opacity: 0.66 } } }
    }]
  });
  const service = new AppearanceService();
  await service.load();
  assert.equal(service.currentSurfaceAppearance.mainColor, '#223344');
  assert.equal(service.currentSurfaceAppearance.mainOpacity, 0.44);
  assert.equal(service.currentSurfaceAppearance.toolsColor, '#334455');
  assert.equal(service.currentSurfaceAppearance.toolsOpacity, 0.66);
  assert.equal(service.currentSurfaceAppearance.customized, false);
  await service.setSurfaceAppearance({ mainColor: '#abcdef', toolsOpacity: 0.31 });
  assert.equal(service.currentSurfaceAppearance.mainColor, '#abcdef');
  assert.equal(service.currentSurfaceAppearance.mainOpacity, 0.44);
  assert.equal(service.currentSurfaceAppearance.toolsColor, '#334455');
  assert.equal(service.currentSurfaceAppearance.toolsOpacity, 0.31);
  assert.equal(service.currentSurfaceAppearance.customized, true);
  const exported = service.exportCustomTheme();
  assert.equal(exported.format, 'KopelaEQ Theme');
  assert.equal(exported.theme.tokens.surface.main.color, '#abcdef');
  assert.equal(exported.theme.tokens.surface.main.opacity, 0.44);
  assert.equal(exported.theme.tokens.surface.tools.color, '#334455');
  assert.equal(exported.theme.tokens.surface.tools.opacity, 0.31);
  await service.resetSurfaceAppearance();
  assert.equal(service.currentSurfaceAppearance.mainColor, '#223344');
  assert.equal(service.currentSurfaceAppearance.mainOpacity, 0.44);
  assert.equal(service.currentSurfaceAppearance.toolsColor, '#334455');
  assert.equal(service.currentSurfaceAppearance.toolsOpacity, 0.66);
  assert.equal(service.currentSurfaceAppearance.customized, false);
  assert.equal(env.styles.get('--main-surface-color'), '#223344');
  assert.equal(env.styles.get('--tools-surface-opacity'), '0.66');
}



{
  // 1.25.7 regression: a legacy/stale resolved theme that predates
  // surface.main/tools must never crash first paint.
  const env = installEnv({ [STORAGE.APPEARANCE]: { schemaVersion: 1, themeId: 'builtin.rice', layoutId: 'rice' } });
  const service = new AppearanceService();
  await service.load();
  service.resolved.tokens.surface = { opacity: 0.73, blur: 10, shadowStrength: 0.4 };
  const safe = service.currentSurfaceAppearance;
  assert.equal(safe.mainColor, service.currentTheme.tokens.colors.surface);
  assert.equal(safe.toolsColor, service.currentTheme.tokens.colors.surface);
  assert.equal(safe.mainOpacity, 0.73);
  assert.equal(safe.toolsOpacity, 0.73);
  service.recoverToRice();
  assert.equal(document.documentElement.dataset.layout, 'rice');
  assert.equal(document.documentElement.dataset.theme, 'builtin.rice');
  assert.equal(document.documentElement.classList?.contains?.('appearance-loading') ?? false, false);
  void env;
}


{
  const env = installEnv({
    [STORAGE.APPEARANCE]: { schemaVersion: 1, themeId: 'builtin.rice', layoutId: 'rice' },
    [STORAGE.MEDIA_HINTS]: { 'builtin.rice': 'preloaded-cover' }
  });
  const service = new AppearanceService();
  await service.load();
  const info = service.currentUserArtwork;
  assert.equal(info?.filename, 'rice-preloaded-user.jpg');
  assert.equal(info?.fit, 'cover');
  assert.match(env.styles.get('--artwork-card-image') || '', /rice-preloaded-user\.jpg/);
  assert.equal(document.documentElement.dataset.userArtwork, 'true');
}


{
  // Built-in startup must not validate the whole custom-theme library. The
  // editor explicitly loads it later.
  let validations = 0;
  globalThis.__KopelaThemeValidator = (value) => { validations += 1; return structuredClone(value); };
  installEnv({
    [STORAGE.APPEARANCE]: { schemaVersion: 1, themeId: 'builtin.rice', layoutId: 'rice' },
    [STORAGE.CUSTOM_THEMES]: [{ schemaVersion:1, id:'user.lazy', name:'Lazy', extends:'builtin.rice', tokens:{} }]
  });
  const service = new AppearanceService();
  await service.load();
  assert.equal(validations, 0, 'built-in startup should keep custom-theme validator off the path');
  await service.ensureCustomThemesLoaded();
  assert.equal(validations, 1, 'opening Appearance should load/validate the custom library once');
  delete globalThis.__KopelaThemeValidator;
}

{
  // A storage API that never resolves must not leave AppearanceService.load()
  // pending forever. It falls back to Rice within its bounded startup window.
  installEnv();
  globalThis.chrome.storage.local.get = async () => new Promise(() => {});
  const service = new AppearanceService();
  const started = Date.now();
  await service.load();
  assert.ok(Date.now() - started < 700, 'appearance storage timeout should bound startup');
  assert.equal(service.currentState.themeId, 'builtin.rice');
}


{
  installEnv({ [STORAGE.APPEARANCE]: { schemaVersion:1, themeId:'builtin.rice', layoutId:'rice' } });
  const service = new AppearanceService();
  await service.load();
  await assert.rejects(() => service.importTheme({
    schemaVersion:1, id:'user.unknown-art', name:'Unknown artwork', extends:'builtin.rice', tokens:{ artwork:{ assetId:'user.missing.asset' } }
  }), /Unknown packaged artwork asset/);
}

console.log('appearance_service_recovery.test.mjs: PASS');
