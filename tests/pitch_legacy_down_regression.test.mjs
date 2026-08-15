import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { GranularPitchShifter } from '../extension/js/audio/pitch-shift-core.js';

const sampleRate = 48000;
const frames = sampleRate * 2;
const input = new Float32Array(frames);
for (let i = 0; i < frames; i += 1) {
  input[i] = 0.32 * Math.sin((2 * Math.PI * 173 * i) / sampleRate)
    + 0.21 * Math.sin((2 * Math.PI * 611 * i) / sampleRate + 0.2)
    + 0.08 * Math.sin((2 * Math.PI * 2300 * i) / sampleRate + 0.7);
}

const expected = new Map([
  [-2, '93a01d945e6a223a0ea55c171b26a5843d3970152efccafa9c62f59d51889ddf'],
  [-7, 'e1218a0e3682f543c3b6b0ae014e57566be4956a82503163d0a7e48f2561293d'],
  [-12, 'f9e77b1188539204d7421cb11064f63f50ddd540dd5c519c61922b0ae8e787a0'],
]);

for (const [shift, expectedHash] of expected) {
  const output = new Float32Array(frames);
  const shifter = new GranularPitchShifter(sampleRate, 1792, 1);
  for (let i = 0; i < frames; i += 128) {
    shifter.processBlock([input.subarray(i, i + 128)], [output.subarray(i, i + 128)], shift);
  }
  const bytes = Buffer.from(output.buffer, output.byteOffset, output.byteLength);
  const actualHash = crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(actualHash, expectedHash, `${shift} st must stay bit-identical to the 1.23.1 down-shift reference`);
}

console.log('pitch_legacy_down_regression.test.mjs: PASS (1.23.1 down-shift hashes preserved)');
