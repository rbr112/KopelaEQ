import assert from 'node:assert/strict';
import { ThemeRegistry, BUILTIN_THEME_IDS } from '../extension/js/popup/appearance/theme-registry.js';
import { validateThemeDefinition } from '../extension/js/popup/appearance/theme-validator.js';

const registry = new ThemeRegistry();
const classic = registry.resolve(BUILTIN_THEME_IDS.CLASSIC);
const rice = registry.resolve(BUILTIN_THEME_IDS.RICE);
const nocturne = registry.resolve(BUILTIN_THEME_IDS.NOCTURNE);

assert.equal(classic.tokens.eq.curve, '#72d5bd');
assert.equal(rice.preferredLayout, 'rice');
assert.equal(rice.tokens.eq.pointStyle, 'bands');
assert.equal(rice.tokens.eq.pointShape, 'ring');
assert.equal(rice.tokens.eq.viewGain, 12);
assert.equal(rice.tokens.eq.gridStyle, 'audio');
assert.equal(rice.tokens.eq.showSpectrumScale, false);
assert.ok(rice.tokens.eq.curveWidth > 1.4 && rice.tokens.eq.curveWidth < 2);
assert.equal(nocturne.preferredLayout, 'nocturne');
assert.equal(nocturne.tokens.eq.pointStyle, 'mono');
assert.equal(nocturne.tokens.eq.pointShape, 'ring');
assert.equal(nocturne.tokens.eq.viewGain, 12);
assert.equal(nocturne.tokens.eq.gridStyle, 'audio');
assert.equal(nocturne.tokens.eq.showSpectrumScale, false);
assert.ok(nocturne.tokens.eq.pointRadius < rice.tokens.eq.pointRadius);
assert.ok(nocturne.tokens.eq.bandColors.length >= 1);
assert.equal(rice.tokens.typography.family, 'modern');
assert.equal(rice.tokens.typography.displayFamily, 'modern');
assert.equal(nocturne.tokens.typography.family, 'modern');
assert.equal(nocturne.tokens.typography.displayFamily, 'modern');
assert.equal(rice.tokens.artwork.enabled, true);
assert.equal(rice.tokens.artwork.placement, 'both');
assert.equal(nocturne.tokens.artwork.placement, 'background');
assert.ok(rice.tokens.typography.micro >= 9);
assert.ok(nocturne.tokens.typography.label >= 10);
assert.ok(rice.tokens.spacing.md >= rice.tokens.spacing.sm);
assert.equal(rice.tokens.surface.main.color, '#101a22');
assert.equal(rice.tokens.surface.main.opacity, 0.89);
assert.equal(rice.tokens.surface.eq.color, '#101a22');
assert.equal(rice.tokens.surface.cards.opacity, 0.72);
assert.equal(rice.tokens.surface.tools.color, '#101a22');
assert.equal(rice.tokens.surface.controls.opacity, 0.78);
assert.equal(nocturne.tokens.surface.tools.opacity, 0.82);

const custom = validateThemeDefinition({
  schemaVersion: 1,
  id: 'user.rose-night',
  name: 'Rose Night',
  author: 'Test',
  extends: 'builtin.nocturne',
  preferredLayout: 'nocturne',
  tokens: {
    colors: { accent: '#c4a7e7' },
    radius: { window: 18 },
    surface: { blur: 8, opacity: 0.94, main: { color: '#201525', opacity: 0.48 }, eq: { color: '#111827', opacity: 0.31 }, cards: { color: '#241729', opacity: 0.52 }, tools: { color: '#16131f', opacity: 0.73 }, controls: { color: '#302038', opacity: 0.66 } },
    typography: { family: 'modern', displayFamily: 'rounded', scale: 1.05, micro: 9, label: 10, body: 11, title: 13, headline: 15 },
    artwork: { enabled: true, assetId: 'user.rose.art', placement: 'both', opacity: 0.8, dim: 0.5, blur: 2, positionX: 50, positionY: 40, scale: 1.05 },
    spacing: { scale: 1, xs: 4, sm: 8, md: 12, lg: 16 },
    eq: { curve: '#ebbcba', pointStyle: 'mono', pointShape: 'ring', viewGain: 14 }
  }
});
assert.equal(custom.id, 'user.rose-night');
assert.equal(custom.tokens.colors?.accent, '#c4a7e7');
assert.equal(custom.tokens.eq?.viewGain, 14);
assert.equal(custom.tokens.typography?.family, 'modern');
assert.equal(custom.tokens.typography?.displayFamily, 'rounded');
assert.equal(custom.tokens.artwork?.assetId, 'user.rose.art');
assert.equal(custom.tokens.spacing?.md, 12);
assert.equal(custom.tokens.surface?.main?.color, '#201525');
assert.equal(custom.tokens.surface?.main?.opacity, 0.48);
assert.equal(custom.tokens.surface?.eq?.opacity, 0.31);
assert.equal(custom.tokens.surface?.cards?.color, '#241729');
assert.equal(custom.tokens.surface?.controls?.opacity, 0.66);
registry.register(custom);
assert.equal(registry.resolve('user.rose-night').tokens.colors.accent, '#c4a7e7');
assert.equal(registry.resolve('user.rose-night').tokens.surface.main.color, '#201525');
assert.equal(registry.resolve('user.rose-night').tokens.surface.tools.opacity, 0.73);
assert.equal(registry.resolve('user.rose-night').tokens.surface.eq.opacity, 0.31);
assert.equal(registry.resolve('user.rose-night').tokens.surface.controls.color, '#302038');
assert.equal(registry.isBuiltin('user.rose-night'), false);
assert.equal(registry.listCustom().some((theme) => theme.id === 'user.rose-night'), true);
assert.throws(() => registry.register(custom), /already exists/);
assert.equal(registry.remove('builtin.rice'), false);
assert.equal(registry.remove('user.rose-night'), true);
assert.equal(registry.get('user.rose-night'), undefined);
assert.throws(() => validateThemeDefinition({ schemaVersion: 1, id: 'builtin.hack', name: 'x', tokens: {} }), /reserved/);
assert.throws(() => validateThemeDefinition({ schemaVersion: 1, id: 'user.bad', name: 'x', tokens: { colors: { accent: 'url(https://x)' } } }), /Invalid color/);
assert.throws(() => validateThemeDefinition({ schemaVersion: 1, id: 'user.bad-rgb', name: 'x', tokens: { colors: { accent: 'rgb(999,0,0)' } } }), /Invalid color/);
assert.throws(() => validateThemeDefinition({ schemaVersion: 1, id: 'user.bad2', name: 'x', tokens: { surface: { blur: 999 } } }), /Invalid surface/);
assert.throws(() => validateThemeDefinition({ schemaVersion: 1, id: 'user.bad-surface-color', name: 'x', tokens: { surface: { main: { color: 'url(https://x)' } } } }), /Invalid surface main.color/);
assert.throws(() => validateThemeDefinition({ schemaVersion: 1, id: 'user.bad-surface-opacity', name: 'x', tokens: { surface: { tools: { opacity: 0.01 } } } }), /Invalid surface tools.opacity/);
assert.throws(() => validateThemeDefinition({ schemaVersion: 1, id: 'user.bad3', name: 'x', tokens: { eq: { viewGain: 99 } } }), /Invalid EQ viewGain/);
assert.throws(() => validateThemeDefinition({ schemaVersion: 1, id: 'user.bad4', name: 'x', tokens: { typography: { micro: 7 } } }), /Invalid typography/);
assert.throws(() => validateThemeDefinition({ schemaVersion: 1, id: 'user.bad5', name: 'x', tokens: { spacing: { scale: 4 } } }), /Invalid spacing/);
assert.throws(() => validateThemeDefinition({ schemaVersion: 1, id: 'user.bad6', name: 'x', tokens: { artwork: { assetId: 'https://evil.example/x' } } }), /Invalid artwork/);
assert.throws(() => validateThemeDefinition({ schemaVersion: 1, id: 'user.bad7', name: 'x', tokens: { artwork: { scale: 2 } } }), /Invalid artwork/);

assert.throws(() => validateThemeDefinition({ schemaVersion: 1, id: 'user.rgba-ui', name: 'x', tokens: { colors: { accent: 'rgba(255,0,0,.5)' } } }), /#RRGGBB/);
const tooSmall = validateThemeDefinition({ schemaVersion: 1, id: 'user.too-small-resolved', name: 'x', extends:'builtin.rice', tokens: { typography: { scale:0.9, micro:9 } } });
assert.throws(() => registry.register(tooSmall), /layout-safe range/);

// Replacing a parent must also revalidate existing descendants.
{
  const graph = new ThemeRegistry();
  graph.register(validateThemeDefinition({
    schemaVersion:1, id:'user.parent', name:'Parent', extends:'builtin.rice',
    tokens:{ typography:{ micro:10, scale:1 } }
  }));
  graph.register(validateThemeDefinition({
    schemaVersion:1, id:'user.child', name:'Child', extends:'user.parent',
    tokens:{ typography:{ scale:0.9 } }
  }));
  assert.equal(graph.resolve('user.child').tokens.typography.micro * graph.resolve('user.child').tokens.typography.scale, 9);
  const invalidatingParent = validateThemeDefinition({
    schemaVersion:1, id:'user.parent', name:'Parent v2', extends:'builtin.rice',
    tokens:{ typography:{ micro:9, scale:1 } }
  });
  assert.throws(() => graph.register(invalidatingParent, true), /user\.child.*layout-safe range/);
  assert.equal(graph.get('user.parent').name, 'Parent', 'failed parent replacement must roll back atomically');
}


// Fixed popup layouts reject values that are individually valid but become
// unsafe after inheritance/scale. This prevents user themes from overlapping
// PRESET, Gain, Audio Tools or footer text.
{
  const visual = new ThemeRegistry();
  const hugeType = validateThemeDefinition({
    schemaVersion:1, id:'user.huge-type', name:'Huge type', extends:'builtin.rice', preferredLayout:'rice',
    tokens:{ typography:{ scale:1.2, micro:20, label:20, body:20, title:20, headline:20 } }
  });
  assert.throws(() => visual.register(hugeType), /layout-safe range/);
  const hugeSpacing = validateThemeDefinition({
    schemaVersion:1, id:'user.huge-spacing', name:'Huge spacing', extends:'builtin.nocturne', preferredLayout:'nocturne',
    tokens:{ spacing:{ scale:1.25, xs:12, sm:18, md:24, lg:28 } }
  });
  assert.throws(() => visual.register(hugeSpacing), /layout-safe range/);
  const safeEdge = validateThemeDefinition({
    schemaVersion:1, id:'user.safe-edge', name:'Safe edge', extends:'builtin.rice', preferredLayout:'rice',
    tokens:{ typography:{ scale:1.05, micro:10, label:11, body:13, title:16, headline:18 }, spacing:{ scale:1.05, xs:4, sm:8, md:12, lg:16 } }
  });
  visual.register(safeEdge);
  assert.equal(visual.resolve('user.safe-edge').id, 'user.safe-edge');
}

console.log('theme_system.test.mjs: PASS');
