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
const sessionProtectionRevision = new Map<number, number>();
let audioContext: AudioContext | null = null;
let globalState: AudioState = normalizeAudioState(null);
let globalProtection: ProtectionMode = 'strong';
let globalStateRevision = 0;
let globalProtectionRevision = 0;
let contextResumeInFlight: Promise<void> | null = null;
let pitchWorkletContext: AudioContext | null = null;
let pitchWorkletLoad: Promise<void> | null = null;


function pitchRequested(state: AudioState): boolean {
  return state.pitchShift.enabled && Math.abs(state.pitchShift.semitones) > 0.0001;
}

async function ensurePitchWorklet(context: AudioContext): Promise<void> {
  if (pitchWorkletContext === context) return;
  if (!context.audioWorklet) throw new Error('AudioWorklet is unavailable in this Chrome build.');
  if (pitchWorkletLoad) return pitchWorkletLoad;
  pitchWorkletLoad = context.audioWorklet
    .addModule(chrome.runtime.getURL('js/audio/pitch-worklet-processor.js'))
    .then(() => { pitchWorkletContext = context; })
    .finally(() => { pitchWorkletLoad = null; });
  return pitchWorkletLoad;
}

function messageRevision(value: unknown, fallback: number): number {
  const revision = Number(value);
  return Number.isInteger(revision) && revision >= 0 ? revision : fallback;
}

async function applyStateToSession(session: AudioSession, state: AudioState, revision: number): Promise<boolean> {
  const tabId = session.tabId;
  const previousRevision = sessionStateRevision.get(tabId) ?? -1;
  if (revision < previousRevision) return false;
  // Claim the revision before any await. If a newer request arrives while the
  // worklet module loads, the post-await guard prevents this request applying.
  sessionStateRevision.set(tabId, revision);
  if (pitchRequested(state)) {
    await ensurePitchWorklet(session.context);
    if (sessionStateRevision.get(tabId) !== revision) return false;
    session.ensurePitchProcessor();
  }
  if (sessionStateRevision.get(tabId) !== revision) return false;
  session.applyState(state);
  return true;
}

function applyProtectionToSession(session: AudioSession, value: ProtectionMode, revision: number): boolean {
  const previousRevision = sessionProtectionRevision.get(session.tabId) ?? -1;
  if (revision < previousRevision) return false;
  sessionProtectionRevision.set(session.tabId, revision);
  session.applyProtection(value);
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

async function ensureAudioContextRunning(): Promise<void> {
  const context = audioContext;
  if (!context || context.state !== 'suspended' || !sessions.size) return;
  if (contextResumeInFlight) return contextResumeInFlight;
  contextResumeInFlight = context.resume().catch(() => undefined).finally(() => { contextResumeInFlight = null; });
  return contextResumeInFlight;
}

function bindAudioContextHealth(context: AudioContext): void {
  context.addEventListener('statechange', () => {
    if (audioContext !== context || !sessions.size) return;
    if (context.state === 'suspended') void ensureAudioContextRunning();
  });
}

async function getAudioContext(): Promise<AudioContext> {
  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new AudioContext({ latencyHint: 'playback' });
    bindAudioContextHealth(audioContext);
  }
  if (audioContext.state === 'suspended') {
    try { await audioContext.resume(); } catch { /* stream may not be ready yet */ }
  }
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
  sessionProtectionRevision.delete(tabId);
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
    if (sessionGeneration.get(tabId) !== generation) throw new Error('Audio capture was cancelled.');
    const session = new AudioSession(context, tabId, stream, globalState, globalProtection, {
      onEnded: handleSessionEnded,
      onHealthChange: handleSessionHealthChange,
      pitchWorkletReady: pitchWorkletContext === context
    });
    sessions.set(tabId, session);
    sessionStateRevision.set(tabId, globalStateRevision);
    sessionProtectionRevision.set(tabId, globalProtectionRevision);
    if (context.state === 'suspended') await context.resume();
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
    if (message.protection) applyProtectionToSession(existing, normalizeProtection(message.protection), protectionRevision);
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
      if (message.protection) applyProtectionToSession(session, normalizeProtection(message.protection), protectionRevision);
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
    sessionProtectionRevision.delete(id);
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
      if (revision >= globalProtectionRevision) {
        globalProtection = next;
        globalProtectionRevision = revision;
      }
      for (const session of sessions.values()) applyProtectionToSession(session, next, revision);
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
