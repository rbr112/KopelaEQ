import assert from 'node:assert/strict';
import { freqToX, freqToMarkerX, gainToY } from '../extension/js/popup/eq-geometry.js';

const plot = { left: 40, top: 12, right: 588, bottom: 300, width: 548, height: 288 };

assert.equal(freqToX(5, plot), plot.left, '5 Hz DSP minimum maps to the visible left edge');
assert.ok(freqToX(17, plot) > plot.left, '17 Hz is now represented inside the expanded graph');
assert.equal(freqToX(1, plot), plot.left, 'frequencies below DSP minimum clamp to the left edge');
assert.equal(freqToX(20000, plot), plot.right, '20 kHz maps to right edge');
assert.equal(freqToX(50000, plot), plot.right, 'frequencies above graph maximum clamp to right edge');

const markerRadius = 6.4;
assert.ok(freqToMarkerX(17, plot, markerRadius) > plot.left + markerRadius, '17 Hz marker keeps its real logarithmic position');
assert.equal(freqToMarkerX(5, plot, markerRadius), plot.left + markerRadius, '5 Hz marker stays fully inside plot');
assert.equal(freqToMarkerX(20000, plot, markerRadius), plot.right - markerRadius, 'high marker stays fully inside plot');
assert.ok(freqToMarkerX(80, plot, markerRadius) > plot.left + markerRadius, 'normal marker keeps logarithmic position');

assert.equal(gainToY(40, plot), plot.top, 'gain above graph range clamps to top');
assert.equal(gainToY(-40, plot), plot.bottom, 'gain below graph range clamps to bottom');

console.log('eq_geometry.test.mjs: PASS');
