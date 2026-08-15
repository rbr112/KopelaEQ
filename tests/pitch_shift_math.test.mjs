import assert from 'node:assert/strict';
import { GranularPitchShifter, pitchShiftLatencyMs } from '../extension/js/audio/pitch-shift-core.js';

const sampleRate = 48000;
const frames = sampleRate * 3;
const input = new Float32Array(frames);
for (let i = 0; i < frames; i += 1) input[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);

function shiftedOutput(semitones) {
  const output = new Float32Array(frames);
  const shifter = new GranularPitchShifter(sampleRate, 1792, 1);
  for (let i = 0; i < frames; i += 128) {
    shifter.processBlock([input.subarray(i, i + 128)], [output.subarray(i, i + 128)], semitones);
  }
  return output;
}

function amplitudeAt(output, frequency) {
  const start = sampleRate;
  let re = 0;
  let im = 0;
  for (let i = start; i < frames; i += 1) {
    const phase = (2 * Math.PI * frequency * i) / sampleRate;
    re += output[i] * Math.cos(phase);
    im -= output[i] * Math.sin(phase);
  }
  return Math.hypot(re, im) / (frames - start);
}

function dominantFrequency(output, low, high) {
  let bestFrequency = low;
  let bestAmplitude = -1;
  for (let frequency = low; frequency <= high; frequency += 1) {
    const amplitude = amplitudeAt(output, frequency);
    if (amplitude > bestAmplitude) { bestAmplitude = amplitude; bestFrequency = frequency; }
  }
  return { frequency: bestFrequency, amplitude: bestAmplitude };
}

const octaveDown = shiftedOutput(-12);
const downPeak = dominantFrequency(octaveDown, 180, 260);
assert.ok(Math.abs(downPeak.frequency - 220) <= 5, `-12 semitones expected ~220 Hz, got ${downPeak.frequency} Hz`);
assert.ok(downPeak.amplitude > amplitudeAt(octaveDown, 440) * 20, '-12 shifted peak must dominate original fundamental');

// Positive values are intentionally unsupported and clamp to neutral in the
// core as a defense-in-depth measure. Public state/UI cannot produce them.
const positiveAttempt = shiftedOutput(12);
const neutralPeak = dominantFrequency(positiveAttempt, 420, 460);
assert.ok(Math.abs(neutralPeak.frequency - 440) <= 3, `positive pitch must clamp to neutral, got ${neutralPeak.frequency} Hz`);

const latencyMs = pitchShiftLatencyMs(sampleRate);
assert.ok(latencyMs > 40 && latencyMs < 60, `expected ~48 ms modeled latency, got ${latencyMs}`);
assert.ok(!/new\s+LegacyDownPitchShifter/.test(pitchShiftLatencyMs.toString()), 'latency helper must remain allocation-free');
for (const rate of [44100, 48000, 96000]) {
  const value = pitchShiftLatencyMs(rate);
  assert.ok(value > 40 && value < 60, `expected stable modeled latency at ${rate} Hz, got ${value}`);
}
console.log(`pitch_shift_math.test.mjs: PASS (-12 peak ${downPeak.frequency} Hz, positive clamp ${neutralPeak.frequency} Hz, latency ${latencyMs.toFixed(1)} ms)`);
