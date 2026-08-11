import {
  MessageType,
  assertNever,
  defaultAudioState,
  normalizeAudioState,
  normalizePresetName,
  normalizeProtection,
  normalizeStereo,
  parseBackgroundMessage,
  STORAGE
} from '../shared/index.js';
import type { AudioState, ProtectionMode } from '../shared/types.js';
import type { BackgroundMessage } from '../shared/messages.js';
import { CaptureManager, validTabId } from './capture-manager.js';

const AUDIO_BASELINE_VERSION = 3;
let audioState: AudioState = defaultAudioState();
let protection: ProtectionMode = 'strong';

async function loadStoredState(): Promise<void> {
  const stored = await chrome.storage.local.get([STORAGE.AUDIO_STATE, STORAGE.PROTECTION, STORAGE.AUDIO_BASELINE_VERSION]);
  audioState = normalizeAudioState(stored[STORAGE.AUDIO_STATE]);
  protection = normalizeProtection(stored[STORAGE.PROTECTION]);

  if (Number(stored[STORAGE.AUDIO_BASELINE_VERSION] || 0) < AUDIO_BASELINE_VERSION) {
    audioState.dynamics.enabled = false;
    audioState.stereo = normalizeStereo(null);
    await chrome.storage.local.set({
      [STORAGE.AUDIO_STATE]: audioState,
      [STORAGE.AUDIO_BASELINE_VERSION]: AUDIO_BASELINE_VERSION
    });
  }
}

const stateReady = loadStoredState().catch((error: unknown) => console.error('KopelaEQ state init:', error));

const captures = new CaptureManager({
  getAudioState: () => audioState,
  getProtection: () => protection
});

const captureReady = stateReady.then(() => captures.reconcileExistingCaptures())
  .catch((error: unknown) => console.warn('KopelaEQ capture reconciliation:', error));

function stringRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function messageTabId(message: { tabId?: unknown }, sender: ChromeMessageSender): number | null {
  const explicit = validTabId(message?.tabId);
  if (explicit !== null) return explicit;
  return validTabId(sender?.tab?.id);
}

async function updateAudioState(next: unknown, persist = true, tabIdValue: unknown = null, presetSelection?: unknown): Promise<Record<string, unknown>> {
  const tabId = validTabId(tabIdValue);
  audioState = normalizeAudioState(next);
  const storageUpdate: Record<string, unknown> = {};
  if (persist) storageUpdate[STORAGE.AUDIO_STATE] = audioState;

  if (presetSelection !== undefined && tabId !== null) {
    const stored = await chrome.storage.local.get(STORAGE.SELECTED_PRESETS);
    const current = stored[STORAGE.SELECTED_PRESETS];
    const map = stringRecord(current);
    const clean = normalizePresetName(presetSelection, '');
    if (clean) map[String(tabId)] = clean;
    else delete map[String(tabId)];
    storageUpdate[STORAGE.SELECTED_PRESETS] = map;
  }
  if (Object.keys(storageUpdate).length) await chrome.storage.local.set(storageUpdate);
  if (tabId !== null) await captures.propagateState(tabId, audioState);
  return {
    ok: true,
    state: audioState,
    presetSelection: presetSelection === undefined ? undefined : normalizePresetName(presetSelection, '')
  };
}

async function updateProtection(next: unknown): Promise<Record<string, unknown>> {
  protection = normalizeProtection(next);
  await chrome.storage.local.set({ [STORAGE.PROTECTION]: protection });
  await captures.propagateProtection(protection);
  return { ok: true, protection };
}

async function getSelectedPreset(tabIdValue: unknown): Promise<Record<string, unknown>> {
  const tabId = validTabId(tabIdValue);
  if (tabId === null) return { ok: true, name: '' };
  const stored = await chrome.storage.local.get(STORAGE.SELECTED_PRESETS);
  const map = stringRecord(stored[STORAGE.SELECTED_PRESETS]);
  return { ok: true, name: typeof map[String(tabId)] === 'string' ? map[String(tabId)] : '' };
}

async function setSelectedPreset(tabIdValue: unknown, name: unknown): Promise<Record<string, unknown>> {
  const tabId = validTabId(tabIdValue);
  if (tabId === null) return { ok: false, error: 'Invalid tab id.' };
  const stored = await chrome.storage.local.get(STORAGE.SELECTED_PRESETS);
  const map = stringRecord(stored[STORAGE.SELECTED_PRESETS]);
  const clean = normalizePresetName(name, '');
  if (clean) map[String(tabId)] = clean;
  else delete map[String(tabId)];
  await chrome.storage.local.set({ [STORAGE.SELECTED_PRESETS]: map });
  return { ok: true, name: clean };
}

async function clearSelectedPresetForTab(tabIdValue: unknown): Promise<void> {
  const tabId = validTabId(tabIdValue);
  if (tabId === null) return;
  const stored = await chrome.storage.local.get(STORAGE.SELECTED_PRESETS);
  const current = stored[STORAGE.SELECTED_PRESETS];
  if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, String(tabId))) return;
  const map = stringRecord(current);
  delete map[String(tabId)];
  await chrome.storage.local.set({ [STORAGE.SELECTED_PRESETS]: map });
}

async function handleMessage(message: BackgroundMessage, sender: ChromeMessageSender): Promise<unknown> {
  switch (message.type) {
    case MessageType.CaptureStart:
      return captures.startCapture(messageTabId(message, sender));
    case MessageType.CaptureStop:
      return captures.stopCapture(messageTabId(message, sender));
    case MessageType.StatusGet:
      return captures.statusForTab(messageTabId(message, sender));
    case MessageType.StateSet:
      return updateAudioState(
        message.state,
        message.persist !== false,
        messageTabId(message, sender),
        Object.prototype.hasOwnProperty.call(message, 'presetSelection') ? message.presetSelection : undefined
      );
    case MessageType.ProtectionSet:
      return updateProtection(message.protection);
    case MessageType.PresetSelectionGet:
      return getSelectedPreset(messageTabId(message, sender));
    case MessageType.PresetSelectionSet:
      return setSelectedPreset(messageTabId(message, sender), message.name);
    case MessageType.MeterGet:
      return captures.meter(messageTabId(message, sender), message.spectrum === true, message.spectrumMode ?? 'balanced', message.levels !== false);
    case MessageType.SessionEnded:
      captures.onSessionEnded(message.tabId);
      return { ok: true };
    case MessageType.SessionHealthChanged:
      captures.onSessionHealthChanged(message.tabId, message.trackMuted, message.trackReadyState, message.contextState);
      return { ok: true };
    default:
      return assertNever(message);
  }
}

chrome.runtime.onMessage.addListener((rawMessage: unknown, sender: ChromeMessageSender, sendResponse: (value?: unknown) => void) => {
  const message = parseBackgroundMessage(rawMessage);
  if (!message) {
    if (rawMessage && typeof rawMessage === 'object' && (rawMessage as Record<string, unknown>).target === 'offscreen') return false;
    sendResponse({ ok: false, error: 'Unknown message.' });
    return false;
  }

  void (async () => {
    await stateReady;
    await captureReady;
    return handleMessage(message, sender);
  })().then(sendResponse).catch((error: unknown) => {
    console.error('KopelaEQ background error:', error);
    const e = error as Error & { code?: string };
    sendResponse({ ok: false, code: e?.code || '', error: e instanceof Error ? e.message : String(error) });
  });
  return true;
});

chrome.tabs.onRemoved.addListener((tabId: number) => {
  void captures.stopCapture(tabId).catch(() => undefined);
  void clearSelectedPresetForTab(tabId).catch(() => undefined);
});

chrome.tabs.onUpdated.addListener((tabId: number, changeInfo: ChromeTabUpdateInfo) => {
  if (typeof changeInfo.audible === 'boolean') captures.onTabAudibleChanged(tabId, changeInfo.audible);
});

if (chrome.tabCapture?.onStatusChanged) {
  chrome.tabCapture.onStatusChanged.addListener((info: ChromeTabCaptureInfo) => captures.onCaptureStatusChanged(info));
}
