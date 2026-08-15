import assert from 'node:assert/strict';
import * as S from '../extension/js/shared/index.js';
import { DEFAULT_PRESETS } from '../extension/js/shared/default-presets.js';
import { AudioSession } from '../extension/js/audio/audio-session.js';
import { ContextMock } from './audio_mocks.mjs';

let stopped=false;
const track={readyState:'live',muted:false,enabled:true,addEventListener(){},stop(){stopped=true;this.readyState='ended';}};
const stream={getAudioTracks(){return [track]},getTracks(){return [track]}};
const ctx=new ContextMock();
const state=S.presetToAudioState(DEFAULT_PRESETS['Vivid (111)']);
const session=new AudioSession(ctx,7,stream,state,'off');
assert.deepEqual(ctx.biquads.slice(0,S.EQ_BANDS).map(f=>f.type),S.EQ_TYPES);
for(let i=0;i<S.EQ_BANDS;i++){ assert.equal(ctx.biquads[i].frequency.value,state.eq.frequencies[i]); assert.equal(ctx.biquads[i].gain.value,state.eq.gains[i]); assert.equal(ctx.biquads[i].Q.value,state.eq.qs[i]); }

// Permanent dry paths exist and every optional processor input is physically disconnected when OFF.
assert.equal(session.source.connections[0].dest,session.inputGain);
assert.equal(session.inputGain.connections[0].dest,session.eqFilters[0]);
assert.equal(session.eqFilters[S.EQ_BANDS-1].connections[0].dest,session.masterGain);
assert.equal(session.masterGain.connections[0].dest,session.pitchIn);
assert.deepEqual(session.pitchIn.connections.map(c=>c.dest),[session.pitchDry]);
assert.deepEqual(session.dynamicsIn.connections.map(c=>c.dest),[session.dynamicsDry]);
assert.deepEqual(session.stereoStage.input.connections.map(c=>c.dest),[session.stereoStage.dry]);
assert.deepEqual(session.protectionIn.connections.map(c=>c.dest),[session.protectionDry]);
for(const stage of [session.reverbStage,session.autoPanStage]) assert.deepEqual(stage.input.connections.map(c=>c.dest),[stage.dry]);
assert.equal('delayStage' in session,false); assert.equal('exciterStage' in session,false);
assert.equal(session.pitchDry.gain.value,1); assert.equal(session.pitchWet.gain.value,0);
assert.equal(session.dynamicsDry.gain.value,1); assert.equal(session.dynamicsWet.gain.value,0);
assert.equal(session.stereoStage.dry.gain.value,1); assert.equal(session.stereoStage.wet.gain.value,0);
assert.equal(session.protectionDry.gain.value,1); assert.equal(session.protectionWet.gain.value,0);
assert.ok(session.autoPanStage.output.connections.some(c=>c.dest===ctx.destination));

const next=S.clone(state); next.dynamics.enabled=true; next.dynamics.mode='multiband'; next.dynamics.amount=.6; next.stereo.enabled=true; next.stereo.width=1.5; next.delay.enabled=true; next.delay.mix=.25; next.exciter.enabled=true; next.exciter.amount=.5;
session.applyState(next,true);
assert.equal(session.dynamicsDry.gain.value,0); assert.equal(session.dynamicsWet.gain.value,1); assert.ok(session.dynamicsIn.connections.length>1);
assert.equal(session.stereoStage.debugState.processorConnected,true); assert.ok(session.stereoStage.input.connections.some(c=>c.dest.kind==='splitter'));
assert.equal('delayStage' in session,false); assert.equal('exciterStage' in session,false);
const neutral=S.clone(next); neutral.stereo={enabled:true,width:1,balance:0,mono:false,swap:false}; session.applyState(neutral,true); assert.equal(session.stereoStage.debugState.processorConnected,false);

session.applyProtection('strong',true); assert.equal(session.protectionDry.gain.value,0); assert.equal(session.protectionWet.gain.value,1); assert.ok(session.protectionIn.connections.some(c=>ctx.compressors.includes(c.dest)));
session.low.compressor.reduction=-.5; session.mid.compressor.reduction=-1.5; session.high.compressor.reduction=-.8; session.limiter.reduction=-2.5;
const activeMeter=session.getMeter(false,'balanced',true); assert.equal(activeMeter.gainReductionDb,-2.5); assert.equal(activeMeter.dynamicsReductionDb,-1.5);
session.applyProtection('off',true); assert.ok(session.protectionIn.connections.some(c=>c.dest===session.protectionDry)); assert.ok(!session.protectionIn.connections.some(c=>ctx.compressors.includes(c.dest)));
const meter=session.getMeter(true,'fast',true); assert.equal(meter.sampleRate,48000); assert.equal(meter.spectrum.length,96); assert.ok(meter.peakDb<0); assert.ok(meter.preProtection&&meter.postProtection); assert.equal(ctx.analysers[0].smoothingTimeConstant,.15);
assert.ok(session.protectionIn.connections.some(c=>c.dest.kind==='splitter')); assert.ok(session.protectionOut.connections.some(c=>c.dest.kind==='splitter'));
assert.ok(session.autoPanStage.output.connections.some(c=>c.dest.kind==='analyser')); assert.ok(ctx.analysers.every(a=>a.connections.length===0));
const smooth=session.getMeter(true,'smooth');assert.equal(smooth.spectrum.length,96);assert.equal(ctx.analysers[0].smoothingTimeConstant,.82);
const spectrumOnly=session.getMeter(true,'balanced',false);assert.equal(spectrumOnly.preProtection.peakDb,-120);assert.equal(session.protectionIn.connections.filter(c=>c.dest.kind==='splitter').length,0);assert.equal(session.protectionOut.connections.filter(c=>c.dest.kind==='splitter').length,0);assert.ok(session.autoPanStage.output.connections.some(c=>c.dest.kind==='analyser'));
const levelsOnly=session.getMeter(false,'balanced',true);assert.ok(levelsOnly.preProtection.peakDb>-120);assert.ok(session.protectionIn.connections.some(c=>c.dest.kind==='splitter'));assert.ok(session.protectionOut.connections.some(c=>c.dest.kind==='splitter'));assert.ok(!session.autoPanStage.output.connections.some(c=>c.dest.kind==='analyser'));
session.dispose();assert.equal(stopped,true);
console.log('audio_session.test.mjs: PASS');
