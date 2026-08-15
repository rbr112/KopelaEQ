import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../static/appearance-bootstrap.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../static/popup.html', import.meta.url), 'utf8');

function makeRoot() {
  const classes = new Set();
  const styles = new Map();
  return {
    dataset: {},
    style: { setProperty(name, value) { styles.set(name, value); }, getPropertyValue(name) { return styles.get(name) || ''; } },
    classList: {
      add(...names) { for (const name of names) classes.add(name); },
      remove(...names) { for (const name of names) classes.delete(name); },
      contains(name) { return classes.has(name); }
    }
  };
}

{
  const root = makeRoot();
  let storageCalls = 0;
  const context = {
    document: { documentElement: root },
    localStorage: { getItem: () => JSON.stringify({ themeId: 'builtin.nocturne', layoutId: 'nocturne' }) },
    chrome: { storage: { local: { get: async () => { storageCalls += 1; return {}; } } } },
    setTimeout
  };
  vm.runInNewContext(source, context);
  assert.equal(root.dataset.layout, 'nocturne');
  assert.equal(root.dataset.theme, 'builtin.nocturne');
  assert.equal(root.dataset.appearanceBootstrapped, 'true');
  assert.equal(root.classList.contains('appearance-loading'), false);
  assert.equal(storageCalls, 0, 'cached appearance should be applied synchronously');
}

{
  const root = makeRoot();
  const context = {
    document: { documentElement: root },
    localStorage: { getItem: () => JSON.stringify({ themeId: 'user.blue', layoutId: 'rice', artworkPlacement: 'none', cssVars: { '--cyan': '#5aa9ff', '--panel': '#101820' } }) },
    chrome: { storage: { local: { get: async () => ({}) } } },
    setTimeout
  };
  vm.runInNewContext(source, context);
  assert.equal(root.dataset.theme, 'user.blue');
  assert.equal(root.dataset.layout, 'rice');
  assert.equal(root.style.getPropertyValue('--cyan'), '', 'custom CSS must not execute in first-paint bootstrap');
  assert.equal(root.style.getPropertyValue('--panel'), '', 'custom CSS must wait for validated AppearanceService load');
}

{
  const root = makeRoot();
  const context = {
    document: { documentElement: root },
    localStorage: { getItem: () => null },
    chrome: { storage: { local: { get: async () => ({ 'kopelaeq.appearance': { themeId: 'builtin.rice', layoutId: 'rice' } }) } } },
    setTimeout
  };
  vm.runInNewContext(source, context);
  assert.equal(root.classList.contains('appearance-loading'), true, 'uncached popup stays hidden briefly while storage resolves');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(root.dataset.layout, 'rice');
  assert.equal(root.dataset.theme, 'builtin.rice');
  assert.equal(root.classList.contains('appearance-loading'), false);
}

{
  const root = makeRoot();
  let reveal;
  const context = {
    document: { documentElement: root },
    localStorage: { getItem: () => null },
    chrome: { storage: { local: { get: () => new Promise(() => {}) } } },
    setTimeout(fn) { reveal = fn; return 1; }
  };
  vm.runInNewContext(source, context);
  assert.equal(root.classList.contains('appearance-loading'), true);
  reveal();
  assert.equal(root.dataset.layout, 'rice');
  assert.equal(root.dataset.theme, 'builtin.rice');
  assert.equal(root.classList.contains('appearance-loading'), false, 'startup watchdog must reveal popup even if storage hangs');
}

assert.ok(html.indexOf('appearance-bootstrap.js') < html.indexOf('popup.css'), 'appearance bootstrap must execute before theme CSS is parsed');
console.log('appearance_bootstrap.test.mjs: PASS');
