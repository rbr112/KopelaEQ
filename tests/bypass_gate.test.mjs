import assert from 'node:assert/strict';
import { BypassGate } from '../extension/js/audio/bypass-gate.js';
class Param {
  constructor(value) { this.value = value; this.events = []; }
  cancelScheduledValues(time) { this.events.push(['cancel', time]); }
  setTargetAtTime(value, time, tau) { this.value = value; this.events.push(['target', value, time, tau]); }
}
const context = { currentTime: 1 };
const dry = { gain: new Param(1) };
const wet = { gain: new Param(0) };
let connects = 0, disconnects = 0;
const processor = { connectInput(){ connects += 1; }, disconnectInput(){ disconnects += 1; } };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const gate = new BypassGate(context, dry, wet, processor, { tau: 0.001, settleMs: 8 });
gate.setEnabled(false, true);
assert.equal(dry.gain.value, 1); assert.equal(wet.gain.value, 0); assert.equal(connects, 0);
gate.setEnabled(true); assert.equal(connects, 1); assert.equal(dry.gain.value, 0); assert.equal(wet.gain.value, 1);
gate.setEnabled(false); assert.equal(disconnects, 0); await wait(12); assert.equal(disconnects, 1);
gate.setEnabled(true, true); assert.equal(connects, 2); gate.setEnabled(false); await wait(2); gate.setEnabled(true); await wait(12); assert.equal(disconnects, 1);
const beforeD=disconnects, beforeC=connects; gate.refresh(false); assert.equal(dry.gain.value,1); assert.equal(wet.gain.value,0); await wait(12); assert.equal(disconnects,beforeD+1); assert.equal(connects,beforeC+1); assert.equal(dry.gain.value,0); assert.equal(wet.gain.value,1);
gate.refresh(false); await wait(2); gate.setEnabled(false); await wait(2); gate.setEnabled(true); await wait(12); assert.equal(dry.gain.value,0); assert.equal(wet.gain.value,1);
const beforeDispose=disconnects, connectsBeforeDispose=connects; gate.dispose(); assert.equal(disconnects,beforeDispose+1); gate.setEnabled(true); assert.equal(connects,connectsBeforeDispose);
assert.equal(gate.debugState.disposed, true);
console.log('bypass_gate.test.mjs: PASS');
