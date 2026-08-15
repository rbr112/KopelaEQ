import assert from 'node:assert/strict';

let registeredName='';
let ProcessorCtor=null;
class ProcessorBase {}
globalThis.AudioWorkletProcessor=ProcessorBase;
globalThis.sampleRate=48000;
globalThis.registerProcessor=(name,ctor)=>{registeredName=name;ProcessorCtor=ctor;};
await import(`../extension/js/audio/pitch-worklet-processor.js?qa=${Date.now()}`);
assert.equal(registeredName,'kopelaeq-pitch-shift');
assert.equal(typeof ProcessorCtor,'function');
assert.deepEqual(ProcessorCtor.parameterDescriptors,[{name:'semitones',defaultValue:0,minValue:-12,maxValue:0,automationRate:'k-rate'}]);
const processor=new ProcessorCtor();
const frames=128;
const input=[new Float32Array(frames),new Float32Array(frames)];
for(let i=0;i<frames;i+=1){input[0][i]=Math.sin(i/9);input[1][i]=Math.cos(i/11);}
const output=[new Float32Array(frames),new Float32Array(frames)];
assert.equal(processor.process([input],[output],{semitones:new Float32Array([-4])}),true);
assert.ok(output.every(channel=>channel.every(Number.isFinite)));
const silent=[new Float32Array(frames),new Float32Array(frames)];silent[0].fill(1);silent[1].fill(1);
assert.equal(processor.process([],[silent],{semitones:new Float32Array([0])}),true);
assert.ok(silent.every(channel=>channel.every(value=>value===0)));
console.log('pitch_worklet_wrapper.test.mjs: PASS');
