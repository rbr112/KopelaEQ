import { CLASSIC_THEME } from './builtins/classic.js';
import { RICE_THEME } from './builtins/rice.js';
import { NOCTURNE_THEME } from './builtins/nocturne.js';
import type { ResolvedTheme, ThemeDefinition, ThemeTokens } from './theme-types.js';

const BUILTINS: readonly ThemeDefinition[] = Object.freeze([CLASSIC_THEME, RICE_THEME, NOCTURNE_THEME]);
const BUILTIN_IDS = new Set(BUILTINS.map((theme) => theme.id));

const LAYOUT_SAFE_TYPE_PX = Object.freeze({
  micro: [9, 12],
  label: [9.5, 13.5],
  body: [10.5, 14.5],
  title: [12, 18],
  headline: [14, 20]
} as const);

const LAYOUT_SAFE_SPACE_PX = Object.freeze({
  xs: [2, 6],
  sm: [5, 11],
  md: [8, 17],
  lg: [12, 23]
} as const);

function assertLayoutSafeResolvedTheme(theme: ResolvedTheme): void {
  const typeScale = theme.tokens.typography.scale;
  for (const key of ['micro','label','body','title','headline'] as const) {
    const px = theme.tokens.typography[key] * typeScale;
    const [min, max] = LAYOUT_SAFE_TYPE_PX[key];
    if (px < min || px > max) throw new Error(`Theme ${theme.id} resolves ${key} text outside the layout-safe range (${min}-${max}px).`);
  }
  const spaceScale = theme.tokens.spacing.scale;
  for (const key of ['xs','sm','md','lg'] as const) {
    const px = theme.tokens.spacing[key] * spaceScale;
    const [min, max] = LAYOUT_SAFE_SPACE_PX[key];
    if (px < min || px > max) throw new Error(`Theme ${theme.id} resolves ${key} spacing outside the layout-safe range (${min}-${max}px).`);
  }
}

function mergeTokens(base: ThemeTokens, overlay: ThemeTokens): ThemeTokens {
  return {
    colors: { ...(base.colors || {}), ...(overlay.colors || {}) },
    radius: { ...(base.radius || {}), ...(overlay.radius || {}) },
    surface: {
      ...(base.surface || {}),
      ...(overlay.surface || {}),
      main: { ...(base.surface?.main || {}), ...(overlay.surface?.main || {}) },
      eq: { ...(base.surface?.eq || {}), ...(overlay.surface?.eq || {}) },
      cards: { ...(base.surface?.cards || {}), ...(overlay.surface?.cards || {}) },
      tools: { ...(base.surface?.tools || {}), ...(overlay.surface?.tools || {}) },
      controls: { ...(base.surface?.controls || {}), ...(overlay.surface?.controls || {}) }
    },
    typography: { ...(base.typography || {}), ...(overlay.typography || {}) },
    spacing: { ...(base.spacing || {}), ...(overlay.spacing || {}) },
    motion: { ...(base.motion || {}), ...(overlay.motion || {}) },
    artwork: { ...(base.artwork || {}), ...(overlay.artwork || {}) },
    eq: {
      ...(base.eq || {}),
      ...(overlay.eq || {}),
      bandColors: overlay.eq?.bandColors ? [...overlay.eq.bandColors] : (base.eq?.bandColors ? [...base.eq.bandColors] : undefined)
    }
  };
}

export class ThemeRegistry {
  private readonly themes = new Map<string, ThemeDefinition>();

  constructor(extraThemes: readonly ThemeDefinition[] = []) {
    for (const theme of BUILTINS) this.themes.set(theme.id, theme);
    for (const theme of extraThemes) this.register(theme, true);
  }

  list(): ThemeDefinition[] { return [...this.themes.values()]; }
  listCustom(): ThemeDefinition[] { return this.list().filter((theme) => !theme.builtin); }
  get(id: string): ThemeDefinition | undefined { return this.themes.get(id); }
  isBuiltin(id: string): boolean { return BUILTIN_IDS.has(id); }

  register(theme: ThemeDefinition, replace = false): ThemeDefinition {
    if (BUILTIN_IDS.has(theme.id)) throw new Error(`Theme id is reserved: ${theme.id}`);
    if (this.themes.has(theme.id) && !replace) throw new Error(`Theme already exists: ${theme.id}`);
    if (theme.extends && !this.themes.has(theme.extends)) throw new Error(`Theme ${theme.id} extends unknown theme ${theme.extends}`);

    const previous = this.themes.get(theme.id);
    this.themes.set(theme.id, { ...theme, builtin: false });
    try {
      // Replacing a parent can make an already-installed descendant invalid.
      // Re-resolve the whole custom graph before committing the replacement.
      for (const candidate of this.listCustom()) {
        assertLayoutSafeResolvedTheme(this.resolve(candidate.id));
      }
    } catch (error) {
      if (previous) this.themes.set(theme.id, previous);
      else this.themes.delete(theme.id);
      throw error;
    }
    return this.themes.get(theme.id)!;
  }

  remove(id: string): boolean {
    if (BUILTIN_IDS.has(id)) return false;
    return this.themes.delete(id);
  }

  resolve(id: string): ResolvedTheme {
    const seen = new Set<string>();
    const chain: ThemeDefinition[] = [];
    let current = this.themes.get(id);
    if (!current) throw new Error(`Unknown theme: ${id}`);
    while (current) {
      if (seen.has(current.id)) throw new Error(`Theme inheritance cycle at ${current.id}`);
      seen.add(current.id);
      chain.unshift(current);
      if (!current.extends) break;
      const parent = this.themes.get(current.extends);
      if (!parent) throw new Error(`Theme ${current.id} extends unknown theme ${current.extends}`);
      current = parent;
    }

    let tokens: ThemeTokens = {};
    for (const theme of chain) tokens = mergeTokens(tokens, theme.tokens);
    const fallback = CLASSIC_THEME.tokens;
    tokens = mergeTokens(fallback, tokens);

    const leaf = chain[chain.length - 1] || CLASSIC_THEME;
    return {
      schemaVersion: leaf.schemaVersion,
      id: leaf.id,
      name: leaf.name,
      author: leaf.author,
      preferredLayout: leaf.preferredLayout,
      builtin: leaf.builtin,
      tokens: tokens as ResolvedTheme['tokens']
    };
  }
}

export const BUILTIN_THEME_IDS = Object.freeze({
  CLASSIC: CLASSIC_THEME.id,
  RICE: RICE_THEME.id,
  NOCTURNE: NOCTURNE_THEME.id
} as const);
