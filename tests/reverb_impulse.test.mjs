import assert from 'node:assert/strict';
import { generateReverbImpulseChannel } from '../extension/js/audio/reverb-impulse.js';

const sampleRate = 48000;

function rms(data, start, end) {
  let sum = 0;
  let count = 0;
  for (let i = start; i < Math.min(end, data.length); i += 1) {
    sum += data[i] * data[i];
    count += 1;
  }
  return Math.sqrt(sum / Math.max(1, count));
}

// A normalized first-difference estimate is a cheap broadband proxy for how
// much high-frequency energy remains in a section of the tail.
function highFrequencyRatio(data, start, end) {
  let diff = 0;
  let signal = 0;
  let count = 0;
  for (let i = Math.max(1, start); i < Math.min(end, data.length); i += 1) {
    const value = data[i];
    const delta = value - data[i - 1];
    diff += delta * delta;
    signal += value * value;
    count += 1;
  }
  return Math.sqrt(diff / Math.max(1, count)) / Math.max(1e-12, Math.sqrt(signal / Math.max(1, count)));
}

function correlation(a, b) {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return ab / Math.sqrt(aa * bb);
}

const lateWindowStart = { room: 0.28, plate: 0.48, hall: 0.8 };

for (const type of ['room', 'hall', 'plate']) {
  const left = generateReverbImpulseChannel(sampleRate, type, 0);
  const right = generateReverbImpulseChannel(sampleRate, type, 1);
  const repeat = generateReverbImpulseChannel(sampleRate, type, 0);

  // The generator is deterministic so a preset sounds the same every time.
  assert.deepEqual(left, repeat, `${type}: IR must be deterministic`);

  // No full-level diffuse noise at t=0: the first 2 ms stay silent and the
  // diffuse field has clearly risen by ~28-40 ms.
  assert.ok(rms(left, 0, Math.round(sampleRate * 0.002)) < 1e-8, `${type}: diffuse attack starts too abruptly`);
  assert.ok(rms(left, Math.round(sampleRate * 0.028), Math.round(sampleRate * 0.040)) > 0.01, `${type}: diffuse field did not ramp in`);

  // Progressive damping: the late tail must contain materially less relative
  // high-frequency movement than the early diffuse tail.
  const earlyHf = highFrequencyRatio(left, Math.round(sampleRate * 0.060), Math.round(sampleRate * 0.120));
  const lateStart = lateWindowStart[type];
  const lateHf = highFrequencyRatio(left, Math.round(sampleRate * lateStart), Math.round(sampleRate * (lateStart + 0.060)));
  assert.ok(lateHf < earlyHf * 0.9, `${type}: tail is not darkening enough (${lateHf} vs ${earlyHf})`);

  // Independent channel noise + non-identical early-reflection timing should
  // decorrelate stereo naturally without a shared periodic AM oscillator.
  assert.ok(Math.abs(correlation(left, right)) < 0.05, `${type}: stereo IR channels are too correlated`);
}

console.log('reverb_impulse.test.mjs: PASS');
