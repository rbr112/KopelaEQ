import assert from 'node:assert/strict';
import { MeterUI } from '../extension/js/popup/meter-ui.js';

let resolveFirst;
let calls = 0;
const first = new Promise((resolve) => { resolveFirst = resolve; });
let firstPending = true;
const meterPanel = { hidden: true };
const elements = { meterPanel };
const runtime = {
  captureActive: true,
  activeTabId: 42,
  protection: 'strong',
  analyzerEnabled: true,
  spectrumFrozen: false,
  spectrumMode: 'balanced'
};

const ui = new MeterUI({
  elements,
  getRuntime: () => runtime,
  requestMeter: async () => {
    calls += 1;
    if (firstPending) {
      firstPending = false;
      await first;
    }
    return { ok: true, active: true, meter: null };
  },
  onCaptureStopped() {},
  onSpectrum() {},
  onDraw() {},
  onStatus() {},
  onError(message) { throw new Error(message); }
});

const activePoll = ui.pollMeters();
await Promise.resolve();
await Promise.all([ui.pollMeters(), ui.pollMeters(), ui.pollMeters()]);
assert.equal(calls, 1, 'overlapping ticks must coalesce while a meter request is in flight');
resolveFirst();
await activePoll;
await ui.pollMeters();
assert.equal(calls, 2, 'polling must resume after the in-flight request settles');

console.log('meter_ui_single_flight.test.mjs: PASS');
