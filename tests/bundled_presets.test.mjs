import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_PRESETS as defaults } from '../extension/js/shared/default-presets.js';
const ref = JSON.parse(fs.readFileSync(new URL('./fixtures/EarsAudioToolkitPresets-reference.json', import.meta.url), 'utf8'));
const labels = {
  '111': 'Vivid (111)',
  'bass2': 'Bass Punch (bass2)',
  'bass3': 'Bass Tight (bass3)',
  'bass4': 'Bass Heavy (bass4)',
  'bass4.2': 'Bass Air (bass4.2)'
};
assert.deepEqual(Object.keys(defaults), Object.values(labels));
for (const [source, label] of Object.entries(labels)) {
  const actual = defaults[label];
  const expected = ref[source];
  assert.ok(actual, `missing ${label}`);
  assert.deepEqual(actual.frequencies, expected.frequencies, `${source}: frequencies changed`);
  assert.deepEqual(actual.gains, expected.gains, `${source}: gains changed`);
  assert.deepEqual(actual.qs, expected.qs, `${source}: Q values changed`);
}
console.log('bundled_presets.test.mjs: PASS — uploaded preset DSP data is byte-for-number identical');
