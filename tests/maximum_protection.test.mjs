import assert from 'node:assert/strict';
import * as S from '../extension/js/shared/index.js';
import { AudioSession } from '../extension/js/audio/audio-session.js';
import { ContextMock, NodeMock, Param } from './audio_mocks.mjs';

class WorkletNodeMock extends NodeMock {
  constructor(context,name){
    super('worklet');
    this.context=context;
    this.name=name;
    this.parameters=new Map();
    this.port={onmessage:null,postMessage(){}};
  }
}
globalThis.AudioWorkletNode=WorkletNodeMock;

const track={readyState:'live',muted:false,enabled:true,addEventListener(){},stop(){this.readyState='ended';}};
const stream={getAudioTracks(){return [track]},getTracks(){return [track]}};
const ctx=new ContextMock();
const session=new AudioSession(ctx,44,stream,S.defaultAudioState(),'strong');

// Strong keeps the Maximum worklet physically absent from the active graph.
assert.ok(session.autoPanStage.output.connections.some(c=>c.dest===session.finalDryGain));
assert.ok(session.finalDryGain.connections.some(c=>c.dest===session.finalOutputBus));
assert.ok(session.finalOutputBus.connections.some(c=>c.dest===ctx.destination));
assert.equal(session.maximumLimiterNode,null);
assert.equal(session.finalDryGain.gain.value,1);
assert.equal(session.maximumWetGain.gain.value,0);
assert.equal(session.inputGain.gain.value,1,'Strong must not apply Maximum auto headroom');
const strong=S.PROTECTION_PROFILES.strong;
assert.equal(session.limiter.threshold.value,strong.threshold);
assert.equal(session.limiter.attack.value,strong.attack);

// Maximum must not silently enable unless its AudioWorklet node exists.
assert.throws(()=>session.applyProtection('maximum',true),/true-peak limiter is not ready/i);
assert.equal(session.protection,'strong');

const boosted={...S.defaultAudioState(),gainDb:6};
session.applyState(boosted,true);
assert.equal(session.inputGain.gain.value,1,'aggressive Gain must still leave Strong path unchanged');
session.ensureMaximumLimiterProcessor();
assert.equal(session.maximumLimiterNode.name,'kopelaeq-true-peak-limiter');
session.applyProtection('maximum',true);
const maximum=S.PROTECTION_PROFILES.maximum;
assert.equal(session.protection,'maximum');
assert.equal(session.limiter.threshold.value,maximum.threshold);
assert.equal(session.limiter.attack.value,maximum.attack);
assert.deepEqual(maximum,strong,'Maximum primary Protection stage must remain identical to Strong; extra safety belongs to the final peak catcher');

// Maximum alone connects the post-effects true-peak-aware worklet.
assert.ok(session.autoPanStage.output.connections.some(c=>c.dest===session.maximumLimiterNode));
assert.ok(session.maximumLimiterNode.connections.some(c=>c.dest===session.maximumWetGain));
assert.equal(session.finalDryGain.gain.value,0);
assert.equal(session.maximumWetGain.gain.value,1);
assert.equal(session.inputGain.gain.value,1,'Maximum must never apply constant pre-attenuation');

// Spectrum always taps the one final output bus regardless of protection mode.
session.getMeter(true,'balanced',false);
assert.ok(session.finalOutputBus.connections.some(c=>c.dest===session.spectrumAnalyser));

// Worklet gain-reduction telemetry contributes to the Protection GR meter.
session.limiter.reduction=-1.25;
session.maximumLimiterNode.port.onmessage({data:{type:'meter',reductionDb:-0.75,inputTruePeakDb:0.6,outputTruePeakDb:-1.2}});
const meter=session.getMeter(false,'balanced',true);
assert.equal(meter.maximumLimiterReductionDb,-0.75);
assert.equal(meter.maximumInputTruePeakDb,0.6);
assert.equal(meter.maximumOutputTruePeakDb,-1.2);
assert.equal(meter.gainReductionDb,-2,'Protection GR includes only the active Strong stage plus final peak catcher; no fixed headroom cut');

session.applyProtection('strong',true);
assert.equal(session.protection,'strong');
assert.equal(session.finalDryGain.gain.value,1);
assert.equal(session.maximumWetGain.gain.value,0);
assert.equal(session.inputGain.gain.value,1,'leaving Maximum keeps the always-unity input gain unchanged');
assert.ok(!session.autoPanStage.output.connections.some(c=>c.dest===session.maximumLimiterNode));

// Live switching warms the lookahead buffer before crossfade, and a rapid
// Maximum -> Strong reversal cancels that delayed engage instead of muting audio.
session.applyProtection('maximum',false);
assert.equal(session.finalDryGain.gain.value,1);
assert.equal(session.maximumWetGain.gain.value,0);
session.applyProtection('strong',false);
await new Promise(r=>setTimeout(r,15));
assert.equal(session.finalDryGain.gain.value,1);
assert.equal(session.maximumWetGain.gain.value,0);
await new Promise(r=>setTimeout(r,45));
assert.ok(!session.autoPanStage.output.connections.some(c=>c.dest===session.maximumLimiterNode));

session.applyProtection('maximum',false);
await new Promise(r=>setTimeout(r,12));
assert.equal(session.finalDryGain.gain.value,0);
assert.equal(session.maximumWetGain.gain.value,1);

session.dispose();
console.log('maximum_protection.test.mjs: PASS');
