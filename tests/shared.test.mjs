import assert from 'node:assert/strict';
import * as S from '../extension/js/shared/index.js';
import { DEFAULT_PRESETS as defaults } from '../extension/js/shared/default-presets.js';

assert.equal(S.SCHEMA_VERSION, 4);
assert.equal(S.FREQ_MIN, 5);
assert.equal(S.FREQ_MAX, 20000);
assert.equal(Object.keys(defaults).length, 5);

const legacy = defaults['Bass Punch (bass2)'];
const migrated = S.normalizeAudioState(legacy);
assert.equal(migrated.schemaVersion, 4);
assert.equal(migrated.eq.frequencies.length, 11);
assert.equal(migrated.eq.gains[0], legacy.gains[0]);
assert.equal(migrated.eq.qs[10], legacy.qs[10]);
assert.equal(migrated.dynamics.enabled, false);
assert.equal(migrated.dynamics.amount, 0.35);
assert.equal(migrated.dynamics.response, 0.5);
assert.equal(migrated.dynamics.lowCrossoverHz, 180);
assert.equal(migrated.dynamics.highCrossoverHz, 4500);
assert.equal(migrated.stereo.enabled, false);
assert.equal(migrated.stereo.width, 1);
assert.equal(migrated.stereo.balance, 0);

const preset = S.audioStateToPreset('Test', migrated);
assert.equal(preset.name, 'Test');
assert.equal('protection' in preset, false);
assert.equal(preset.dynamics.enabled, false);
assert.equal('stereo' in preset, false);

const enabled = S.normalizeAudioState({
  ...migrated,
  dynamics: { enabled: true, mode: 'multiband', amount: 2, response: -1, lowCrossoverHz: 900, highCrossoverHz: 1000 },
  stereo: { enabled: true, width: 9, balance: -9, mono: true, swap: true }
});
assert.equal(enabled.dynamics.enabled, true);
assert.equal(enabled.dynamics.mode, 'multiband');
assert.equal(enabled.dynamics.amount, 1);
assert.equal(enabled.dynamics.response, 0);
assert.equal(enabled.dynamics.lowCrossoverHz, 800);
assert.equal(enabled.dynamics.highCrossoverHz, 1200);
assert.equal(enabled.stereo.enabled, true);
assert.equal(enabled.stereo.width, 2);
assert.equal(enabled.stereo.balance, -1);
assert.equal(enabled.stereo.mono, true);
assert.equal(enabled.stereo.swap, true);
assert.equal(S.effectiveStereoWidth(enabled.stereo), 0);
assert.equal(enabled.reverb.enabled, false);
assert.equal(enabled.delay.enabled, false);
assert.equal(enabled.autoPan.enabled, false);
assert.equal(enabled.exciter.enabled, false);
assert.equal(enabled.pitchShift.enabled, false);

const imported = S.validateImportText(JSON.stringify({ bass2: legacy }));
assert.equal(Object.keys(imported).length, 1);
assert.equal(imported.bass2.dynamics.enabled, false);
assert.equal('stereo' in imported.bass2, false);

assert.equal(S.normalizePresetName('__proto__'), '');
assert.equal(S.normalizePresetName('constructor'), '');
assert.equal(S.normalizePresetName('  Good Name  '), 'Good Name');
const many = {};
for (let i = 0; i < 105; i += 1) many[`P${i}`] = legacy;
assert.equal(Object.keys(S.normalizePresetMap(many)).length, S.MAX_PRESETS);
const base99 = {};
for (let i = 0; i < 99; i += 1) base99[`B${i}`] = legacy;
const merge = S.mergePresetMaps(base99, { B0: legacy, New1: legacy, New2: legacy });
assert.equal(Object.keys(merge.presets).length, 100);
assert.equal(merge.imported, 2);
assert.equal(merge.skipped, 1);
const poison = Object.create(null);
poison.__proto__ = legacy;
assert.throws(() => S.validateImportText(JSON.stringify({ presets: poison })), /No valid presets/);

const weird = S.normalizeAudioState({ gainDb: Infinity, frequencies: Array(11).fill(NaN), gains: Array(11).fill(999), qs: Array(11).fill(-100) });
assert.equal(weird.gainDb, -30);
assert.deepEqual(weird.eq.frequencies, S.DEFAULT_FREQUENCIES);
assert.ok(weird.eq.gains.every((v) => v === 30));
assert.ok(weird.eq.qs.every((v) => v === 0.2));

const params = S.dynamicParams({ enabled: true, amount: 0.5, response: 0.5 });
assert.ok(params.ratio > 1 && params.ratio < 8.1);
assert.ok(params.attack >= 0.003 && params.release >= 0.07);

const renamed = S.migrateBundledPresetNames({ Vivid: defaults['Vivid (111)'], 'Bass Punch': defaults['Bass Punch (bass2)'] });
assert.ok(renamed['Vivid (111)']);
assert.ok(renamed['Bass Punch (bass2)']);
assert.equal(renamed.Vivid, undefined);
assert.deepEqual(S.PROTECTION_PROFILES.maximum,S.PROTECTION_PROFILES.strong,'Maximum primary stage must stay identical to Strong; extra safety is post-effects only');
assert.equal(S.normalizeProtection(undefined), 'strong');
assert.equal(S.normalizeProtection('maximum'), 'maximum');
assert.ok(S.PROTECTION_PROFILES.strong.threshold >= -0.2);
assert.ok(S.PROTECTION_PROFILES.strong.knee <= 0.2);
assert.ok(S.PROTECTION_PROFILES.strong.release <= 0.05);

console.log('shared.test.mjs: PASS');
