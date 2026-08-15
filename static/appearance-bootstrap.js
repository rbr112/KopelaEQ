(() => {
  const CACHE_KEY = 'kopelaeq.appearance-cache.v1';
  const STORAGE_KEY = 'kopelaeq.appearance';
  const root = document.documentElement;
  root.classList.add('appearance-loading');

  // Startup safety: appearance is a paint optimization, never a reason to keep
  // the extension popup invisible. If storage/cache code stalls or throws, Rice
  // is revealed and the normal AppearanceService can finish asynchronously.
  if (typeof setTimeout === 'function') {
    setTimeout(() => {
      if (!root.dataset.layout) root.dataset.layout = 'rice';
      if (!root.dataset.theme) root.dataset.theme = 'builtin.rice';
      root.classList.remove('appearance-loading');
    }, 120);
  }

  const apply = (value) => {
    const record = value && typeof value === 'object' ? value : {};
    const layout = record.layoutId === 'nocturne' || record.layoutId === 'classic' ? record.layoutId : 'rice';
    const fallbackTheme = layout === 'nocturne' ? 'builtin.nocturne' : layout === 'classic' ? 'builtin.classic' : 'builtin.rice';
    root.dataset.layout = layout;
    root.dataset.theme = typeof record.themeId === 'string' ? record.themeId : fallbackTheme;
    root.dataset.appearanceBootstrapped = 'true';
    root.classList.remove('appearance-loading');
  };

  // Keep the synchronous bootstrap deliberately tiny. Custom-theme CSS variables
  // are applied by AppearanceService after validation; untrusted/corrupt cached
  // theme data must never run in the first-paint path.
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cached && typeof cached === 'object') {
      apply(cached);
      return;
    }
  } catch {}

  try {
    const pending = chrome?.storage?.local?.get?.(STORAGE_KEY);
    if (pending && typeof pending.then === 'function') {
      pending.then((stored) => {
        const value = stored?.[STORAGE_KEY];
        apply(value && typeof value === 'object' ? value : { themeId: 'builtin.rice', layoutId: 'rice' });
      }).catch(() => apply({ themeId: 'builtin.rice', layoutId: 'rice' }));
      return;
    }
  } catch {}

  apply({ themeId: 'builtin.rice', layoutId: 'rice' });
})();
