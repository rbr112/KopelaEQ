import { STORAGE } from '../../shared/constants.js';
import { settleBounded, type BoundedResult } from '../../shared/bounded.js';
import { LatestWinsWriter } from '../../shared/latest-wins.js';
import { ThemeRegistry, BUILTIN_THEME_IDS } from './theme-registry.js';
import { APPEARANCE_SCHEMA_VERSION, type AppearanceState, type EffectiveSurfaceAppearance, type EqAppearance, type LayoutId, type ResolvedTheme, type SurfaceAppearanceOverride, type ThemeDefinition } from './theme-types.js';
import { applySurfaceOverrideToTheme, clampNumber, clampSurfaceOpacity, isSurfaceHexColor, normalizeSurfaceOverride, resolvedSurfaceDefaults } from './appearance-surface.js';
import { resolveArtworkAsset } from './artwork-assets.js';
import type { ArtworkStore, BackgroundStore, UserArtworkFit, UserArtworkInfo, UserArtworkRecord } from './artwork-store.js';

const APPEARANCE_CACHE_KEY = 'kopelaeq.appearance-cache.v1';
const PRELOADED_RICE_ARTWORK_URL = 'artwork/rice-preloaded-user.jpg';
const PRELOADED_RICE_ARTWORK_SIZE = 61553;
export const MAX_CUSTOM_THEMES = 20;
export const MAX_THEME_IMPORT_BYTES = 64 * 1024;

const APPEARANCE_STORAGE_TIMEOUT_MS = 280;
const BACKGROUND_HINT_SUFFIX = '::background';

type IdleCallbackHandle = number;
type MediaJournalKind = 'artwork' | 'background';
interface MediaJournalEntry {
  operation: 'put' | 'remove';
  themeId: string;
  hintKey: string;
  previousHint?: string;
  nextHint: string;
  filename?: string;
  size?: number;
  fit?: UserArtworkFit;
}

function backgroundHintKey(themeId: string): string { return `${themeId}${BACKGROUND_HINT_SUFFIX}`; }

function customMediaHint(fit: UserArtworkFit): string { return fit === 'contain' ? 'custom-contain' : 'custom-cover'; }
function hintIsCustom(value: unknown): boolean { return String(value || '').startsWith('custom'); }
function fitFromHint(value: unknown, fallback: UserArtworkFit): UserArtworkFit {
  const source = String(value || '');
  if (source.endsWith('-contain')) return 'contain';
  if (source.endsWith('-cover')) return 'cover';
  return fallback;
}

async function storageGetBounded(keys: readonly string[], timeoutMs = APPEARANCE_STORAGE_TIMEOUT_MS): Promise<BoundedResult<Record<string, unknown>>> {
  return settleBounded(chrome.storage.local.get([...keys]) as Promise<Record<string, unknown>>, timeoutMs);
}

function storageUnavailableMessage(label: string): Error {
  return new Error(`${label} storage is still busy. Try again in a moment.`);
}

const DEFAULT_STATE: AppearanceState = Object.freeze({
  schemaVersion: APPEARANCE_SCHEMA_VERSION,
  themeId: BUILTIN_THEME_IDS.RICE,
  layoutId: 'rice'
});

function normalizeLayout(value: unknown, fallback: LayoutId): LayoutId {
  return value === 'rice' || value === 'nocturne' || value === 'classic' ? value : fallback;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function unwrapThemePayload(value: unknown): unknown {
  const root = record(value);
  if (root?.format === 'KopelaEQ Theme' && root.theme !== undefined) return root.theme;
  return value;
}


export class AppearanceService extends EventTarget {
  private state: AppearanceState = { ...DEFAULT_STATE };
  private resolved: ResolvedTheme;
  private mediaStoresPromise: Promise<{ artworkStore: ArtworkStore; backgroundStore: BackgroundStore }> | null = null;
  private userArtwork: UserArtworkRecord | null = null;
  private userArtworkUrl: string | null = null;
  private userBackground: UserArtworkRecord | null = null;
  private userBackgroundUrl: string | null = null;
  private mediaHints: Record<string, string> = {};
  private preloadedArtworkActive = false;
  private surfaceOverrides: Record<string, SurfaceAppearanceOverride> = {};
  private mediaRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private mediaRefreshIdleId: IdleCallbackHandle | null = null;
  private mediaRefreshGeneration = 0;
  private artworkMutation: Promise<unknown> = Promise.resolve();
  private backgroundMutation: Promise<unknown> = Promise.resolve();
  private customThemesLoaded = false;
  private customThemesAuthoritative = false;
  private surfaceOverridesAuthoritative = false;
  private mediaHintsAuthoritative = false;
  private mediaHintsWrite: Promise<void> = Promise.resolve();
  private appearanceRevision = 0;
  private readonly appearanceWriter = new LatestWinsWriter<AppearanceState>(async ({ value }) => {
    await chrome.storage.local.set({ [STORAGE.APPEARANCE]: value });
  });

  constructor(private readonly registry = new ThemeRegistry()) {
    super();
    this.resolved = registry.resolve(DEFAULT_STATE.themeId);
  }

  get currentState(): AppearanceState { return { ...this.state }; }
  get currentTheme(): ResolvedTheme { return this.resolved; }
  get currentUserArtwork(): UserArtworkInfo | null {
    if (this.userArtwork) {
      const { blob: _blob, ...info } = this.userArtwork;
      return { ...info };
    }
    if (this.preloadedArtworkActive && this.state.themeId === BUILTIN_THEME_IDS.RICE) {
      return {
        themeId: BUILTIN_THEME_IDS.RICE,
        filename: 'rice-preloaded-user.jpg',
        mimeType: 'image/jpeg',
        size: PRELOADED_RICE_ARTWORK_SIZE,
        fit: this.mediaHints[BUILTIN_THEME_IDS.RICE] === 'preloaded-contain' ? 'contain' : 'cover',
        updatedAt: 0
      };
    }
    return null;
  }
  get currentUserBackground(): UserArtworkInfo | null {
    if (!this.userBackground) return null;
    const { blob: _blob, ...info } = this.userBackground;
    return { ...info };
  }
  get currentSurfaceAppearance(): EffectiveSurfaceAppearance {
    const override = this.surfaceOverrides[this.state.themeId] || {};
    const defaults = resolvedSurfaceDefaults(this.resolved);
    return {
      mainColor: override.mainColor || defaults.mainColor,
      mainOpacity: clampSurfaceOpacity(override.mainOpacity, defaults.mainOpacity, .10),
      eqColor: override.eqColor || defaults.eqColor,
      eqOpacity: clampSurfaceOpacity(override.eqOpacity, defaults.eqOpacity),
      cardsColor: override.cardsColor || defaults.cardsColor,
      cardsOpacity: clampSurfaceOpacity(override.cardsOpacity, defaults.cardsOpacity),
      toolsColor: override.toolsColor || defaults.toolsColor,
      toolsOpacity: clampSurfaceOpacity(override.toolsOpacity, defaults.toolsOpacity, .10),
      controlsColor: override.controlsColor || defaults.controlsColor,
      controlsOpacity: clampSurfaceOpacity(override.controlsOpacity, defaults.controlsOpacity),
      borderColor: override.borderColor || defaults.borderColor,
      borderOpacity: clampSurfaceOpacity(override.borderOpacity, defaults.borderOpacity),
      accentColor: override.accentColor || defaults.accentColor,
      accentAltColor: override.accentAltColor || defaults.accentAltColor,
      positiveColor: override.positiveColor || defaults.positiveColor,
      dangerColor: override.dangerColor || defaults.dangerColor,
      eqCurveColor: override.eqCurveColor || defaults.eqCurveColor,
      textColor: override.textColor || defaults.textColor,
      mutedTextColor: override.mutedTextColor || defaults.mutedTextColor,
      shadowStrength: clampNumber(override.shadowStrength, defaults.shadowStrength, 0, 1),
      blur: clampNumber(override.blur, defaults.blur, 0, 30),
      windowRadius: clampNumber(override.windowRadius, defaults.windowRadius, 0, 32),
      panelRadius: clampNumber(override.panelRadius, defaults.panelRadius, 0, 32),
      controlRadius: clampNumber(override.controlRadius, defaults.controlRadius, 0, 32),
      backgroundDim: clampNumber(override.backgroundDim, defaults.backgroundDim, 0, 1),
      customized: Boolean(this.surfaceOverrides[this.state.themeId] && Object.keys(this.surfaceOverrides[this.state.themeId]).length)
    };
  }
  get currentEqAppearance(): EqAppearance {
    const surface = this.currentSurfaceAppearance;
    const eq = this.resolved.tokens.eq;
    return {
      ...eq,
      background: surface.eqColor,
      surfaceOpacity: surface.eqOpacity,
      label: surface.mutedTextColor,
      labelStrong: surface.textColor,
      spectrumLabel: surface.mutedTextColor,
      curve: surface.eqCurveColor,
      pointSelected: surface.accentColor,
      selectedRing: surface.accentColor,
      totalPoint: surface.accentColor
    };
  }

  private getMediaStores(): Promise<{ artworkStore: ArtworkStore; backgroundStore: BackgroundStore }> {
    if (!this.mediaStoresPromise) {
      const qaCtors = (globalThis as typeof globalThis & { __KopelaMediaStoreCtors?: unknown }).__KopelaMediaStoreCtors as { ArtworkStore: new () => ArtworkStore; BackgroundStore: new () => BackgroundStore } | undefined;
      const load = qaCtors ? Promise.resolve(qaCtors) : import('./artwork-store.js');
      this.mediaStoresPromise = load.then(({ ArtworkStore, BackgroundStore }) => ({
        artworkStore: new ArtworkStore(),
        backgroundStore: new BackgroundStore()
      })).catch((error) => {
        this.mediaStoresPromise = null;
        throw error;
      });
    }
    return this.mediaStoresPromise;
  }


  private enqueueArtworkMutation<T>(task: () => Promise<T>): Promise<T> {
    const run = this.artworkMutation.then(task, task);
    this.artworkMutation = run.then(() => undefined, () => undefined);
    return run;
  }

  private enqueueBackgroundMutation<T>(task: () => Promise<T>): Promise<T> {
    const run = this.backgroundMutation.then(task, task);
    this.backgroundMutation = run.then(() => undefined, () => undefined);
    return run;
  }

  private persistAppearanceState(): { revision: number; done: Promise<void> } {
    const revision = ++this.appearanceRevision;
    const snapshot = structuredClone(this.state);
    return { revision, done: this.appearanceWriter.submit({ revision, value: snapshot }) };
  }

  private mediaJournalStorageKey(kind: MediaJournalKind): string {
    return kind === 'artwork' ? STORAGE.MEDIA_ARTWORK_JOURNAL : STORAGE.MEDIA_BACKGROUND_JOURNAL;
  }

  private async writeMediaJournal(kind: MediaJournalKind, entry: MediaJournalEntry): Promise<void> {
    await chrome.storage.local.set({ [this.mediaJournalStorageKey(kind)]: entry });
  }

  private async clearMediaJournal(kind: MediaJournalKind): Promise<void> {
    await chrome.storage.local.set({ [this.mediaJournalStorageKey(kind)]: null });
  }

  private parseMediaJournal(value: unknown): MediaJournalEntry | null {
    const source = record(value);
    if (!source || (source.operation !== 'put' && source.operation !== 'remove')) return null;
    if (typeof source.themeId !== 'string' || typeof source.hintKey !== 'string' || typeof source.nextHint !== 'string') return null;
    return {
      operation: source.operation,
      themeId: source.themeId,
      hintKey: source.hintKey,
      previousHint: typeof source.previousHint === 'string' ? source.previousHint : undefined,
      nextHint: source.nextHint,
      filename: typeof source.filename === 'string' ? source.filename : undefined,
      size: Number.isFinite(Number(source.size)) ? Number(source.size) : undefined,
      fit: source.fit === 'contain' ? 'contain' : source.fit === 'cover' ? 'cover' : undefined
    };
  }

  private mediaRecordMatchesJournal(media: UserArtworkRecord | null, journal: MediaJournalEntry): boolean {
    if (!media || journal.operation !== 'put') return false;
    return media.themeId === journal.themeId
      && (journal.filename === undefined || media.filename === journal.filename)
      && (journal.size === undefined || media.size === journal.size)
      && (journal.fit === undefined || media.fit === journal.fit);
  }

  private async recoverMediaJournal(kind: MediaJournalKind, raw: unknown): Promise<void> {
    const journal = this.parseMediaJournal(raw);
    if (!journal) return;
    const stores = await this.getMediaStores();
    const store = kind === 'artwork' ? stores.artworkStore : stores.backgroundStore;
    const media = await store.get(journal.themeId);
    if (journal.operation === 'put') {
      if (this.mediaRecordMatchesJournal(media, journal)) this.mediaHints[journal.hintKey] = journal.nextHint;
      else if (journal.previousHint === undefined) delete this.mediaHints[journal.hintKey];
      else this.mediaHints[journal.hintKey] = journal.previousHint;
    } else if (!media) {
      this.mediaHints[journal.hintKey] = journal.nextHint;
    } else if (journal.previousHint === undefined) {
      delete this.mediaHints[journal.hintKey];
    } else {
      this.mediaHints[journal.hintKey] = journal.previousHint;
    }
    await this.persistMediaHints();
    await this.clearMediaJournal(kind);
  }

  private async writeMediaHint(key: string, value: string | undefined): Promise<string | undefined> {
    await this.ensureMediaHintsAuthoritative();
    const previous = this.mediaHints[key];
    if (value === undefined) delete this.mediaHints[key]; else this.mediaHints[key] = value;
    try {
      await this.persistMediaHints();
    } catch (error) {
      if (previous === undefined) delete this.mediaHints[key]; else this.mediaHints[key] = previous;
      throw error;
    }
    return previous;
  }

  private cancelDeferredMediaRefresh(): void {
    this.mediaRefreshGeneration += 1;
    if (this.mediaRefreshTimer !== null) {
      clearTimeout(this.mediaRefreshTimer);
      this.mediaRefreshTimer = null;
    }
    if (this.mediaRefreshIdleId !== null) {
      const cancelIdle = (globalThis as typeof globalThis & { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback;
      if (typeof cancelIdle === 'function') cancelIdle(this.mediaRefreshIdleId);
      this.mediaRefreshIdleId = null;
    }
  }

  async ensureCustomThemesLoaded(): Promise<void> {
    if (this.customThemesLoaded && this.customThemesAuthoritative) return;
    const stored = await storageGetBounded([STORAGE.CUSTOM_THEMES], 1500);
    if (stored.status !== 'ok') throw storageUnavailableMessage('Custom theme');
    await this.loadStoredCustomThemes(stored.value[STORAGE.CUSTOM_THEMES]);
    this.customThemesLoaded = true;
    this.customThemesAuthoritative = true;
  }

  private async ensureSurfaceOverridesAuthoritative(): Promise<void> {
    if (this.surfaceOverridesAuthoritative) return;
    const stored = await storageGetBounded([STORAGE.SURFACE_OVERRIDES], 1500);
    if (stored.status !== 'ok') throw storageUnavailableMessage('Appearance override');
    const pending = structuredClone(this.surfaceOverrides);
    this.surfaceOverrides = {};
    this.loadStoredSurfaceOverrides(stored.value[STORAGE.SURFACE_OVERRIDES]);
    this.surfaceOverrides = { ...this.surfaceOverrides, ...pending };
    this.surfaceOverridesAuthoritative = true;
  }

  private async ensureMediaHintsAuthoritative(): Promise<void> {
    if (this.mediaHintsAuthoritative) return;
    const stored = await storageGetBounded([STORAGE.MEDIA_HINTS], 1500);
    if (stored.status !== 'ok') throw storageUnavailableMessage('Media metadata');
    const authoritative = record(stored.value[STORAGE.MEDIA_HINTS]) as Record<string, string> || {};
    // No media mutations are allowed before this method succeeds, so storage
    // remains the source of truth when startup had to fall back.
    this.mediaHints = { ...authoritative };
    this.mediaHintsAuthoritative = true;
    this.syncPreloadedArtworkHint();
  }

  listThemes(): ThemeDefinition[] { return this.registry.list().map((theme) => ({ ...theme, tokens: structuredClone(theme.tokens) })); }
  listCustomThemes(): ThemeDefinition[] { return this.registry.listCustom().map((theme) => ({ ...theme, tokens: structuredClone(theme.tokens) })); }
  hasTheme(id: string): boolean { return Boolean(this.registry.get(id)); }
  isCustomTheme(id: string): boolean { return Boolean(this.registry.get(id) && !this.registry.isBuiltin(id)); }
  resolveTheme(id: string): ResolvedTheme { return this.registry.resolve(id); }

  async load(): Promise<void> {
    // A bounded read may time out, but timeout is uncertainty, NOT an empty
    // storage record. Never repair or persist from fallback data.
    const storedResult = await storageGetBounded([STORAGE.APPEARANCE, STORAGE.SURFACE_OVERRIDES, STORAGE.MEDIA_HINTS, STORAGE.MEDIA_ARTWORK_JOURNAL, STORAGE.MEDIA_BACKGROUND_JOURNAL]);
    const startupAuthoritative = storedResult.status === 'ok';
    const stored = startupAuthoritative ? storedResult.value : {};

    if (startupAuthoritative) {
      this.loadStoredSurfaceOverrides(stored[STORAGE.SURFACE_OVERRIDES]);
      this.surfaceOverridesAuthoritative = true;
      this.mediaHints = record(stored[STORAGE.MEDIA_HINTS]) as Record<string, string> || {};
      this.mediaHintsAuthoritative = true;
      await this.recoverMediaJournal('artwork', stored[STORAGE.MEDIA_ARTWORK_JOURNAL]);
      await this.recoverMediaJournal('background', stored[STORAGE.MEDIA_BACKGROUND_JOURNAL]);
    }

    const raw = stored[STORAGE.APPEARANCE];
    const appearance = record(raw) || {};
    const storedThemeId = typeof appearance.themeId === 'string' ? appearance.themeId : '';
    let requestedThemeId = storedThemeId || DEFAULT_STATE.themeId;
    let selectionRecoveryAuthoritative = startupAuthoritative;

    // Only an actually-selected custom theme pays the validation/library cost at
    // startup. If that library read times out, use Rice for this popup only and
    // preserve the user's stored selection for the next successful read.
    if (storedThemeId && !this.registry.get(storedThemeId)) {
      try {
        await this.ensureCustomThemesLoaded();
      } catch (error) {
        selectionRecoveryAuthoritative = false;
        console.warn('KopelaEQ custom theme storage unavailable:', error);
      }
      if (!this.registry.get(storedThemeId)) requestedThemeId = DEFAULT_STATE.themeId;
    }

    try {
      this.resolved = this.registry.resolve(requestedThemeId);
    } catch (error) {
      console.warn('KopelaEQ appearance fallback to Rice:', error);
      this.resolved = this.registry.resolve(DEFAULT_STATE.themeId);
    }

    const recoveredTheme = Boolean(storedThemeId && storedThemeId !== this.resolved.id);
    this.state = {
      schemaVersion: APPEARANCE_SCHEMA_VERSION,
      themeId: this.resolved.id,
      layoutId: recoveredTheme
        ? (this.resolved.preferredLayout || DEFAULT_STATE.layoutId)
        : normalizeLayout(appearance.layoutId, this.resolved.preferredLayout || DEFAULT_STATE.layoutId)
    };
    this.syncPreloadedArtworkHint();
    this.apply();
    this.cacheForNextOpen();
    // User media may be several MB. Only schedule IndexedDB work when media
    // hints were read authoritatively; an uncertain empty map must never be
    // normalized back to "none".
    if (this.mediaHintsAuthoritative) this.deferUserMediaRefresh(true);

    // Repair only a definitively stale selection. A timeout/error is not proof
    // that a custom theme is missing and must never overwrite user storage.
    if (recoveredTheme && selectionRecoveryAuthoritative) {
      try { await this.persistAppearanceState().done; } catch { /* non-fatal */ }
    }
  }

  async set(themeId: string, layoutId?: LayoutId): Promise<void> {
    if (!this.registry.get(themeId)) await this.ensureCustomThemesLoaded();
    if (!this.registry.get(themeId)) throw new Error(`Unknown theme: ${themeId}`);
    const resolved = this.registry.resolve(themeId);
    this.cancelDeferredMediaRefresh();
    this.clearUserArtwork();
    this.clearUserBackground();
    this.resolved = resolved;
    this.state = {
      schemaVersion: APPEARANCE_SCHEMA_VERSION,
      themeId: resolved.id,
      layoutId: layoutId || resolved.preferredLayout || this.state.layoutId
    };
    this.syncPreloadedArtworkHint();
    this.apply();
    this.cacheForNextOpen();
    const write = this.persistAppearanceState();
    await write.done;
    if (write.revision !== this.appearanceRevision || this.state.themeId !== resolved.id) return;
    this.dispatchEvent(new CustomEvent('change', { detail: this.currentState }));
    if (this.mediaHintsAuthoritative) this.deferUserMediaRefresh(true);
    else void this.ensureMediaHintsAuthoritative().then(() => {
      if (write.revision === this.appearanceRevision && this.state.themeId === resolved.id) { this.syncPreloadedArtworkHint(); this.apply(); this.deferUserMediaRefresh(true); }
    }).catch(() => undefined);
  }

  async setUserArtwork(blob: Blob, filename: string, fit: UserArtworkFit = 'cover'): Promise<UserArtworkInfo> {
    const themeId = this.state.themeId;
    return this.enqueueArtworkMutation(async () => {
      await this.ensureMediaHintsAuthoritative();
      const hintKey = themeId;
      const previousHint = this.mediaHints[hintKey];
      const cleanFilename = String(filename || 'image').slice(0, 160);
      const journal: MediaJournalEntry = {
        operation: 'put', themeId, hintKey, previousHint, nextHint: customMediaHint(fit),
        filename: cleanFilename, size: blob.size, fit
      };
      await this.writeMediaJournal('artwork', journal);
      const { artworkStore } = await this.getMediaStores();
      const stored = await artworkStore.put(themeId, blob, cleanFilename, fit);
      await this.writeMediaHint(hintKey, journal.nextHint);
      await this.clearMediaJournal('artwork');
      const info: UserArtworkInfo = (({ blob: _blob, ...rest }) => rest)(stored);
      if (themeId !== this.state.themeId) return info;
      this.preloadedArtworkActive = false;
      this.installUserArtwork(stored);
      this.apply();
      this.dispatchEvent(new CustomEvent('artworkchange', { detail: info }));
      return info;
    });
  }


  async setUserArtworkFit(fit: UserArtworkFit): Promise<void> {
    const themeId = this.state.themeId;
    await this.enqueueArtworkMutation(async () => {
      await this.ensureMediaHintsAuthoritative();
      if (this.preloadedArtworkActive && !this.userArtwork && themeId === BUILTIN_THEME_IDS.RICE && themeId === this.state.themeId) {
        await this.writeMediaHint(themeId, fit === 'contain' ? 'preloaded-contain' : 'preloaded-cover');
        if (themeId !== this.state.themeId) return;
        this.apply();
        this.dispatchEvent(new CustomEvent('artworkchange', { detail: this.currentUserArtwork }));
        return;
      }
      if (!this.userArtwork || this.userArtwork.themeId !== themeId) return;
      await this.writeMediaHint(themeId, customMediaHint(fit));
      if (themeId !== this.state.themeId) return;
      this.userArtwork = { ...this.userArtwork, fit };
      this.apply();
      this.dispatchEvent(new CustomEvent('artworkchange', { detail: this.currentUserArtwork }));
    });
  }

  async removeUserArtwork(): Promise<void> {
    const themeId = this.state.themeId;
    await this.enqueueArtworkMutation(async () => {
      await this.ensureMediaHintsAuthoritative();
      const hintKey = themeId;
      const journal: MediaJournalEntry = { operation: 'remove', themeId, hintKey, previousHint: this.mediaHints[hintKey], nextHint: 'none' };
      await this.writeMediaJournal('artwork', journal);
      const { artworkStore } = await this.getMediaStores();
      await artworkStore.remove(themeId);
      await this.writeMediaHint(hintKey, 'none');
      await this.clearMediaJournal('artwork');
      if (themeId !== this.state.themeId) return;
      this.preloadedArtworkActive = false;
      this.clearUserArtwork();
      this.apply();
      this.dispatchEvent(new CustomEvent('artworkchange', { detail: null }));
    });
  }


  async setUserBackground(blob: Blob, filename: string, fit: UserArtworkFit = 'cover'): Promise<UserArtworkInfo> {
    const themeId = this.state.themeId;
    return this.enqueueBackgroundMutation(async () => {
      await this.ensureMediaHintsAuthoritative();
      const hintKey = backgroundHintKey(themeId);
      const previousHint = this.mediaHints[hintKey];
      const cleanFilename = String(filename || 'image').slice(0, 160);
      const journal: MediaJournalEntry = {
        operation: 'put', themeId, hintKey, previousHint, nextHint: customMediaHint(fit),
        filename: cleanFilename, size: blob.size, fit
      };
      await this.writeMediaJournal('background', journal);
      const { backgroundStore } = await this.getMediaStores();
      const stored = await backgroundStore.put(themeId, blob, cleanFilename, fit);
      await this.writeMediaHint(hintKey, journal.nextHint);
      await this.clearMediaJournal('background');
      const info: UserArtworkInfo = (({ blob: _blob, ...rest }) => rest)(stored);
      if (themeId !== this.state.themeId) return info;
      this.installUserBackground(stored);
      this.apply();
      this.dispatchEvent(new CustomEvent('backgroundchange', { detail: info }));
      return info;
    });
  }


  async setUserBackgroundFit(fit: UserArtworkFit): Promise<void> {
    const themeId = this.state.themeId;
    await this.enqueueBackgroundMutation(async () => {
      await this.ensureMediaHintsAuthoritative();
      if (!this.userBackground || this.userBackground.themeId !== themeId) return;
      await this.writeMediaHint(backgroundHintKey(themeId), customMediaHint(fit));
      if (themeId !== this.state.themeId) return;
      this.userBackground = { ...this.userBackground, fit };
      this.apply();
      this.dispatchEvent(new CustomEvent('backgroundchange', { detail: this.currentUserBackground }));
    });
  }

  async removeUserBackground(): Promise<void> {
    const themeId = this.state.themeId;
    await this.enqueueBackgroundMutation(async () => {
      await this.ensureMediaHintsAuthoritative();
      const hintKey = backgroundHintKey(themeId);
      const journal: MediaJournalEntry = { operation: 'remove', themeId, hintKey, previousHint: this.mediaHints[hintKey], nextHint: 'none' };
      await this.writeMediaJournal('background', journal);
      const { backgroundStore } = await this.getMediaStores();
      await backgroundStore.remove(themeId);
      await this.writeMediaHint(hintKey, 'none');
      await this.clearMediaJournal('background');
      if (themeId !== this.state.themeId) return;
      this.clearUserBackground();
      this.apply();
      this.dispatchEvent(new CustomEvent('backgroundchange', { detail: null }));
    });
  }


  previewSurfaceAppearance(patch: SurfaceAppearanceOverride): EffectiveSurfaceAppearance {
    const current = this.surfaceOverrides[this.state.themeId] || {};
    const next: SurfaceAppearanceOverride = { ...current };
    const colorKeys = ['mainColor','eqColor','cardsColor','toolsColor','controlsColor','borderColor','accentColor','accentAltColor','positiveColor','dangerColor','eqCurveColor','textColor','mutedTextColor'] as const;
    for (const key of colorKeys) {
      const value = patch[key];
      if (value === undefined) continue;
      if (!isSurfaceHexColor(value)) throw new Error(`${key} must be a #RRGGBB color.`);
      next[key] = value.toLowerCase();
    }
    const defaults = resolvedSurfaceDefaults(this.resolved);
    const opacityKeys = ['mainOpacity','eqOpacity','cardsOpacity','toolsOpacity','controlsOpacity','borderOpacity'] as const;
    for (const key of opacityKeys) {
      const value = patch[key];
      if (value === undefined) continue;
      const min = key === 'mainOpacity' || key === 'toolsOpacity' ? .10 : 0;
      next[key] = clampSurfaceOpacity(value, defaults[key], min);
    }
    if (patch.shadowStrength !== undefined) next.shadowStrength = clampNumber(patch.shadowStrength, defaults.shadowStrength, 0, 1);
    if (patch.blur !== undefined) next.blur = clampNumber(patch.blur, defaults.blur, 0, 30);
    if (patch.windowRadius !== undefined) next.windowRadius = clampNumber(patch.windowRadius, defaults.windowRadius, 0, 32);
    if (patch.panelRadius !== undefined) next.panelRadius = clampNumber(patch.panelRadius, defaults.panelRadius, 0, 32);
    if (patch.controlRadius !== undefined) next.controlRadius = clampNumber(patch.controlRadius, defaults.controlRadius, 0, 32);
    if (patch.backgroundDim !== undefined) next.backgroundDim = clampNumber(patch.backgroundDim, defaults.backgroundDim, 0, 1);
    this.surfaceOverrides[this.state.themeId] = next;
    this.applySurfaceCssVars(patch);
    const effective = this.currentSurfaceAppearance;
    this.dispatchEvent(new CustomEvent('surfacepreview', { detail: { appearance: effective, keys: Object.keys(patch) } }));
    return effective;
  }

  async commitSurfaceAppearance(): Promise<void> {
    await this.ensureSurfaceOverridesAuthoritative();
    await this.persistSurfaceOverrides();
    this.dispatchEvent(new CustomEvent('surfacechange', { detail: this.currentSurfaceAppearance }));
  }

  async setSurfaceAppearance(patch: SurfaceAppearanceOverride, persist = true): Promise<void> {
    this.previewSurfaceAppearance(patch);
    if (persist) await this.commitSurfaceAppearance();
  }

  async resetSurfaceAppearance(): Promise<void> {
    await this.ensureSurfaceOverridesAuthoritative();
    delete this.surfaceOverrides[this.state.themeId];
    this.apply();
    await this.persistSurfaceOverrides();
    this.dispatchEvent(new CustomEvent('surfacechange', { detail: this.currentSurfaceAppearance }));
  }

  exportCustomTheme(id = this.state.themeId): { format: 'KopelaEQ Theme'; theme: ThemeDefinition } {
    const source = this.registry.get(id);
    if (!source || source.builtin) throw new Error('Only imported themes can be exported.');
    const theme: ThemeDefinition = { ...source, tokens: structuredClone(source.tokens), builtin: undefined };
    applySurfaceOverrideToTheme(theme, this.surfaceOverrides[id]);
    return { format: 'KopelaEQ Theme', theme };
  }

  exportCurrentLook(): { format: 'KopelaEQ Theme'; theme: ThemeDefinition } {
    const current = this.currentSurfaceAppearance;
    const theme: ThemeDefinition = {
      schemaVersion: APPEARANCE_SCHEMA_VERSION,
      id: `user.${this.state.layoutId}-look`,
      name: `${this.resolved.name} Custom Look`,
      author: 'KopelaEQ user',
      preferredLayout: this.state.layoutId,
      tokens: structuredClone(this.resolved.tokens)
    };
    // Resolved tokens are complete, so the exported file is standalone and does
    // not depend on another user theme being installed first.
    applySurfaceOverrideToTheme(theme, {
      mainColor: current.mainColor, mainOpacity: current.mainOpacity,
      eqColor: current.eqColor, eqOpacity: current.eqOpacity,
      cardsColor: current.cardsColor, cardsOpacity: current.cardsOpacity,
      toolsColor: current.toolsColor, toolsOpacity: current.toolsOpacity,
      controlsColor: current.controlsColor, controlsOpacity: current.controlsOpacity,
      borderColor: current.borderColor, borderOpacity: current.borderOpacity,
      accentColor: current.accentColor, accentAltColor: current.accentAltColor, positiveColor: current.positiveColor, dangerColor: current.dangerColor, eqCurveColor: current.eqCurveColor, textColor: current.textColor, mutedTextColor: current.mutedTextColor,
      shadowStrength: current.shadowStrength, blur: current.blur,
      windowRadius: current.windowRadius, panelRadius: current.panelRadius, controlRadius: current.controlRadius,
      backgroundDim: current.backgroundDim
    });
    return { format: 'KopelaEQ Theme', theme };
  }


  recoverToRice(): void {
    this.cancelDeferredMediaRefresh();
    this.clearUserArtwork();
    this.clearUserBackground();
    this.resolved = this.registry.resolve(BUILTIN_THEME_IDS.RICE);
    this.state = { schemaVersion: APPEARANCE_SCHEMA_VERSION, themeId: BUILTIN_THEME_IDS.RICE, layoutId: 'rice' };
    this.syncPreloadedArtworkHint();
    this.apply();
    this.cacheForNextOpen();
  }

  async importTheme(value: unknown, replace = false): Promise<ThemeDefinition> {
    await this.ensureCustomThemesLoaded();
    const qaValidator = (globalThis as typeof globalThis & { __KopelaThemeValidator?: unknown }).__KopelaThemeValidator as ((value: unknown) => ThemeDefinition) | undefined;
    const validate = qaValidator || (await import('./theme-validator.js')).validateThemeDefinition;
    const theme = validate(unwrapThemePayload(value));
    const assetId = theme.tokens.artwork?.assetId;
    if (assetId && !resolveArtworkAsset(assetId)) throw new Error(`Unknown packaged artwork asset: ${assetId}`);
    const existing = this.registry.get(theme.id);
    if (existing?.builtin) throw new Error('Built-in theme ids cannot be replaced.');
    if (existing && !replace) throw new Error(`Theme "${theme.name}" already exists.`);
    if (!existing && this.registry.listCustom().length >= MAX_CUSTOM_THEMES) throw new Error(`Custom theme limit reached (${MAX_CUSTOM_THEMES}).`);
    if (theme.extends && !this.registry.get(theme.extends)) throw new Error(`Theme extends unknown base: ${theme.extends}`);

    const storedTheme = this.registry.register(theme, replace);
    await this.persistCustomThemes();
    this.dispatchEvent(new CustomEvent('themeschange', { detail: this.listCustomThemes() }));

    if (this.state.themeId === storedTheme.id) {
      this.resolved = this.registry.resolve(storedTheme.id);
      this.state.layoutId = storedTheme.preferredLayout || this.state.layoutId;
      this.apply();
      this.cacheForNextOpen();
      const write = this.persistAppearanceState();
      await write.done;
      if (write.revision === this.appearanceRevision && this.state.themeId === storedTheme.id) this.dispatchEvent(new CustomEvent('change', { detail: this.currentState }));
    }
    return { ...storedTheme, tokens: structuredClone(storedTheme.tokens) };
  }

  async removeCustomTheme(id: string): Promise<void> {
    await this.ensureCustomThemesLoaded();
    await this.ensureSurfaceOverridesAuthoritative();
    await this.ensureMediaHintsAuthoritative();
    if (!this.isCustomTheme(id)) throw new Error('Only imported themes can be removed.');
    const dependent = this.registry.listCustom().find((theme) => theme.extends === id);
    if (dependent) throw new Error(`Remove dependent theme first: ${dependent.name}`);

    const theme = this.registry.get(id);
    if (!theme) throw new Error(`Unknown theme: ${id}`);
    const wasCurrent = this.state.themeId === id;
    if (wasCurrent) await this.set(BUILTIN_THEME_IDS.RICE, 'rice');

    // Commit the authoritative theme registry first. A crash/failure after this
    // point may leave harmless orphaned metadata/media, but can never resurrect
    // a theme whose blobs were already deleted.
    this.registry.remove(id);
    try {
      await this.persistCustomThemes();
    } catch (error) {
      this.registry.register(theme, true);
      throw error;
    }

    delete this.surfaceOverrides[id];
    delete this.mediaHints[id];
    delete this.mediaHints[backgroundHintKey(id)];
    try {
      await Promise.all([this.persistSurfaceOverrides(), this.persistMediaHints()]);
    } catch (error) {
      this.dispatchEvent(new CustomEvent('themeschange', { detail: this.listCustomThemes() }));
      throw error;
    }

    // Destructive blob cleanup is deliberately last. If it fails, the deleted
    // theme stays deleted and only unreachable orphaned media remains.
    const { artworkStore, backgroundStore } = await this.getMediaStores();
    await Promise.all([artworkStore.remove(id), backgroundStore.remove(id)]);
    this.dispatchEvent(new CustomEvent('themeschange', { detail: this.listCustomThemes() }));
  }

  private async loadStoredCustomThemes(value: unknown): Promise<void> {
    if (!Array.isArray(value) || value.length === 0) return;
    const qaValidator = (globalThis as typeof globalThis & { __KopelaThemeValidator?: unknown }).__KopelaThemeValidator as ((value: unknown) => ThemeDefinition) | undefined;
    const validate = qaValidator || (await import('./theme-validator.js')).validateThemeDefinition;
    const pending = value.slice(0, MAX_CUSTOM_THEMES).map((entry) => {
      try {
        const theme = validate(entry);
        const assetId = theme.tokens.artwork?.assetId;
        if (assetId && !resolveArtworkAsset(assetId)) return null;
        return theme;
      } catch { return null; }
    }).filter((theme): theme is ThemeDefinition => Boolean(theme));

    // Resolve dependencies in passes so a custom theme may extend another
    // previously imported custom theme without relying on storage order.
    let rest = pending;
    for (let pass = 0; pass < pending.length && rest.length; pass += 1) {
      const next: ThemeDefinition[] = [];
      let progress = false;
      for (const theme of rest) {
        if (theme.extends && !this.registry.get(theme.extends)) { next.push(theme); continue; }
        try { this.registry.register(theme, true); progress = true; } catch { /* malformed dependency/cycle: ignore stored entry */ }
      }
      if (!progress) break;
      rest = next;
    }
  }

  private loadStoredSurfaceOverrides(value: unknown): void {
    const source = record(value);
    if (!source) return;
    const next: Record<string, SurfaceAppearanceOverride> = {};
    for (const [themeId, raw] of Object.entries(source)) {
      const normalized = normalizeSurfaceOverride(raw);
      if (normalized) next[themeId] = normalized;
    }
    this.surfaceOverrides = next;
  }

  private async persistSurfaceOverrides(): Promise<void> {
    if (!this.surfaceOverridesAuthoritative) await this.ensureSurfaceOverridesAuthoritative();
    await chrome.storage.local.set({ [STORAGE.SURFACE_OVERRIDES]: this.surfaceOverrides });
  }

  private async persistCustomThemes(): Promise<void> {
    if (!this.customThemesLoaded || !this.customThemesAuthoritative) throw storageUnavailableMessage('Custom theme');
    await chrome.storage.local.set({ [STORAGE.CUSTOM_THEMES]: this.registry.listCustom() });
  }

  private effectiveSurfaceBlur(value: number): number {
    return this.userBackground?.mimeType === 'image/gif' ? Math.min(value, 6) : value;
  }

  private applySurfaceCssVars(patch?: SurfaceAppearanceOverride): void {
    const root = document.documentElement;
    const s = this.currentSurfaceAppearance;
    const all: Record<keyof SurfaceAppearanceOverride, Array<[string, string]>> = {
      mainColor: [['--main-surface-color', s.mainColor]],
      mainOpacity: [['--main-surface-opacity', String(s.mainOpacity)]],
      eqColor: [['--eq-surface-color', s.eqColor]],
      eqOpacity: [['--eq-surface-opacity', String(s.eqOpacity)]],
      cardsColor: [['--cards-surface-color', s.cardsColor]],
      cardsOpacity: [['--cards-surface-opacity', String(s.cardsOpacity)]],
      toolsColor: [['--tools-surface-color', s.toolsColor]],
      toolsOpacity: [['--tools-surface-opacity', String(s.toolsOpacity)]],
      controlsColor: [['--controls-surface-color', s.controlsColor]],
      controlsOpacity: [['--controls-surface-opacity', String(s.controlsOpacity)]],
      borderColor: [['--line', s.borderColor], ['--border-custom-color', s.borderColor]],
      borderOpacity: [['--border-opacity', String(s.borderOpacity)]],
      accentColor: [['--cyan', s.accentColor]],
      accentAltColor: [['--purple', s.accentAltColor]],
      positiveColor: [['--green', s.positiveColor]],
      dangerColor: [['--danger', s.dangerColor]],
      eqCurveColor: [['--mint', s.eqCurveColor]],
      textColor: [['--text', s.textColor]],
      mutedTextColor: [['--muted', s.mutedTextColor]],
      shadowStrength: [['--shadow-strength', String(s.shadowStrength)]],
      blur: [['--surface-blur', `${this.effectiveSurfaceBlur(s.blur)}px`]],
      windowRadius: [['--radius-window', `${s.windowRadius}px`]],
      panelRadius: [['--radius-panel', `${s.panelRadius}px`]],
      controlRadius: [['--radius-control', `${s.controlRadius}px`]],
      backgroundDim: [['--artwork-dim', `${Math.round(s.backgroundDim * 100)}%`]]
    };
    const keys = patch ? Object.keys(patch) as Array<keyof SurfaceAppearanceOverride> : Object.keys(all) as Array<keyof SurfaceAppearanceOverride>;
    for (const key of keys) for (const [name, value] of all[key] || []) root.style.setProperty(name, value);
  }

  private buildCssVars(): Record<string, string> {
    const { colors, surface, typography, spacing, motion, artwork } = this.resolved.tokens;
    const fontStacks: Record<string, string> = {
      system: '"Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
      humanist: '"Segoe UI Variable Text", Candara, "Segoe UI", system-ui, sans-serif',
      compact: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
      rounded: 'ui-rounded, "SF Pro Rounded", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif',
      modern: '"Segoe UI Variable Text", Aptos, Inter, "Noto Sans", system-ui, sans-serif'
    };
    const typeScale = Math.max(0.9, Math.min(1.2, typography.scale));
    const spaceScale = Math.max(0.85, Math.min(1.25, spacing.scale));
    // Defense in depth: imported/storage-corrupted themes must never be able to
    // make the fixed popup geometry overlap. ThemeRegistry rejects unsafe
    // resolved themes; these clamps also protect first paint/recovery paths.
    const safeTypePx = (value: number, min: number, max: number) => `${Math.max(min, Math.min(max, value * typeScale))}px`;
    const safeSpacePx = (value: number, min: number, max: number) => `${Math.max(min, Math.min(max, value * spaceScale))}px`;
    const artworkUrl = artwork.enabled ? resolveArtworkAsset(artwork.assetId) : null;
    const backgroundArtworkUrl = this.userBackgroundUrl || artworkUrl;
    const preloadedCardUrl = this.preloadedArtworkActive && this.state.themeId === BUILTIN_THEME_IDS.RICE
      ? chrome.runtime.getURL(PRELOADED_RICE_ARTWORK_URL)
      : '';
    const cardArtworkUrl = this.userArtworkUrl || preloadedCardUrl || artworkUrl;
    const surfaceAppearance = this.currentSurfaceAppearance;
    return {
      '--bg': colors.background,
      '--panel': colors.surface,
      '--panel-2': colors.surfaceRaised,
      '--surface-overlay': colors.surfaceOverlay,
      '--line': surfaceAppearance.borderColor,
      '--line-soft': colors.borderSoft,
      '--border-custom-color': surfaceAppearance.borderColor,
      '--border-opacity': String(surfaceAppearance.borderOpacity),
      '--text': surfaceAppearance.textColor,
      '--muted': surfaceAppearance.mutedTextColor,
      '--cyan': surfaceAppearance.accentColor,
      '--mint': surfaceAppearance.eqCurveColor,
      '--purple': surfaceAppearance.accentAltColor,
      '--green': surfaceAppearance.positiveColor,
      '--danger': surfaceAppearance.dangerColor,
      '--radius-window': `${surfaceAppearance.windowRadius}px`,
      '--radius-panel': `${surfaceAppearance.panelRadius}px`,
      '--radius-control': `${surfaceAppearance.controlRadius}px`,
      '--surface-opacity': String(surface.opacity),
      '--main-surface-color': surfaceAppearance.mainColor,
      '--main-surface-opacity': String(surfaceAppearance.mainOpacity),
      '--eq-surface-color': surfaceAppearance.eqColor,
      '--eq-surface-opacity': String(surfaceAppearance.eqOpacity),
      '--cards-surface-color': surfaceAppearance.cardsColor,
      '--cards-surface-opacity': String(surfaceAppearance.cardsOpacity),
      '--tools-surface-color': surfaceAppearance.toolsColor,
      '--tools-surface-opacity': String(surfaceAppearance.toolsOpacity),
      '--controls-surface-color': surfaceAppearance.controlsColor,
      '--controls-surface-opacity': String(surfaceAppearance.controlsOpacity),
      '--surface-blur': `${this.effectiveSurfaceBlur(surfaceAppearance.blur)}px`,
      '--shadow-strength': String(surfaceAppearance.shadowStrength),
      '--font-ui': fontStacks[typography.family] || fontStacks.system,
      '--font-display': fontStacks[typography.displayFamily] || fontStacks[typography.family] || fontStacks.system,
      '--font-numeric': 'ui-monospace, "Cascadia Code", "SFMono-Regular", Consolas, monospace',
      '--type-micro': safeTypePx(typography.micro, 9, 12),
      '--type-label': safeTypePx(typography.label, 9.5, 13.5),
      '--type-body': safeTypePx(typography.body, 10.5, 14.5),
      '--type-title': safeTypePx(typography.title, 12, 18),
      '--type-headline': safeTypePx(typography.headline, 14, 20),
      '--weight-regular': String(typography.weightRegular),
      '--weight-medium': String(typography.weightMedium),
      '--weight-strong': String(typography.weightStrong),
      '--space-xs': safeSpacePx(spacing.xs, 2, 6),
      '--space-sm': safeSpacePx(spacing.sm, 5, 11),
      '--space-md': safeSpacePx(spacing.md, 8, 17),
      '--space-lg': safeSpacePx(spacing.lg, 12, 23),
      '--motion-fast': `${motion.fast}ms`,
      '--motion-normal': `${motion.normal}ms`,
      '--artwork-image': backgroundArtworkUrl ? `url("${backgroundArtworkUrl.replace(/"/g, '%22')}")` : 'none',
      '--artwork-card-image': cardArtworkUrl ? `url("${cardArtworkUrl.replace(/"/g, '%22')}")` : 'none',
      '--artwork-background-size': this.userBackground?.fit === 'contain' ? 'contain' : 'cover',
      '--artwork-background-position': this.userBackground ? '50% 50%' : `${artwork.positionX}% ${artwork.positionY}%`,
      '--artwork-card-size': (this.userArtwork?.fit === 'contain' || (this.preloadedArtworkActive && this.mediaHints[BUILTIN_THEME_IDS.RICE] === 'preloaded-contain')) ? 'contain' : 'cover',
      '--artwork-card-position': (this.userArtwork || this.preloadedArtworkActive) ? '50% 50%' : `${artwork.positionX}% ${artwork.positionY}%`,
      '--artwork-opacity': String(artwork.opacity),
      '--artwork-dim': `${Math.round(surfaceAppearance.backgroundDim * 100)}%`,
      '--artwork-blur': `${artwork.blur}px`,
      '--artwork-position-x': `${artwork.positionX}%`,
      '--artwork-position-y': `${artwork.positionY}%`,
      '--artwork-scale': String(artwork.scale)
    };
  }

  private deferUserMediaRefresh(dispatch: boolean): void {
    if (!this.mediaHintsAuthoritative) return;
    this.cancelDeferredMediaRefresh();
    const generation = this.mediaRefreshGeneration;
    const themeId = this.state.themeId;
    const artworkHint = this.mediaHints[themeId];
    const backgroundHint = this.mediaHints[backgroundHintKey(themeId)];
    // Classic is a compatibility fallback, not a user-selectable media theme.
    // Do not wake IndexedDB just to discover two empty legacy slots.
    if (themeId === BUILTIN_THEME_IDS.CLASSIC && artworkHint === undefined && backgroundHint === undefined) return;
    const needsArtworkStore = artworkHint === undefined || hintIsCustom(artworkHint);
    const needsBackgroundStore = backgroundHint === undefined || hintIsCustom(backgroundHint);

    // Once both slots are known to be empty/preloaded there is no reason to
    // import IndexedDB code or open the database on ordinary popup opens.
    if (!needsArtworkStore && !needsBackgroundStore) return;

    const run = () => {
      this.mediaRefreshTimer = null;
      this.mediaRefreshIdleId = null;
      if (generation !== this.mediaRefreshGeneration || themeId !== this.state.themeId) return;
      void this.refreshUserMediaForCurrentTheme(dispatch, generation).catch(() => undefined);
    };
    const idle = (globalThis as typeof globalThis & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
    if (typeof idle === 'function') {
      this.mediaRefreshIdleId = idle(run, { timeout: 360 });
      return;
    }
    this.mediaRefreshTimer = setTimeout(run, 260);
  }

  private async refreshUserMediaForCurrentTheme(dispatch: boolean, generation = this.mediaRefreshGeneration): Promise<void> {
    const themeId = this.state.themeId;
    const artworkHint = this.mediaHints[themeId];
    const backgroundKey = backgroundHintKey(themeId);
    const backgroundHint = this.mediaHints[backgroundKey];
    const needArtwork = artworkHint === undefined || hintIsCustom(artworkHint);
    const needBackground = backgroundHint === undefined || hintIsCustom(backgroundHint);
    if (!needArtwork && !needBackground) return;

    const { artworkStore, backgroundStore } = await this.getMediaStores();
    const [artwork, background] = await Promise.all([
      needArtwork ? artworkStore.get(themeId) : Promise.resolve(null),
      needBackground ? backgroundStore.get(themeId) : Promise.resolve(null)
    ]);
    if (generation !== this.mediaRefreshGeneration || themeId !== this.state.themeId) return;

    let hintsChanged = false;
    if (needArtwork) {
      if (artwork) {
        const fit = fitFromHint(this.mediaHints[themeId], artwork.fit);
        this.installUserArtwork({ ...artwork, fit });
        this.preloadedArtworkActive = false;
        const normalizedHint = customMediaHint(fit);
        if (this.mediaHints[themeId] !== normalizedHint) { this.mediaHints[themeId] = normalizedHint; hintsChanged = true; }
      } else if (String(this.mediaHints[themeId] || '').startsWith('preloaded') && themeId === BUILTIN_THEME_IDS.RICE) {
        this.clearUserArtwork();
        this.preloadedArtworkActive = true;
      } else {
        this.clearUserArtwork();
        this.preloadedArtworkActive = false;
        if (this.mediaHints[themeId] !== 'none') { this.mediaHints[themeId] = 'none'; hintsChanged = true; }
      }
    }

    if (needBackground) {
      if (background) {
        const fit = fitFromHint(this.mediaHints[backgroundKey], background.fit);
        this.installUserBackground({ ...background, fit });
        const normalizedHint = customMediaHint(fit);
        if (this.mediaHints[backgroundKey] !== normalizedHint) { this.mediaHints[backgroundKey] = normalizedHint; hintsChanged = true; }
      } else {
        this.clearUserBackground();
        if (this.mediaHints[backgroundKey] !== 'none') { this.mediaHints[backgroundKey] = 'none'; hintsChanged = true; }
      }
    }

    if (hintsChanged) void this.persistMediaHints().catch(() => undefined);
    this.apply();
    if (dispatch) {
      this.dispatchEvent(new CustomEvent('artworkchange', { detail: this.currentUserArtwork }));
      this.dispatchEvent(new CustomEvent('backgroundchange', { detail: this.currentUserBackground }));
    }
  }

  private installUserArtwork(record: UserArtworkRecord): void {
    this.clearUserArtwork();
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') throw new Error('Artwork preview is unavailable in this browser context.');
    this.userArtwork = record;
    this.userArtworkUrl = URL.createObjectURL(record.blob);
  }

  private clearUserArtwork(): void {
    if (this.userArtworkUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      try { URL.revokeObjectURL(this.userArtworkUrl); } catch { /* non-fatal */ }
    }
    this.userArtworkUrl = null;
    this.userArtwork = null;
  }

  private installUserBackground(record: UserArtworkRecord): void {
    this.clearUserBackground();
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') throw new Error('Background preview is unavailable in this browser context.');
    this.userBackground = record;
    this.userBackgroundUrl = URL.createObjectURL(record.blob);
  }

  private clearUserBackground(): void {
    if (this.userBackgroundUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      try { URL.revokeObjectURL(this.userBackgroundUrl); } catch { /* non-fatal */ }
    }
    this.userBackgroundUrl = null;
    this.userBackground = null;
  }

  private syncPreloadedArtworkHint(): void {
    this.preloadedArtworkActive = this.state.themeId === BUILTIN_THEME_IDS.RICE && String(this.mediaHints[this.state.themeId] || '').startsWith('preloaded');
  }

  private async persistMediaHints(): Promise<void> {
    if (!this.mediaHintsAuthoritative) await this.ensureMediaHintsAuthoritative();
    const snapshot = structuredClone(this.mediaHints);
    const write = this.mediaHintsWrite.then(() => chrome.storage.local.set({ [STORAGE.MEDIA_HINTS]: snapshot }));
    this.mediaHintsWrite = write.then(() => undefined, () => undefined);
    await write;
  }

  private cacheForNextOpen(): void {
    try {
      // First paint only needs layout/theme identity. Custom CSS variables are
      // intentionally NOT cached here: they are validated and applied after
      // chrome.storage loads, so corrupt theme data cannot blank the popup.
      localStorage.setItem(APPEARANCE_CACHE_KEY, JSON.stringify({
        themeId: this.state.themeId,
        layoutId: this.state.layoutId
      }));
    } catch {
      // chrome.storage remains the source of truth if localStorage is unavailable.
    }
  }

  private apply(): void {
    const root = document.documentElement;
    root.dataset.theme = this.resolved.id;
    root.dataset.layout = this.state.layoutId;
    root.classList.remove('appearance-loading');
    let placement = this.resolved.tokens.artwork.enabled ? this.resolved.tokens.artwork.placement : 'none';
    if (this.userBackground) placement = placement === 'card' || placement === 'both' ? 'both' : 'background';
    const hasCardArtwork = Boolean(this.userArtwork || this.preloadedArtworkActive);
    if (hasCardArtwork && this.state.layoutId === 'rice') placement = placement === 'background' || placement === 'both' ? 'both' : 'card';
    root.dataset.artworkPlacement = placement;
    root.dataset.userArtwork = hasCardArtwork ? 'true' : 'false';
    root.dataset.userBackground = this.userBackground ? 'true' : 'false';
    root.dataset.animatedBackground = this.userBackground?.mimeType === 'image/gif' ? 'true' : 'false';
    for (const [name, value] of Object.entries(this.buildCssVars())) root.style.setProperty(name, value);
  }
}
