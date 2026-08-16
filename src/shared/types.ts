export type EqFilterType = 'lowshelf' | 'peaking' | 'highshelf';
export type DynamicsMode = 'normal' | 'multiband';
export type ProtectionMode = 'maximum' | 'strong' | 'medium' | 'light' | 'off';
export type SpectrumMode = 'fast' | 'balanced' | 'smooth';
export type ReverbType = 'room' | 'hall' | 'plate';

export interface EqState {
  enabled: boolean;
  frequencies: number[];
  gains: number[];
  qs: number[];
}

export interface DynamicsState {
  enabled: boolean;
  mode: DynamicsMode;
  amount: number;
  response: number;
  lowCrossoverHz: number;
  highCrossoverHz: number;
}

export interface StereoState {
  enabled: boolean;
  /** Mid/Side width multiplier: 0 = mono, 1 = unchanged, 2 = 200%. */
  width: number;
  /** Balance normalized to -1..+1. */
  balance: number;
  mono: boolean;
  swap: boolean;
}

export interface ReverbState {
  enabled: boolean;
  mix: number;
  type: ReverbType;
}

export interface DelayState {
  enabled: boolean;
  timeMs: number;
  feedback: number;
  mix: number;
}

export interface AutoPanState {
  enabled: boolean;
  rateHz: number;
  depth: number;
}

export interface ExciterState {
  enabled: boolean;
  amount: number;
  frequencyHz: number;
}

export interface PitchShiftState {
  enabled: boolean;
  semitones: number;
}

export interface AudioState {
  schemaVersion: number;
  gainDb: number;
  eq: EqState;
  dynamics: DynamicsState;
  stereo: StereoState;
  reverb: ReverbState;
  delay: DelayState;
  autoPan: AutoPanState;
  exciter: ExciterState;
  pitchShift: PitchShiftState;
}

export interface Preset {
  schemaVersion: number;
  name: string;
  gainDb: number;
  eq: EqState;
  dynamics: DynamicsState;
}

export type PresetMap = Record<string, Preset>;

export interface CompressorParams {
  threshold: number;
  knee: number;
  ratio: number;
  attack: number;
  release: number;
}

export interface StereoMeterSnapshot {
  leftPeakDb: number;
  rightPeakDb: number;
  peakDb: number;
  rmsDb: number;
}

export interface MeterSnapshot {
  sampleRate: number;
  /** Level immediately before the final Protection stage (after Stereo/Dynamics). */
  preProtection: StereoMeterSnapshot;
  /** Level immediately after Protection, before decorative post-effects. */
  postProtection: StereoMeterSnapshot;
  /** Compatibility aliases for the post-Protection meter. */
  peakDb: number;
  rmsDb: number;
  gainReductionDb: number;
  dynamicsReductionDb: number;
  /** True-peak telemetry from Maximum's final post-effects limiter. */
  maximumInputTruePeakDb?: number;
  maximumOutputTruePeakDb?: number;
  maximumLimiterReductionDb?: number;
  spectrum?: number[];
}

export interface WorkspacePosition { left: number; top: number; }
export type WorkspaceState = Record<string, WorkspacePosition>;
