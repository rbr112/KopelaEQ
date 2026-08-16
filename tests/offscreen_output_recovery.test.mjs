import assert from 'node:assert/strict';
import * as S from '../extension/js/shared/index.js';
import { ContextMock as BaseContextMock } from './audio_mocks.mjs';

let listener = null;
let resumeFailures = 2;
let permanentResumeFailure = false;
let resumeCalls = 0;
let stopCount = 0;

class ContextMock extends BaseContextMock {
  constructor() {
    super();
    this.state = 'suspended';
  }
  async resume() {
    resumeCalls += 1;
    if (permanentResumeFailure || resumeFailures > 0) {
      if (resumeFailures > 0) resumeFailures -= 1;
      throw new Error('autoplay resume blocked');
    }
    this.state = 'running';
    this.emit('statechange');
  }
}

globalThis.AudioContext = ContextMock;

function makeStream() {
  const listeners = new Map();
  const track = {
    readyState: 'live', muted: false, enabled: true,
    addEventListener(type, fn) { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); },
    stop() { stopCount += 1; this.readyState = 'ended'; }
  };
  return { getAudioTracks() { return [track]; }, getTracks() { return [track]; } };
}

Object.defineProperty(globalThis, 'navigator', {
  value: { mediaDevices: { async getUserMedia() { return makeStream(); } } }, configurable: true
});

globalThis.chrome = {
  runtime: {
    getURL(path) { return `chrome-extension://test/${path}`; },
    onMessage: { addListener(fn) { listener = fn; } },
    async sendMessage() { return { ok: true }; }
  }
};

await import(`../extension/js/offscreen/index.js?output-recovery=${Date.now()}`);
assert.equal(typeof listener, 'function');

function invoke(message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 2500);
    const handled = listener(message, {}, (value) => { clearTimeout(timer); resolve(value); });
    if (handled === false) { clearTimeout(timer); resolve(undefined); }
  });
}

// Cold start: early resume attempts can fail, but active tab capture makes a
// later retry viable. Capture must not report active until the context runs.
let result = await invoke({
  target: 'offscreen', type: S.MessageType.CaptureStart, tabId: 31, streamId: 'cold',
  state: S.defaultAudioState(), protection: 'strong', stateRevision: 1, protectionRevision: 1
});
assert.equal(result.ok, true);
assert.ok(resumeCalls >= 3, 'cold output should retry AudioContext.resume()');
let status = await invoke({ target: 'offscreen', type: S.MessageType.SessionStatus, tabId: 31 });
assert.equal(status.active, true);
assert.equal(status.contextState, 'running');
await invoke({ target: 'offscreen', type: S.MessageType.CaptureStop, tabId: 31 });

// Permanent output failure: never leave a consumed tabCapture stream active
// while the AudioContext is suspended, otherwise Chrome suppresses native tab
// audio and the user hears silence. The late stream must be released instead.
permanentResumeFailure = true;
const beforeStops = stopCount;
result = await invoke({
  target: 'offscreen', type: S.MessageType.CaptureStart, tabId: 32, streamId: 'blocked',
  state: S.defaultAudioState(), protection: 'strong', stateRevision: 2, protectionRevision: 2
});
assert.equal(result.ok, false);
assert.match(result.error, /AudioContext remained suspended/i);
assert.ok(stopCount > beforeStops, 'failed output startup must release captured tracks');
status = await invoke({ target: 'offscreen', type: S.MessageType.SessionStatus, tabId: 32 });
assert.equal(status.active, false);

console.log('offscreen_output_recovery.test.mjs: PASS');
