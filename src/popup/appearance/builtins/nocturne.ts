import { APPEARANCE_SCHEMA_VERSION, type ThemeDefinition } from '../theme-types.js';

// Foundation palette only. Geometry/layout is implemented separately.
export const NOCTURNE_THEME: ThemeDefinition = {
  schemaVersion: APPEARANCE_SCHEMA_VERSION,
  id: 'builtin.nocturne',
  name: 'Nocturne',
  author: 'Kopela',
  extends: 'builtin.classic',
  preferredLayout: 'nocturne',
  builtin: true,
  tokens: {
    colors: {
      background: '#060a12',
      surface: '#0c111d',
      surfaceRaised: '#141927',
      surfaceOverlay: '#0c111d',
      text: '#e6e5ef',
      textMuted: '#7d8295',
      border: '#292e40',
      borderSoft: '#171c29',
      accent: '#9e7cff',
      accentAlt: '#7b9fe8',
      positive: '#80caa4'
    },
    radius: { window: 14, panel: 12, control: 9 },
    typography: { family: 'modern', displayFamily: 'modern', scale: 1, micro: 10, label: 11, body: 12.25, title: 14, headline: 15.5, weightRegular: 400, weightMedium: 530, weightStrong: 640 },
    spacing: { scale: 1, xs: 4, sm: 8, md: 12, lg: 16 },
    surface: { opacity: 0.82, blur: 18, shadowStrength: 0.52, main: { color: '#0c111d', opacity: 0.82 }, eq: { color: '#0c111d', opacity: 0.18 }, cards: { color: '#141927', opacity: 0.72 }, tools: { color: '#0c111d', opacity: 0.82 }, controls: { color: '#141927', opacity: 0.78 } },
    motion: { fast: 130, normal: 175 },
    artwork: { enabled: true, assetId: 'builtin.nocturne.night', placement: 'background', opacity: 0.96, dim: 0.22, blur: 0.7, positionX: 50, positionY: 42, scale: 1.03 },
    eq: {
      background: 'rgba(9,13,23,0.58)',
      gridMajor: '#1e2434',
      gridMinor: '#141925',
      axis: '#30364a',
      label: '#81899f',
      labelStrong: '#aab2c4',
      curve: '#9e7cff',
      curveDisabled: '#586176',
      fill: 'rgba(158,124,255,.038)',
      spectrumFill: 'rgba(111,151,229,.045)',
      spectrumStroke: 'rgba(132,160,224,.20)',
      spectrumLabel: '#5f6b82',
      bandGuide: 'rgba(164,131,243,.48)',
      totalGuide: 'rgba(199,202,225,.30)',
      totalPoint: '#d9d9e7',
      totalPointStroke: '#090d15',
      point: '#7c8496',
      pointHover: '#bea9ff',
      pointSelected: '#b096ff',
      pointStroke: '#090d15',
      selectedRing: 'rgba(190,171,255,.62)',
      pointStyle: 'mono',
      pointShape: 'ring',
      viewGain: 12,
      gridStyle: 'audio',
      showSpectrumScale: false,
      curveWidth: 1.55,
      pointRadius: 4.3,
      bandColors: ['#7c8496']
    }
  }
};
