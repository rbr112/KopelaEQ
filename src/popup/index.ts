import * as S from '../shared/index.js';
import { DEFAULT_PRESETS } from '../shared/default-presets.js';
import { DEFAULT_SAMPLE_RATE, NativeEqResponse } from '../audio/eq-response.js';
import type { BackgroundMessage, ResponseFor } from '../shared/messages.js';
import type { AudioState, EqState, MeterSnapshot, Preset, PresetMap, ProtectionMode, SpectrumMode } from '../shared/types.js';
import { PanelManager } from './panel-manager.js';
import { EqBandEditor } from './eq-band-editor.js';
import { GRAPH_MIN_FREQ as MIN_FREQ, GRAPH_MAX_FREQ as MAX_FREQ, GRAPH_MIN_GAIN as MIN_GAIN, GRAPH_MAX_GAIN as MAX_GAIN, getPlot, freqToX, xToFreq, gainToY, yToGain } from './eq-geometry.js';

let state = S.defaultAudioState();
let protection: ProtectionMode = 'strong';
let presets: PresetMap = {};
let workspace: Record<string, any> = {};
let analyzerEnabled = true;
let spectrumMode: SpectrumMode = 'balanced';
let spectrumFrozen = false;
let lastSpectrum: number[] | null = null;
let prePeakHoldDb = -120;
let postPeakHoldDb = -120;
let preClipHoldUntil = 0;
let postClipHoldUntil = 0;
const CLIP_HOLD_MS = 1500;
let activeTabId: number | null = null;
let activeTabCapturable = false;
let captureActive = false;
let capturePending = false;
let selectedPresetName = '';
let presetEditTargetName = '';
let presetSelectionDirty = false;
let lastMeter: MeterSnapshot | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let realtimeFrame: number | null = null;
let drawQueued = false;
let responseCache: { key: string; points: number[] } = { key: '', points: [] };
let hoveredEqBand = -1;
let bandEditor: EqBandEditor | null = null;
let engineSampleRate = DEFAULT_SAMPLE_RATE;
const eqResponse = new NativeEqResponse(engineSampleRate);

const $ = (id: string): HTMLElement | null => document.getElementById(id);
const els: Record<string, any> = {};

function cacheElements() {
  for (const id of [
    'analyzerToggle','powerToggle','powerText','gainSlider','gainReadout','gainPercentReadout','gainResetButton','eqCanvas','canvasTooltip','bandInspector','bandIndexLabel','bandTypeLabel','bandInspectorClose','bandFrequency','bandGain','bandQ','bandQUnit','bandTotalReadout','bandHint','bandResetButton','resetButton','helpButton',
    'presetControl','presetPickerButton','presetPickerText','presetMenu','presetMenuList','presetSelect','dynamicsButton','meterButton','protectionButton','moreButton','statusText','helpPanel',
    'presetPanel','presetName','saveAsPresetButton','updatePresetButton','duplicatePresetButton','renamePresetButton','deletePresetButton','importPresetButton','exportPresetButton','importFile','presetActionHint',
    'protectionPanel','protectionOptions','dynamicsPanel','dynamicsEnabled','normalModeButton','multibandModeButton',
    'dynamicsAmount','dynamicsAmountReadout','dynamicsResponse','dynamicsResponseReadout','dynamicsAdvancedToggle','dynamicsAdvancedBody','dynThresholdReadout','dynRatioReadout','dynAttackReadout','dynReleaseReadout','crossoverFields','lowCrossover',
    'lowCrossoverReadout','highCrossover','highCrossoverReadout','meterPanel','meterHoldReset','protectionActivity','protectionActivityValue','preClipState','postClipState',
    'preLeftBar','preRightBar','preRmsBar','postLeftBar','postRightBar','postRmsBar','preLeftValue','preRightValue','preRmsValue','postLeftValue','postRightValue','postRmsValue','preHoldValue','postHoldValue','grBar','dynGrBar','grValue','dynGrValue','spectrumFreezeButton','spectrumModeOptions'
  ]) els[id] = $(id);
}

function setStatus(text: string, isError = false): void {
  els.statusText.textContent = text;
  els.statusText.style.color = isError ? 'var(--danger)' : '';
}

async function message<M extends BackgroundMessage>(payload: M): Promise<ResponseFor<M>> {
  const result = await chrome.runtime.sendMessage(payload) as ResponseFor<M>;
  if (!result || result.ok !== true) throw new Error((result && result.error) || 'KopelaEQ request failed.');
  return result;
}

function statePayload(persist: boolean): Extract<BackgroundMessage, { type: typeof S.MessageType.StateSet }> {
  const payload: Extract<BackgroundMessage, { type: typeof S.MessageType.StateSet }> = { type: S.MessageType.StateSet, state, persist, tabId: activeTabId };
  if (presetSelectionDirty) payload.presetSelection = selectedPresetName;
  return payload;
}

function markPresetSelectionPersisted(sentName: string): void {
  if (presetSelectionDirty && selectedPresetName === sentName) presetSelectionDirty = false;
}

function schedulePersist(): void {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const sentName = selectedPresetName;
    message(statePayload(true))
      .then(() => markPresetSelectionPersisted(sentName))
      .catch((error: any) => setStatus(error.message, true));
  }, 420);
}

function sendStateRealtime(persistNow = false): Promise<any> {
  state = S.normalizeAudioState(state);
  updateControlState();
  queueDraw();

  if (persistNow) {
    if (realtimeFrame !== null) {
      cancelAnimationFrame(realtimeFrame);
      realtimeFrame = null;
    }
    if (persistTimer !== null) clearTimeout(persistTimer);
    persistTimer = null;
    const sentName = selectedPresetName;
    return message(statePayload(true))
      .then((result) => { markPresetSelectionPersisted(sentName); return result; })
      .catch((error: any) => { setStatus(error.message, true); throw error; });
  }

  if (realtimeFrame === null) {
    realtimeFrame = requestAnimationFrame(() => {
      realtimeFrame = null;
      const sentName = selectedPresetName;
      message(statePayload(false))
        .then(() => markPresetSelectionPersisted(sentName))
        .catch((error: any) => setStatus(error.message, true));
    });
  }
  schedulePersist();
  return Promise.resolve();
}

function persistSelectedPreset(name: string): Promise<any> {
  if (activeTabId === null) return Promise.resolve();
  return message({ type: S.MessageType.PresetSelectionSet, tabId: activeTabId, name: name || '' }).catch(() => {});
}

function markEdited(): void {
  if (selectedPresetName) { presetSelectionDirty = true; presetEditTargetName = selectedPresetName; }
  selectedPresetName = '';
  syncPresetUi();
}

function updateControlState(): void {
  els.gainSlider.value = String(state.gainDb);
  els.gainReadout.textContent = `${state.gainDb >= 0 ? '+' : ''}${state.gainDb.toFixed(1)} dB`;
  els.gainPercentReadout.textContent = `${Math.round(S.dbToLinear(state.gainDb) * 100)}%`;
  const gainPosition = ((state.gainDb - S.GAIN_DB_MIN) / (S.GAIN_DB_MAX - S.GAIN_DB_MIN)) * 100;
  els.gainSlider.style.setProperty('--gain-position', `${Math.max(0, Math.min(100, gainPosition))}%`);
  els.gainSlider.setAttribute('aria-valuetext', `${Math.round(S.dbToLinear(state.gainDb) * 100)} percent, ${state.gainDb.toFixed(1)} decibels`);

  els.dynamicsEnabled.checked = state.dynamics.enabled;
  els.normalModeButton.classList.toggle('active', state.dynamics.mode === 'normal');
  els.multibandModeButton.classList.toggle('active', state.dynamics.mode === 'multiband');
  els.dynamicsAmount.value = String(Math.round(state.dynamics.amount * 100));
  els.dynamicsAmountReadout.textContent = `${Math.round(state.dynamics.amount * 100)}%`;
  els.dynamicsResponse.value = String(Math.round(state.dynamics.response * 100));
  els.dynamicsResponseReadout.textContent = `${Math.round(state.dynamics.response * 100)}%`;
  els.lowCrossover.value = String(state.dynamics.lowCrossoverHz);
  els.lowCrossoverReadout.textContent = `${Math.round(state.dynamics.lowCrossoverHz)} Hz`;
  els.highCrossover.value = String(state.dynamics.highCrossoverHz);
  els.highCrossoverReadout.textContent = formatFrequency(state.dynamics.highCrossoverHz);
  const derivedDynamics = S.dynamicParams(state.dynamics);
  els.dynThresholdReadout.textContent = `${derivedDynamics.threshold.toFixed(1)} dB`;
  els.dynRatioReadout.textContent = `${derivedDynamics.ratio.toFixed(1)}:1`;
  els.dynAttackReadout.textContent = `${(derivedDynamics.attack * 1000).toFixed(1)} ms`;
  els.dynReleaseReadout.textContent = `${Math.round(derivedDynamics.release * 1000)} ms`;
  els.crossoverFields.hidden = state.dynamics.mode !== 'multiband';
  els.dynamicsButton.classList.toggle('is-on', state.dynamics.enabled);
  els.dynamicsButton.querySelector('span').textContent = state.dynamics.enabled ? (state.dynamics.mode === 'multiband' ? '3-band' : 'On') : 'Off';


  els.protectionButton.querySelector('span').textContent = capitalize(protection);
  for (const button of els.protectionOptions.querySelectorAll('[data-protection]')) {
    button.classList.toggle('active', button.dataset.protection === protection);
  }

  els.analyzerToggle.setAttribute('aria-pressed', String(analyzerEnabled));
  els.analyzerToggle.querySelector('span').textContent = analyzerEnabled ? 'On' : 'Off';
  els.spectrumFreezeButton.setAttribute('aria-pressed', String(spectrumFrozen));
  els.spectrumFreezeButton.textContent = spectrumFrozen ? 'Frozen' : 'Freeze';
  els.spectrumFreezeButton.disabled = !analyzerEnabled;
  for (const button of els.spectrumModeOptions.querySelectorAll('[data-spectrum-mode]')) {
    button.classList.toggle('active', button.dataset.spectrumMode === spectrumMode);
  }
  els.powerToggle.setAttribute('aria-pressed', String(captureActive));
  els.powerText.textContent = capturePending ? 'Starting…' : (captureActive ? 'On' : 'Off');
  els.powerToggle.disabled = capturePending || activeTabId === null || !activeTabCapturable;
  bandEditor?.sync();
}

function capitalize(value: unknown): string {
  const s = String(value || '');
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

function formatFrequency(value: unknown): string {
  const n = Number(value);
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 1 : 2).replace(/\.0+$/, '')} kHz` : `${Math.round(n)} Hz`;
}

async function loadPresets(): Promise<void> {
  const keys = [S.STORAGE.PRESETS, 'presets', 'userPresets', 'savedPresets'];
  const localStored = await chrome.storage.local.get(keys);
  let source: unknown;
  let found = false;

  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(localStored, key)) continue;
    const candidate = localStored[key];
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      source = candidate;
      found = true;
      break;
    }
  }

  // 1.9.0 and earlier stored presets in storage.sync. Migrate once, then keep the
  // authoritative preset map local so a larger collection cannot hit sync's per-item quota.
  if (!found && chrome.storage.sync) {
    const synced = await chrome.storage.sync.get(keys);
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(synced, key)) continue;
      const candidate = synced[key];
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        source = candidate;
        found = true;
        break;
      }
    }
  }

  if (!found) source = DEFAULT_PRESETS;
  presets = S.migrateBundledPresetNames(source);
  await chrome.storage.local.set({ [S.STORAGE.PRESETS]: presets });
  renderPresetSelect();
}

function syncPresetUi(): void {
  const label = selectedPresetName || 'Current settings';
  if (els.presetSelect) els.presetSelect.value = selectedPresetName;
  if (els.presetPickerText) els.presetPickerText.textContent = label;
  if (els.presetMenuList) {
    for (const item of els.presetMenuList.querySelectorAll('[data-preset-name]')) {
      item.classList.toggle('active', item.dataset.presetName === selectedPresetName);
      item.setAttribute('aria-selected', String(item.dataset.presetName === selectedPresetName));
    }
  }
  if (els.updatePresetButton) syncPresetActionState();
}

function closePresetMenu(): void {
  if (!els.presetMenu || !els.presetPickerButton) return;
  els.presetMenu.hidden = true;
  els.presetPickerButton.setAttribute('aria-expanded', 'false');
}

function openPresetMenu(): void {
  if (!els.presetMenu || !els.presetPickerButton) return;
  els.presetMenu.hidden = false;
  els.presetPickerButton.setAttribute('aria-expanded', 'true');
  const active = els.presetMenuList.querySelector('.preset-menu-item.active') || els.presetMenuList.querySelector('.preset-menu-item');
  if (active) requestAnimationFrame(() => active.focus());
}

function renderPresetSelect(): void {
  const previous = selectedPresetName;
  els.presetSelect.textContent = '';
  els.presetMenuList.textContent = '';

  const appendChoice = (name: string, label: string, current = false): void => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = label;
    els.presetSelect.appendChild(option);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `preset-menu-item${current ? ' current' : ''}`;
    button.dataset.presetName = name;
    button.setAttribute('role', 'option');
    button.textContent = label;
    els.presetMenuList.appendChild(button);
  };

  appendChoice('', 'Current settings', true);
  for (const name of Object.keys(presets)) appendChoice(name, name);
  selectedPresetName = Object.prototype.hasOwnProperty.call(presets, previous) ? previous : '';
  syncPresetUi();
}

async function savePresetMap(): Promise<void> {
  presets = S.normalizePresetMap(presets);
  await chrome.storage.local.set({ [S.STORAGE.PRESETS]: presets });
  renderPresetSelect();
}

async function applyPreset(name: string): Promise<void> {
  if (!name || !presets[name]) return;
  const presetState = S.presetToAudioState(presets[name]);
  // Presets are EQ presets, matching the original Ears behavior. Gain and
  // optional Dynamics remain independent controls and do not get reset here.
  state.eq = presetState.eq;
  selectedPresetName = name;
  presetEditTargetName = name;
  presetSelectionDirty = true;
  syncPresetUi();
  await sendStateRealtime(true);
  closePresetMenu();
  setStatus(`Preset: ${name}`);
}

function almostEqual(a: unknown, b: unknown, tolerance = 1e-5): boolean {
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

function stateMatchesPreset(currentState: unknown, preset: Preset): boolean {
  const a = S.normalizeAudioState(currentState);
  const b = S.presetToAudioState(preset);
  if (a.eq.enabled !== b.eq.enabled) return false;
  for (const key of ['frequencies', 'gains', 'qs'] as const satisfies readonly (keyof EqState)[]) {
    if (!a.eq[key].every((value: number, index: number) => almostEqual(value, b.eq[key][index]))) return false;
  }
  return true;
}

function inferPresetFromState(): string {
  const matches = Object.entries(presets)
    .filter(([, preset]) => stateMatchesPreset(state, preset))
    .map(([name]) => name);
  return matches.length === 1 ? matches[0] : '';
}

async function restoreSelectedPreset(): Promise<void> {
  if (activeTabId === null) return;
  try {
    const result = await message({ type: S.MessageType.PresetSelectionGet, tabId: activeTabId });
    const storedName = typeof result.name === 'string' ? result.name : '';
    let name = storedName && presets[storedName] && stateMatchesPreset(state, presets[storedName]) ? storedName : '';

    // Recovery path for older builds where preset identity and DSP state were
    // persisted by separate messages. If the state is an exact unique preset,
    // restore its label and heal the per-tab identity automatically.
    if (!name) name = inferPresetFromState();
    selectedPresetName = name;
    presetEditTargetName = name;
    presetSelectionDirty = false;
    syncPresetUi();
    if (name !== storedName) await persistSelectedPreset(name);
  } catch (_) { /* selection label is non-critical */ }
}

function isCapturableTab(tab: ChromeTab | null | undefined): boolean {
  if (!tab || !Number.isInteger(tab.id)) return false;
  const url = typeof tab.url === 'string' ? tab.url : '';
  return !/^(chrome|edge|about|chrome-extension|devtools):/i.test(url);
}

async function getActiveTab(): Promise<ChromeTab | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  activeTabId = tab && Number.isInteger(tab.id) ? Number(tab.id) : null;
  activeTabCapturable = isCapturableTab(tab);
  return tab ?? null;
}

async function refreshCaptureStatus(): Promise<void> {
  if (activeTabId === null) return;
  const result = await message({ type: S.MessageType.StatusGet, tabId: activeTabId });
  captureActive = result.active === true;
  capturePending = result.pending === true;
  state = S.normalizeAudioState(result.state || state);
  protection = S.normalizeProtection(result.protection || protection);
  if (setEngineSampleRate(result.sampleRate)) queueDraw();
  updateControlState();
  if (result.phase === 'recovering') setStatus('Reconnecting audio…');
  else if (captureActive && result.trackMuted === true) setStatus('Waiting for tab audio…');
  else if (captureActive) setStatus('Processing current tab');
  else if (!capturePending) setStatus('Processing stopped');
}

async function toggleCapture(): Promise<void> {
  if (activeTabId === null || !activeTabCapturable || capturePending) return;
  capturePending = true;
  updateControlState();
  try {
    if (captureActive) {
      await message({ type: S.MessageType.CaptureStop, tabId: activeTabId });
      captureActive = false;
      setStatus('Processing stopped');
    } else {
      await message({ type: 'STATE_SET', state, persist: true, tabId: activeTabId });
      await message({ type: S.MessageType.ProtectionSet, protection });
      await message({ type: S.MessageType.CaptureStart, tabId: activeTabId });
      captureActive = true;
      setStatus('Processing current tab');
    }
  } catch (error: any) {
    captureActive = false;
    setStatus(error.message, true);
    try { await refreshCaptureStatus(); } catch (_) { /* preserve original error */ }
  } finally {
    capturePending = false;
    updateControlState();
  }
}

function protectionRank(value: ProtectionMode): number {
  return ({ off: 0, light: 1, medium: 2, strong: 3 })[value] ?? 3;
}

async function setProtection(value: unknown): Promise<void> {
  const next = S.normalizeProtection(value);
  if (protectionRank(next) < protectionRank(protection)) {
    const ok = confirm('Lower clip protection can allow peaks to distort when Gain or EQ is aggressive. Continue?');
    if (!ok) return;
  }
  const previous = protection;
  protection = next;
  updateControlState();
  try {
    await message({ type: S.MessageType.ProtectionSet, protection });
    setStatus(`Protection: ${capitalize(protection)}`);
  } catch (error: any) {
    protection = previous;
    updateControlState();
    setStatus(error.message, true);
  }
}

function bindAudioControls(): void {
  els.gainSlider.addEventListener('input', () => {
    state.gainDb = Number(els.gainSlider.value);
    sendStateRealtime(false);
  });
  els.gainSlider.addEventListener('change', () => sendStateRealtime(true));
  els.gainSlider.addEventListener('dblclick', () => {
    state.gainDb = 0;
    sendStateRealtime(true);
  });

  els.gainResetButton.addEventListener('click', () => {
    state.gainDb = 0;
    sendStateRealtime(true);
    setStatus('Gain reset to 0 dB');
  });

  els.resetButton.addEventListener('click', () => {
    const defaults = S.defaultAudioState();
    state.gainDb = defaults.gainDb;
    state.eq = defaults.eq;
    markEdited();
    sendStateRealtime(true);
    setStatus('Gain and EQ reset');
  });

  els.dynamicsEnabled.addEventListener('change', () => {
    state.dynamics.enabled = els.dynamicsEnabled.checked;
    sendStateRealtime(true);
  });
  els.normalModeButton.addEventListener('click', () => {
    state.dynamics.mode = 'normal';
    sendStateRealtime(true);
  });
  els.multibandModeButton.addEventListener('click', () => {
    state.dynamics.mode = 'multiband';
    sendStateRealtime(true);
  });
  els.dynamicsAmount.addEventListener('input', () => {
    state.dynamics.amount = Number(els.dynamicsAmount.value) / 100;
    sendStateRealtime(false);
  });
  els.dynamicsResponse.addEventListener('input', () => {
    state.dynamics.response = Number(els.dynamicsResponse.value) / 100;
    sendStateRealtime(false);
  });
  els.lowCrossover.addEventListener('input', () => {
    state.dynamics.lowCrossoverHz = Number(els.lowCrossover.value);
    if (state.dynamics.highCrossoverHz < state.dynamics.lowCrossoverHz + 400) state.dynamics.highCrossoverHz = state.dynamics.lowCrossoverHz + 400;
    sendStateRealtime(false);
  });
  els.highCrossover.addEventListener('input', () => {
    state.dynamics.highCrossoverHz = Number(els.highCrossover.value);
    if (state.dynamics.highCrossoverHz < state.dynamics.lowCrossoverHz + 400) state.dynamics.highCrossoverHz = state.dynamics.lowCrossoverHz + 400;
    sendStateRealtime(false);
  });
  for (const input of [els.dynamicsAmount, els.dynamicsResponse, els.lowCrossover, els.highCrossover]) {
    input.addEventListener('change', () => sendStateRealtime(true));
  }


  els.analyzerToggle.addEventListener('click', async () => {
    const previous = analyzerEnabled;
    analyzerEnabled = !analyzerEnabled;
    if (!analyzerEnabled) spectrumFrozen = false;
    updateControlState();
    queueDraw();
    try {
      await chrome.storage.local.set({ [S.STORAGE.VISUALIZER]: analyzerEnabled });
    } catch (error: any) {
      analyzerEnabled = previous;
      updateControlState();
      queueDraw();
      setStatus(error.message, true);
    }
  });

  els.spectrumModeOptions.addEventListener('click', async (event: Event) => {
    const button = (event.target as Element | null)?.closest('[data-spectrum-mode]') as HTMLElement | null;
    const next = button?.dataset.spectrumMode;
    if (next !== 'fast' && next !== 'balanced' && next !== 'smooth') return;
    spectrumMode = next;
    spectrumFrozen = false;
    updateControlState();
    try { await chrome.storage.local.set({ [S.STORAGE.SPECTRUM_MODE]: spectrumMode }); } catch (error: any) { setStatus(error.message, true); }
  });
  els.spectrumFreezeButton.addEventListener('click', () => {
    spectrumFrozen = !spectrumFrozen;
    updateControlState();
    if (!spectrumFrozen) void pollMeters();
  });
  els.meterHoldReset.addEventListener('click', resetPeakHold);

  els.powerToggle.addEventListener('click', toggleCapture);
  els.protectionOptions.addEventListener('click', (event: Event) => {
    const button = (event.target as Element | null)?.closest('[data-protection]');
    if (button) setProtection((button as HTMLElement).dataset.protection);
  });
}

function syncPresetActionState(): void {
  const selectedExists = Boolean(selectedPresetName && Object.prototype.hasOwnProperty.call(presets, selectedPresetName));
  const targetExists = Boolean(presetEditTargetName && Object.prototype.hasOwnProperty.call(presets, presetEditTargetName));
  els.updatePresetButton.disabled = !targetExists;
  els.duplicatePresetButton.disabled = !selectedExists;
  els.renamePresetButton.disabled = !selectedExists;
  els.deletePresetButton.disabled = !selectedExists;
  if (selectedExists) {
    els.presetActionHint.textContent = `Selected: ${selectedPresetName}. Presets apply the EQ curve; Gain, Dynamics and Protection stay independent.`;
  } else if (targetExists) {
    els.presetActionHint.textContent = `Current settings based on ${presetEditTargetName}. Update selected overwrites that preset; Save as creates a new one.`;
  } else {
    els.presetActionHint.textContent = 'No preset selected. Save the current EQ curve as a new preset.';
  }
}

function uniquePresetName(base: string): string {
  const normalizedBase = S.normalizePresetName(base) || 'Preset';
  if (!Object.prototype.hasOwnProperty.call(presets, normalizedBase)) return normalizedBase;
  for (let n = 2; n <= S.MAX_PRESETS + 1; n += 1) {
    const candidate = S.normalizePresetName(`${normalizedBase} ${n}`);
    if (candidate && !Object.prototype.hasOwnProperty.call(presets, candidate)) return candidate;
  }
  return '';
}

async function selectAndPersistPreset(name: string): Promise<void> {
  selectedPresetName = name;
  presetEditTargetName = name;
  presetSelectionDirty = false;
  syncPresetUi();
  syncPresetActionState();
  await persistSelectedPreset(name);
}

async function saveCurrentEqAs(name: string, allowOverwrite = false): Promise<boolean> {
  if (!name) { setStatus('Enter a valid preset name', true); return false; }
  const exists = Object.prototype.hasOwnProperty.call(presets, name);
  if (exists && !allowOverwrite && name !== selectedPresetName) {
    if (!confirm(`Replace existing preset “${name}”?`)) return false;
  }
  if (!exists && Object.keys(presets).length >= S.MAX_PRESETS) {
    setStatus(`Preset limit reached (${S.MAX_PRESETS})`, true);
    return false;
  }
  presets[name] = S.audioStateToPreset(name, state);
  await savePresetMap();
  await selectAndPersistPreset(name);
  els.presetName.value = name;
  return true;
}

function bindPresetControls(): void {
  // The visible picker is custom instead of a native <select>; Windows can render
  // native option popups with a white OS theme even inside a dark extension popup.
  els.presetPickerButton.addEventListener('click', (event: Event) => {
    event.stopPropagation();
    if (els.presetMenu.hidden) openPresetMenu(); else closePresetMenu();
  });
  els.presetMenuList.addEventListener('click', (event: Event) => {
    const item = (event.target as Element | null)?.closest('[data-preset-name]');
    if (!item) return;
    const name = (item as HTMLElement).dataset.presetName || '';
    if (!name) { closePresetMenu(); return; }
    applyPreset(name);
  });
  els.presetMenuList.addEventListener('keydown', (event: KeyboardEvent) => {
    const items = [...els.presetMenuList.querySelectorAll('.preset-menu-item')];
    const index = items.indexOf(document.activeElement);
    if (event.key === 'Escape') { closePresetMenu(); els.presetPickerButton.focus(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(Math.max(0, index) + step + items.length) % items.length]?.focus();
    }
    if (event.key === 'Enter' || event.key === ' ') {
      const item = (document.activeElement as Element | null)?.closest?.('[data-preset-name]');
      if (item) { event.preventDefault(); const name = (item as HTMLElement).dataset.presetName || ''; if (name) applyPreset(name); else closePresetMenu(); }
    }
  });
  document.addEventListener('pointerdown', (event: PointerEvent) => {
    if (!els.presetControl.contains(event.target)) closePresetMenu();
  });

  els.moreButton.addEventListener('click', () => {
    els.presetName.value = selectedPresetName || '';
    syncPresetActionState();
    requestAnimationFrame(() => els.presetName.focus());
  });

  els.saveAsPresetButton.addEventListener('click', async () => {
    const name = S.normalizePresetName(els.presetName.value || '');
    try {
      if (await saveCurrentEqAs(name, false)) setStatus(`Saved as: ${name}`);
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });

  els.updatePresetButton.addEventListener('click', async () => {
    const name = selectedPresetName || presetEditTargetName;
    if (!name || !Object.prototype.hasOwnProperty.call(presets, name)) { setStatus('Select a preset to update', true); return; }
    try {
      if (await saveCurrentEqAs(name, true)) setStatus(`Updated: ${name}`);
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });

  els.duplicatePresetButton.addEventListener('click', async () => {
    const sourceName = selectedPresetName;
    if (!sourceName || !presets[sourceName]) { setStatus('Select a preset to duplicate', true); return; }
    const copyName = uniquePresetName(`${sourceName} copy`);
    if (!copyName) { setStatus('Could not create a unique preset name', true); return; }
    if (!Object.prototype.hasOwnProperty.call(presets, copyName) && Object.keys(presets).length >= S.MAX_PRESETS) {
      setStatus(`Preset limit reached (${S.MAX_PRESETS})`, true); return;
    }
    try {
      presets[copyName] = S.normalizePreset(copyName, { ...presets[sourceName], name: copyName });
      await savePresetMap();
      await selectAndPersistPreset(copyName);
      els.presetName.value = copyName;
      setStatus(`Duplicated: ${copyName}`);
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });

  els.renamePresetButton.addEventListener('click', async () => {
    const oldName = selectedPresetName;
    const newName = S.normalizePresetName(els.presetName.value || '');
    if (!oldName || !presets[oldName]) { setStatus('Select a preset to rename', true); return; }
    if (!newName) { setStatus('Enter a valid preset name', true); return; }
    if (newName === oldName) { setStatus('Preset already has this name'); return; }
    if (Object.prototype.hasOwnProperty.call(presets, newName) && !confirm(`Replace existing preset “${newName}”?`)) return;
    const oldPreset = presets[oldName];
    const replaced = presets[newName];
    try {
      presets[newName] = S.normalizePreset(newName, { ...oldPreset, name: newName });
      delete presets[oldName];
      await savePresetMap();
      await selectAndPersistPreset(newName);
      els.presetName.value = newName;
      setStatus(`Renamed: ${oldName} → ${newName}`);
    } catch (error: unknown) {
      presets[oldName] = oldPreset;
      if (replaced) presets[newName] = replaced; else delete presets[newName];
      renderPresetSelect();
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });

  els.deletePresetButton.addEventListener('click', async () => {
    const name = selectedPresetName;
    if (!name || !Object.prototype.hasOwnProperty.call(presets, name)) { setStatus('Select a preset to delete', true); return; }
    if (!confirm(`Delete preset “${name}”?`)) return;
    const previous = presets[name];
    delete presets[name];
    try {
      await savePresetMap();
      await selectAndPersistPreset('');
      presetEditTargetName = '';
      els.presetName.value = '';
      setStatus(`Deleted: ${name}`);
    } catch (error: unknown) {
      presets[name] = previous;
      renderPresetSelect();
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });

  els.importPresetButton.addEventListener('click', () => els.importFile.click());
  els.importFile.addEventListener('change', async () => {
    const file = els.importFile.files && els.importFile.files[0];
    els.importFile.value = '';
    if (!file) return;
    if (file.size > S.MAX_IMPORT_BYTES) { setStatus('Preset file exceeds 256 KB', true); return; }
    try {
      const imported = S.validateImportText(await file.text());
      const merged = S.mergePresetMaps(presets, imported);
      presets = merged.presets;
      await savePresetMap();
      syncPresetActionState();
      setStatus(merged.skipped
        ? `Imported ${merged.imported}; skipped ${merged.skipped} (limit ${S.MAX_PRESETS})`
        : `Imported ${merged.imported} preset(s)`);
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  });

  els.exportPresetButton.addEventListener('click', () => {
    const data = JSON.stringify({ format: 'KopelaEQ Presets', schemaVersion: S.SCHEMA_VERSION, presets }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'KopelaEQ-presets.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
    setStatus('Presets exported');
  });

  syncPresetActionState();
}

function resizeCanvas(): { ctx: CanvasRenderingContext2D; rect: DOMRect } {
  const canvas = els.eqCanvas as HTMLCanvasElement;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, rect };
}

function setEngineSampleRate(value: unknown): boolean {
  const next = Number(value);
  if (!Number.isFinite(next) || next < 8000) return false;
  const normalized = Math.round(next);
  if (normalized === engineSampleRate) return false;
  engineSampleRate = normalized;
  eqResponse.setSampleRate(normalized);
  responseCache = { key: '', points: [] };
  return true;
}

function responseDbAtFrequency(freq: number): number {
  const result = eqResponse.combinedDb(Float32Array.of(freq), state.eq);
  const db = result[0];
  return Number.isFinite(db) ? Math.max(MIN_GAIN, Math.min(MAX_GAIN, db)) : NaN;
}

function queueDraw(): void {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; drawEq(); });
}

function drawEq(): void {
  const { ctx, rect } = resizeCanvas();
  const plot = getPlot(els.eqCanvas);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = '#0c1116';
  ctx.fillRect(0, 0, rect.width, rect.height);

  const freqTicks = [20,40,80,160,320,640,1280,2560,5120,10240,20000];
  const labelSet = new Set([20,80,320,1280,5120,20000]);
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const freq of freqTicks) {
    const x = freqToX(freq, plot);
    ctx.strokeStyle = labelSet.has(freq) ? '#27303a' : '#1b232b';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, plot.top); ctx.lineTo(x, plot.bottom); ctx.stroke();
    if (labelSet.has(freq)) {
      ctx.fillStyle = '#748291';
      ctx.fillText(freq >= 1000 ? `${(freq / 1000).toFixed(freq === 1280 || freq === 5120 ? 1 : 0).replace('.0','')}k` : String(freq), x, plot.bottom + 7);
    }
  }

  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const gain of [30,20,10,0,-10,-20,-30]) {
    const y = gainToY(gain, plot);
    ctx.strokeStyle = gain === 0 ? '#3a4957' : (gain % 20 === 0 ? '#252e37' : '#1a222a');
    ctx.lineWidth = gain === 0 ? 1.2 : 1;
    ctx.beginPath(); ctx.moveTo(plot.left, y); ctx.lineTo(plot.right, y); ctx.stroke();
    ctx.fillStyle = gain === 0 ? '#a2afbc' : '#697785';
    ctx.fillText(gain > 0 ? `+${gain}` : String(gain), plot.left - 7, y);
  }

  if (analyzerEnabled && Array.isArray(lastSpectrum)) {
    // Spectrum is an absolute output level (dBFS), not EQ gain. Give it the
    // same full-height mapping the legacy Ears visualizer used: 0 dBFS at
    // the top, -100 dBFS at the bottom. The EQ gain scale remains on the left.
    ctx.save();
    ctx.beginPath();
    let started = false;
    const bins = lastSpectrum.length;
    for (let i = 0; i < bins; i += 1) {
      const x = plot.left + (i / Math.max(1, bins - 1)) * plot.width;
      const db = Math.max(-100, Math.min(0, lastSpectrum[i]));
      const y = plot.top + ((0 - db) / 100) * plot.height;
      if (!started) { ctx.moveTo(x, plot.bottom); ctx.lineTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
    if (started) {
      ctx.lineTo(plot.right, plot.bottom); ctx.closePath();
      ctx.fillStyle = 'rgba(95,201,216,.065)'; ctx.fill();
      ctx.strokeStyle = 'rgba(95,201,216,.34)'; ctx.lineWidth = 1; ctx.stroke();
    }

    // Right-hand scale makes the two overlaid units explicit.
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#5f7583';
    for (const dbfs of [0, -50, -100]) {
      const y = plot.top + ((0 - dbfs) / 100) * plot.height;
      ctx.fillText(dbfs === 0 ? '0 dBFS' : String(dbfs), plot.right - 4, y);
    }
    ctx.restore();
  }

  const samples = Math.max(180, Math.floor(plot.width));
  const sampleRate = engineSampleRate;

  // The solid line below is the COMBINED response of all 11 bands. When a
  // control point is hovered/dragged, show that band's own response as a
  // dashed reference so a +24 dB point is not mistaken for +24 dB total at
  // that frequency when neighbouring cuts overlap it. Protection is not part
  // of this EQ response graph.
  const responseFreqs = new Float32Array(samples + 1);
  for (let i = 0; i <= samples; i += 1) {
    const x = plot.left + (i / samples) * plot.width;
    responseFreqs[i] = xToFreq(x, plot);
  }

  const activeEqBand = hoveredEqBand >= 0 ? hoveredEqBand : (bandEditor?.selectedIndex ?? -1);
  if (activeEqBand >= 0 && activeEqBand < S.EQ_BANDS && state.eq.enabled) {
    const bandPoints = eqResponse.bandDb(activeEqBand, responseFreqs, state.eq);
    ctx.save();
    ctx.beginPath();
    let startedBand = false;
    for (let i = 0; i <= samples; i += 1) {
      const db = bandPoints[i];
      if (!Number.isFinite(db)) { startedBand = false; continue; }
      const x = plot.left + (i / samples) * plot.width;
      const y = gainToY(Math.max(MIN_GAIN, Math.min(MAX_GAIN, db)), plot);
      if (!startedBand) { ctx.moveTo(x, y); startedBand = true; } else ctx.lineTo(x, y);
    }
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(165,138,245,.58)';
    ctx.lineWidth = 1.15;
    ctx.stroke();
    ctx.restore();
  }

  ctx.beginPath();
  const responseKey = JSON.stringify([
    Math.round(plot.width), sampleRate, state.eq.enabled, state.eq.frequencies, state.eq.gains, state.eq.qs
  ]);
  if (responseCache.key !== responseKey) {
    const nativePoints = eqResponse.combinedDb(responseFreqs, state.eq);
    const points = Array.from(nativePoints, (db) => Number.isFinite(db)
      ? Math.max(MIN_GAIN, Math.min(MAX_GAIN, db))
      : NaN);
    responseCache = { key: responseKey, points };
  }
  let startedResponse = false;
  for (let i = 0; i <= samples; i += 1) {
    const db = responseCache.points[i];
    if (!Number.isFinite(db)) { startedResponse = false; continue; }
    const x = plot.left + (i / samples) * plot.width;
    const y = gainToY(db, plot);
    if (!startedResponse) { ctx.moveTo(x, y); startedResponse = true; } else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = state.eq.enabled ? '#72d5bd' : '#59636e';
  ctx.lineWidth = 1.7;
  ctx.stroke();

  // A control point is the gain parameter of one filter; the solid line is the
  // cascade of all filters. Connect the selected/hovered point to the actual
  // combined response at the same frequency so the distinction is visible.
  if (activeEqBand >= 0 && activeEqBand < S.EQ_BANDS) {
    const x = freqToX(state.eq.frequencies[activeEqBand], plot);
    const bandY = gainToY(state.eq.gains[activeEqBand], plot);
    const totalDb = responseDbAtFrequency(state.eq.frequencies[activeEqBand]);
    if (Number.isFinite(totalDb)) {
      const totalY = gainToY(totalDb, plot);
      ctx.save();
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = 'rgba(195,210,222,.42)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, bandY); ctx.lineTo(x, totalY); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(x, totalY, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = '#d8e2ec'; ctx.fill();
      ctx.strokeStyle = '#0b0f14'; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.restore();
    }
  }

  for (let i = 0; i < S.EQ_BANDS; i += 1) {
    const x = freqToX(state.eq.frequencies[i], plot);
    const y = gainToY(state.eq.gains[i], plot);
    ctx.beginPath(); ctx.arc(x, y, 5.2, 0, Math.PI * 2);
    ctx.fillStyle = (i === 0 || i === S.EQ_BANDS - 1) ? '#a58af5' : '#72d5bd';
    ctx.fill();
    ctx.strokeStyle = '#0b0f14'; ctx.lineWidth = 2; ctx.stroke();
    if (bandEditor?.selectedIndex === i) {
      ctx.beginPath(); ctx.arc(x, y, 8.2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(225,238,247,.82)'; ctx.lineWidth = 1.2; ctx.stroke();
    }
  }
}

function bindEqCanvas(): void {
  const canvas = els.eqCanvas as HTMLCanvasElement;
  let drag: { index: number; qMode: boolean; startY: number; startQ: number; pointerId?: number } | null = null;

  bandEditor = new EqBandEditor({
    elements: els,
    getEq: () => state.eq,
    totalDbAt: responseDbAtFrequency,
    onChange: (persist) => {
      markEdited();
      void sendStateRealtime(persist);
      queueDraw();
    }
  });
  bandEditor.bind();

  function pointFromEvent(event: PointerEvent | MouseEvent | WheelEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function nearest(point: { x: number; y: number }, radius = 15): number {
    const plot = getPlot(canvas);
    let best = -1, bestD = radius;
    for (let i = 0; i < S.EQ_BANDS; i += 1) {
      const d = Math.hypot(point.x - freqToX(state.eq.frequencies[i], plot), point.y - gainToY(state.eq.gains[i], plot));
      if (d < bestD) { best = i; bestD = d; }
    }
    return best;
  }
  function showTooltip(index: number, point: { x: number; y: number }): void {
    if (index < 0) {
      if (hoveredEqBand !== -1) { hoveredEqBand = -1; queueDraw(); }
      els.canvasTooltip.hidden = true;
      return;
    }
    if (hoveredEqBand !== index) { hoveredEqBand = index; queueDraw(); }
    if (bandEditor?.selectedIndex === index && !drag) { els.canvasTooltip.hidden = true; return; }
    const totalHere = responseDbAtFrequency(state.eq.frequencies[index]);
    const typeLabel = S.EQ_TYPES[index] === 'lowshelf' ? 'Low Shelf' : (S.EQ_TYPES[index] === 'highshelf' ? 'High Shelf' : 'Peak');
    const qText = S.EQ_TYPES[index] === 'peaking' ? ` · Q ${state.eq.qs[index].toFixed(2)}` : '';
    const text = `${typeLabel} · ${formatFrequency(state.eq.frequencies[index])} · Band ${state.eq.gains[index].toFixed(1)} dB · Total ${totalHere.toFixed(1)} dB${qText}`;
    els.canvasTooltip.textContent = text;
    els.canvasTooltip.hidden = false;
    els.canvasTooltip.style.left = `${Math.min(canvas.clientWidth - 300, Math.max(4, point.x + 10))}px`;
    els.canvasTooltip.style.top = `${Math.max(4, point.y - 34)}px`;
  }

  canvas.addEventListener('pointerdown', (event: PointerEvent) => {
    const point = pointFromEvent(event);
    const index = nearest(point);
    if (index < 0) return;
    bandEditor?.select(index);
    drag = { index, qMode: event.shiftKey && S.EQ_TYPES[index] === 'peaking', startY: point.y, startQ: state.eq.qs[index] };
    canvas.setPointerCapture(event.pointerId);
    showTooltip(index, point);
    queueDraw();
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', (event: PointerEvent) => {
    const point = pointFromEvent(event);
    if (!drag) { showTooltip(nearest(point), point); return; }
    const plot = getPlot(canvas);
    const useQ = (drag.qMode || event.shiftKey) && S.EQ_TYPES[drag.index] === 'peaking';
    if (useQ) {
      state.eq.qs[drag.index] = S.clamp(drag.startQ * Math.exp((drag.startY - point.y) / 70), S.Q_MIN, S.Q_MAX);
    } else {
      state.eq.frequencies[drag.index] = S.clamp(xToFreq(point.x, plot), S.FREQ_MIN, S.FREQ_MAX);
      state.eq.gains[drag.index] = S.clamp(yToGain(point.y, plot), S.EQ_GAIN_MIN, S.EQ_GAIN_MAX);
    }
    markEdited();
    void sendStateRealtime(false);
    bandEditor?.sync();
    showTooltip(drag.index, point);
  });
  canvas.addEventListener('pointerup', (event: PointerEvent) => {
    if (!drag) return;
    drag = null;
    els.canvasTooltip.hidden = true;
    void sendStateRealtime(true);
    bandEditor?.sync();
    try { canvas.releasePointerCapture(event.pointerId); } catch (_) { /* no-op */ }
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('pointerleave', () => { if (!drag) { hoveredEqBand = -1; els.canvasTooltip.hidden = true; queueDraw(); } });
  canvas.addEventListener('wheel', (event: WheelEvent) => {
    const index = nearest(pointFromEvent(event), 18);
    if (index < 0 || !bandEditor?.adjustQ(index, event.deltaY)) return;
    event.preventDefault();
    showTooltip(index, pointFromEvent(event));
    schedulePersist();
  }, { passive: false });
  canvas.addEventListener('dblclick', (event: MouseEvent) => {
    const point = pointFromEvent(event);
    const index = nearest(point);
    if (index < 0) return;
    bandEditor?.select(index);
    state.eq.gains[index] = 0;
    if (S.EQ_TYPES[index] === 'peaking') state.eq.qs[index] = S.DEFAULT_Q;
    markEdited();
    void sendStateRealtime(true);
    bandEditor?.sync();
  });
  canvas.addEventListener('keydown', (event: KeyboardEvent) => {
    const index = bandEditor?.selectedIndex ?? -1;
    if (index < 0) return;
    if (event.key === 'Escape') { bandEditor?.clear(); queueDraw(); return; }
    if ((event.key === '[' || event.key === ']') && S.EQ_TYPES[index] === 'peaking') {
      const delta = event.key === ']' ? -60 : 60;
      if (bandEditor?.adjustQ(index, delta)) {
        event.preventDefault();
        void sendStateRealtime(true);
      }
    }
  });
}

function dbLabel(value: number): string {
  return value <= -100 ? '−∞' : `${value.toFixed(1)} dB`;
}
function meterWidth(db: number, min = -60, max = 3): string {
  return `${Math.max(0, Math.min(100, ((db - min) / (max - min)) * 100))}%`;
}
function setMeterBar(bar: HTMLElement, db: number): void {
  bar.style.width = meterWidth(db);
  bar.classList.toggle('is-over', db > 0);
}
function setClipState(el: HTMLElement, peakDb: number, stage: 'pre' | 'post'): void {
  const now = performance.now();
  let holdUntil = stage === 'pre' ? preClipHoldUntil : postClipHoldUntil;
  if (peakDb > 0) holdUntil = now + CLIP_HOLD_MS;
  if (stage === 'pre') preClipHoldUntil = holdUntil;
  else postClipHoldUntil = holdUntil;

  const overHeld = now < holdUntil;
  const near = !overHeld && peakDb > -1;
  const status = overHeld ? 'over' : (near ? 'near' : 'safe');
  el.textContent = overHeld ? 'OVER' : (near ? 'NEAR' : 'SAFE');
  el.dataset.level = status;
  el.classList.toggle('is-over', overHeld);
}
function resetPeakHold(): void {
  prePeakHoldDb = -120;
  postPeakHoldDb = -120;
  preClipHoldUntil = 0;
  postClipHoldUntil = 0;
  updateMeterUi();
}
function updateMeterUi(): void {
  const m = lastMeter;
  if (!m) {
    for (const id of ['preLeftValue','preRightValue','preRmsValue','postLeftValue','postRightValue','postRmsValue','preHoldValue','postHoldValue']) els[id].textContent = '−∞';
    els.grValue.textContent = '0.0 dB'; els.dynGrValue.textContent = '0.0 dB';
    for (const id of ['preLeftBar','preRightBar','preRmsBar','postLeftBar','postRightBar','postRmsBar','grBar','dynGrBar']) { els[id].style.width = '0%'; els[id].classList.remove('is-over'); }
    els.preClipState.textContent = 'SAFE'; els.preClipState.dataset.level = 'safe'; els.preClipState.classList.remove('is-over');
    els.postClipState.textContent = 'SAFE'; els.postClipState.dataset.level = 'safe'; els.postClipState.classList.remove('is-over');
    els.protectionActivity.dataset.state = 'bypassed';
    els.protectionActivity.querySelector('strong').textContent = protection === 'off' ? 'Protection off' : 'Protection idle';
    els.protectionActivityValue.textContent = '0.0 dB';
    return;
  }

  const pre = m.preProtection ?? { leftPeakDb: m.peakDb, rightPeakDb: m.peakDb, peakDb: m.peakDb, rmsDb: m.rmsDb };
  const post = m.postProtection ?? { leftPeakDb: m.peakDb, rightPeakDb: m.peakDb, peakDb: m.peakDb, rmsDb: m.rmsDb };
  prePeakHoldDb = Math.max(prePeakHoldDb, pre.peakDb);
  postPeakHoldDb = Math.max(postPeakHoldDb, post.peakDb);

  for (const [id, value] of [
    ['preLeftValue', pre.leftPeakDb], ['preRightValue', pre.rightPeakDb], ['preRmsValue', pre.rmsDb],
    ['postLeftValue', post.leftPeakDb], ['postRightValue', post.rightPeakDb], ['postRmsValue', post.rmsDb]
  ] as const) els[id].textContent = dbLabel(value);
  els.preHoldValue.textContent = dbLabel(prePeakHoldDb);
  els.postHoldValue.textContent = dbLabel(postPeakHoldDb);
  setMeterBar(els.preLeftBar, pre.leftPeakDb); setMeterBar(els.preRightBar, pre.rightPeakDb); setMeterBar(els.preRmsBar, pre.rmsDb);
  setMeterBar(els.postLeftBar, post.leftPeakDb); setMeterBar(els.postRightBar, post.rightPeakDb); setMeterBar(els.postRmsBar, post.rmsDb);
  setClipState(els.preClipState, pre.peakDb, 'pre'); setClipState(els.postClipState, post.peakDb, 'post');

  const gr = Math.abs(Math.min(0, m.gainReductionDb || 0));
  const dgr = Math.abs(Math.min(0, m.dynamicsReductionDb || 0));
  els.grValue.textContent = `${gr.toFixed(1)} dB`;
  els.dynGrValue.textContent = `${dgr.toFixed(1)} dB`;
  els.grBar.style.width = `${Math.min(100, gr / 18 * 100)}%`;
  els.dynGrBar.style.width = `${Math.min(100, dgr / 18 * 100)}%`;
  const engaged = protection !== 'off' && gr >= 0.05;
  els.protectionActivity.dataset.state = engaged ? 'active' : 'bypassed';
  els.protectionActivity.querySelector('strong').textContent = protection === 'off' ? 'Protection off' : (engaged ? 'Protection working' : 'Protection idle');
  els.protectionActivityValue.textContent = engaged ? `−${gr.toFixed(1)} dB` : '0.0 dB';
}

async function pollMeters(): Promise<void> {
  const meterVisible = !els.meterPanel.hidden;
  const needSpectrum = analyzerEnabled && !spectrumFrozen;
  const needLevels = meterVisible;
  if (!captureActive || (!needSpectrum && !needLevels) || activeTabId === null) return;
  try {
    const result = await message({ type: S.MessageType.MeterGet, tabId: activeTabId, spectrum: needSpectrum, spectrumMode, levels: needLevels });
    if (result.active === false) {
      captureActive = false;
      lastMeter = null;
      lastSpectrum = null;
      resetPeakHold();
      updateControlState();
      if (meterVisible) updateMeterUi();
      setStatus('Processing stopped');
      return;
    }
    lastMeter = result.meter ?? null;
    if (!spectrumFrozen && lastMeter && Array.isArray(lastMeter.spectrum)) lastSpectrum = lastMeter.spectrum.slice();
    if (meterVisible) updateMeterUi();
    if (analyzerEnabled) queueDraw();
  } catch (_) { /* transient while capture stops */ }
}

function bindRuntimeStatusEvents(): void {
  if (!chrome.runtime || !chrome.runtime.onMessage) return;
  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
    const record = message as Record<string, unknown>;
    if (record.type !== S.MessageType.SessionEnded) return false;
    const tabId = Number(record.tabId);
    if (Number.isInteger(tabId) && tabId === activeTabId) {
      captureActive = false;
      capturePending = true;
      lastMeter = null;
      lastSpectrum = null;
      resetPeakHold();
      updateControlState();
      updateMeterUi();
      setStatus('Reconnecting audio…');
      queueDraw();
      setTimeout(() => { void refreshCaptureStatus().catch(() => undefined); }, 180);
    }
    return false;
  });
}

async function init(): Promise<void> {
  cacheElements();
  const local = await chrome.storage.local.get([S.STORAGE.AUDIO_STATE, S.STORAGE.PROTECTION, S.STORAGE.WORKSPACE, S.STORAGE.VISUALIZER, S.STORAGE.SPECTRUM_MODE]);
  state = S.normalizeAudioState(local[S.STORAGE.AUDIO_STATE]);
  protection = S.normalizeProtection(local[S.STORAGE.PROTECTION]);
  workspace = local[S.STORAGE.WORKSPACE] && typeof local[S.STORAGE.WORKSPACE] === 'object' && !Array.isArray(local[S.STORAGE.WORKSPACE])
    ? local[S.STORAGE.WORKSPACE] as Record<string, unknown> : {};
  analyzerEnabled = local[S.STORAGE.VISUALIZER] !== false;
  spectrumMode = ['fast','balanced','smooth'].includes(String(local[S.STORAGE.SPECTRUM_MODE])) ? local[S.STORAGE.SPECTRUM_MODE] as SpectrumMode : 'balanced';

  const tab = await getActiveTab();
  await loadPresets();
  bindAudioControls();
  bindPresetControls();
  const panelManager = new PanelManager({ elements: els, workspace, onError: (text) => setStatus(text, true) });
  panelManager.bind();
  bindEqCanvas();
  bindRuntimeStatusEvents();

  if (!tab) setStatus('No active tab', true);
  else if (!activeTabCapturable) setStatus('Open a normal web page with audio', true);

  try { await refreshCaptureStatus(); } catch (error: any) { setStatus(error.message, true); }
  await restoreSelectedPreset();
  updateControlState();
  queueDraw();
  setInterval(pollMeters, 100);
  window.addEventListener('resize', () => {
    panelManager.restoreVisible();
    queueDraw();
  });
}

init().catch((error) => {
  console.error('KopelaEQ popup init:', error);
  if (els.statusText) setStatus(error.message, true);
});
