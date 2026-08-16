import {
  MessageType,
  assertNever,
  normalizeAudioState,
  normalizeProtection,
  parseOffscreenMessage
} from '../shared/index.js';
import type { AudioState, ProtectionMode } from '../shared/types.js';
import type { OffscreenMessage } from '../shared/messages.js';
import { AudioSession } from '../audio/audio-session.js';
import type { AudioSessionHealth } from '../audio/audio-session.js';

const sessions = new Map<number, AudioSession>();
const pendingSessions = new Map<number, Promise<{ ok: true }>>();
const sessionGeneration = new Map<number, number>();
const sessionStateRevision = new Map<number, number>();
const sessionStateRequestRevision = new Map<number, number>();
const sessionProtectionRevision = new Map<number, number>();
const sessionProtectionRequestRevision = new Map<number, number>();
let audioContext: AudioContext | null = null;
let globalState: AudioState = normalizeAudioState(null);
let globalProtection: ProtectionMode = 'strong';
let globalStateRevision = 0;
let globalProtectionRevision = 0;
let contextResumeInFlight: Promise<boolean> | null = null;
let pitchWorkletContext: AudioContext | null = null;
let pitchWorkletLoad: Promise<void> | null = null;
let maximumLimiterWorkletContext: AudioContext | null = null;
let maximumLimiterWorkletLoad: Promise<void> | null = null;

const AUDIO_CONTEXT_RESUME_ATTEMPTS = 4;
const AUDIO_CONTEXT_RESUME_RETRY_MS = 90;

function pitchRequested(state: AudioState): boolean {
  return state.pitchShift.enabled && Math.abs(state.pitchShift.semitones) > 0.0001;
}

function maximumProtectionRequested(value: ProtectionMode): boolean {
  return value === 'maximum';
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensurePitchWorklet(context: AudioContext): Promise<void> {
  if (pitchWorkletContext === context) return;
  if (!context.audioWorklet) throw new Error('AudioWorklet is unavailable in this Chrome build.');
  if (pitchWorkletLoad) return pitchWorkletLoad;
  const url = chrome.runtime.getURL('js/audio/pitch-worklet-processor.js');
  pitchWorkletLoad = (async () => {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await context.audioWorklet.addModule(url);
        pitchWorkletContext = context;
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await wait(80 * (attempt + 1));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Pitch AudioWorklet failed to load.'));
  })().finally(() => { pitchWorkletLoad = null; });
  return pitchWorkletLoad;
}

async function ensureMaximumLimiterWorklet(context: AudioContext): Promise<void> {
  if (maximumLimiterWorkletContext === context) return;
  if (!context.audioWorklet) throw new Error('AudioWorklet is unavailable in this Chrome build.');
  if (maximumLimiterWorkletLoad) return maximumLimiterWorkletLoad;
  const url = chrome.runtime.getURL('js/audio/true-peak-limiter-processor.js');
  maximumLimiterWorkletLoad = (async () => {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await context.audioWorklet.addModule(url);
        maximumLimiterWorkletContext = context;
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await wait(80 * (attempt + 1));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Maximum limiter AudioWorklet failed to load.'));
  })().finally(() => { maximumLimiterWorkletLoad = null; });
  return maximumLimiterWorkletLoad;
}

function messageRevision(value: unknown, fallback: number): number {
  const revision = Number(value);
  return Number.isInteger(revision) && revision >= 0 ? revision : fallback;
}

async function applyStateToSession(session: AudioSession, state: AudioState, revision: number): Promise<boolean> {
  const tabId = session.tabId;
  const appliedRevision = sessionStateRevision.get(tabId) ?? -1;
  const requestedRevision = sessionStateRequestRevision.get(tabId) ?? appliedRevision;
  if (revision < appliedRevision || revision < requestedRevision) return false;

  // Request revision and applied revision are intentionally separate. A pitch
  // worklet load can fail or be superseded while awaiting; failed work must not
  // be advertised by SessionStatus as if the audio graph had already applied it.
  sessionStateRequestRevision.set(tabId, revision);
  if (pitchRequested(state)) {
    await ensurePitchWorklet(session.context);
    if (sessionStateRequestRevision.get(tabId) !== revision) return false;
    session.ensurePitchProcessor();
  }
  if (sessionStateRequestRevision.get(tabId) !== revision) return false;
  session.applyState(state);
  sessionStateRevision.set(tabId, revision);
  return true;
}

async function applyProtectionToSession(session: AudioSession, value: ProtectionMode, revision: number): Promise<boolean> {
  const tabId = session.tabId;
  const appliedRevision = sessionProtectionRevision.get(tabId) ?? -1;
  const requestedRevision = sessionProtectionRequestRevision.get(tabId) ?? appliedRevision;
  if (revision < appliedRevision || revision < requestedRevision) return false;

  sessionProtectionRequestRevision.set(tabId, revision);
  if (maximumProtectionRequested(value)) {
    await ensureMaximumLimiterWorklet(session.context);
    if (sessionProtectionRequestRevision.get(tabId) !== revision) return false;
    session.ensureMaximumLimiterProcessor();
  }
  if (sessionProtectionRequestRevision.get(tabId) !== revision) return false;
  session.applyProtection(value);
  sessionProtectionRevision.set(tabId, revision);
  return true;
}

function validTabId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function isExpectedCancellation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /audio capture was cancelled/i.test(message);
}

async function resumeAudioContext(context: AudioContext, attempts = AUDIO_CONTEXT_RESUME_ATTEMPTS): Promise<boolean> {
  const state = (): AudioContextState => context.state as AudioContextState;
  if (state() === 'running') return true;
  if (state() === 'closed') return false;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { await context.resume(); } catch { /* retry below */ }
    if (state() === 'running') return true;
    if (state() === 'closed') return false;
    if (attempt + 1 < attempts) await wait(AUDIO_CONTEXT_RESUME_RETRY_MS * (attempt + 1));
  }
  return state() === 'running';
}

async function ensureAudioContextRunning(): Promise<boolean> {
  const context = audioContext;
  if (!context) return false;
  if (context.state === 'running') return true;
  if (context.state === 'closed') return false;
  if (!sessions.size) return false;
  if (contextResumeInFlight) return contextResumeInFlight;
  contextResumeInFlight = resumeAudioContext(context).finally(() => { contextResumeInFlight = null; });
  return contextResumeInFlight;
}

function bindAudioContextHealth(context: AudioContext): void {
  context.addEventListener('statechange', () => {
    if (audioContext !== context || !sessions.size || context.state === 'running') return;
    void ensureAudioContextRunning().then((running) => {
      if (running || audioContext !== context) return;
      // tabCapture suppresses the tab's native playback. If our output context
      // cannot resume, tell background immediately so it can release/recover
      // capture instead of leaving the user with a silently captured tab.
      for (const session of sessions.values()) void handleSessionHealthChange(session.tabId, session.health());
    });
  });
}

async function getAudioContext(): Promise<AudioContext> {
  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new AudioContext({ latencyHint: 'playback' });
    bindAudioContextHealth(audioContext);
  }
  // Best-effort warm resume before taking ownership of tab audio. A second,
  // strict resume happens after getUserMedia because active capture can make
  // Web Audio eligible to run even when this early attempt was suspended.
  if (audioContext.state !== 'running') await resumeAudioContext(audioContext, 2);
  return audioContext;
}

function maybeSuspendContext(): void {
  if (!sessions.size && !pendingSessions.size && audioContext && audioContext.state === 'running') {
    void audioContext.suspend().catch(() => undefined);
  }
}

async function handleSessionEnded(tabId: number): Promise<void> {
  sessions.delete(tabId);
  sessionStateRevision.delete(tabId);
  sessionStateRequestRevision.delete(tabId);
  sessionProtectionRevision.delete(tabId);
  sessionProtectionRequestRevision.delete(tabId);
  try { await chrome.runtime.sendMessage({ type: MessageType.SessionEnded, tabId, reason: 'track-ended' }); } catch { /* worker may be restarting */ }
  maybeSuspendContext();
}

async function handleSessionHealthChange(tabId: number, health: AudioSessionHealth): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: MessageType.SessionHealthChanged,
      tabId,
      trackMuted: health.trackMuted,
      trackReadyState: health.trackReadyState,
      contextState: health.contextState
    });
  } catch { /* popup/worker may be unavailable transiently */ }
}

async function createSession(
  message: Extract<OffscreenMessage, { type: typeof MessageType.CaptureStart }>,
  tabId: number,
  generation: number
): Promise<{ ok: true }> {
  const context = await getAudioContext();
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // Chrome tabCapture's stream id uses these Chromium-specific legacy constraints.
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: message.streamId
        }
      } as MediaTrackConstraints,
      video: false
    });

    if (sessionGeneration.get(tabId) !== generation) {
      for (const track of stream.getTracks()) {
        try { track.stop(); } catch { /* no-op */ }
      }
      throw new Error('Audio capture was cancelled.');
    }

    const incomingStateRevision = message.stateRevision;
    const incomingProtectionRevision = message.protectionRevision;
    if (incomingStateRevision >= globalStateRevision) {
      globalState = normalizeAudioState(message.state || globalState);
      globalStateRevision = incomingStateRevision;
    }
    if (incomingProtectionRevision >= globalProtectionRevision) {
      globalProtection = normalizeProtection(message.protection || globalProtection);
      globalProtectionRevision = incomingProtectionRevision;
    }
    // StateSet may have advanced globalState while getUserMedia was pending.
    // Always construct from the newest accepted global snapshot.
    if (pitchRequested(globalState)) await ensurePitchWorklet(context);
    if (maximumProtectionRequested(globalProtection)) await ensureMaximumLimiterWorklet(context);
    if (sessionGeneration.get(tabId) !== generation) throw new Error('Audio capture was cancelled.');
    const session = new AudioSession(context, tabId, stream, globalState, globalProtection, {
      onEnded: handleSessionEnded,
      onHealthChange: handleSessionHealthChange,
      pitchWorkletReady: pitchWorkletContext === context,
      maximumLimiterWorkletReady: maximumLimiterWorkletContext === context
    });
    // Do not advertise capture as active until local playback is actually live.
    // Chrome suppresses native tab playback as soon as the tab MediaStream is
    // consumed, so accepting a suspended AudioContext would create total silence.
    if (!(await resumeAudioContext(context))) {
      session.dispose();
      throw new Error('Audio output could not start because the AudioContext remained suspended.');
    }
    sessions.set(tabId, session);
    sessionStateRevision.set(tabId, globalStateRevision);
    sessionStateRequestRevision.set(tabId, globalStateRevision);
    sessionProtectionRevision.set(tabId, globalProtectionRevision);
    sessionProtectionRequestRevision.set(tabId, globalProtectionRevision);
    return { ok: true };
  } catch (error) {
    if (stream && !sessions.has(tabId)) {
      for (const track of stream.getTracks()) {
        try { track.stop(); } catch { /* no-op */ }
      }
    }
    throw error;
  }
}

async function startSession(message: Extract<OffscreenMessage, { type: typeof MessageType.CaptureStart }>): Promise<Record<string, unknown>> {
  const tabId = validTabId(message.tabId);
  if (tabId === null || !message.streamId) throw new Error('Invalid capture request.');

  const existing = sessions.get(tabId);
  if (existing) {
    const stateRevision = message.stateRevision;
    const protectionRevision = message.protectionRevision;
    if (message.state) await applyStateToSession(existing, normalizeAudioState(message.state), stateRevision);
    if (message.protection) await applyProtectionToSession(existing, normalizeProtection(message.protection), protectionRevision);
    return { ok: true, alreadyActive: true };
  }

  const pending = pendingSessions.get(tabId);
  if (pending) {
    await pending;
    const session = sessions.get(tabId);
    if (session) {
      const stateRevision = message.stateRevision;
      const protectionRevision = message.protectionRevision;
      if (message.state) await applyStateToSession(session, normalizeAudioState(message.state), stateRevision);
      if (message.protection) await applyProtectionToSession(session, normalizeProtection(message.protection), protectionRevision);
      return { ok: true, alreadyActive: true };
    }
  }

  const generation = (sessionGeneration.get(tabId) || 0) + 1;
  sessionGeneration.set(tabId, generation);
  const task = createSession(message, tabId, generation);
  pendingSessions.set(tabId, task);
  try {
    return await task;
  } finally {
    if (pendingSessions.get(tabId) === task) pendingSessions.delete(tabId);
  }
}

function stopSession(tabId: unknown): { ok: true } {
  const id = validTabId(tabId);
  if (id === null) return { ok: true };
  sessionGeneration.set(id, (sessionGeneration.get(id) || 0) + 1);
  const session = sessions.get(id);
  if (session) {
    session.dispose();
    sessions.delete(id);
    sessionStateRevision.delete(id);
    sessionStateRequestRevision.delete(id);
    sessionProtectionRevision.delete(id);
    sessionProtectionRequestRevision.delete(id);
  }
  maybeSuspendContext();
  return { ok: true };
}

async function handleMessage(message: OffscreenMessage): Promise<Record<string, unknown>> {
  switch (message.type) {
    case MessageType.CaptureStart:
      return startSession(message);
    case MessageType.CaptureStop:
      return stopSession(message.tabId);
    case MessageType.SessionStatus: {
      await ensureAudioContextRunning();
      const tabId = validTabId(message.tabId);
      const session = tabId !== null ? sessions.get(tabId) : undefined;
      const health = session?.health();
      return {
        ok: true,
        active: Boolean(session),
        activeTabs: [...sessions.keys()],
        pendingTabs: [...pendingSessions.keys()],
        state: session ? session.state : null,
        protection: session ? session.protection : globalProtection,
        stateRevision: session && tabId !== null ? (sessionStateRevision.get(tabId) ?? globalStateRevision) : globalStateRevision,
        protectionRevision: session && tabId !== null ? (sessionProtectionRevision.get(tabId) ?? globalProtectionRevision) : globalProtectionRevision,
        sampleRate: session ? session.context.sampleRate : (audioContext && audioContext.state !== 'closed' ? audioContext.sampleRate : null),
        trackReadyState: health?.trackReadyState ?? null,
        trackMuted: health?.trackMuted ?? null,
        trackEnabled: health?.trackEnabled ?? null,
        contextState: health?.contextState ?? (audioContext?.state ?? null)
      };
    }
    case MessageType.StateSet: {
      const revision = messageRevision(message.revision, globalStateRevision + 1);
      const next = normalizeAudioState(message.state);
      if (revision >= globalStateRevision) {
        globalState = next;
        globalStateRevision = revision;
      }
      const tabId = validTabId(message.tabId);
      if (tabId !== null) {
        const session = sessions.get(tabId);
        if (session) await applyStateToSession(session, next, revision);
        return { ok: true, active: Boolean(session), revision: globalStateRevision };
      }
      await Promise.all([...sessions.values()].map((session) => applyStateToSession(session, next, revision)));
      return { ok: true, active: sessions.size > 0, revision: globalStateRevision };
    }
    case MessageType.ProtectionSet: {
      const revision = messageRevision(message.revision, globalProtectionRevision + 1);
      const next = normalizeProtection(message.protection);
      if (revision < globalProtectionRevision) return { ok: true, revision: globalProtectionRevision };

      // Build/apply runtime first. In particular, Maximum must not become the
      // advertised global mode until its AudioWorklet was actually loaded and
      // every live session accepted the new path. Background will roll back with
      // a newer revision if this operation reports an error.
      await Promise.all([...sessions.values()].map((session) => applyProtectionToSession(session, next, revision)));
      if (revision >= globalProtectionRevision) {
        globalProtection = next;
        globalProtectionRevision = revision;
      }
      return { ok: true, revision: globalProtectionRevision };
    }
    case MessageType.MeterGet: {
      await ensureAudioContextRunning();
      const session = sessions.get(validTabId(message.tabId) ?? -1);
      return session
        ? { ok: true, active: true, meter: session.getMeter(message.spectrum === true, message.spectrumMode ?? 'balanced', message.levels !== false) }
        : { ok: true, active: false, meter: null };
    }
    default:
      return assertNever(message);
  }
}

chrome.runtime.onMessage.addListener((rawMessage: unknown, _sender: unknown, sendResponse: (value: unknown) => void) => {
  const message = parseOffscreenMessage(rawMessage);
  if (!message) return false;
  void handleMessage(message).then(sendResponse).catch((error: unknown) => {
    if (!isExpectedCancellation(error)) console.error('KopelaEQ offscreen error:', error);
    const text = error instanceof Error ? error.message : String(error);
    sendResponse({ ok: false, error: text });
  });
  return true;
});
