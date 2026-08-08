import {
  SCHEMA_VERSION, EQ_BANDS, DEFAULT_FREQUENCIES, DEFAULT_Q,
  GAIN_DB_MIN, GAIN_DB_MAX, EQ_GAIN_MIN, EQ_GAIN_MAX,
  Q_MIN, Q_MAX, FREQ_MIN, FREQ_MAX, PROTECTION_PROFILES
} from './constants.js';
import type {
  AudioState, DynamicsState, EqState, StereoCompatibilityState,
  ProtectionMode, CompressorParams
} from './types.js';

export function finiteNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function clamp(value: unknown, min: number, max: number): number {
  return Math.min(max, Math.max(min, finiteNumber(value, min)));
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function defaultAudioState(): AudioState {
  return {
    schemaVersion: SCHEMA_VERSION,
    gainDb: 0,
    eq: {
      enabled: true,
      frequencies: [...DEFAULT_FREQUENCIES],
      gains: new Array(EQ_BANDS).fill(0),
      qs: new Array(EQ_BANDS).fill(DEFAULT_Q)
    },
    dynamics: {
      enabled: false,
      mode: 'normal',
      amount: 0.35,
      response: 0.5,
      lowCrossoverHz: 180,
      highCrossoverHz: 4500
    },
    stereo: normalizeStereo(null)
  };
}

function normalizeArray(
  source: unknown,
  length: number,
  fallback: readonly number[] | number,
  min: number,
  max: number
): number[] {
  const out = new Array<number>(length);
  const arr = Array.isArray(source) ? source : [];
  for (let i = 0; i < length; i += 1) {
    const fb = typeof fallback === 'number' ? fallback : Number(fallback[i]);
    out[i] = clamp(arr[i], min, max);
    if (!Number.isFinite(Number(arr[i]))) out[i] = fb;
  }
  return out;
}

export function normalizeEq(value: unknown): EqState {
  const defaults = defaultAudioState().eq;
  const src = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    enabled: src.enabled !== false,
    frequencies: normalizeArray(src.frequencies, EQ_BANDS, defaults.frequencies, FREQ_MIN, FREQ_MAX),
    gains: normalizeArray(src.gains, EQ_BANDS, defaults.gains, EQ_GAIN_MIN, EQ_GAIN_MAX),
    qs: normalizeArray(src.qs, EQ_BANDS, defaults.qs, Q_MIN, Q_MAX)
  };
}

export function normalizeDynamics(value: unknown): DynamicsState {
  const defaults: DynamicsState = {
    enabled: false,
    mode: 'normal',
    amount: 0.35,
    response: 0.5,
    lowCrossoverHz: 180,
    highCrossoverHz: 4500
  };
  const src = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const mode = src.mode === 'multiband' ? 'multiband' : 'normal';
  const low = clamp(finiteNumber(src.lowCrossoverHz, defaults.lowCrossoverHz), 80, 800);
  let high = clamp(finiteNumber(src.highCrossoverHz, defaults.highCrossoverHz), 1200, 12000);
  if (high < low + 400) high = Math.min(12000, low + 400);
  return {
    enabled: src.enabled === true,
    mode,
    amount: clamp(finiteNumber(src.amount, defaults.amount), 0, 1),
    response: clamp(finiteNumber(src.response, defaults.response), 0, 1),
    lowCrossoverHz: low,
    highCrossoverHz: high
  };
}

export function normalizeStereo(_value: unknown): StereoCompatibilityState {
  return { enabled: false, width: 1, balance: 0, mono: false, swap: false };
}

export function isLegacyPreset(value: unknown): value is Record<string, unknown> & { frequencies: unknown[]; gains: unknown[] } {
  return Boolean(value && typeof value === 'object'
    && Array.isArray((value as Record<string, unknown>).frequencies)
    && Array.isArray((value as Record<string, unknown>).gains));
}

export function normalizeAudioState(value: unknown): AudioState {
  const defaults = defaultAudioState();
  if (!value || typeof value !== 'object') return defaults;
  const src = value as Record<string, unknown>;

  if (isLegacyPreset(value)) {
    return {
      ...defaults,
      gainDb: clamp(src.gainDb ?? src.gain ?? 0, GAIN_DB_MIN, GAIN_DB_MAX),
      eq: normalizeEq(value),
      dynamics: normalizeDynamics({ enabled: false }),
      stereo: normalizeStereo(null)
    };
  }

  const eqSource = src.eq && typeof src.eq === 'object' ? src.eq : value;
  return {
    schemaVersion: SCHEMA_VERSION,
    gainDb: clamp(src.gainDb ?? src.gain ?? 0, GAIN_DB_MIN, GAIN_DB_MAX),
    eq: normalizeEq(eqSource),
    dynamics: normalizeDynamics(src.dynamics),
    stereo: normalizeStereo(src.stereo)
  };
}

export function normalizeProtection(value: unknown): ProtectionMode {
  const key = String(value || '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(PROTECTION_PROFILES, key) ? key as ProtectionMode : 'strong';
}

export function dbToLinear(db: unknown): number {
  return Math.pow(10, clamp(db, GAIN_DB_MIN, GAIN_DB_MAX) / 20);
}

export function dynamicParams(value: unknown): CompressorParams {
  const d = normalizeDynamics(value);
  return {
    threshold: -8 - (24 * d.amount),
    knee: 6 + (12 * (1 - d.amount)),
    ratio: 1 + (7 * d.amount),
    attack: 0.003 + (0.035 * (1 - d.response)),
    release: 0.07 + (0.38 * (1 - d.response))
  };
}
