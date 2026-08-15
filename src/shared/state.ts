import {
  SCHEMA_VERSION, EQ_BANDS, DEFAULT_FREQUENCIES, DEFAULT_Q,
  GAIN_DB_MIN, GAIN_DB_MAX, EQ_GAIN_MIN, EQ_GAIN_MAX,
  Q_MIN, Q_MAX, FREQ_MIN, FREQ_MAX, PROTECTION_PROFILES
} from './constants.js';
import type {
  AudioState, AutoPanState, DelayState, DynamicsState, EqState, ExciterState,
  PitchShiftState, ProtectionMode, CompressorParams, ReverbState, StereoState
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
    dynamics: normalizeDynamics(null),
    stereo: normalizeStereo(null),
    reverb: normalizeReverb(null),
    delay: normalizeDelay(null),
    autoPan: normalizeAutoPan(null),
    exciter: normalizeExciter(null),
    pitchShift: normalizePitchShift(null)
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
  const defaults = {
    enabled: true,
    frequencies: [...DEFAULT_FREQUENCIES],
    gains: new Array(EQ_BANDS).fill(0),
    qs: new Array(EQ_BANDS).fill(DEFAULT_Q)
  } satisfies EqState;
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

export function normalizeStereo(value: unknown): StereoState {
  const src = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    enabled: src.enabled === true,
    width: clamp(finiteNumber(src.width, 1), 0, 2),
    balance: clamp(finiteNumber(src.balance, 0), -1, 1),
    mono: src.mono === true,
    swap: src.swap === true
  };
}

export function effectiveStereoWidth(value: unknown): number {
  const stereo = normalizeStereo(value);
  return stereo.mono ? 0 : stereo.width;
}

export function normalizeReverb(value: unknown): ReverbState {
  const src = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const type = src.type === 'hall' || src.type === 'plate' ? src.type : 'room';
  return { enabled: src.enabled === true, mix: clamp(finiteNumber(src.mix, 0.22), 0, 1), type };
}

export function normalizeDelay(value: unknown): DelayState {
  const src = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    enabled: false,
    timeMs: clamp(finiteNumber(src.timeMs, 280), 20, 2000),
    feedback: clamp(finiteNumber(src.feedback, 0.28), 0, 0.88),
    mix: clamp(finiteNumber(src.mix, 0.2), 0, 1)
  };
}

export function normalizeAutoPan(value: unknown): AutoPanState {
  const src = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    enabled: src.enabled === true,
    rateHz: clamp(finiteNumber(src.rateHz, 0.18), 0.03, 4),
    depth: clamp(finiteNumber(src.depth, 0.45), 0, 1)
  };
}

export function normalizeExciter(value: unknown): ExciterState {
  const src = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    enabled: false,
    amount: clamp(finiteNumber(src.amount, 0.18), 0, 1),
    frequencyHz: clamp(finiteNumber(src.frequencyHz, 5200), 1200, 16000)
  };
}

export function normalizePitchShift(value: unknown): PitchShiftState {
  const src = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { enabled: src.enabled === true, semitones: clamp(finiteNumber(src.semitones, 0), -12, 0) };
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
      dynamics: normalizeDynamics({ enabled: false })
    };
  }

  const eqSource = src.eq && typeof src.eq === 'object' ? src.eq : value;
  return {
    schemaVersion: SCHEMA_VERSION,
    gainDb: clamp(src.gainDb ?? src.gain ?? 0, GAIN_DB_MIN, GAIN_DB_MAX),
    eq: normalizeEq(eqSource),
    dynamics: normalizeDynamics(src.dynamics),
    stereo: normalizeStereo(src.stereo),
    reverb: normalizeReverb(src.reverb),
    delay: normalizeDelay(src.delay),
    autoPan: normalizeAutoPan(src.autoPan),
    exciter: normalizeExciter(src.exciter),
    pitchShift: normalizePitchShift(src.pitchShift)
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
