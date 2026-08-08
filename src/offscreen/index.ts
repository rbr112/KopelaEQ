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

const sessions = new Map<number, AudioSession>();
const pendingSessions = new Map<number, Promise<{ ok: true }>>();
const sessionGeneration = new Map<number, number>();
let audioContext: AudioContext | null = null;
let globalState: AudioState = normalizeAudioState(null);
let globalProtection: ProtectionMode = 'strong';

function validTabId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function isExpectedCancellation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /audio capture was cancelled/i.test(message);
}

async function getAudioContext(): Promise<AudioContext> {
  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new AudioContext({ latencyHint: 'playback' });
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
  try { await chrome.runtime.sendMessage({ type: MessageType.SessionEnded, tabId }); } catch { /* worker may be restarting */ }
  maybeSuspendContext();
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

    globalState = normalizeAudioState(message.state || globalState);
    globalProtection = normalizeProtection(message.protection || globalProtection);
    const session = new AudioSession(context, tabId, stream, globalState, globalProtection, { onEnded: handleSessionEnded });
    sessions.set(tabId, session);
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
    if (message.state) existing.applyState(message.state);
    if (message.protection) existing.applyProtection(message.protection);
    return { ok: true, alreadyActive: true };
  }

  const pending = pendingSessions.get(tabId);
  if (pending) {
    await pending;
    const session = sessions.get(tabId);
    if (session) {
      if (message.state) session.applyState(message.state);
      if (message.protection) session.applyProtection(message.protection);
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
      const tabId = validTabId(message.tabId);
      const session = tabId !== null ? sessions.get(tabId) : undefined;
      return {
        ok: true,
        active: Boolean(session),
        activeTabs: [...sessions.keys()],
        pendingTabs: [...pendingSessions.keys()],
        state: session ? session.state : null,
        protection: session ? session.protection : globalProtection,
        sampleRate: session ? session.context.sampleRate : (audioContext && audioContext.state !== 'closed' ? audioContext.sampleRate : null)
      };
    }
    case MessageType.StateSet: {
      globalState = normalizeAudioState(message.state);
      const tabId = validTabId(message.tabId);
      if (tabId !== null) {
        const session = sessions.get(tabId);
        if (session) session.applyState(globalState);
        return { ok: true, active: Boolean(session) };
      }
      return { ok: true, active: false };
    }
    case MessageType.ProtectionSet:
      globalProtection = normalizeProtection(message.protection);
      for (const session of sessions.values()) session.applyProtection(globalProtection);
      return { ok: true };
    case MessageType.MeterGet: {
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
