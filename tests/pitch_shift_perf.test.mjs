import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { GranularPitchShifter } from '../extension/js/audio/pitch-shift-core.js';

const sampleRate = 48000;
const blockSize = 128;
const iterations = 12000;
const shifter = new GranularPitchShifter(sampleRate, 1792, 2);
const left = new Float32Array(blockSize);
const right = new Float32Array(blockSize);
const outLeft = new Float32Array(blockSize);
const outRight = new Float32Array(blockSize);
let frame = 0;
function fillInput() {
  for (let i = 0; i < blockSize; i += 1) {
    left[i] = 0.6 * Math.sin((2 * Math.PI * 440 * frame) / sampleRate);
    right[i] = 0.5 * Math.sin((2 * Math.PI * 997 * frame) / sampleRate);
    frame += 1;
  }
}
for (let i = 0; i < 768; i += 1) { fillInput(); shifter.processBlock([left, right], [outLeft, outRight], -7); }
const timings = [];
for (let i = 0; i < iterations; i += 1) {
  fillInput();
  const start = performance.now();
  shifter.processBlock([left, right], [outLeft, outRight], i & 1 ? -12 : -7);
  timings.push(performance.now() - start);
}
timings.sort((a, b) => a - b);
const average = timings.reduce((sum, value) => sum + value, 0) / timings.length;
const p95 = timings[Math.floor(timings.length * 0.95)];
const p99 = timings[Math.floor(timings.length * 0.99)];
const max = timings[timings.length - 1];
const callbackBudgetMs = (blockSize / sampleRate) * 1000;
const deadlineMisses = timings.filter((value) => value > callbackBudgetMs).length;
const missRate = deadlineMisses / timings.length;
assert.ok(p95 < callbackBudgetMs * 0.5, `down-pitch core p95 ${p95.toFixed(3)}ms exceeds 50% of callback budget`);
assert.ok(p99 < callbackBudgetMs * 0.5, `down-pitch core p99 ${p99.toFixed(3)}ms exceeds 50% of callback budget`);
// Node can occasionally pause for scheduler/GC work unrelated to the DSP core,
// so do not fail on one isolated max spike. Do fail if deadline misses become a
// measurable pattern (>0.1%), which catches regressions that p95 alone hides.
assert.ok(missRate <= 0.001, `down-pitch core missed ${deadlineMisses}/${iterations} callback budgets (${(missRate * 100).toFixed(3)}%)`);
assert.ok(Number.isFinite(outLeft[0]) && Number.isFinite(outRight[0]), 'processor output must stay finite');
console.log(`pitch_shift_perf.test.mjs: PASS (avg ${average.toFixed(4)} ms, p95 ${p95.toFixed(4)} ms, p99 ${p99.toFixed(4)} ms, max ${max.toFixed(4)} ms, deadline misses ${deadlineMisses}/${iterations}; budget ${callbackBudgetMs.toFixed(4)} ms)`);
