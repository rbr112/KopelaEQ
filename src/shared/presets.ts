import { MAX_IMPORT_BYTES, MAX_PRESETS, BUNDLED_PRESET_RENAMES, SCHEMA_VERSION } from './constants.js';
import type { AudioState, Preset, PresetMap } from './types.js';
import { clone, isLegacyPreset, normalizeAudioState, normalizeStereo, normalizeReverb, normalizeDelay, normalizeAutoPan, normalizeExciter, normalizePitchShift } from './state.js';

const RESERVED_PRESET_NAMES = new Set(['__proto__', 'prototype', 'constructor']);

export function normalizePresetName(value: unknown, fallback = ''): string {
  const name = String(value ?? fallback).trim().slice(0, 80);
  if (!name || RESERVED_PRESET_NAMES.has(name.toLowerCase())) return '';
  return name;
}

export function audioStateToPreset(name: unknown, state: unknown): Preset {
  const normalized = normalizeAudioState(state);
  return {
    schemaVersion: SCHEMA_VERSION,
    name: normalizePresetName(name, 'Preset') || 'Preset',
    gainDb: normalized.gainDb,
    eq: clone(normalized.eq),
    dynamics: clone(normalized.dynamics)
  };
}

export function normalizePreset(name: unknown, value: unknown): Preset {
  if (isLegacyPreset(value)) return audioStateToPreset(name, normalizeAudioState(value));
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return audioStateToPreset(typeof record.name === 'string' ? record.name : name, value);
}

export function normalizePresetMap(value: unknown): PresetMap {
  const src = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const out: PresetMap = Object.create(null) as PresetMap;
  for (const [key, preset] of Object.entries(src)) {
    if (Object.keys(out).length >= MAX_PRESETS) break;
    const record = preset && typeof preset === 'object' ? preset as Record<string, unknown> : {};
    const rawName = typeof record.name === 'string' && record.name.trim() ? record.name : key;
    const name = normalizePresetName(rawName);
    if (!name) continue;
    out[name] = normalizePreset(name, preset);
  }
  return out;
}

export function migrateBundledPresetNames(value: unknown): PresetMap {
  const out = normalizePresetMap(value);
  for (const [oldName, newName] of Object.entries(BUNDLED_PRESET_RENAMES)) {
    if (!Object.prototype.hasOwnProperty.call(out, oldName)) continue;
    if (!Object.prototype.hasOwnProperty.call(out, newName)) out[newName] = audioStateToPreset(newName, out[oldName]);
    delete out[oldName];
  }
  return out;
}

export function mergePresetMaps(base: unknown, incoming: unknown): { presets: PresetMap; imported: number; skipped: number } {
  const out = normalizePresetMap(base);
  const normalizedIncoming = normalizePresetMap(incoming);
  let imported = 0;
  let skipped = 0;
  for (const [name, preset] of Object.entries(normalizedIncoming)) {
    const exists = Object.prototype.hasOwnProperty.call(out, name);
    if (!exists && Object.keys(out).length >= MAX_PRESETS) { skipped += 1; continue; }
    out[name] = preset;
    imported += 1;
  }
  return { presets: out, imported, skipped };
}

export function presetToAudioState(preset: unknown): AudioState {
  const state = normalizeAudioState(preset);
  const record = preset && typeof preset === 'object' ? preset as Record<string, unknown> : {};
  const dynamics = record.dynamics && typeof record.dynamics === 'object'
    ? record.dynamics as Record<string, unknown> : {};
  state.dynamics.enabled = dynamics.enabled === true;
  state.stereo = normalizeStereo(null);
  state.reverb = normalizeReverb(null);
  state.delay = normalizeDelay(null);
  state.autoPan = normalizeAutoPan(null);
  state.exciter = normalizeExciter(null);
  state.pitchShift = normalizePitchShift(null);
  return state;
}

export function validateImportText(text: unknown): PresetMap {
  if (typeof text !== 'string') throw new Error('Preset file must be text.');
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) throw new Error('Preset file is too large.');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('Preset file is not valid JSON.'); }
  const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  const presets = normalizePresetMap(record.presets ?? parsed);
  if (!Object.keys(presets).length) throw new Error('No valid presets found.');
  return presets;
}
