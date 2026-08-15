import type { EffectiveSurfaceAppearance, ResolvedTheme, SurfaceAppearanceOverride, ThemeDefinition } from './theme-types.js';

const SAFE_HEX = /^#[0-9a-f]{6}$/i;
export function isSurfaceHexColor(value: unknown): value is string { return typeof value === 'string' && SAFE_HEX.test(value); }

type SurfaceLayer = { color?: unknown; opacity?: unknown };
type ExtendedSurface = ResolvedTheme['tokens']['surface'] & Partial<Record<'main' | 'eq' | 'cards' | 'tools' | 'controls', SurfaceLayer>>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

export function clampSurfaceOpacity(value: unknown, fallback: number, min = 0): number {
  return clampNumber(value, fallback, min, 1);
}

function safeHex(value: unknown, fallback: string): string {
  return isSurfaceHexColor(value) ? value.toLowerCase() : fallback;
}

/** Resolve all optional surface tokens to values that are safe for runtime CSS. */
export function resolvedSurfaceDefaults(theme: ResolvedTheme): Omit<EffectiveSurfaceAppearance, 'customized'> {
  const surface = theme.tokens.surface as ExtendedSurface;
  const colors = theme.tokens.colors;
  const radius = theme.tokens.radius;
  const baseColor = safeHex(colors.surface, '#11161d');
  const raisedColor = safeHex(colors.surfaceRaised, baseColor);
  const baseOpacity = clampSurfaceOpacity(surface?.opacity, 1);
  const layer = (name: 'main' | 'eq' | 'cards' | 'tools' | 'controls', fallbackColor: string, fallbackOpacity: number) => ({
    color: safeHex(surface?.[name]?.color, fallbackColor),
    opacity: clampSurfaceOpacity(surface?.[name]?.opacity, fallbackOpacity)
  });
  const main = layer('main', baseColor, baseOpacity);
  const eq = layer('eq', baseColor, 0.88);
  const cards = layer('cards', raisedColor, 0.72);
  const tools = layer('tools', baseColor, baseOpacity);
  const controls = layer('controls', raisedColor, 0.78);
  return {
    mainColor: main.color, mainOpacity: main.opacity,
    eqColor: eq.color, eqOpacity: eq.opacity,
    cardsColor: cards.color, cardsOpacity: cards.opacity,
    toolsColor: tools.color, toolsOpacity: tools.opacity,
    controlsColor: controls.color, controlsOpacity: controls.opacity,
    borderColor: safeHex(colors.border, '#27303b'), borderOpacity: 0.72,
    accentColor: safeHex(colors.accent, '#5fc9d8'), accentAltColor: safeHex(colors.accentAlt, '#a58af5'),
    positiveColor: safeHex(colors.positive, '#64d28a'), dangerColor: safeHex(colors.danger, '#e1767d'),
    eqCurveColor: safeHex(theme.tokens.eq.curve, '#72d5bd'),
    textColor: safeHex(colors.text, '#edf2f7'), mutedTextColor: safeHex(colors.textMuted, '#8895a4'),
    shadowStrength: clampNumber(surface?.shadowStrength, 0.45, 0, 1),
    blur: clampNumber(surface?.blur, 0, 0, 30),
    windowRadius: clampNumber(radius?.window, 10, 0, 32),
    panelRadius: clampNumber(radius?.panel, 9, 0, 32),
    controlRadius: clampNumber(radius?.control, 8, 0, 32),
    backgroundDim: clampNumber(theme.tokens.artwork?.dim, 0.3, 0, 1)
  };
}

export function normalizeSurfaceOverride(value: unknown): SurfaceAppearanceOverride | null {
  const raw = record(value);
  if (!raw) return null;
  const out: SurfaceAppearanceOverride = {};
  const colorKeys = ['mainColor','eqColor','cardsColor','toolsColor','controlsColor','borderColor','accentColor','accentAltColor','positiveColor','dangerColor','eqCurveColor','textColor','mutedTextColor'] as const;
  for (const key of colorKeys) if (typeof raw[key] === 'string' && SAFE_HEX.test(raw[key] as string)) out[key] = String(raw[key]).toLowerCase();
  const opacityKeys = ['mainOpacity','eqOpacity','cardsOpacity','toolsOpacity','controlsOpacity','borderOpacity'] as const;
  for (const key of opacityKeys) if (raw[key] !== undefined) out[key] = clampSurfaceOpacity(raw[key], 1, key === 'mainOpacity' || key === 'toolsOpacity' ? 0.10 : 0);
  if (raw.shadowStrength !== undefined) out.shadowStrength = clampNumber(raw.shadowStrength, .45, 0, 1);
  if (raw.blur !== undefined) out.blur = clampNumber(raw.blur, 0, 0, 30);
  if (raw.windowRadius !== undefined) out.windowRadius = clampNumber(raw.windowRadius, 10, 0, 32);
  if (raw.panelRadius !== undefined) out.panelRadius = clampNumber(raw.panelRadius, 9, 0, 32);
  if (raw.controlRadius !== undefined) out.controlRadius = clampNumber(raw.controlRadius, 8, 0, 32);
  if (raw.backgroundDim !== undefined) out.backgroundDim = clampNumber(raw.backgroundDim, .3, 0, 1);
  return Object.keys(out).length ? out : null;
}

/** Merge local visual overrides into an exportable theme definition. */
export function applySurfaceOverrideToTheme(theme: ThemeDefinition, override?: SurfaceAppearanceOverride): void {
  if (!override) return;
  const surface = { ...(theme.tokens.surface || {}) };
  const assignLayer = (name: 'main'|'eq'|'cards'|'tools'|'controls', colorKey: keyof SurfaceAppearanceOverride, opacityKey: keyof SurfaceAppearanceOverride) => {
    const layer = { ...(surface[name] || {}) } as { color?: string; opacity?: number };
    const color = override[colorKey];
    const opacity = override[opacityKey];
    if (typeof color === 'string') layer.color = color;
    if (typeof opacity === 'number') layer.opacity = opacity;
    surface[name] = layer;
  };
  assignLayer('main','mainColor','mainOpacity');
  assignLayer('eq','eqColor','eqOpacity');
  assignLayer('cards','cardsColor','cardsOpacity');
  assignLayer('tools','toolsColor','toolsOpacity');
  assignLayer('controls','controlsColor','controlsOpacity');
  if (override.blur !== undefined) surface.blur = override.blur;
  if (override.shadowStrength !== undefined) surface.shadowStrength = override.shadowStrength;
  theme.tokens.surface = surface;

  const colors = { ...(theme.tokens.colors || {}) };
  if (override.borderColor !== undefined) colors.border = override.borderColor;
  if (override.accentColor !== undefined) colors.accent = override.accentColor;
  if (override.accentAltColor !== undefined) colors.accentAlt = override.accentAltColor;
  if (override.positiveColor !== undefined) colors.positive = override.positiveColor;
  if (override.dangerColor !== undefined) colors.danger = override.dangerColor;
  if (override.textColor !== undefined) colors.text = override.textColor;
  if (override.mutedTextColor !== undefined) colors.textMuted = override.mutedTextColor;
  theme.tokens.colors = colors;

  const eq = { ...(theme.tokens.eq || {}) };
  if (override.eqCurveColor !== undefined) eq.curve = override.eqCurveColor;
  theme.tokens.eq = eq;

  const radius = { ...(theme.tokens.radius || {}) };
  if (override.windowRadius !== undefined) radius.window = override.windowRadius;
  if (override.panelRadius !== undefined) radius.panel = override.panelRadius;
  if (override.controlRadius !== undefined) radius.control = override.controlRadius;
  theme.tokens.radius = radius;

  const artwork = { ...(theme.tokens.artwork || {}) };
  if (override.backgroundDim !== undefined) artwork.dim = override.backgroundDim;
  theme.tokens.artwork = artwork;
}
