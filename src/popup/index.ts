import * as S from '../shared/index.js';
import { DEFAULT_SAMPLE_RATE } from '../audio/eq-response.js';
import { pitchShiftLatencyMs } from '../audio/pitch-latency.js';
import type { BackgroundMessage, ResponseFor } from '../shared/messages.js';
import type { AudioState, ProtectionMode, SpectrumMode, WorkspaceState } from '../shared/types.js';
import { EqUI } from './eq-ui.js';
import { MeterUI } from './meter-ui.js';
import { PanelManager } from './panel-manager.js';
import { PresetUI } from './preset-ui.js';
import { AppearanceService } from './appearance/appearance-service.js';
import type { AppearanceUI } from './appearance/appearance-ui.js';
import { collectPopupElements, type PopupElements } from './popup-elements.js';

let state = S.defaultAudioState();
let protection: ProtectionMode = 'strong';
let workspace: WorkspaceState = {};
let analyzerEnabled = true;
let spectrumMode: SpectrumMode = 'balanced';
let spectrumFrozen = false;
let lastSpectrum: number[] | null = null;
let activeTabId: number | null = null;
let activeTabCapturable = false;
let captureActive = false;
let capturePending = false;
let engineSampleRate = DEFAULT_SAMPLE_RATE;
let stateIntentGeneration = 0;
let protectionIntentGeneration = 0;
let captureIntentGeneration = 0;
let captureStatusGeneration = 0;
let eqUi: EqUI;
let meterUi: MeterUI;
let presetUi: PresetUI;
let appearance: AppearanceService;
let appearanceUi: AppearanceUI | null = null;
let appearanceUiPromise: Promise<AppearanceUI> | null = null;
const els: PopupElements = collectPopupElements();

const STARTUP_IO_TIMEOUT_MS = 320;

async function bounded<T>(promise: Promise<T>, fallback: T, label: string, timeoutMs = STARTUP_IO_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`KopelaEQ startup ${label} timed out; continuing with fallback.`);
      resolve(fallback);
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } catch (error) {
    console.warn(`KopelaEQ startup ${label} failed; continuing with fallback.`, error);
    return fallback;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

function cacheElements(): void {
  if (!els.statusText || !els.eqCanvas || !els.powerToggle) throw new Error('KopelaEQ popup markup is incomplete.');
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
  const payload: Extract<BackgroundMessage, { type: typeof S.MessageType.StateSet }> = { type: S.MessageType.StateSet, state: structuredClone(state), persist, tabId: activeTabId, revision: stateIntentGeneration };
  const selection = presetUi?.selection;
  if (selection?.dirty) payload.presetSelection = selection.name;
  return payload;
}

function schedulePersist(): void {
  // Audio-state persistence is background-owned. Every dispatched StateSet is
  // durably serialized there, so popup lifetime cannot cancel the final write.
}

function fireAndReport(operation: Promise<unknown>): void {
  void operation.catch((error: unknown) => setStatus(error instanceof Error ? error.message : String(error), true));
}


function sendStateRealtime(persistNow = false, syncGroups: readonly ControlSyncGroup[] = ALL_CONTROL_GROUPS): Promise<unknown> {
  state = S.normalizeAudioState(state);
  stateIntentGeneration += 1;
  updateControlState(syncGroups);
  if (syncGroups.includes('bandEditor')) eqUi?.queueDraw();
  const sentName = presetUi?.selection.name || '';
  const request = message(statePayload(persistNow)).then((result) => {
    presetUi?.markSelectionPersisted(sentName);
    return result;
  });
  if (!persistNow) {
    // Background performs single-flight/latest-wins collapse. Dispatch every
    // input intent immediately so closing the popup cannot strand the final RAF.
    fireAndReport(request);
    return Promise.resolve();
  }
  return request;
}


function markEdited(): void { presetUi?.markEdited(); }
function capitalize(value: unknown): string { const s = String(value || ''); return s ? s[0].toUpperCase() + s.slice(1) : ''; }
function formatFrequency(value: unknown): string { const n = Number(value); return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 1 : 2).replace(/\.0+$/, '')} kHz` : `${Math.round(n)} Hz`; }
function setButtonState(id: string, enabled: boolean, label = enabled ? 'On' : 'Off'): void {
  els[id]?.classList.toggle('is-on', enabled);
  const span = els[id]?.querySelector('[data-state-label]') || els[id]?.querySelector('span'); if (span) span.textContent = label;
}

type ControlSyncGroup = 'gain' | 'dynamics' | 'stereo' | 'effects' | 'protection' | 'analyzer' | 'capture' | 'bandEditor';
const ALL_CONTROL_GROUPS: readonly ControlSyncGroup[] = ['gain', 'dynamics', 'stereo', 'effects', 'protection', 'analyzer', 'capture', 'bandEditor'];

function syncGainControls(): void {
  els.gainSlider.value = String(state.gainDb);
  els.gainReadout.textContent = `${state.gainDb >= 0 ? '+' : ''}${state.gainDb.toFixed(1)} dB`;
  els.gainPercentReadout.textContent = `${Math.round(S.dbToLinear(state.gainDb) * 100)}%`;
  const gp = ((state.gainDb - S.GAIN_DB_MIN) / (S.GAIN_DB_MAX - S.GAIN_DB_MIN)) * 100;
  els.gainSlider.style.setProperty('--gain-position', `${Math.max(0, Math.min(100, gp))}%`);
  els.gainResetButton.disabled = Math.abs(state.gainDb) < 0.0001;
}

function syncDynamicsControls(): void {
  els.dynamicsEnabled.checked = state.dynamics.enabled;
  els.normalModeButton.classList.toggle('active', state.dynamics.mode === 'normal');
  els.multibandModeButton.classList.toggle('active', state.dynamics.mode === 'multiband');
  els.dynamicsAmount.value = String(Math.round(state.dynamics.amount * 100)); els.dynamicsAmountReadout.textContent = `${Math.round(state.dynamics.amount * 100)}%`;
  els.dynamicsResponse.value = String(Math.round(state.dynamics.response * 100)); els.dynamicsResponseReadout.textContent = `${Math.round(state.dynamics.response * 100)}%`;
  els.lowCrossover.value = String(state.dynamics.lowCrossoverHz); els.lowCrossoverReadout.textContent = `${Math.round(state.dynamics.lowCrossoverHz)} Hz`;
  els.highCrossover.value = String(state.dynamics.highCrossoverHz); els.highCrossoverReadout.textContent = formatFrequency(state.dynamics.highCrossoverHz);
  const dyn = S.dynamicParams(state.dynamics);
  els.dynThresholdReadout.textContent = `${dyn.threshold.toFixed(1)} dB`; els.dynRatioReadout.textContent = `${dyn.ratio.toFixed(1)}:1`;
  els.dynAttackReadout.textContent = `${(dyn.attack * 1000).toFixed(1)} ms`; els.dynReleaseReadout.textContent = `${Math.round(dyn.release * 1000)} ms`;
  els.crossoverFields.hidden = state.dynamics.mode !== 'multiband';
  setButtonState('dynamicsButton', state.dynamics.enabled, state.dynamics.enabled ? (state.dynamics.mode === 'multiband' ? '3-band' : 'On') : 'Off');
}

function syncStereoControls(): void {
  els.stereoEnabled.checked = state.stereo.enabled; els.stereoWidth.value = String(Math.round(state.stereo.width * 100));
  els.stereoWidth.disabled = state.stereo.mono; els.stereoWidthReadout.textContent = state.stereo.mono ? 'Mono' : `${Math.round(state.stereo.width * 100)}%`;
  els.stereoBalance.value = String(Math.round(state.stereo.balance * 100)); els.stereoBalanceReadout.textContent = `${Math.round(state.stereo.balance * 100)}%`;
  for (const [id, active] of [['stereoMonoButton', state.stereo.mono], ['stereoSwapButton', state.stereo.swap]] as const) { els[id].classList.toggle('active', active); els[id].setAttribute('aria-pressed', String(active)); }
  setButtonState('stereoButton', state.stereo.enabled, state.stereo.enabled ? (state.stereo.mono ? 'Mono' : `${Math.round(state.stereo.width * 100)}%`) : 'Off');
  if (els.stereoPanel) { els.stereoPanel.style.setProperty('--stereo-ratio', String(Math.max(0, Math.min(1, state.stereo.width / 2)))); els.stereoPanel.dataset.widthLabel = state.stereo.mono ? 'MONO' : `${Math.round(state.stereo.width * 100)}%`; }
}

function syncEffectsControls(): void {
  els.pitchEnabled.checked = state.pitchShift.enabled; els.pitchSemitones.value = String(state.pitchShift.semitones);
  els.pitchSemitonesReadout.textContent = `${state.pitchShift.semitones} st`;
  els.pitchLatencyReadout.textContent = `~${Math.round(pitchShiftLatencyMs(engineSampleRate))} ms`;
  setButtonState('pitchButton', state.pitchShift.enabled && state.pitchShift.semitones < 0, state.pitchShift.enabled ? `${state.pitchShift.semitones} st` : 'Off');
  els.reverbEnabled.checked = state.reverb.enabled; els.reverbMix.value = String(Math.round(state.reverb.mix * 100)); els.reverbMixReadout.textContent = `${Math.round(state.reverb.mix * 100)}%`;
  for (const button of els.reverbTypeOptions.querySelectorAll<HTMLElement>('[data-reverb-type]')) button.classList.toggle('active', button.dataset.reverbType === state.reverb.type);
  setButtonState('reverbButton', state.reverb.enabled, state.reverb.enabled ? capitalize(state.reverb.type) : 'Off');
  els.autoPanEnabled.checked = state.autoPan.enabled; els.autoPanRate.value = String(state.autoPan.rateHz); els.autoPanRateReadout.textContent = `${state.autoPan.rateHz.toFixed(2)} Hz`;
  els.autoPanDepth.value = String(Math.round(state.autoPan.depth * 100)); els.autoPanDepthReadout.textContent = `${Math.round(state.autoPan.depth * 100)}%`; setButtonState('autoPanButton', state.autoPan.enabled);
  const activeEffects = [
    state.pitchShift.enabled && state.pitchShift.semitones !== 0,
    state.reverb.enabled && state.reverb.mix > 0.0001,
    state.autoPan.enabled && state.autoPan.depth > 0.0001
  ].filter(Boolean).length;
  setButtonState('effectsButton', activeEffects > 0, activeEffects > 0 ? `${activeEffects} active` : 'Off');
}

function syncProtectionControls(): void {
  const pspan = els.protectionButton.querySelector('[data-state-label]') || els.protectionButton.querySelector('span'); if (pspan) pspan.textContent = capitalize(protection);
  if (els.footerProtection) els.footerProtection.textContent = capitalize(protection);
  for (const button of els.protectionOptions.querySelectorAll<HTMLElement>('[data-protection]')) button.classList.toggle('active', button.dataset.protection === protection);
}

function syncAnalyzerControls(): void {
  els.analyzerToggle.setAttribute('aria-pressed', String(analyzerEnabled)); const analyzerLabel = els.analyzerToggle.querySelector<HTMLElement>('span'); if (analyzerLabel) analyzerLabel.textContent = analyzerEnabled ? 'On' : 'Off';
  els.spectrumFreezeButton.setAttribute('aria-pressed', String(spectrumFrozen)); els.spectrumFreezeButton.textContent = spectrumFrozen ? 'Frozen' : 'Freeze'; els.spectrumFreezeButton.disabled = !analyzerEnabled;
  for (const button of els.spectrumModeOptions.querySelectorAll<HTMLElement>('[data-spectrum-mode]')) button.classList.toggle('active', button.dataset.spectrumMode === spectrumMode);
}

function syncCaptureControls(): void {
  els.powerToggle.setAttribute('aria-pressed', String(captureActive)); els.powerText.textContent = capturePending ? 'Starting…' : (captureActive ? 'On' : 'Off');
  els.powerToggle.disabled = capturePending || activeTabId === null || !activeTabCapturable;
}

function updateControlState(groups: readonly ControlSyncGroup[] = ALL_CONTROL_GROUPS): void {
  for (const group of groups) {
    if (group === 'gain') syncGainControls();
    else if (group === 'dynamics') syncDynamicsControls();
    else if (group === 'stereo') syncStereoControls();
    else if (group === 'effects') syncEffectsControls();
    else if (group === 'protection') syncProtectionControls();
    else if (group === 'analyzer') syncAnalyzerControls();
    else if (group === 'capture') syncCaptureControls();
    else eqUi?.syncBandEditor();
  }
}

function isCapturableTab(tab: ChromeTab | null | undefined): boolean {
  if (!tab || !Number.isInteger(tab.id)) return false;
  return !/^(chrome|edge|about|chrome-extension|devtools):/i.test(typeof tab.url === 'string' ? tab.url : '');
}

async function getActiveTab(): Promise<ChromeTab | null> {
  const tabs = await bounded(chrome.tabs.query({ active: true, currentWindow: true }), [] as ChromeTab[], 'active-tab query');
  const tab = tabs?.[0] ?? null;
  activeTabId = tab && Number.isInteger(tab.id) ? Number(tab.id) : null; activeTabCapturable = isCapturableTab(tab);
  if (els.activeTabTitle) els.activeTabTitle.textContent = String(tab?.title || 'Current tab').trim() || 'Current tab';
  if (els.activeTabHost) {
    let host = 'No web audio tab';
    try { host = tab?.url ? new URL(tab.url).hostname.replace(/^www\./, '') || 'Current page' : host; } catch { /* keep fallback */ }
    els.activeTabHost.textContent = host;
  }
  return tab;
}

async function refreshCaptureStatus(): Promise<void> {
  if (activeTabId === null) return;
  const requestGeneration = ++captureStatusGeneration;
  const stateGenerationAtStart = stateIntentGeneration;
  const protectionGenerationAtStart = protectionIntentGeneration;
  const captureGenerationAtStart = captureIntentGeneration;
  const result = await message({ type: S.MessageType.StatusGet, tabId: activeTabId });
  if (requestGeneration !== captureStatusGeneration) return;

  if (captureGenerationAtStart === captureIntentGeneration) {
    captureActive = result.active === true;
    capturePending = result.pending === true;
  }
  if (stateGenerationAtStart === stateIntentGeneration && result.stateAuthoritative !== false && result.state) {
    state = S.normalizeAudioState(result.state);
  }
  if (protectionGenerationAtStart === protectionIntentGeneration && result.protectionAuthoritative !== false && result.protection) {
    protection = S.normalizeProtection(result.protection);
  }
  if (Number(result.sampleRate) >= 8000) {
    engineSampleRate = Math.round(Number(result.sampleRate));
    if (eqUi?.setSampleRate(engineSampleRate)) eqUi.queueDraw();
  }
  updateControlState();
  if (result.phase === 'recovering') setStatus('Reconnecting audio…');
  else if (captureActive && result.trackMuted === true) setStatus('Waiting for tab audio…');
  else setStatus(captureActive ? 'Processing current tab' : 'Processing stopped');
}

async function toggleCapture(): Promise<void> {
  if (activeTabId === null || !activeTabCapturable || capturePending) return;
  captureIntentGeneration += 1;
  captureStatusGeneration += 1;
  capturePending = true; updateControlState(['capture']);
  try {
    if (captureActive) { await message({ type: S.MessageType.CaptureStop, tabId: activeTabId }); captureActive = false; setStatus('Processing stopped'); }
    else { stateIntentGeneration += 1; protectionIntentGeneration += 1; await message(statePayload(true)); await message({ type: S.MessageType.ProtectionSet, protection, revision: protectionIntentGeneration }); await message({ type: S.MessageType.CaptureStart, tabId: activeTabId }); captureActive = true; setStatus('Processing current tab'); }
  } catch (error: unknown) { captureActive = false; setStatus(error instanceof Error ? error.message : String(error), true); try { await refreshCaptureStatus(); } catch { /* preserve root error */ } }
  finally { capturePending = false; updateControlState(['capture']); }
}

function protectionRank(value: ProtectionMode): number { return ({ off: 0, light: 1, medium: 2, strong: 3 })[value] ?? 3; }
async function setProtection(value: unknown): Promise<void> {
  const next = S.normalizeProtection(value); if (protectionRank(next) < protectionRank(protection) && !confirm('Lower clip protection can allow peaks to distort when Gain or EQ is aggressive. Continue?')) return;
  const previous = protection; protection = next; protectionIntentGeneration += 1; updateControlState(['protection']);
  const requestGeneration = protectionIntentGeneration;
  try { await message({ type: S.MessageType.ProtectionSet, protection, revision: requestGeneration }); setStatus(`Protection: ${capitalize(protection)}`); }
  catch (error: unknown) { if (requestGeneration === protectionIntentGeneration) { protection = previous; updateControlState(['protection']); } setStatus(error instanceof Error ? error.message : String(error), true); }
}

function bindRange(element: HTMLInputElement, group: ControlSyncGroup, update: () => void): void {
  element.addEventListener('input', () => { update(); fireAndReport(sendStateRealtime(false, [group])); });
  element.addEventListener('change', () => { update(); fireAndReport(sendStateRealtime(true, [group])); });
}
function bindAudioControls(): void {
  bindRange(els.gainSlider, 'gain', () => {
    const raw = Number(els.gainSlider.value);
    state.gainDb = Math.abs(raw) <= 0.25 ? 0 : raw;
    if (state.gainDb === 0 && raw !== 0) els.gainSlider.value = '0';
  });
  els.gainResetButton.addEventListener('click', () => { state.gainDb = 0; fireAndReport(sendStateRealtime(true, ['gain'])); setStatus('Gain reset to 0 dB'); });
  els.gainSlider.addEventListener('dblclick', () => { state.gainDb = 0; fireAndReport(sendStateRealtime(true, ['gain'])); setStatus('Gain reset to 0 dB'); });
  els.resetButton.addEventListener('click', () => { const defaults = S.defaultAudioState(); state.gainDb = defaults.gainDb; state.eq = defaults.eq; markEdited(); fireAndReport(sendStateRealtime(true, ['gain', 'bandEditor'])); setStatus('Gain and EQ reset'); });
  els.dynamicsEnabled.addEventListener('change', () => { state.dynamics.enabled = els.dynamicsEnabled.checked; fireAndReport(sendStateRealtime(true, ['dynamics'])); });
  els.normalModeButton.addEventListener('click', () => { state.dynamics.mode = 'normal'; fireAndReport(sendStateRealtime(true, ['dynamics'])); }); els.multibandModeButton.addEventListener('click', () => { state.dynamics.mode = 'multiband'; fireAndReport(sendStateRealtime(true, ['dynamics'])); });
  bindRange(els.dynamicsAmount, 'dynamics', () => { state.dynamics.amount = Number(els.dynamicsAmount.value) / 100; }); bindRange(els.dynamicsResponse, 'dynamics', () => { state.dynamics.response = Number(els.dynamicsResponse.value) / 100; });
  bindRange(els.lowCrossover, 'dynamics', () => { state.dynamics.lowCrossoverHz = Number(els.lowCrossover.value); if (state.dynamics.highCrossoverHz < state.dynamics.lowCrossoverHz + 400) state.dynamics.highCrossoverHz = state.dynamics.lowCrossoverHz + 400; });
  bindRange(els.highCrossover, 'dynamics', () => { state.dynamics.highCrossoverHz = Math.max(Number(els.highCrossover.value), state.dynamics.lowCrossoverHz + 400); });

  els.stereoEnabled.addEventListener('change', () => { state.stereo.enabled = els.stereoEnabled.checked; fireAndReport(sendStateRealtime(true, ['stereo'])); }); bindRange(els.stereoWidth, 'stereo', () => { state.stereo.width = Number(els.stereoWidth.value) / 100; }); bindRange(els.stereoBalance, 'stereo', () => { state.stereo.balance = Number(els.stereoBalance.value) / 100; });
  els.stereoMonoButton.addEventListener('click', () => { state.stereo.mono = !state.stereo.mono; fireAndReport(sendStateRealtime(true, ['stereo'])); }); els.stereoSwapButton.addEventListener('click', () => { state.stereo.swap = !state.stereo.swap; fireAndReport(sendStateRealtime(true, ['stereo'])); });
  els.pitchEnabled.addEventListener('change', () => { state.pitchShift.enabled = els.pitchEnabled.checked; fireAndReport(sendStateRealtime(true, ['effects'])); }); bindRange(els.pitchSemitones, 'effects', () => { state.pitchShift.semitones = Number(els.pitchSemitones.value); });
  els.reverbEnabled.addEventListener('change', () => { state.reverb.enabled = els.reverbEnabled.checked; fireAndReport(sendStateRealtime(true, ['effects'])); }); bindRange(els.reverbMix, 'effects', () => { state.reverb.mix = Number(els.reverbMix.value) / 100; });
  els.reverbTypeOptions.addEventListener('click', (event: Event) => { const type = ((event.target as Element | null)?.closest('[data-reverb-type]') as HTMLElement | null)?.dataset.reverbType; if (type === 'room' || type === 'hall' || type === 'plate') { state.reverb.type = type; fireAndReport(sendStateRealtime(true, ['effects'])); } });
  els.autoPanEnabled.addEventListener('change', () => { state.autoPan.enabled = els.autoPanEnabled.checked; fireAndReport(sendStateRealtime(true, ['effects'])); }); bindRange(els.autoPanRate, 'effects', () => { state.autoPan.rateHz = Number(els.autoPanRate.value); }); bindRange(els.autoPanDepth, 'effects', () => { state.autoPan.depth = Number(els.autoPanDepth.value) / 100; });

  els.analyzerToggle.addEventListener('click', async () => { const previous = analyzerEnabled; analyzerEnabled = !analyzerEnabled; if (!analyzerEnabled) spectrumFrozen = false; updateControlState(['analyzer']); eqUi.queueDraw(); try { await chrome.storage.local.set({ [S.STORAGE.VISUALIZER]: analyzerEnabled }); } catch (error: unknown) { analyzerEnabled = previous; updateControlState(['analyzer']); setStatus(error instanceof Error ? error.message : String(error), true); } });
  els.spectrumModeOptions.addEventListener('click', async (event: Event) => { const next = ((event.target as Element | null)?.closest('[data-spectrum-mode]') as HTMLElement | null)?.dataset.spectrumMode; if (next !== 'fast' && next !== 'balanced' && next !== 'smooth') return; spectrumMode = next; spectrumFrozen = false; updateControlState(['analyzer']); try { await chrome.storage.local.set({ [S.STORAGE.SPECTRUM_MODE]: spectrumMode }); } catch (error: unknown) { setStatus(error instanceof Error ? error.message : String(error), true); } });
  els.spectrumFreezeButton.addEventListener('click', () => { spectrumFrozen = !spectrumFrozen; updateControlState(['analyzer']); if (!spectrumFrozen) void meterUi.pollMeters(); });
  els.powerToggle.addEventListener('click', () => { void toggleCapture(); }); els.protectionOptions.addEventListener('click', (event: Event) => { const button = (event.target as Element | null)?.closest('[data-protection]') as HTMLElement | null; if (button) void setProtection(button.dataset.protection); });
}

function bindRuntimeStatusEvents(): void {
  chrome.runtime?.onMessage?.addListener((incoming: unknown) => {
    const record = incoming && typeof incoming === 'object' && !Array.isArray(incoming) ? incoming as Record<string, unknown> : null;
    if (!record || record.type !== S.MessageType.SessionEnded || Number(record.tabId) !== activeTabId) return false;
    captureStatusGeneration += 1;
    captureActive = false; capturePending = true; lastSpectrum = null; meterUi.reset(); updateControlState(['capture']); meterUi.updateMeterUi(); setStatus('Reconnecting audio…'); eqUi.queueDraw();
    setTimeout(() => { void refreshCaptureStatus().catch(() => undefined); }, 180); return false;
  });
}

async function ensureAppearanceUi(): Promise<AppearanceUI> {
  if (appearanceUi) return appearanceUi;
  if (!appearanceUiPromise) {
    const qaCtor = (globalThis as typeof globalThis & { __KopelaAppearanceUiCtor?: unknown }).__KopelaAppearanceUiCtor as (new (options: { elements: PopupElements; service: AppearanceService; onError: (text: string) => void; onStatus: (text: string) => void }) => AppearanceUI) | undefined;
    const moduleLoad = qaCtor ? Promise.resolve({ AppearanceUI: qaCtor }) : import('./appearance/appearance-ui.js');
    appearanceUiPromise = Promise.all([
      appearance.ensureCustomThemesLoaded().catch((error: unknown) => {
        console.warn('KopelaEQ custom theme library unavailable in editor:', error);
      }),
      moduleLoad
    ]).then(([, { AppearanceUI }]) => {
      const ui = new AppearanceUI({ elements: els, service: appearance, onError: (text: string) => setStatus(text, true), onStatus: setStatus });
      ui.bind();
      appearanceUi = ui;
      return ui;
    }).catch((error) => { appearanceUiPromise = null; throw error; });
  }
  return appearanceUiPromise;
}

async function init(): Promise<void> {
  cacheElements();
  appearance = new AppearanceService();

  // Theme identity, local audio settings and active-tab metadata are independent.
  // Run them together so popup startup is bounded by the slowest read instead of
  // paying each storage/IPC round trip serially.
  const appearanceLoad = appearance.load().catch((error) => {
    console.error('KopelaEQ appearance startup recovered:', error);
    appearance.recoverToRice();
  }).finally(() => document.documentElement.classList.remove('appearance-loading'));
  const localLoad = bounded(
    chrome.storage.local.get([S.STORAGE.AUDIO_STATE, S.STORAGE.PROTECTION, S.STORAGE.WORKSPACE, S.STORAGE.VISUALIZER, S.STORAGE.SPECTRUM_MODE]) as Promise<Record<string, unknown>>,
    {} as Record<string, unknown>,
    'settings storage'
  );
  const tabLoad = getActiveTab();
  const [, local, tab] = await Promise.all([appearanceLoad, localLoad, tabLoad]);

  state = S.normalizeAudioState(local[S.STORAGE.AUDIO_STATE]); protection = S.normalizeProtection(local[S.STORAGE.PROTECTION]);
  workspace = local[S.STORAGE.WORKSPACE] && typeof local[S.STORAGE.WORKSPACE] === 'object' && !Array.isArray(local[S.STORAGE.WORKSPACE]) ? local[S.STORAGE.WORKSPACE] as WorkspaceState : {};
  analyzerEnabled = local[S.STORAGE.VISUALIZER] !== false; spectrumMode = ['fast','balanced','smooth'].includes(String(local[S.STORAGE.SPECTRUM_MODE])) ? local[S.STORAGE.SPECTRUM_MODE] as SpectrumMode : 'balanced';

  presetUi = new PresetUI({ elements: els, getState: () => state, setState: (next: AudioState) => { state = next; }, getActiveTabId: () => activeTabId, onStateChange: (persist) => sendStateRealtime(persist), onStatus: setStatus, onError: (text) => setStatus(text, true) });
  eqUi = new EqUI({ elements: els, getState: () => state, onStateChange: (persist) => { fireAndReport(sendStateRealtime(persist, ['bandEditor'])); }, onEdited: markEdited, schedulePersist, getAnalyzerState: () => ({ enabled: analyzerEnabled, spectrum: lastSpectrum }), getAppearance: () => appearance.currentEqAppearance });
  appearance.addEventListener('surfacepreview', (event: Event) => {
    const detail = (event as CustomEvent<{ keys?: string[] }>).detail;
    if ((detail?.keys || []).some((key) => ['eqColor','eqOpacity','accentColor','eqCurveColor','textColor','mutedTextColor'].includes(key))) eqUi?.queueDraw();
  });
  appearance.addEventListener('surfacechange', () => eqUi?.queueDraw());
  meterUi = new MeterUI({ elements: els, getRuntime: () => ({ captureActive, activeTabId, protection, analyzerEnabled, spectrumFrozen, spectrumMode }), requestMeter: (tabId, spectrum, mode, levels) => message({ type: S.MessageType.MeterGet, tabId, spectrum, spectrumMode: mode, levels }), onCaptureStopped: () => { captureActive = false; updateControlState(['capture']); }, onSpectrum: (spectrum) => { lastSpectrum = spectrum; }, onDraw: () => eqUi.queueDraw(), onStatus: setStatus, onError: (text) => setStatus(text, true) });

  const presetLoad = presetUi.loadPresets();
  bindAudioControls(); presetUi.bind(); eqUi.bind(); meterUi.bind();
  const panels = new PanelManager({
    elements: els, workspace, onError: (text) => setStatus(text, true),
    onPanelOpen: (panelId) => {
      eqUi.closeBandEditor();
      if (panelId === 'appearancePanel') void ensureAppearanceUi().catch((error: unknown) => setStatus(error instanceof Error ? error.message : String(error), true));
    }
  }); panels.bind();
  appearance.addEventListener('change', () => {
    eqUi.queueDraw();
    requestAnimationFrame(() => panels.restoreVisible());
  });
  bindRuntimeStatusEvents();
  if (!tab) setStatus('No active tab', true); else if (!activeTabCapturable) setStatus('Open a normal web page with audio', true);

  // Capture status and preset restoration are independent after the preset map
  // has loaded. Start capture IPC immediately instead of paying both round trips
  // serially on every popup open.
  updateControlState(); meterUi.updateMeterUi(); eqUi.queueDraw();

  // First interaction no longer waits for background IPC/preset restoration.
  // These independent enrichments update the already-live UI when they arrive.
  void bounded(refreshCaptureStatus(), undefined, 'capture status', 500).catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : String(error), true);
  });
  void presetLoad.then(() =>
    bounded(presetUi.restoreSelectedPreset(), undefined, 'preset selection', 500)
  ).catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : String(error), true);
  });
  setInterval(() => { void meterUi.pollMeters(); }, 100);
  window.addEventListener('resize', () => { panels.restoreVisible(); eqUi.queueDraw(); });
}

void init().catch((error: unknown) => { console.error(error); if (els.statusText) setStatus(error instanceof Error ? error.message : String(error), true); });
