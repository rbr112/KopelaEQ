import { APPEARANCE_SCHEMA_VERSION, type LayoutId, type ThemeDefinition, type ThemeTokens } from './theme-types.js';

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const SAFE_ASSET_ID = /^[a-z0-9][a-z0-9._-]{0,95}$/i;
const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const LAYOUTS = new Set<LayoutId>(['classic', 'rice', 'nocturne']);
const COLOR_FIELDS = new Set(['background','surface','surfaceRaised','surfaceOverlay','text','textMuted','border','borderSoft','accent','accentAlt','positive','danger']);
const EQ_COLOR_FIELDS = new Set(['background','gridMajor','gridMinor','axis','label','labelStrong','curve','curveDisabled','fill','spectrumFill','spectrumStroke','spectrumLabel','bandGuide','totalGuide','totalPoint','totalPointStroke','point','pointHover','pointSelected','pointStroke','selectedRing']);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function safeUiColor(value: unknown): value is string {
  return typeof value === 'string' && HEX6.test(value.trim());
}

function safeColor(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const source = value.trim();
  if (HEX.test(source)) return true;
  const functional = /^rgba?\(([^)]+)\)$/i.exec(source);
  if (!functional) return false;
  const parts = functional[1].split(',').map((item) => item.trim());
  if (parts.length !== 3 && parts.length !== 4) return false;
  const channels = parts.slice(0, 3);
  if (channels.some((item) => !/^\d{1,3}$/.test(item) || Number(item) > 255)) return false;
  if (parts.length === 4) {
    if (!/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(parts[3])) return false;
    const alpha = Number(parts[3]);
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) return false;
  }
  return true;
}

function finiteIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

export function validateThemeDefinition(value: unknown): ThemeDefinition {
  const root = record(value);
  if (!root) throw new Error('Theme must be an object.');
  if (root.schemaVersion !== APPEARANCE_SCHEMA_VERSION) throw new Error(`Unsupported theme schemaVersion: ${String(root.schemaVersion)}`);
  if (typeof root.id !== 'string' || !SAFE_ID.test(root.id) || root.id.startsWith('builtin.')) throw new Error('Theme id is invalid or reserved.');
  if (typeof root.name !== 'string' || !root.name.trim() || root.name.trim().length > 80) throw new Error('Theme name is required and must be at most 80 characters.');
  if (root.author !== undefined && (typeof root.author !== 'string' || root.author.length > 80)) throw new Error('Theme author is invalid.');
  if (root.extends !== undefined && (typeof root.extends !== 'string' || !SAFE_ID.test(root.extends))) throw new Error('Theme extends id is invalid.');
  if (root.preferredLayout !== undefined && (typeof root.preferredLayout !== 'string' || !LAYOUTS.has(root.preferredLayout as LayoutId))) throw new Error('Theme preferredLayout is invalid.');

  const rawTokens = record(root.tokens);
  if (!rawTokens) throw new Error('Theme tokens must be an object.');
  const tokens: ThemeTokens = {};

  const colors = record(rawTokens.colors);
  if (colors) {
    tokens.colors = {};
    for (const [key, item] of Object.entries(colors)) {
      if (!COLOR_FIELDS.has(key) || !safeUiColor(item)) throw new Error(`Invalid color token: ${key}. UI colors must use #RRGGBB.`);
      (tokens.colors as Record<string, string>)[key] = item.trim();
    }
  }

  const radius = record(rawTokens.radius);
  if (radius) {
    tokens.radius = {};
    for (const [key, item] of Object.entries(radius)) {
      if (!['window','panel','control'].includes(key) || !finiteIn(item, 0, 32)) throw new Error(`Invalid radius token: ${key}`);
      (tokens.radius as Record<string, number>)[key] = item;
    }
  }

  const surface = record(rawTokens.surface);
  if (surface) {
    tokens.surface = {};
    for (const [key, item] of Object.entries(surface)) {
      if (key === 'main' || key === 'eq' || key === 'cards' || key === 'tools' || key === 'controls') {
        const panel = record(item);
        if (!panel) throw new Error(`Invalid surface token: ${key}`);
        const normalized: { color?: string; opacity?: number } = {};
        for (const [panelKey, panelValue] of Object.entries(panel)) {
          if (panelKey === 'color') {
            if (!safeUiColor(panelValue)) throw new Error(`Invalid surface ${key}.color. Surface colors must use #RRGGBB.`);
            normalized.color = panelValue.trim();
          } else if (panelKey === 'opacity') {
            const minOpacity = key === 'main' || key === 'tools' ? 0.10 : 0;
            if (!finiteIn(panelValue, minOpacity, 1)) throw new Error(`Invalid surface ${key}.opacity`);
            normalized.opacity = panelValue;
          } else {
            throw new Error(`Invalid surface ${key} token: ${panelKey}`);
          }
        }
        tokens.surface[key] = normalized;
        continue;
      }
      const valid = key === 'opacity' ? finiteIn(item, 0.65, 1) : key === 'blur' ? finiteIn(item, 0, 30) : key === 'shadowStrength' ? finiteIn(item, 0, 1) : false;
      if (!valid) throw new Error(`Invalid surface token: ${key}`);
      (tokens.surface as Record<string, unknown>)[key] = item;
    }
  }

  const typography = record(rawTokens.typography);
  if (typography) {
    tokens.typography = {};
    for (const [key, item] of Object.entries(typography)) {
      if (key === 'family') {
        if (!['system','humanist','compact','rounded','modern'].includes(String(item))) throw new Error('Invalid typography family.');
        tokens.typography.family = item as 'system' | 'humanist' | 'compact' | 'rounded' | 'modern';
      } else if (key === 'displayFamily') {
        if (!['system','humanist','compact','rounded','modern'].includes(String(item))) throw new Error('Invalid typography displayFamily.');
        tokens.typography.displayFamily = item as 'system' | 'humanist' | 'compact' | 'rounded' | 'modern';
      } else if (key === 'scale') {
        if (!finiteIn(item, 0.9, 1.2)) throw new Error('Invalid typography scale.');
        tokens.typography.scale = item;
      } else if (['micro','label','body','title','headline'].includes(key)) {
        if (!finiteIn(item, 9, 20)) throw new Error(`Invalid typography token: ${key}`);
        (tokens.typography as Record<string, number | string>)[key] = item;
      } else if (['weightRegular','weightMedium','weightStrong'].includes(key)) {
        if (!finiteIn(item, 300, 800)) throw new Error(`Invalid typography token: ${key}`);
        (tokens.typography as Record<string, number | string>)[key] = item;
      } else {
        throw new Error(`Invalid typography token: ${key}`);
      }
    }
  }

  const spacing = record(rawTokens.spacing);
  if (spacing) {
    tokens.spacing = {};
    for (const [key, item] of Object.entries(spacing)) {
      if (key === 'scale') {
        if (!finiteIn(item, 0.85, 1.25)) throw new Error('Invalid spacing scale.');
        tokens.spacing.scale = item;
      } else if (['xs','sm','md','lg'].includes(key)) {
        if (!finiteIn(item, 2, 28)) throw new Error(`Invalid spacing token: ${key}`);
        (tokens.spacing as Record<string, number>)[key] = item;
      } else {
        throw new Error(`Invalid spacing token: ${key}`);
      }
    }
  }

  const motion = record(rawTokens.motion);
  if (motion) {
    tokens.motion = {};
    for (const [key, item] of Object.entries(motion)) {
      if (!['fast','normal'].includes(key) || !finiteIn(item, 60, 500)) throw new Error(`Invalid motion token: ${key}`);
      (tokens.motion as Record<string, number>)[key] = item;
    }
  }

  const artwork = record(rawTokens.artwork);
  if (artwork) {
    tokens.artwork = {};
    for (const [key, item] of Object.entries(artwork)) {
      if (key === 'enabled') {
        if (typeof item !== 'boolean') throw new Error('Invalid artwork enabled token.');
        tokens.artwork.enabled = item;
      } else if (key === 'assetId') {
        if (typeof item !== 'string' || (item !== '' && !SAFE_ASSET_ID.test(item))) throw new Error('Invalid artwork assetId.');
        tokens.artwork.assetId = item;
      } else if (key === 'placement') {
        if (!['none','background','card','both'].includes(String(item))) throw new Error('Invalid artwork placement.');
        tokens.artwork.placement = item as 'none' | 'background' | 'card' | 'both';
      } else if (key === 'opacity') {
        if (!finiteIn(item, 0, 1)) throw new Error('Invalid artwork opacity.');
        tokens.artwork.opacity = item;
      } else if (key === 'dim') {
        if (!finiteIn(item, 0, 1)) throw new Error('Invalid artwork dim.');
        tokens.artwork.dim = item;
      } else if (key === 'blur') {
        if (!finiteIn(item, 0, 24)) throw new Error('Invalid artwork blur.');
        tokens.artwork.blur = item;
      } else if (key === 'positionX' || key === 'positionY') {
        if (!finiteIn(item, 0, 100)) throw new Error(`Invalid artwork ${key}.`);
        (tokens.artwork as Record<string, number | string | boolean>)[key] = item;
      } else if (key === 'scale') {
        if (!finiteIn(item, 1, 1.2)) throw new Error('Invalid artwork scale.');
        tokens.artwork.scale = item;
      } else {
        throw new Error(`Invalid artwork token: ${key}`);
      }
    }
  }

  const eq = record(rawTokens.eq);
  if (eq) {
    tokens.eq = {};
    for (const [key, item] of Object.entries(eq)) {
      if (key === 'pointStyle') {
        if (item !== 'mono' && item !== 'bands') throw new Error('Invalid EQ pointStyle.');
        tokens.eq.pointStyle = item;
      } else if (key === 'pointShape') {
        if (item !== 'solid' && item !== 'ring') throw new Error('Invalid EQ pointShape.');
        tokens.eq.pointShape = item;
      } else if (key === 'viewGain') {
        if (!finiteIn(item, 6, 30)) throw new Error('Invalid EQ viewGain.');
        tokens.eq.viewGain = item;
      } else if (key === 'gridStyle') {
        if (item !== 'legacy' && item !== 'audio') throw new Error('Invalid EQ gridStyle.');
        tokens.eq.gridStyle = item;
      } else if (key === 'showSpectrumScale') {
        if (typeof item !== 'boolean') throw new Error('Invalid EQ showSpectrumScale.');
        tokens.eq.showSpectrumScale = item;
      } else if (key === 'curveWidth') {
        if (!finiteIn(item, 0.8, 4)) throw new Error('Invalid EQ curveWidth.');
        tokens.eq.curveWidth = item;
      } else if (key === 'pointRadius') {
        if (!finiteIn(item, 2.5, 8)) throw new Error('Invalid EQ pointRadius.');
        tokens.eq.pointRadius = item;
      } else if (key === 'bandColors') {
        if (!Array.isArray(item) || item.length < 1 || item.length > 16 || item.some((entry) => !safeColor(entry))) throw new Error('Invalid EQ bandColors.');
        tokens.eq.bandColors = item.map((entry) => String(entry).trim());
      } else {
        if (!EQ_COLOR_FIELDS.has(key) || !safeColor(item)) throw new Error(`Invalid EQ token: ${key}`);
        if (key === 'curve' && !safeUiColor(item)) throw new Error('Invalid EQ curve color. Use #RRGGBB.');
        (tokens.eq as Record<string, string>)[key] = item.trim();
      }
    }
  }

  return {
    schemaVersion: APPEARANCE_SCHEMA_VERSION,
    id: root.id,
    name: root.name.trim(),
    author: typeof root.author === 'string' ? root.author.trim() : undefined,
    extends: typeof root.extends === 'string' ? root.extends : undefined,
    preferredLayout: typeof root.preferredLayout === 'string' ? root.preferredLayout as LayoutId : undefined,
    tokens
  };
}
