import { APPEARANCE_SCHEMA_VERSION, type ThemeDefinition } from '../theme-types.js';

// Foundation palette only. Geometry/layout is implemented separately.
export const RICE_THEME: ThemeDefinition = {
  schemaVersion: APPEARANCE_SCHEMA_VERSION,
  id: 'builtin.rice',
  name: 'Rice',
  author: 'Kopela',
  extends: 'builtin.classic',
  preferredLayout: 'rice',
  builtin: true,
  tokens: {
    colors: {
      background: '#081119',
      surface: '#101a22',
      surfaceRaised: '#182630',
      surfaceOverlay: '#101a22',
      text: '#e8eef4',
      textMuted: '#8495a5',
      border: '#2a3a46',
      borderSoft: '#192933',
      accent: '#6c91ff',
      accentAlt: '#be83d9',
      positive: '#91b86f'
    },
    radius: { window: 18, panel: 16, control: 11 },
    typography: { family: 'modern', displayFamily: 'modern', scale: 1, micro: 10.5, label: 11.5, body: 13, title: 15.5, headline: 17, weightRegular: 430, weightMedium: 580, weightStrong: 690 },
    spacing: { scale: 1.04, xs: 4, sm: 8, md: 12, lg: 16 },
    surface: { opacity: 0.89, blur: 16, shadowStrength: 0.56, main: { color: '#101a22', opacity: 0.89 }, eq: { color: '#101a22', opacity: 0.88 }, cards: { color: '#182630', opacity: 0.72 }, tools: { color: '#101a22', opacity: 0.89 }, controls: { color: '#182630', opacity: 0.78 } },
    motion: { fast: 150, normal: 210 },
    artwork: { enabled: true, assetId: 'builtin.rice.landscape', placement: 'both', opacity: 0.94, dim: 0.30, blur: 0.8, positionX: 54, positionY: 46, scale: 1.03 },
    eq: {
      background: '#101b24',
      gridMajor: '#263742',
      gridMinor: '#182832',
      axis: '#465b69',
      label: '#748897',
      labelStrong: '#b9c6d0',
      curve: '#dfe9ef',
      curveDisabled: '#667580',
      fill: 'rgba(89,145,193,.058)',
      point: '#8aa1b2',
      pointHover: '#c7d6e0',
      pointSelected: '#86a6ff',
      selectedRing: 'rgba(206,222,234,.70)',
      pointStyle: 'bands',
      pointShape: 'ring',
      viewGain: 12,
      gridStyle: 'audio',
      showSpectrumScale: false,
      curveWidth: 1.65,
      pointRadius: 4.7,
      bandColors: ['#d66d79','#d7a351','#9dbd6a','#5d9fdb','#ce75b8','#7f95d8','#8cb6a1','#c38d65','#78a8c5','#b97aac','#90b969']
    }
  }
};
