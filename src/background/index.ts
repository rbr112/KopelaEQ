import {
  MessageType,
  assertNever,
  defaultAudioState,
  normalizeAudioState,
  normalizePresetName,
  normalizeProtection,
  normalizeDynamics,
  normalizeStereo,
  normalizeReverb,
  normalizeDelay,
  normalizeAutoPan,
  normalizeExciter,
  normalizePitchShift,
  parseBackgroundMessage,
  STORAGE
} from '../shared/index.js';
import type { AudioState, ProtectionMode } from '../shared/types.js';
import type { BackgroundMessage } from '../shared/messages.js';
import { CaptureManager, validTabId } from './capture-manager.js';
import { LatestWinsWriter } from '../shared/latest-wins.js';
import { ensurePreloadedUserMedia } from './preloaded-media.js';
import { settleBounded } from '../shared/bounded.js';

const AUDIO_BASELINE_VERSION = 4;
const BACKGROUND_STORAGE_TIMEOUT_MS = 1400;
const CAPTURE_RECONCILE_TIMEOUT_MS = 4200;
const STORAGE_RETRY_DELAY_MS = 650;

let audioState: AudioState = defaultAudioState();
let protection: ProtectionMode = 'strong';
let stateRevision = 0;
let protectionRevision = 0;
let stateAuthoritative = false;
let protectionAuthoritative = false;
let selectedPresetMutation: Promise<void> = Promise.resolve();
let storageRetryTimer: ReturnType<typeof setTimeout> | null = null;

const stateStorageWriter = new LatestWinsWriter<AudioState>(async ({ value }) => {
  await chrome.storage.local.set({
    [STORAGE.AUDIO_STATE]: value,
    [STORAGE.AUDIO_BASELINE_VERSION]: AUDIO_BASELINE_VERSION
  });
});

const protectionStorageWriter = new LatestWinsWriter<ProtectionMode>(async ({ value }) => {
  await chrome.storage.local.set({ [STORAGE.PROTECTION]: value });
});

const captures = new CaptureManager({
  getAudioState: () => audioState,
  getProtection: () => protection,
  getStateRevision: () => stateRevision,
  getProtectionRevision: () => protectionRevision,
  isStateAuthoritative: () => stateAuthoritative,
  isProtectionAuthoritative: () => protectionAuthoritative,
  rebaseStateRevision: (remoteRevision: number) => {
    if (Number.isInteger(remoteRevision) && remoteRevision >= stateRevision) stateRevision = remoteRevision + 1;
    return stateRevision;
  },
  rebaseProtectionRevision: (remoteRevision: number) => {
    if (Number.isInteger(remoteRevision) && remoteRevision >= protectionRevision) protectionRevision = remoteRevision + 1;
    return protectionRevision;
  }
});

function stringRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function migrateStoredAudioState(value: unknown): AudioState {
  const next = normalizeAudioState(value);
  next.dynamics = normalizeDynamics({ ...next.dynamics, enabled: false });
  next.stereo = normalizeStereo({ ...next.stereo, enabled: false });
  next.reverb = normalizeReverb({ ...next.reverb, enabled: false });
  next.delay = normalizeDelay({ ...next.delay, enabled: false });
  next.autoPan = normalizeAutoPan({ ...next.autoPan, enabled: false });
  next.exciter = normalizeExciter({ ...next.exciter, enabled: false });
  next.pitchShift = normalizePitchShift({ ...next.pitchShift, enabled: false });
  return next;
}

async function mutateSelectedPresetMap<T>(mutator: (map: Record<string, unknown>) => T): Promise<T> {
  let resolveValue!: (value: T | PromiseLike<T>) => void;
  let rejectValue!: (reason?: unknown) => void;
  const result = new Promise<T>((resolve, reject) => { resolveValue = resolve; rejectValue = reject; });
  const run = async () => {
    try {
      const stored = await chrome.storage.local.get(STORAGE.SELECTED_PRESETS);
      const map = stringRecord(stored[STORAGE.SELECTED_PRESETS]);
      const value = mutator(map);
      await chrome.storage.local.set({ [STORAGE.SELECTED_PRESETS]: map });
      resolveValue(value);
    } catch (error) {
      rejectValue(error);
    }
  };
  selectedPresetMutation = selectedPresetMutation.then(run, run).then(() => undefined, () => undefined);
  return result;
}

async function waitForSelectedPresetMutations(): Promise<void> {
  await selectedPresetMutation;
}

async function applyStoredSnapshot(stored: Record<string, unknown>): Promise<void> {
  const baselineVersion = Number(stored[STORAGE.AUDIO_BASELINE_VERSION] || 0);
  let syncState = false;
  let syncProtection = false;

  // Startup storage may finish after the popup has already changed settings.
  // Only hydrate a slice that has not received a newer user intent.
  if (!stateAuthoritative && stateRevision === 0) {
    audioState = baselineVersion < AUDIO_BASELINE_VERSION
      ? migrateStoredAudioState(stored[STORAGE.AUDIO_STATE])
      : normalizeAudioState(stored[STORAGE.AUDIO_STATE]);
    stateAuthoritative = true;
    syncState = true;
    if (baselineVersion < AUDIO_BASELINE_VERSION) {
      await stateStorageWriter.submit({ revision: stateRevision, value: audioState });
    }
  }

  if (!protectionAuthoritative && protectionRevision === 0) {
    protection = normalizeProtection(stored[STORAGE.PROTECTION]);
    protectionAuthoritative = true;
    syncProtection = true;
  }

  // A capture may have been started from temporary safe defaults while storage
  // was slow. Once the real snapshot arrives, converge the running engine too.
  if (syncState) void captures.propagateStateToAll(audioState, stateRevision).catch(() => undefined);
  if (syncProtection) void captures.propagateProtection(protection, protectionRevision).catch(() => undefined);
}

function scheduleStorageAuthorityRetry(): void {
  if ((stateAuthoritative && protectionAuthoritative) || storageRetryTimer !== null) return;
  storageRetryTimer = setTimeout(() => {
    storageRetryTimer = null;
    void loadStoredState().catch((error: unknown) => console.warn('KopelaEQ state retry:', error));
  }, STORAGE_RETRY_DELAY_MS);
}

async function loadStoredState(): Promise<void> {
  if (stateAuthoritative && protectionAuthoritative) return;
  const pending = chrome.storage.local.get([STORAGE.AUDIO_STATE, STORAGE.PROTECTION, STORAGE.AUDIO_BASELINE_VERSION]);
  const result = await settleBounded(pending, BACKGROUND_STORAGE_TIMEOUT_MS);
  if (result.status === 'ok') {
    await applyStoredSnapshot(result.value);
    return;
  }

  if (result.status === 'timeout') {
    console.warn('KopelaEQ background storage read deferred; defaults are temporary and non-authoritative.');
    // The Chrome promise is not cancellable. Accept its eventual value only if no
    // newer user mutation won the slice in the meantime.
    void pending.then(applyStoredSnapshot).catch(() => scheduleStorageAuthorityRetry());
  } else {
    console.warn('KopelaEQ background storage read failed; retrying without persisting fallbacks.', result.error);
  }
  scheduleStorageAuthorityRetry();
}

const stateReady = loadStoredState().catch((error: unknown) => {
  console.error('KopelaEQ state init:', error);
  scheduleStorageAuthorityRetry();
});

// Appearance media is a one-time install/update migration. Never run it on
// ordinary service-worker startup: popup status requests should not compete
// with appearance migration storage I/O.
(chrome.runtime as ChromeRuntimeApi & { onInstalled?: { addListener(callback: (details?: { reason?: string }) => void): void } }).onInstalled?.addListener((details) => {
  void ensurePreloadedUserMedia(details?.reason === 'install').catch((error: unknown) => console.warn('KopelaEQ media install seed:', error));
});

const captureReady = stateReady.then(async () => {
  const result = await settleBounded(captures.reconcileExistingCaptures(), CAPTURE_RECONCILE_TIMEOUT_MS);
  if (result.status === 'timeout') console.warn('KopelaEQ capture reconciliation timed out; destructive recovery was skipped.');
  else if (result.status === 'error') console.warn('KopelaEQ capture reconciliation:', result.error);
}).catch((error: unknown) => console.warn('KopelaEQ capture reconciliation:', error));

function messageTabId(message: { tabId?: unknown }, sender: ChromeMessageSender): number | null {
  const explicit = validTabId(message?.tabId);
  if (explicit !== null) return explicit;
  return validTabId(sender?.tab?.id);
}

async function updateAudioState(next: unknown, tabIdValue: unknown = null, presetSelection?: unknown): Promise<Record<string, unknown>> {
  const tabId = validTabId(tabIdValue);
  const normalized = normalizeAudioState(next);
  const revision = ++stateRevision;
  audioState = normalized;
  stateAuthoritative = true;

  const presetWrite = presetSelection !== undefined && tabId !== null
    ? mutateSelectedPresetMap((map) => {
        const clean = normalizePresetName(presetSelection, '');
        if (clean) map[String(tabId)] = clean;
        else delete map[String(tabId)];
        return clean;
      })
    : Promise.resolve(undefined);

  // Persistence and audio propagation start together. Each path is serialized
  // independently and collapses queued intermediate drag states to the newest.
  await Promise.all([
    stateStorageWriter.submit({ revision, value: normalized }),
    presetWrite,
    tabId !== null ? captures.propagateState(tabId, normalized, revision) : Promise.resolve(false)
  ]);

  return {
    ok: true,
    state: audioState,
    revision: stateRevision,
    presetSelection: presetSelection === undefined ? undefined : normalizePresetName(presetSelection, '')
  };
}

async function updateProtection(next: unknown): Promise<Record<string, unknown>> {
  const normalized = normalizeProtection(next);
  const previous = protection;
  const revision = ++protectionRevision;
  protection = normalized;
  protectionAuthoritative = true;

  try {
    // Runtime first: Maximum needs an AudioWorklet. Do not durably persist a mode
    // the active engine could not actually construct. Inactive captures return
    // immediately and the preference is still persisted normally.
    await captures.propagateProtection(normalized, revision);
    if (revision === protectionRevision) {
      await protectionStorageWriter.submit({ revision, value: normalized });
    }
    return { ok: true, protection, revision: protectionRevision };
  } catch (error) {
    // If this is still the newest intent, converge memory/runtime/storage back to
    // the last working mode. A newer user click owns the state and must not be
    // undone by an older failed Maximum request.
    if (revision === protectionRevision) {
      protection = previous;
      const rollbackRevision = ++protectionRevision;
      await captures.propagateProtection(previous, rollbackRevision).catch(() => undefined);
      await protectionStorageWriter.submit({ revision: rollbackRevision, value: previous }).catch(() => undefined);
    }
    throw error;
  }
}

async function getSelectedPreset(tabIdValue: unknown): Promise<Record<string, unknown>> {
  const tabId = validTabId(tabIdValue);
  if (tabId === null) return { ok: true, name: '' };
  await waitForSelectedPresetMutations();
  const stored = await chrome.storage.local.get(STORAGE.SELECTED_PRESETS);
  const map = stringRecord(stored[STORAGE.SELECTED_PRESETS]);
  return { ok: true, name: typeof map[String(tabId)] === 'string' ? map[String(tabId)] : '' };
}

async function setSelectedPreset(tabIdValue: unknown, name: unknown): Promise<Record<string, unknown>> {
  const tabId = validTabId(tabIdValue);
  if (tabId === null) return { ok: false, error: 'Invalid tab id.' };
  const clean = await mutateSelectedPresetMap((map) => {
    const normalized = normalizePresetName(name, '');
    if (normalized) map[String(tabId)] = normalized;
    else delete map[String(tabId)];
    return normalized;
  });
  return { ok: true, name: clean };
}

async function clearSelectedPresetForTab(tabIdValue: unknown): Promise<void> {
  const tabId = validTabId(tabIdValue);
  if (tabId === null) return;
  await mutateSelectedPresetMap((map) => {
    delete map[String(tabId)];
    return undefined;
  });
}

async function handleMessage(message: BackgroundMessage, sender: ChromeMessageSender): Promise<unknown> {
  switch (message.type) {
    case MessageType.CaptureStart:
      return captures.startCapture(messageTabId(message, sender));
    case MessageType.CaptureStop:
      return captures.stopCapture(messageTabId(message, sender));
    case MessageType.StatusGet:
      if (!stateAuthoritative || !protectionAuthoritative) scheduleStorageAuthorityRetry();
      return captures.statusForTab(messageTabId(message, sender));
    case MessageType.StateSet:
      return updateAudioState(
        message.state,
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
