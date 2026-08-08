import assert from 'node:assert/strict';
import * as S from '../extension/js/shared/index.js';
class Param { constructor(v=0,min=-Infinity,max=Infinity){this.value=v;this.minValue=min;this.maxValue=max;} cancelScheduledValues(){} setTargetAtTime(v){this.value=v;} }
class NodeMock { constructor(kind='node'){this.kind=kind;this.connections=[];} connect(dest,output=0,input=0){this.connections.push({dest,output,input});return dest;} disconnect(dest){if(!dest)this.connections=[];else this.connections=this.connections.filter(c=>c.dest!==dest);} }
class GainMock extends NodeMock{constructor(){super('gain');this.gain=new Param(1)}}
class BiquadMock extends NodeMock{constructor(){super('biquad');this.type='peaking';this.frequency=new Param(350,0,24000);this.Q=new Param(1,.0001,1000);this.gain=new Param(0,-40,40)}}
class CompressorMock extends NodeMock{constructor(){super('comp');this.threshold=new Param(-24,-100,0);this.knee=new Param(30,0,40);this.ratio=new Param(12,1,20);this.attack=new Param(.003,0,1);this.release=new Param(.25,0,1);this.reduction=0}}
class AnalyserMock extends NodeMock{constructor(){super('analyser');this._fft=2048;this.frequencyBinCount=1024;this.minDecibels=-100;this.maxDecibels=0;this.smoothingTimeConstant=.5;}set fftSize(v){this._fft=v;this.frequencyBinCount=v/2}get fftSize(){return this._fft}getFloatTimeDomainData(a){a.fill(.1)}getFloatFrequencyData(a){a.fill(-60)}}
class ContextMock{constructor(){this.state='running';this.currentTime=0;this.sampleRate=48000;this.destination=new NodeMock('dest')}createMediaStreamSource(){return new NodeMock('src')}createGain(){return new GainMock()}createBiquadFilter(){return new BiquadMock()}createDynamicsCompressor(){return new CompressorMock()}createAnalyser(){return new AnalyserMock()}createChannelSplitter(){return new NodeMock('split')}async resume(){this.state='running'}async suspend(){this.state='suspended'}}
globalThis.AudioContext=ContextMock;
let listener=null,gumCalls=0,defer=false,resolver=null,stopCount=0;
function makeStream(){const track={addEventListener(){},stop(){stopCount++}};return {getAudioTracks(){return [track]},getTracks(){return [track]}}}
Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{async getUserMedia(){gumCalls++;if(!defer)return makeStream();return new Promise(r=>{resolver=()=>r(makeStream())})}}},configurable:true});
globalThis.chrome={runtime:{onMessage:{addListener(fn){listener=fn}},async sendMessage(){return {ok:true}}}};
await import(`../extension/js/offscreen/index.js?qa=${Date.now()}`);
assert.equal(typeof listener,'function');
function invoke(msg){return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('timeout')),1200);const ret=listener(msg,{},v=>{clearTimeout(t);resolve(v)});if(ret===false){clearTimeout(t);resolve(undefined)}})}
let r=await invoke({target:'offscreen',type:S.MessageType.SessionStatus,tabId:7});assert.equal(r.active,false);
r=await invoke({target:'offscreen',type:S.MessageType.CaptureStart,tabId:7,streamId:'s',state:S.defaultAudioState(),protection:'off'});assert.equal(r.ok,true);
r=await invoke({target:'offscreen',type:S.MessageType.SessionStatus,tabId:7});assert.equal(r.active,true);assert.equal(r.sampleRate,48000);assert.deepEqual(r.activeTabs,[7]);
const calls=gumCalls;r=await invoke({target:'offscreen',type:S.MessageType.CaptureStart,tabId:7,streamId:'unused',state:S.defaultAudioState(),protection:'strong'});assert.equal(r.alreadyActive,true);assert.equal(gumCalls,calls);
r=await invoke({target:'offscreen',type:S.MessageType.MeterGet,tabId:7,spectrum:true,spectrumMode:'smooth'});assert.equal(r.active,true);assert.equal(r.meter.spectrum.length,96);assert.ok(r.meter.preProtection);assert.ok(r.meter.postProtection);
r=await invoke({target:'offscreen',type:S.MessageType.MeterGet,tabId:7,spectrum:true,spectrumMode:'fast',levels:false});assert.equal(r.active,true);assert.equal(r.meter.preProtection.peakDb,-120);assert.equal(r.meter.spectrum.length,96);
r=await invoke({target:'offscreen',type:S.MessageType.MeterGet,tabId:7,spectrum:true,spectrumMode:'warp'});assert.equal(r,undefined);
await invoke({target:'offscreen',type:S.MessageType.CaptureStop,tabId:7});r=await invoke({target:'offscreen',type:S.MessageType.SessionStatus,tabId:7});assert.equal(r.active,false);

// Concurrent duplicate starts share the pending getUserMedia work.
defer=true;const before=gumCalls;const p1=invoke({target:'offscreen',type:S.MessageType.CaptureStart,tabId:8,streamId:'p1',state:S.defaultAudioState(),protection:'off'});await new Promise(r=>setTimeout(r,0));const p2=invoke({target:'offscreen',type:S.MessageType.CaptureStart,tabId:8,streamId:'p2',state:S.defaultAudioState(),protection:'off'});resolver();const [a,b]=await Promise.all([p1,p2]);assert.equal(a.ok,true);assert.equal(b.ok,true);assert.equal(gumCalls,before+1);await invoke({target:'offscreen',type:S.MessageType.CaptureStop,tabId:8});defer=false;

// Stop while getUserMedia is pending invalidates generation and stops late stream.
defer=true;const p3=invoke({target:'offscreen',type:S.MessageType.CaptureStart,tabId:9,streamId:'p3',state:S.defaultAudioState(),protection:'off'});await new Promise(r=>setTimeout(r,0));await invoke({target:'offscreen',type:S.MessageType.CaptureStop,tabId:9});const beforeStops=stopCount;resolver();const cancelled=await p3;assert.equal(cancelled.ok,false);assert.match(cancelled.error,/cancelled/i);assert.ok(stopCount>beforeStops);defer=false;

assert.equal(await invoke({target:'offscreen',type:'STATE_SEТ',state:{}}),undefined);
console.log('offscreen_runtime.test.mjs: PASS');
