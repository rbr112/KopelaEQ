import * as S from '../shared/index.js';
import { DEFAULT_PRESETS } from '../shared/default-presets.js';
import type { AudioState, EqState, Preset, PresetMap } from '../shared/types.js';
import { settleBounded, type BoundedResult } from '../shared/bounded.js';
import type { PopupElements } from './popup-elements.js';

const PRESET_STORAGE_TIMEOUT_MS = 320;
const PRESET_STORAGE_RETRY_MS = 1600;

async function storageRead(area: { get(keys: string[] | string): Promise<Record<string, unknown>> }, keys: string[] | string, timeoutMs = PRESET_STORAGE_TIMEOUT_MS): Promise<BoundedResult<Record<string, unknown>>> {
  return settleBounded(area.get(keys), timeoutMs);
}

async function storageWrite(values: Record<string, unknown>): Promise<void> {
  const result = await settleBounded(chrome.storage.local.set(values), PRESET_STORAGE_RETRY_MS);
  if (result.status === 'ok') return;
  if (result.status === 'error') throw result.error;
  throw new Error('Preset storage is still busy. Try again in a moment.');
}

function presetCandidate(stored: Record<string, unknown>, keys: readonly string[]): unknown | undefined {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(stored, key)) continue;
    const candidate = stored[key];
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) return candidate;
  }
  return undefined;
}

interface PresetSourceResult {
  source: unknown;
  authoritative: boolean;
  canonicalExists: boolean;
  needsCanonicalWrite: boolean;
}

async function readPresetSource(keys: readonly string[], timeoutMs = PRESET_STORAGE_TIMEOUT_MS): Promise<PresetSourceResult> {
  const localResult = await storageRead(chrome.storage.local, [...keys], timeoutMs);
  if (localResult.status !== 'ok') return { source: DEFAULT_PRESETS, authoritative: false, canonicalExists: false, needsCanonicalWrite: false };
  const localStored = localResult.value;
  const localSource = presetCandidate(localStored, keys);
  const canonical = localStored[S.STORAGE.PRESETS];
  const canonicalExists = Boolean(canonical && typeof canonical === 'object' && !Array.isArray(canonical));
  if (localSource !== undefined) return { source: localSource, authoritative: true, canonicalExists, needsCanonicalWrite: !canonicalExists };

  // 1.9.0 and earlier stored presets in storage.sync. Only conclude that the
  // user's preset map is absent when this legacy read also completes.
  if (chrome.storage.sync) {
    const syncResult = await storageRead(chrome.storage.sync, [...keys], timeoutMs);
    if (syncResult.status !== 'ok') return { source: DEFAULT_PRESETS, authoritative: false, canonicalExists: false, needsCanonicalWrite: false };
    const syncSource = presetCandidate(syncResult.value, keys);
    if (syncSource !== undefined) return { source: syncSource, authoritative: true, canonicalExists: false, needsCanonicalWrite: true };
  }
  return { source: DEFAULT_PRESETS, authoritative: true, canonicalExists: false, needsCanonicalWrite: true };
}

export interface PresetUIOptions {
  elements: PopupElements;
  getState: () => AudioState;
  setState: (state: AudioState) => void;
  getActiveTabId: () => number | null;
  onStateChange: (persist: boolean) => Promise<unknown> | void;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
}

export class PresetUI {
  private readonly els: PopupElements;
  private readonly getState: () => AudioState;
  private readonly setState: (state: AudioState) => void;
  private readonly getActiveTabId: () => number | null;
  private readonly onStateChange: (persist: boolean) => Promise<unknown> | void;
  private readonly onStatus: (message: string) => void;
  private readonly onError: (message: string) => void;
  private presets: PresetMap = {};
  private selectedPresetName = '';
  private presetEditTargetName = '';
  private presetSelectionDirty = false;
  private presetStoreAuthoritative = false;

  constructor(options: PresetUIOptions) {
    this.els = options.elements;
    this.getState = options.getState;
    this.setState = options.setState;
    this.getActiveTabId = options.getActiveTabId;
    this.onStateChange = options.onStateChange;
    this.onStatus = options.onStatus;
    this.onError = options.onError;
  }

  get selection(): Readonly<{ name: string; dirty: boolean }> {
    return Object.freeze({ name: this.selectedPresetName, dirty: this.presetSelectionDirty });
  }

  markSelectionPersisted(sentName: string): void {
    if (this.presetSelectionDirty && this.selectedPresetName === sentName) this.presetSelectionDirty = false;
  }

  markEdited(): void {
    if (this.selectedPresetName) {
      this.presetSelectionDirty = true;
      this.presetEditTargetName = this.selectedPresetName;
    }
    this.selectedPresetName = '';
    this.syncPresetUi();
  }

  async loadPresets(): Promise<void> {
    const keys = [S.STORAGE.PRESETS, 'presets', 'userPresets', 'savedPresets'];
    const loaded = await readPresetSource(keys);
    this.presetStoreAuthoritative = loaded.authoritative;
    this.presets = S.migrateBundledPresetNames(loaded.source);
    const changed = JSON.stringify(loaded.source) !== JSON.stringify(this.presets);
    // Defaults shown after a timeout are RAM-only. Never turn an uncertain read
    // into an authoritative write that can erase user presets.
    if (loaded.authoritative && (loaded.needsCanonicalWrite || changed)) {
      await storageWrite({ [S.STORAGE.PRESETS]: this.presets });
    }
    this.renderPresetSelect();
  }

  private async ensurePresetStoreAuthoritative(): Promise<void> {
    if (this.presetStoreAuthoritative) return;
    const keys = [S.STORAGE.PRESETS, 'presets', 'userPresets', 'savedPresets'];
    const loaded = await readPresetSource(keys, PRESET_STORAGE_RETRY_MS);
    if (!loaded.authoritative) throw new Error('Preset storage is still busy. Try again in a moment.');
    this.presets = S.migrateBundledPresetNames(loaded.source);
    this.presetStoreAuthoritative = true;
    const changed = JSON.stringify(loaded.source) !== JSON.stringify(this.presets);
    if (loaded.needsCanonicalWrite || changed) await storageWrite({ [S.STORAGE.PRESETS]: this.presets });
    this.renderPresetSelect();
  }

  bind(): void {
    this.els.presetPickerButton.addEventListener('click', (event: Event) => {
      event.stopPropagation();
      if (this.els.presetMenu.hidden) this.openPresetMenu(); else this.closePresetMenu();
    });
    this.els.presetMenuList.addEventListener('click', (event: Event) => {
      const item = (event.target as Element | null)?.closest('[data-preset-name]');
      if (!item) return;
      const name = (item as HTMLElement).dataset.presetName || '';
      if (!name) { this.closePresetMenu(); return; }
      void this.applyPreset(name);
    });
    this.els.presetMenuList.addEventListener('keydown', (event: KeyboardEvent) => {
      const items = [...this.els.presetMenuList.querySelectorAll<HTMLElement>('.preset-menu-item')];
      const activeElement = document.activeElement;
      const index = activeElement instanceof HTMLElement ? items.indexOf(activeElement) : -1;
      if (event.key === 'Escape') { this.closePresetMenu(); this.els.presetPickerButton.focus(); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        items[(Math.max(0, index) + step + items.length) % items.length]?.focus();
      }
      if (event.key === 'Enter' || event.key === ' ') {
        const item = (document.activeElement as Element | null)?.closest?.('[data-preset-name]');
        if (item) {
          event.preventDefault();
          const name = (item as HTMLElement).dataset.presetName || '';
          if (name) void this.applyPreset(name); else this.closePresetMenu();
        }
      }
    });
    document.addEventListener('pointerdown', (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !this.els.presetControl.contains(event.target)) this.closePresetMenu();
    });

    this.els.moreButton.addEventListener('click', () => {
      this.els.presetName.value = this.selectedPresetName || this.presetEditTargetName || '';
      this.syncPresetActionState();
      requestAnimationFrame(() => this.els.presetName.focus());
    });

    this.els.saveAsPresetButton.addEventListener('click', async () => {
      const name = S.normalizePresetName(this.els.presetName.value || '');
      try { if (await this.saveCurrentEqAs(name, false)) this.onStatus(`Saved as: ${name}`); }
      catch (error: unknown) { this.onError(error instanceof Error ? error.message : String(error)); }
    });
    this.els.updatePresetButton.addEventListener('click', async () => {
      try {
        await this.ensurePresetStoreAuthoritative();
        const name = this.selectedPresetName || this.presetEditTargetName;
        if (!name || !Object.prototype.hasOwnProperty.call(this.presets, name)) { this.onError('Select a preset to update'); return; }
        if (await this.saveCurrentEqAs(name, true)) this.onStatus(`Updated: ${name}`);
      } catch (error: unknown) { this.onError(error instanceof Error ? error.message : String(error)); }
    });
    this.els.duplicatePresetButton.addEventListener('click', async () => {
      try {
        await this.ensurePresetStoreAuthoritative();
        const sourceName = this.selectedPresetName;
        if (!sourceName || !this.presets[sourceName]) { this.onError('Select a preset to duplicate'); return; }
        const copyName = this.uniquePresetName(`${sourceName} copy`);
        if (!copyName) { this.onError('Could not create a unique preset name'); return; }
        if (!Object.prototype.hasOwnProperty.call(this.presets, copyName) && Object.keys(this.presets).length >= S.MAX_PRESETS) {
          this.onError(`Preset limit reached (${S.MAX_PRESETS})`); return;
        }
        this.presets[copyName] = S.normalizePreset(copyName, { ...this.presets[sourceName], name: copyName });
        await this.savePresetMap(); await this.selectAndPersistPreset(copyName);
        this.els.presetName.value = copyName; this.onStatus(`Duplicated: ${copyName}`);
      } catch (error: unknown) { this.onError(error instanceof Error ? error.message : String(error)); }
    });
    this.els.renamePresetButton.addEventListener('click', async () => {
      try {
        await this.ensurePresetStoreAuthoritative();
        const oldName = this.selectedPresetName;
        const newName = S.normalizePresetName(this.els.presetName.value || '');
        if (!oldName || !this.presets[oldName]) { this.onError('Select a preset to rename'); return; }
        if (!newName) { this.onError('Enter a valid preset name'); return; }
        if (newName === oldName) { this.onStatus('Preset already has this name'); return; }
        if (Object.prototype.hasOwnProperty.call(this.presets, newName) && !confirm(`Replace existing preset “${newName}”?`)) return;
        const oldPreset = this.presets[oldName]; const replaced = this.presets[newName];
        try {
          this.presets[newName] = S.normalizePreset(newName, { ...oldPreset, name: newName }); delete this.presets[oldName];
          await this.savePresetMap(); await this.selectAndPersistPreset(newName); this.els.presetName.value = newName;
          this.onStatus(`Renamed: ${oldName} → ${newName}`);
        } catch (error: unknown) {
          this.presets[oldName] = oldPreset; if (replaced) this.presets[newName] = replaced; else delete this.presets[newName];
          this.renderPresetSelect(); throw error;
        }
      } catch (error: unknown) { this.onError(error instanceof Error ? error.message : String(error)); }
    });
    this.els.deletePresetButton.addEventListener('click', async () => {
      try {
        await this.ensurePresetStoreAuthoritative();
        const name = this.selectedPresetName;
        if (!name || !Object.prototype.hasOwnProperty.call(this.presets, name)) { this.onError('Select a preset to delete'); return; }
        if (!confirm(`Delete preset “${name}”?`)) return;
        const previous = this.presets[name]; delete this.presets[name];
        try {
          await this.savePresetMap(); await this.selectAndPersistPreset(''); this.presetEditTargetName = ''; this.els.presetName.value = '';
          this.onStatus(`Deleted: ${name}`);
        } catch (error: unknown) {
          this.presets[name] = previous; this.renderPresetSelect(); throw error;
        }
      } catch (error: unknown) { this.onError(error instanceof Error ? error.message : String(error)); }
    });
    this.els.importPresetButton.addEventListener('click', () => this.els.importFile.click());
    this.els.importFile.addEventListener('change', async () => {
      const file = this.els.importFile.files && this.els.importFile.files[0]; this.els.importFile.value = '';
      if (!file) return;
      if (file.size > S.MAX_IMPORT_BYTES) { this.onError('Preset file exceeds 256 KB'); return; }
      try {
        await this.ensurePresetStoreAuthoritative();
        const imported = S.validateImportText(await file.text()); const merged = S.mergePresetMaps(this.presets, imported);
        this.presets = merged.presets; await this.savePresetMap(); this.syncPresetActionState();
        this.onStatus(merged.skipped ? `Imported ${merged.imported}; skipped ${merged.skipped} (limit ${S.MAX_PRESETS})` : `Imported ${merged.imported} preset(s)`);
      } catch (error: unknown) { this.onError(error instanceof Error ? error.message : String(error)); }
    });
    this.els.exportPresetButton.addEventListener('click', () => {
      const data = JSON.stringify({ format: 'KopelaEQ Presets', schemaVersion: S.SCHEMA_VERSION, presets: this.presets }, null, 2);
      const blob = new Blob([data], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = 'KopelaEQ-presets.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 500); this.onStatus('Presets exported');
    });
    this.syncPresetActionState();
  }

  async restoreSelectedPreset(): Promise<void> {
    const tabId = this.getActiveTabId();
    if (tabId === null) return;
    try {
      const result = await chrome.runtime.sendMessage({ type: S.MessageType.PresetSelectionGet, tabId }) as { ok?: boolean; error?: string; name?: string };
      const storedName = result && typeof result.name === 'string' ? result.name : '';
      let name = storedName && this.presets[storedName] && this.stateMatchesPreset(this.getState(), this.presets[storedName]) ? storedName : '';
      if (!name) name = this.inferPresetFromState();
      this.selectedPresetName = name; this.presetEditTargetName = name; this.presetSelectionDirty = false; this.syncPresetUi();
      if (name !== storedName) await this.persistSelectedPreset(name);
    } catch { /* selection label is non-critical */ }
  }

  private syncPresetUi(): void {
    const label = this.selectedPresetName || 'Current settings';
    if (this.els.presetSelect) this.els.presetSelect.value = this.selectedPresetName;
    if (this.els.presetPickerText) this.els.presetPickerText.textContent = label;
    if (this.els.presetMenuList) {
      for (const item of this.els.presetMenuList.querySelectorAll<HTMLElement>('[data-preset-name]')) {
        item.classList.toggle('active', item.dataset.presetName === this.selectedPresetName);
        item.setAttribute('aria-selected', String(item.dataset.presetName === this.selectedPresetName));
      }
    }
    if (this.els.updatePresetButton) this.syncPresetActionState();
  }

  private closePresetMenu(): void {
    if (!this.els.presetMenu || !this.els.presetPickerButton) return;
    this.els.presetMenu.hidden = true; this.els.presetPickerButton.setAttribute('aria-expanded', 'false');
  }
  private openPresetMenu(): void {
    if (!this.els.presetMenu || !this.els.presetPickerButton) return;
    this.els.presetMenu.hidden = false; this.els.presetPickerButton.setAttribute('aria-expanded', 'true');
    const active = this.els.presetMenuList.querySelector<HTMLElement>('.preset-menu-item.active') || this.els.presetMenuList.querySelector<HTMLElement>('.preset-menu-item');
    if (active) requestAnimationFrame(() => active.focus());
  }

  private renderPresetSelect(): void {
    const previous = this.selectedPresetName; this.els.presetSelect.textContent = ''; this.els.presetMenuList.textContent = '';
    const appendChoice = (name: string, label: string, current = false): void => {
      const option = document.createElement('option'); option.value = name; option.textContent = label; this.els.presetSelect.appendChild(option);
      const button = document.createElement('button'); button.type = 'button'; button.className = `preset-menu-item${current ? ' current' : ''}`;
      button.dataset.presetName = name; button.setAttribute('role', 'option'); button.textContent = label; this.els.presetMenuList.appendChild(button);
    };
    appendChoice('', 'Current settings', true);
    for (const name of Object.keys(this.presets)) appendChoice(name, name);
    this.selectedPresetName = Object.prototype.hasOwnProperty.call(this.presets, previous) ? previous : '';
    this.syncPresetUi();
  }

  private async savePresetMap(): Promise<void> {
    if (!this.presetStoreAuthoritative) throw new Error('Preset storage is not ready yet.');
    this.presets = S.normalizePresetMap(this.presets);
    await storageWrite({ [S.STORAGE.PRESETS]: this.presets });
    this.renderPresetSelect();
  }

  private async applyPreset(name: string): Promise<void> {
    if (!name || !this.presets[name]) return;
    const state = S.clone(this.getState()); const presetState = S.presetToAudioState(this.presets[name]);
    // Presets remain EQ presets, matching the original Ears behavior. New 1.23
    // modules, Gain, Dynamics and Protection remain independent controls.
    state.eq = presetState.eq; this.setState(state);
    this.selectedPresetName = name; this.presetEditTargetName = name; this.presetSelectionDirty = true; this.syncPresetUi();
    await this.onStateChange(true); this.closePresetMenu(); this.onStatus(`Preset: ${name}`);
  }

  private almostEqual(a: unknown, b: unknown, tolerance = 1e-5): boolean { return Math.abs(Number(a) - Number(b)) <= tolerance; }
  private stateMatchesPreset(currentState: unknown, preset: Preset): boolean {
    const a = S.normalizeAudioState(currentState); const b = S.presetToAudioState(preset);
    if (a.eq.enabled !== b.eq.enabled) return false;
    for (const key of ['frequencies', 'gains', 'qs'] as const satisfies readonly (keyof EqState)[]) {
      if (!a.eq[key].every((value: number, index: number) => this.almostEqual(value, b.eq[key][index]))) return false;
    }
    return true;
  }
  private inferPresetFromState(): string {
    const matches = Object.entries(this.presets).filter(([, preset]) => this.stateMatchesPreset(this.getState(), preset)).map(([name]) => name);
    return matches.length === 1 ? matches[0] : '';
  }

  private syncPresetActionState(): void {
    const selectedExists = Boolean(this.selectedPresetName && Object.prototype.hasOwnProperty.call(this.presets, this.selectedPresetName));
    const targetExists = Boolean(this.presetEditTargetName && Object.prototype.hasOwnProperty.call(this.presets, this.presetEditTargetName));
    this.els.updatePresetButton.disabled = !targetExists;
    this.els.duplicatePresetButton.disabled = !selectedExists;
    this.els.renamePresetButton.disabled = !selectedExists;
    this.els.deletePresetButton.disabled = !selectedExists;

    if (this.els.presetActionTitle) {
      this.els.presetActionTitle.textContent = selectedExists ? 'Selected preset' : (targetExists ? 'Based on preset' : 'Preset actions');
    }
    if (this.els.updatePresetButton) {
      this.els.updatePresetButton.textContent = selectedExists ? 'Update selected' : (targetExists ? `Update “${this.presetEditTargetName}”` : 'Update selected');
    }

    if (selectedExists) this.els.presetActionHint.textContent = `Selected: ${this.selectedPresetName}. Presets apply the EQ curve; Gain and DSP modules stay independent.`;
    else if (targetExists) this.els.presetActionHint.textContent = `Based on: ${this.presetEditTargetName}. The EQ has changed, so it is no longer selected. Update overwrites that preset; Save as creates a new one.`;
    else this.els.presetActionHint.textContent = 'No preset selected. Save the current EQ curve as a new preset.';
  }

  private uniquePresetName(base: string): string {
    const normalizedBase = S.normalizePresetName(base) || 'Preset';
    if (!Object.prototype.hasOwnProperty.call(this.presets, normalizedBase)) return normalizedBase;
    for (let n = 2; n <= S.MAX_PRESETS + 1; n += 1) {
      const candidate = S.normalizePresetName(`${normalizedBase} ${n}`);
      if (candidate && !Object.prototype.hasOwnProperty.call(this.presets, candidate)) return candidate;
    }
    return '';
  }

  private async persistSelectedPreset(name: string): Promise<void> {
    const tabId = this.getActiveTabId(); if (tabId === null) return;
    const result = await chrome.runtime.sendMessage({ type: S.MessageType.PresetSelectionSet, tabId, name: name || '' }) as { ok?: boolean; error?: string };
    if (!result || result.ok !== true) throw new Error(result?.error || 'Could not persist preset selection.');
  }

  private async selectAndPersistPreset(name: string): Promise<void> {
    this.selectedPresetName = name; this.presetEditTargetName = name; this.presetSelectionDirty = false;
    this.syncPresetUi(); this.syncPresetActionState(); await this.persistSelectedPreset(name);
  }

  private async saveCurrentEqAs(name: string, allowOverwrite = false): Promise<boolean> {
    await this.ensurePresetStoreAuthoritative();
    if (!name) { this.onError('Enter a valid preset name'); return false; }
    const exists = Object.prototype.hasOwnProperty.call(this.presets, name);
    if (exists && !allowOverwrite && name !== this.selectedPresetName && !confirm(`Replace existing preset “${name}”?`)) return false;
    if (!exists && Object.keys(this.presets).length >= S.MAX_PRESETS) { this.onError(`Preset limit reached (${S.MAX_PRESETS})`); return false; }
    this.presets[name] = S.audioStateToPreset(name, this.getState()); await this.savePresetMap(); await this.selectAndPersistPreset(name);
    this.els.presetName.value = name; return true;
  }
}
