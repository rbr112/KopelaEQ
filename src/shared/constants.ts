import type { CompressorParams, EqFilterType, ProtectionMode } from './types.js';

export const SCHEMA_VERSION = 4;
export const EQ_BANDS = 11;
export const DEFAULT_FREQUENCIES = [20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240, 20000] as const;
export const DEFAULT_Q = 0.7071;
export const EQ_TYPES: readonly EqFilterType[] = Object.freeze([
  'lowshelf',
  ...new Array(EQ_BANDS - 2).fill('peaking') as EqFilterType[],
  'highshelf'
]);
export const GAIN_DB_MIN = -30;
export const GAIN_DB_MAX = 10;
export const EQ_GAIN_MIN = -30;
export const EQ_GAIN_MAX = 30;
export const Q_MIN = 0.2;
export const Q_MAX = 11;
export const FREQ_MIN = 5;
export const FREQ_MAX = 20000;
export const MAX_PRESETS = 100;
export const MAX_IMPORT_BYTES = 256 * 1024;

export const STORAGE = Object.freeze({
  AUDIO_STATE: 'kopelaeq.audioState',
  PRESETS: 'kopelaeq.presets',
  PROTECTION: 'kopelaeq.protection',
  WORKSPACE: 'kopelaeq.workspace',
  VISUALIZER: 'kopelaeq.visualizer',
  SPECTRUM_MODE: 'kopelaeq.spectrumMode',
  SELECTED_PRESETS: 'kopelaeq.selectedPresets',
  AUDIO_BASELINE_VERSION: 'kopelaeq.audioBaselineVersion',
  APPEARANCE: 'kopelaeq.appearance',
  CUSTOM_THEMES: 'kopelaeq.customThemes',
  SURFACE_OVERRIDES: 'kopelaeq.surfaceOverrides',
  MEDIA_HINTS: 'kopelaeq.mediaHints',
  MEDIA_ARTWORK_JOURNAL: 'kopelaeq.mediaArtworkJournal',
  MEDIA_BACKGROUND_JOURNAL: 'kopelaeq.mediaBackgroundJournal',
  PRELOADED_MEDIA_VERSION: 'kopelaeq.preloadedMediaVersion'
} as const);

export const PROTECTION_PROFILES: Readonly<Record<ProtectionMode, Readonly<CompressorParams> | null>> = Object.freeze({
  maximum: Object.freeze({ threshold: -0.15, knee: 0.2, ratio: 20, attack: 0.001, release: 0.05 }),
  strong: Object.freeze({ threshold: -0.15, knee: 0.2, ratio: 20, attack: 0.001, release: 0.05 }),
  medium: Object.freeze({ threshold: -0.08, knee: 0.1, ratio: 12, attack: 0.0015, release: 0.04 }),
  light: Object.freeze({ threshold: -0.02, knee: 0.0, ratio: 6, attack: 0.0025, release: 0.03 }),
  off: null
});

export const BUNDLED_PRESET_RENAMES = Object.freeze({
  'Vivid': 'Vivid (111)',
  'Bass Punch': 'Bass Punch (bass2)',
  'Bass Tight': 'Bass Tight (bass3)',
  'Bass Heavy': 'Bass Heavy (bass4)',
  'Bass Air': 'Bass Air (bass4.2)'
} as const);
