import type { AppearanceService } from './appearance-service.js';
import { MAX_THEME_IMPORT_BYTES } from './appearance-service.js';
import { BUILTIN_THEME_IDS } from './theme-registry.js';
import { APPEARANCE_SCHEMA_VERSION, type SurfaceAppearanceOverride, type ThemeDefinition } from './theme-types.js';
import { MAX_USER_ARTWORK_BYTES, type UserArtworkFit } from './artwork-store.js';
import type { PopupElements } from '../popup-elements.js';

export interface AppearanceUIOptions {
  elements: PopupElements;
  service: AppearanceService;
  onError: (message: string) => void;
  onStatus?: (message: string) => void;
}

const CHOICES = Object.freeze({
  rice: { themeId: BUILTIN_THEME_IDS.RICE, layoutId: 'rice' as const },
  nocturne: { themeId: BUILTIN_THEME_IDS.NOCTURNE, layoutId: 'nocturne' as const }
});

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function colorInputValue(value: string): string {
  const hex = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const short = hex.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const rgb = hex.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map((part) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, '0')).join('')}`;
  return '#101a22';
}

function themeExample(): Record<string, unknown> {
  return {
    format: 'KopelaEQ Theme',
    theme: {
      schemaVersion: APPEARANCE_SCHEMA_VERSION,
      id: 'user.my-theme',
      name: 'My Theme',
      author: 'Your name',
      extends: 'builtin.rice',
      preferredLayout: 'rice',
      tokens: {
        colors: { accent: '#7aa2f7', accentAlt: '#bb9af7', text: '#e8eef4', textMuted: '#8495a5', border: '#2a3a46' },
        radius: { window: 18, panel: 16, control: 11 },
        surface: {
          main: { color: '#101a22', opacity: 0.72 },
          eq: { color: '#101a22', opacity: 0.82 },
          cards: { color: '#182630', opacity: 0.70 },
          tools: { color: '#16212b', opacity: 0.86 },
          controls: { color: '#182630', opacity: 0.78 },
          blur: 16, shadowStrength: 0.56
        },
        artwork: { dim: 0.30 },
        typography: { scale: 1 },
        spacing: { scale: 1 },
        eq: { curve: '#dfe9ef', pointSelected: '#7aa2f7', pointStyle: 'bands' }
      }
    }
  };
}

export class AppearanceUI {
  private readonly els: PopupElements;
  private readonly service: AppearanceService;
  private readonly onError: (message: string) => void;
  private readonly onStatus: (message: string) => void;
  private surfacePreviewFrame = 0;
  private pendingSurfacePatch: SurfaceAppearanceOverride = {};

  constructor(options: AppearanceUIOptions) {
    this.els = options.elements;
    this.service = options.service;
    this.onError = options.onError;
    this.onStatus = options.onStatus || (() => {});
  }

  bind(): void {
    this.els.appearanceTabs?.addEventListener('click', (event: Event) => {
      const button = (event.target as Element | null)?.closest('[data-appearance-tab]') as HTMLButtonElement | null;
      const tab = button?.dataset.appearanceTab;
      if (!tab) return;
      this.selectTab(tab);
    });

    this.els.appearanceThemeOptions?.addEventListener('click', (event: Event) => {
      const button = (event.target as Element | null)?.closest('[data-theme-choice]') as HTMLElement | null;
      if (!button) return;
      const choice = button.dataset.themeChoice as keyof typeof CHOICES | undefined;
      if (!choice || !CHOICES[choice]) return;
      const next = CHOICES[choice];
      void this.service.set(next.themeId, next.layoutId).then(() => this.sync()).catch((error: unknown) => this.fail(error));
    });

    this.els.appearanceCustomThemeOptions?.addEventListener('click', (event: Event) => {
      const button = (event.target as Element | null)?.closest('[data-custom-theme-id]') as HTMLElement | null;
      const themeId = button?.dataset.customThemeId;
      if (!themeId) return;
      void this.service.set(themeId).then(() => this.sync()).catch((error: unknown) => this.fail(error));
    });

    this.els.artworkUploadButton?.addEventListener('click', () => this.els.artworkFile?.click());
    this.els.artworkFile?.addEventListener('change', () => { void this.importArtworkFile(); });
    this.els.artworkRemoveButton?.addEventListener('click', () => { void this.removeArtwork(); });
    this.els.artworkFitOptions?.addEventListener('click', (event: Event) => {
      const button = (event.target as Element | null)?.closest('[data-artwork-fit]') as HTMLElement | null;
      const fit = button?.dataset.artworkFit;
      if (fit !== 'cover' && fit !== 'contain' || button?.hasAttribute('disabled')) return;
      void this.service.setUserArtworkFit(fit).then(() => this.syncArtwork()).catch((error: unknown) => this.fail(error));
    });

    this.els.backgroundUploadButton?.addEventListener('click', () => this.els.backgroundFile?.click());
    this.els.backgroundFile?.addEventListener('change', () => { void this.importBackgroundFile(); });
    this.els.backgroundRemoveButton?.addEventListener('click', () => { void this.removeBackground(); });
    this.els.backgroundFitOptions?.addEventListener('click', (event: Event) => {
      const button = (event.target as Element | null)?.closest('[data-background-fit]') as HTMLElement | null;
      const fit = button?.dataset.backgroundFit;
      if (fit !== 'cover' && fit !== 'contain' || button?.hasAttribute('disabled')) return;
      void this.service.setUserBackgroundFit(fit).then(() => this.syncBackground()).catch((error: unknown) => this.fail(error));
    });

    const bindSurfaceRange = (id: string, key: keyof SurfaceAppearanceOverride, min: number, max: number, divisor = 1) => {
      const input = this.els[id] as HTMLInputElement | undefined;
      const updateReadout = (raw: number) => {
        const output = this.els[`${id}Readout`] as HTMLOutputElement | undefined;
        if (!output) return;
        output.textContent = divisor === 100 ? `${Math.round(raw)}%` : `${Math.round(raw)} px`;
      };
      const patch = (): SurfaceAppearanceOverride => {
        const raw = Math.max(min, Math.min(max, Number(input?.value)));
        updateReadout(raw);
        return { [key]: raw / divisor } as SurfaceAppearanceOverride;
      };
      input?.addEventListener('input', () => this.queueSurfacePreview(patch()));
      input?.addEventListener('change', () => {
        this.flushSurfacePreview(patch());
        void this.service.commitSurfaceAppearance().catch((error: unknown) => this.fail(error));
      });
    };
    const bindSurfaceColor = (id: string, key: keyof SurfaceAppearanceOverride) => {
      const input = this.els[id] as HTMLInputElement | undefined;
      const patch = (): SurfaceAppearanceOverride => ({ [key]: input?.value || '#101a22' } as SurfaceAppearanceOverride);
      input?.addEventListener('input', () => this.queueSurfacePreview(patch()));
      input?.addEventListener('change', () => {
        this.flushSurfacePreview(patch());
        void this.service.commitSurfaceAppearance().catch((error: unknown) => this.fail(error));
      });
    };
    for (const [id,key,min,max,divisor] of [
      ['mainSurfaceOpacity','mainOpacity',10,100,100], ['eqSurfaceOpacity','eqOpacity',0,100,100],
      ['cardsSurfaceOpacity','cardsOpacity',0,100,100], ['toolsSurfaceOpacity','toolsOpacity',10,100,100],
      ['controlsSurfaceOpacity','controlsOpacity',0,100,100], ['borderOpacity','borderOpacity',0,100,100],
      ['backgroundDim','backgroundDim',0,100,100], ['shadowStrength','shadowStrength',0,100,100],
      ['surfaceBlur','blur',0,30,1], ['windowRadius','windowRadius',0,32,1],
      ['panelRadius','panelRadius',0,32,1], ['controlRadius','controlRadius',0,32,1]
    ] as Array<[string,keyof SurfaceAppearanceOverride,number,number,number]>) bindSurfaceRange(id,key,min,max,divisor);
    for (const [id,key] of [
      ['mainSurfaceColor','mainColor'], ['eqSurfaceColor','eqColor'], ['cardsSurfaceColor','cardsColor'],
      ['toolsSurfaceColor','toolsColor'], ['controlsSurfaceColor','controlsColor'], ['borderColor','borderColor'],
      ['accentColor','accentColor'], ['accentAltColor','accentAltColor'], ['positiveColor','positiveColor'], ['dangerColor','dangerColor'],
      ['eqCurveColor','eqCurveColor'], ['textColor','textColor'], ['mutedTextColor','mutedTextColor']
    ] as Array<[string,keyof SurfaceAppearanceOverride]>) bindSurfaceColor(id,key);
    this.els.surfaceAdvancedToggle?.addEventListener('click', () => {
      const expanded = this.els.surfaceAdvancedToggle.getAttribute('aria-expanded') === 'true';
      this.els.surfaceAdvancedToggle.setAttribute('aria-expanded', String(!expanded));
      if (this.els.surfaceAdvancedBody) this.els.surfaceAdvancedBody.hidden = expanded;
    });
    this.els.surfaceResetButton?.addEventListener('click', () => {
      void this.service.resetSurfaceAppearance().then(() => { this.onStatus('Visual overrides reset to theme defaults'); }).catch((error: unknown) => this.fail(error));
    });
    this.els.exportCurrentLookButton?.addEventListener('click', () => {
      try {
        const safeName = `${this.service.currentTheme.name}-look`.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'current-look';
        downloadJson(`KopelaEQ-${safeName}.json`, this.service.exportCurrentLook());
        this.onStatus('Current visual look exported');
      } catch (error: unknown) { this.fail(error); }
    });

    this.els.importThemeButton?.addEventListener('click', () => this.els.themeImportFile?.click());
    this.els.themeImportFile?.addEventListener('change', () => { void this.importSelectedFile(); });
    this.els.themeExampleButton?.addEventListener('click', () => downloadJson('KopelaEQ-theme-example.json', themeExample()));
    this.els.exportCustomThemeButton?.addEventListener('click', () => {
      try {
        const theme = this.service.listCustomThemes().find((item) => item.id === this.service.currentState.themeId);
        const safeName = (theme?.name || 'custom-theme').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'custom-theme';
        downloadJson(`KopelaEQ-${safeName}.json`, this.service.exportCustomTheme());
        this.onStatus(`Theme exported: ${theme?.name || 'Custom theme'}`);
      } catch (error: unknown) { this.fail(error); }
    });
    this.els.deleteCustomThemeButton?.addEventListener('click', () => { void this.removeCurrentCustomTheme(); });

    this.service.addEventListener('change', () => this.sync());
    this.service.addEventListener('themeschange', () => this.sync());
    this.service.addEventListener('artworkchange', () => this.syncArtwork());
    this.service.addEventListener('backgroundchange', () => this.syncBackground());
    this.service.addEventListener('surfacechange', () => this.syncSurfaceAppearance());
    this.sync();
  }

  private selectTab(tab: string): void {
    for (const button of (this.els.appearanceTabs?.querySelectorAll('[data-appearance-tab]') || []) as NodeListOf<HTMLButtonElement>) {
      const active = button.dataset.appearanceTab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    }
    for (const pane of document.querySelectorAll<HTMLElement>('#appearancePanel [data-appearance-pane]')) pane.hidden = pane.dataset.appearancePane !== tab;
  }

  private queueSurfacePreview(patch: SurfaceAppearanceOverride): void {
    Object.assign(this.pendingSurfacePatch, patch);
    if (this.surfacePreviewFrame) return;
    this.surfacePreviewFrame = requestAnimationFrame(() => {
      this.surfacePreviewFrame = 0;
      const next = this.pendingSurfacePatch;
      this.pendingSurfacePatch = {};
      try { this.service.previewSurfaceAppearance(next); } catch (error: unknown) { this.fail(error); }
    });
  }

  private flushSurfacePreview(patch?: SurfaceAppearanceOverride): void {
    if (patch) Object.assign(this.pendingSurfacePatch, patch);
    if (this.surfacePreviewFrame) { cancelAnimationFrame(this.surfacePreviewFrame); this.surfacePreviewFrame = 0; }
    const next = this.pendingSurfacePatch;
    this.pendingSurfacePatch = {};
    if (!Object.keys(next).length) return;
    try { this.service.previewSurfaceAppearance(next); } catch (error: unknown) { this.fail(error); }
  }

  sync(): void {
    const current = this.service.currentState;
    for (const button of (this.els.appearanceThemeOptions?.querySelectorAll('[data-theme-choice]') || []) as NodeListOf<HTMLElement>) {
      const choice = button.dataset.themeChoice as keyof typeof CHOICES | undefined;
      const active = Boolean(choice && CHOICES[choice]?.themeId === current.themeId && CHOICES[choice]?.layoutId === current.layoutId);
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    this.renderCustomThemes();
    this.syncArtwork();
    this.syncBackground();
    this.syncSurfaceAppearance();
    const currentIsCustom = this.service.isCustomTheme(current.themeId);
    if (this.els.exportCustomThemeButton) this.els.exportCustomThemeButton.hidden = !currentIsCustom;
    if (this.els.deleteCustomThemeButton) this.els.deleteCustomThemeButton.hidden = !currentIsCustom;
  }

  private syncSurfaceAppearance(): void {
    const v = this.service.currentSurfaceAppearance;
    const setPercent = (inputId: string, outputId: string, value: number) => {
      const pct = Math.round(value * 100);
      const input = this.els[inputId] as HTMLInputElement | undefined;
      if (input) input.value = String(pct);
      if (this.els[outputId]) this.els[outputId].textContent = `${pct}%`;
    };
    const setPx = (inputId: string, outputId: string, value: number) => {
      const px = Math.round(value);
      const input = this.els[inputId] as HTMLInputElement | undefined;
      if (input) input.value = String(px);
      if (this.els[outputId]) this.els[outputId].textContent = `${px} px`;
    };
    setPercent('mainSurfaceOpacity','mainSurfaceOpacityReadout',v.mainOpacity);
    setPercent('eqSurfaceOpacity','eqSurfaceOpacityReadout',v.eqOpacity);
    setPercent('cardsSurfaceOpacity','cardsSurfaceOpacityReadout',v.cardsOpacity);
    setPercent('toolsSurfaceOpacity','toolsSurfaceOpacityReadout',v.toolsOpacity);
    setPercent('controlsSurfaceOpacity','controlsSurfaceOpacityReadout',v.controlsOpacity);
    setPercent('borderOpacity','borderOpacityReadout',v.borderOpacity);
    setPercent('backgroundDim','backgroundDimReadout',v.backgroundDim);
    setPercent('shadowStrength','shadowStrengthReadout',v.shadowStrength);
    setPx('surfaceBlur','surfaceBlurReadout',v.blur);
    setPx('windowRadius','windowRadiusReadout',v.windowRadius);
    setPx('panelRadius','panelRadiusReadout',v.panelRadius);
    setPx('controlRadius','controlRadiusReadout',v.controlRadius);
    for (const [id,value] of [
      ['mainSurfaceColor',v.mainColor], ['eqSurfaceColor',v.eqColor], ['cardsSurfaceColor',v.cardsColor],
      ['toolsSurfaceColor',v.toolsColor], ['controlsSurfaceColor',v.controlsColor], ['borderColor',v.borderColor],
      ['accentColor',v.accentColor], ['accentAltColor',v.accentAltColor], ['positiveColor',v.positiveColor], ['dangerColor',v.dangerColor],
      ['eqCurveColor',v.eqCurveColor], ['textColor',v.textColor], ['mutedTextColor',v.mutedTextColor]
    ] as Array<[string,string]>) {
      const input = this.els[id] as HTMLInputElement | undefined;
      if (input) input.value = colorInputValue(value);
    }
    if (this.els.surfaceResetButton) this.els.surfaceResetButton.disabled = !v.customized;
  }

  private syncArtwork(): void {
    const info = this.service.currentUserArtwork;
    const theme = this.service.currentTheme;
    const supportsCard = this.service.currentState.layoutId === 'rice';
    if (this.els.artworkUploadButton) this.els.artworkUploadButton.disabled = !supportsCard;
    if (this.els.artworkCurrentName) this.els.artworkCurrentName.textContent = supportsCard ? (info?.filename || 'Theme default') : 'Rice artwork card';
    if (this.els.artworkCurrentMeta) {
      this.els.artworkCurrentMeta.textContent = !supportsCard
        ? 'This layout does not use the square artwork card.'
        : info
          ? `${formatBytes(info.size)} · ${info.mimeType.replace('image/', '').toUpperCase()} · ${theme.name}`
          : `Uses ${theme.name}'s built-in artwork.`;
    }
    if (this.els.artworkRemoveButton) this.els.artworkRemoveButton.hidden = !supportsCard || !info;
    for (const button of (this.els.artworkFitOptions?.querySelectorAll('[data-artwork-fit]') || []) as NodeListOf<HTMLButtonElement>) {
      const fit = button.dataset.artworkFit as UserArtworkFit | undefined;
      const active = Boolean(info && fit === info.fit);
      button.classList.toggle('active', active);
      button.disabled = !supportsCard || !info;
      button.setAttribute('aria-pressed', String(active));
    }
    const preview = this.els.artworkPreview as HTMLElement | undefined;
    if (preview && typeof getComputedStyle === 'function') {
      const rootStyle = getComputedStyle(document.documentElement);
      preview.style.backgroundImage = rootStyle.getPropertyValue('--artwork-card-image') || rootStyle.getPropertyValue('--artwork-image');
      preview.style.backgroundSize = rootStyle.getPropertyValue('--artwork-card-size') || 'cover';
      preview.style.backgroundPosition = rootStyle.getPropertyValue('--artwork-card-position') || 'center';
    }
  }

  private syncBackground(): void {
    const info = this.service.currentUserBackground;
    const theme = this.service.currentTheme;
    if (this.els.backgroundCurrentName) this.els.backgroundCurrentName.textContent = info?.filename || 'Theme default';
    if (this.els.backgroundCurrentMeta) {
      this.els.backgroundCurrentMeta.textContent = info
        ? `${formatBytes(info.size)} · ${info.mimeType.replace('image/', '').toUpperCase()} · ${theme.name}`
        : `Uses ${theme.name}'s built-in background.`;
    }
    if (this.els.backgroundRemoveButton) this.els.backgroundRemoveButton.hidden = !info;
    for (const button of (this.els.backgroundFitOptions?.querySelectorAll('[data-background-fit]') || []) as NodeListOf<HTMLButtonElement>) {
      const fit = button.dataset.backgroundFit as UserArtworkFit | undefined;
      const active = Boolean(info && fit === info.fit);
      button.classList.toggle('active', active);
      button.disabled = !info;
      button.setAttribute('aria-pressed', String(active));
    }
    const preview = this.els.backgroundPreview as HTMLElement | undefined;
    if (preview && typeof getComputedStyle === 'function') {
      const rootStyle = getComputedStyle(document.documentElement);
      preview.style.backgroundImage = rootStyle.getPropertyValue('--artwork-image');
      preview.style.backgroundSize = rootStyle.getPropertyValue('--artwork-background-size') || 'cover';
      preview.style.backgroundPosition = rootStyle.getPropertyValue('--artwork-background-position') || 'center';
    }
  }

  private async importBackgroundFile(): Promise<void> {
    const input = this.els.backgroundFile as HTMLInputElement | undefined;
    const file = input?.files?.[0];
    if (!file) return;
    try {
      if (file.size > MAX_USER_ARTWORK_BYTES) throw new Error(`Background is too large. Maximum is ${Math.round(MAX_USER_ARTWORK_BYTES / 1024 / 1024)} MB.`);
      const previousFit = this.service.currentUserBackground?.fit || 'cover';
      const info = await this.service.setUserBackground(file, file.name, previousFit);
      this.onStatus(`${info.mimeType === 'image/gif' ? 'Animated GIF background' : 'Background'} loaded for ${this.service.currentTheme.name}`);
      this.syncBackground();
    } catch (error: unknown) {
      this.fail(error);
    } finally {
      if (input) input.value = '';
    }
  }

  private async removeBackground(): Promise<void> {
    if (!this.service.currentUserBackground) return;
    try {
      await this.service.removeUserBackground();
      this.onStatus(`Background reset to ${this.service.currentTheme.name} default`);
      this.syncBackground();
    } catch (error: unknown) {
      this.fail(error);
    }
  }

  private async importArtworkFile(): Promise<void> {
    const input = this.els.artworkFile as HTMLInputElement | undefined;
    const file = input?.files?.[0];
    if (!file) return;
    try {
      if (file.size > MAX_USER_ARTWORK_BYTES) throw new Error(`Artwork is too large. Maximum is ${Math.round(MAX_USER_ARTWORK_BYTES / 1024 / 1024)} MB.`);
      const previousFit = this.service.currentUserArtwork?.fit || 'cover';
      const info = await this.service.setUserArtwork(file, file.name, previousFit);
      this.onStatus(`${info.mimeType === 'image/gif' ? 'Animated GIF' : 'Artwork'} loaded for ${this.service.currentTheme.name}`);
      this.syncArtwork();
    } catch (error: unknown) {
      this.fail(error);
    } finally {
      if (input) input.value = '';
    }
  }

  private async removeArtwork(): Promise<void> {
    if (!this.service.currentUserArtwork) return;
    try {
      await this.service.removeUserArtwork();
      this.onStatus(`Artwork reset to ${this.service.currentTheme.name} default`);
      this.syncArtwork();
    } catch (error: unknown) {
      this.fail(error);
    }
  }

  private renderCustomThemes(): void {
    const host = this.els.appearanceCustomThemeOptions as HTMLElement | undefined;
    if (!host) return;
    host.replaceChildren();
    const themes = this.service.listCustomThemes();
    if (this.els.noCustomThemeHint) this.els.noCustomThemeHint.hidden = themes.length > 0;
    const current = this.service.currentState;

    for (const theme of themes) host.append(this.customThemeButton(theme, theme.id === current.themeId));
  }

  private customThemeButton(theme: ThemeDefinition, active: boolean): HTMLButtonElement {
    const resolved = this.service.resolveTheme(theme.id);
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.customThemeId = theme.id;
    button.setAttribute('aria-pressed', String(active));
    button.classList.toggle('active', active);

    const preview = document.createElement('span');
    preview.className = 'theme-preview theme-preview-custom';
    preview.setAttribute('aria-hidden', 'true');
    preview.style.setProperty('--custom-theme-bg', resolved.tokens.colors.surface);
    preview.style.setProperty('--custom-theme-accent', resolved.tokens.colors.accent);
    preview.style.setProperty('--custom-theme-alt', resolved.tokens.colors.accentAlt);
    preview.style.setProperty('--custom-theme-curve', resolved.tokens.eq.curve);
    preview.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));

    const copy = document.createElement('span');
    copy.className = 'theme-choice-copy';
    const heading = document.createElement('span');
    heading.className = 'theme-choice-heading';
    const name = document.createElement('strong');
    name.textContent = theme.name;
    const badge = document.createElement('em');
    badge.textContent = 'Custom';
    heading.append(name, badge);
    const meta = document.createElement('small');
    const layout = theme.preferredLayout || resolved.preferredLayout || 'rice';
    meta.textContent = `${theme.author ? `by ${theme.author} · ` : ''}${layout} layout`;
    copy.append(heading, meta);

    const check = document.createElement('span');
    check.className = 'theme-choice-check';
    check.setAttribute('aria-hidden', 'true');
    check.textContent = '✓';
    button.append(preview, copy, check);
    return button;
  }

  private async importSelectedFile(): Promise<void> {
    const input = this.els.themeImportFile as HTMLInputElement | undefined;
    const file = input?.files?.[0];
    if (!file) return;
    try {
      if (file.size > MAX_THEME_IMPORT_BYTES) throw new Error(`Theme file is too large. Maximum is ${Math.round(MAX_THEME_IMPORT_BYTES / 1024)} KB.`);
      const parsed = JSON.parse(await file.text()) as unknown;
      const raw = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (parsed as Record<string, unknown>).format === 'KopelaEQ Theme'
        ? (parsed as Record<string, unknown>).theme
        : parsed;
      const id = raw && typeof raw === 'object' && !Array.isArray(raw) ? String((raw as Record<string, unknown>).id || '') : '';
      const replace = Boolean(id && this.service.isCustomTheme(id) && confirm(`Replace the existing custom theme "${id}"?`));
      if (id && this.service.isCustomTheme(id) && !replace) return;
      const imported = await this.service.importTheme(parsed, replace);
      await this.service.set(imported.id, imported.preferredLayout);
      this.onStatus(`Theme imported: ${imported.name}`);
      this.sync();
    } catch (error: unknown) {
      this.fail(error);
    } finally {
      if (input) input.value = '';
    }
  }

  private async removeCurrentCustomTheme(): Promise<void> {
    const themeId = this.service.currentState.themeId;
    if (!this.service.isCustomTheme(themeId)) return;
    const theme = this.service.listCustomThemes().find((item) => item.id === themeId);
    if (!confirm(`Remove custom theme "${theme?.name || themeId}"?`)) return;
    try {
      await this.service.removeCustomTheme(themeId);
      this.onStatus('Custom theme removed');
      this.sync();
    } catch (error: unknown) {
      this.fail(error);
    }
  }

  private fail(error: unknown): void {
    this.onError(error instanceof Error ? error.message : String(error));
  }
}
