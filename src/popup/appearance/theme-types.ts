export const APPEARANCE_SCHEMA_VERSION = 1 as const;

export type LayoutId = 'classic' | 'rice' | 'nocturne';
export type EqPointStyle = 'mono' | 'bands';
export type EqPointShape = 'solid' | 'ring';
export type EqGridStyle = 'legacy' | 'audio';

export interface AppearanceState {
  schemaVersion: typeof APPEARANCE_SCHEMA_VERSION;
  themeId: string;
  layoutId: LayoutId;
}

export interface ThemeColorTokens {
  background?: string;
  surface?: string;
  surfaceRaised?: string;
  surfaceOverlay?: string;
  text?: string;
  textMuted?: string;
  border?: string;
  borderSoft?: string;
  accent?: string;
  accentAlt?: string;
  positive?: string;
  danger?: string;
}

export interface ThemeRadiusTokens {
  window?: number;
  panel?: number;
  control?: number;
}

export interface ThemePanelSurfaceTokens {
  color?: string;
  opacity?: number;
}

export interface ThemeSurfaceTokens {
  opacity?: number;
  blur?: number;
  shadowStrength?: number;
  main?: ThemePanelSurfaceTokens;
  eq?: ThemePanelSurfaceTokens;
  cards?: ThemePanelSurfaceTokens;
  tools?: ThemePanelSurfaceTokens;
  controls?: ThemePanelSurfaceTokens;
}

export interface SurfaceAppearanceOverride {
  mainColor?: string;
  mainOpacity?: number;
  eqColor?: string;
  eqOpacity?: number;
  cardsColor?: string;
  cardsOpacity?: number;
  toolsColor?: string;
  toolsOpacity?: number;
  controlsColor?: string;
  controlsOpacity?: number;
  borderColor?: string;
  borderOpacity?: number;
  accentColor?: string;
  accentAltColor?: string;
  positiveColor?: string;
  dangerColor?: string;
  eqCurveColor?: string;
  textColor?: string;
  mutedTextColor?: string;
  shadowStrength?: number;
  blur?: number;
  windowRadius?: number;
  panelRadius?: number;
  controlRadius?: number;
  backgroundDim?: number;
}

export interface EffectiveSurfaceAppearance {
  mainColor: string;
  mainOpacity: number;
  eqColor: string;
  eqOpacity: number;
  cardsColor: string;
  cardsOpacity: number;
  toolsColor: string;
  toolsOpacity: number;
  controlsColor: string;
  controlsOpacity: number;
  borderColor: string;
  borderOpacity: number;
  accentColor: string;
  accentAltColor: string;
  positiveColor: string;
  dangerColor: string;
  eqCurveColor: string;
  textColor: string;
  mutedTextColor: string;
  shadowStrength: number;
  blur: number;
  windowRadius: number;
  panelRadius: number;
  controlRadius: number;
  backgroundDim: number;
  customized: boolean;
}

export type UiFontPreset = 'system' | 'humanist' | 'compact' | 'rounded' | 'modern';
export type ArtworkPlacement = 'none' | 'background' | 'card' | 'both';

export interface ThemeTypographyTokens {
  family?: UiFontPreset;
  displayFamily?: UiFontPreset;
  scale?: number;
  micro?: number;
  label?: number;
  body?: number;
  title?: number;
  headline?: number;
  weightRegular?: number;
  weightMedium?: number;
  weightStrong?: number;
}

export interface ThemeSpacingTokens {
  scale?: number;
  xs?: number;
  sm?: number;
  md?: number;
  lg?: number;
}

export interface ThemeMotionTokens {
  fast?: number;
  normal?: number;
}

export interface ThemeArtworkTokens {
  enabled?: boolean;
  assetId?: string;
  placement?: ArtworkPlacement;
  opacity?: number;
  dim?: number;
  blur?: number;
  positionX?: number;
  positionY?: number;
  scale?: number;
}

export interface EqThemeTokens {
  background?: string;
  gridMajor?: string;
  gridMinor?: string;
  axis?: string;
  label?: string;
  labelStrong?: string;
  curve?: string;
  curveDisabled?: string;
  fill?: string;
  spectrumFill?: string;
  spectrumStroke?: string;
  spectrumLabel?: string;
  bandGuide?: string;
  totalGuide?: string;
  totalPoint?: string;
  totalPointStroke?: string;
  point?: string;
  pointHover?: string;
  pointSelected?: string;
  pointStroke?: string;
  selectedRing?: string;
  pointStyle?: EqPointStyle;
  pointShape?: EqPointShape;
  viewGain?: number;
  gridStyle?: EqGridStyle;
  showSpectrumScale?: boolean;
  curveWidth?: number;
  pointRadius?: number;
  bandColors?: string[];
}

export interface ThemeTokens {
  colors?: ThemeColorTokens;
  radius?: ThemeRadiusTokens;
  surface?: ThemeSurfaceTokens;
  typography?: ThemeTypographyTokens;
  spacing?: ThemeSpacingTokens;
  motion?: ThemeMotionTokens;
  artwork?: ThemeArtworkTokens;
  eq?: EqThemeTokens;
}

export interface ThemeDefinition {
  schemaVersion: typeof APPEARANCE_SCHEMA_VERSION;
  id: string;
  name: string;
  author?: string;
  extends?: string;
  preferredLayout?: LayoutId;
  tokens: ThemeTokens;
  builtin?: boolean;
}

export interface ResolvedTheme extends Omit<ThemeDefinition, 'tokens' | 'extends'> {
  tokens: {
    colors: Required<ThemeColorTokens>;
    radius: Required<ThemeRadiusTokens>;
    surface: Required<Omit<ThemeSurfaceTokens, 'main' | 'eq' | 'cards' | 'tools' | 'controls'>> & {
      main: Required<ThemePanelSurfaceTokens>;
      eq: Required<ThemePanelSurfaceTokens>;
      cards: Required<ThemePanelSurfaceTokens>;
      tools: Required<ThemePanelSurfaceTokens>;
      controls: Required<ThemePanelSurfaceTokens>;
    };
    typography: Required<ThemeTypographyTokens>;
    spacing: Required<ThemeSpacingTokens>;
    motion: Required<ThemeMotionTokens>;
    artwork: Required<ThemeArtworkTokens>;
    eq: Required<Omit<EqThemeTokens, 'bandColors'>> & { bandColors: string[] };
  };
}

export type EqAppearance = ResolvedTheme['tokens']['eq'] & { surfaceOpacity?: number };
