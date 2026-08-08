import assert from 'node:assert/strict';
import * as S from '../extension/js/shared/index.js';
import { DEFAULT_PRESETS } from '../extension/js/shared/default-presets.js';
import { AudioSession } from '../extension/js/audio/audio-session.js';

class Param { constructor(v=0,min=-Infinity,max=Infinity){ this.value=v; this.minValue=min; this.maxValue=max; } cancelScheduledValues(){} setTargetAtTime(v){ this.value=v; } }
class NodeMock {
  constructor(kind='node'){ this.kind=kind; this.connections=[]; }
  connect(dest, output=0, input=0){ this.connections.push({dest,output,input}); return dest; }
  disconnect(dest){ if(!dest) this.connections=[]; else this.connections=this.connections.filter(c=>c.dest!==dest); }
}
class GainMock extends NodeMock { constructor(){ super('gain'); this.gain=new Param(1); } }
class BiquadMock extends NodeMock { constructor(){ super('biquad'); this.type='peaking'; this.frequency=new Param(350,0,24000); this.Q=new Param(1,0.0001,1000); this.gain=new Param(0,-40,40); } }
class CompressorMock extends NodeMock { constructor(){ super('compressor'); this.threshold=new Param(-24,-100,0); this.knee=new Param(30,0,40); this.ratio=new Param(12,1,20); this.attack=new Param(.003,0,1); this.release=new Param(.25,0,1); this.reduction=0; } }
let analyserIndex=0;
class AnalyserMock extends NodeMock { constructor(){ super('analyser'); this.index=analyserIndex++; this._fft=2048; this.frequencyBinCount=1024; this.minDecibels=-100; this.maxDecibels=-12; this.smoothingTimeConstant=.72; } set fftSize(v){this._fft=v; this.frequencyBinCount=v/2;} get fftSize(){return this._fft;} getFloatTimeDomainData(a){a.fill(this.index%2===0?.1:.2);} getFloatFrequencyData(a){a.fill(-60);} }
class ContextMock {
  constructor(){ this.state='running'; this.currentTime=0; this.sampleRate=48000; this.destination=new NodeMock('destination'); this.biquads=[]; this.gains=[]; this.compressors=[]; this.sources=[]; this.analysers=[]; }
  createMediaStreamSource(){ const n=new NodeMock('source'); this.sources.push(n); return n; }
  createGain(){ const n=new GainMock(); this.gains.push(n); return n; }
  createBiquadFilter(){ const n=new BiquadMock(); this.biquads.push(n); return n; }
  createDynamicsCompressor(){ const n=new CompressorMock(); this.compressors.push(n); return n; }
  createAnalyser(){ const n=new AnalyserMock(); this.analysers.push(n); return n; }
  createChannelSplitter(){ return new NodeMock('splitter'); }
}
let stopped=false;
const track={addEventListener(){},stop(){stopped=true;}};
const stream={getAudioTracks(){return [track]},getTracks(){return [track]}};
const ctx=new ContextMock();
const state=S.presetToAudioState(DEFAULT_PRESETS['Vivid (111)']);
const session=new AudioSession(ctx,7,stream,state,'off');
assert.deepEqual(ctx.biquads.slice(0,S.EQ_BANDS).map(f=>f.type),S.EQ_TYPES);
for(let i=0;i<S.EQ_BANDS;i++){
  assert.equal(ctx.biquads[i].frequency.value,state.eq.frequencies[i]);
  assert.equal(ctx.biquads[i].gain.value,state.eq.gains[i]);
  assert.equal(ctx.biquads[i].Q.value,state.eq.qs[i]);
}
// Permanent dry path; processor inputs disconnected when optional modules are OFF.
const [inputGain, masterGain, dynamicsIn, dynamicsDry, dynamicsWet, dynamicsOut, protectionIn, protectionDry, protectionWet, protectionOut]=ctx.gains;
assert.equal(ctx.sources[0].connections[0].dest,inputGain);
assert.equal(inputGain.connections[0].dest,ctx.biquads[0]);
assert.equal(ctx.biquads[S.EQ_BANDS-1].connections[0].dest,masterGain);
assert.equal(masterGain.connections[0].dest,dynamicsIn);
assert.equal(dynamicsIn.connections.length,1); assert.equal(dynamicsIn.connections[0].dest,dynamicsDry);
assert.equal(dynamicsDry.gain.value,1); assert.equal(dynamicsWet.gain.value,0);
assert.equal(protectionIn.connections.length,1); assert.equal(protectionIn.connections[0].dest,protectionDry);
assert.equal(protectionDry.gain.value,1); assert.equal(protectionWet.gain.value,0);
assert.ok(protectionOut.connections.some(c=>c.dest===ctx.destination));
// Analysis branches are demand-driven and must be absent from the idle audible graph.
assert.ok(!protectionIn.connections.some(c=>c.dest.kind==='splitter'));
assert.ok(!protectionOut.connections.some(c=>c.dest.kind==='splitter' || c.dest.kind==='analyser'));
assert.ok(!dynamicsIn.connections.some(c=>ctx.compressors.includes(c.dest)));
assert.ok(!protectionIn.connections.some(c=>ctx.compressors.includes(c.dest)));

const next=S.clone(state); next.dynamics.enabled=true; next.dynamics.mode='multiband'; next.dynamics.amount=.6;
session.applyState(next);
assert.equal(dynamicsDry.gain.value,0); assert.equal(dynamicsWet.gain.value,1);
assert.ok(dynamicsIn.connections.length>1);
session.applyProtection('strong');
assert.equal(protectionDry.gain.value,0); assert.equal(protectionWet.gain.value,1);
assert.ok(protectionIn.connections.some(c=>ctx.compressors.includes(c.dest)));
ctx.compressors[1].reduction=-0.5; ctx.compressors[2].reduction=-1.5; ctx.compressors[3].reduction=-0.8; ctx.compressors[4].reduction=-2.5;
const activeMeter=session.getMeter(false,'balanced',true);
assert.equal(activeMeter.gainReductionDb,-2.5); assert.equal(activeMeter.dynamicsReductionDb,-1.5);
session.applyProtection('off');
await new Promise(r=>setTimeout(r,20));
session.getMeter(false,'balanced',false);
assert.equal(protectionIn.connections.length,1);
const meter=session.getMeter(true,'fast',true);
assert.equal(meter.sampleRate,48000); assert.equal(meter.spectrum.length,96); assert.ok(meter.peakDb<0);
assert.ok(meter.preProtection && meter.postProtection);
assert.equal(meter.peakDb,meter.postProtection.peakDb); assert.equal(meter.rmsDb,meter.postProtection.rmsDb);
assert.equal(typeof meter.preProtection.leftPeakDb,'number'); assert.equal(typeof meter.postProtection.rightPeakDb,'number');
assert.equal(ctx.analysers[0].smoothingTimeConstant,0.15);
assert.ok(protectionIn.connections.some(c=>c.dest.kind==='splitter'));
assert.ok(protectionOut.connections.some(c=>c.dest.kind==='splitter'));
assert.ok(protectionOut.connections.some(c=>c.dest.kind==='analyser'));
// Analyser nodes are terminal observers: they never reconnect to the audible graph.
assert.ok(ctx.analysers.every(a=>a.connections.length===0));
const smoothMeter=session.getMeter(true,'smooth'); assert.equal(smoothMeter.spectrum.length,96); assert.equal(ctx.analysers[0].smoothingTimeConstant,0.82);
// Spectrum-only polling must not keep the pre/post level analyser branches connected.
const spectrumOnly=session.getMeter(true,'balanced',false);
assert.equal(spectrumOnly.preProtection.peakDb,-120);
assert.equal(protectionIn.connections.filter(c=>c.dest.kind==='splitter').length,0);
assert.equal(protectionOut.connections.filter(c=>c.dest.kind==='splitter').length,0);
assert.ok(protectionOut.connections.some(c=>c.dest.kind==='analyser'));
// Meter-only polling does the inverse: levels live, FFT side-chain disconnected.
const levelsOnly=session.getMeter(false,'balanced',true);
assert.ok(levelsOnly.preProtection.peakDb>-120);
assert.ok(protectionIn.connections.some(c=>c.dest.kind==='splitter'));
assert.ok(protectionOut.connections.some(c=>c.dest.kind==='splitter'));
assert.ok(!protectionOut.connections.some(c=>c.dest.kind==='analyser'));
session.dispose(); assert.equal(stopped,true);
console.log('audio_session.test.mjs: PASS');
