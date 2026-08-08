export type EqFilterType = 'lowshelf' | 'peaking' | 'highshelf';
export type DynamicsMode = 'normal' | 'multiband';
export type ProtectionMode = 'strong' | 'medium' | 'light' | 'off';
export type SpectrumMode = 'fast' | 'balanced' | 'smooth';

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

/** Retained only for storage/import compatibility. No Stereo DSP exists. */
export interface StereoCompatibilityState {
  enabled: false;
  width: 1;
  balance: 0;
  mono: false;
  swap: false;
}

export interface AudioState {
  schemaVersion: number;
  gainDb: number;
  eq: EqState;
  dynamics: DynamicsState;
  stereo: StereoCompatibilityState;
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
  /** Level immediately before the final Protection stage (after Dynamics). */
  preProtection: StereoMeterSnapshot;
  /** Final output level after Protection. */
  postProtection: StereoMeterSnapshot;
  /** Compatibility aliases for the final/post-Protection meter. */
  peakDb: number;
  rmsDb: number;
  gainReductionDb: number;
  dynamicsReductionDb: number;
  spectrum?: number[];
}

export interface WorkspacePosition { left: number; top: number; }
export type WorkspaceState = Record<string, WorkspacePosition>;
