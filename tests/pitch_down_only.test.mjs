import assert from 'node:assert/strict';
import { normalizeAudioState, normalizePitchShift } from '../extension/js/shared/state.js';

assert.deepEqual(normalizePitchShift({ enabled: true, semitones: -7 }), { enabled: true, semitones: -7 });
assert.deepEqual(normalizePitchShift({ enabled: true, semitones: 5 }), { enabled: true, semitones: 0 });
assert.deepEqual(normalizePitchShift({ enabled: true, semitones: 99 }), { enabled: true, semitones: 0 });
assert.deepEqual(normalizePitchShift({ enabled: true, semitones: -99 }), { enabled: true, semitones: -12 });

const legacy = normalizeAudioState({
  pitchShift: { enabled: true, semitones: 7 },
  delay: { enabled: true, timeMs: 420, feedback: 0.5, mix: 0.4 },
  exciter: { enabled: true, amount: 0.8, frequencyHz: 6000 },
});
assert.equal(legacy.pitchShift.semitones, 0, 'saved positive Pitch must migrate to neutral');
assert.equal(legacy.delay.enabled, false, 'retired Delay must normalize disabled');
assert.equal(legacy.exciter.enabled, false, 'retired Exciter must normalize disabled');

console.log('pitch_down_only.test.mjs: PASS (positive Pitch clamped; Delay/Exciter retired)');
