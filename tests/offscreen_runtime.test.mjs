import assert from 'node:assert/strict';
import * as S from '../extension/js/shared/index.js';
import { ContextMock as BaseContextMock } from './audio_mocks.mjs';
let lastContext=null;
class ContextMock extends BaseContextMock { constructor(){ super(); lastContext=this; } }
globalThis.AudioContext=ContextMock;
let listener=null,gumCalls=0,defer=false,resolver=null,stopCount=0,lastStream=null;
const runtimeMessages=[];
function makeStream(){const listeners=new Map();const track={readyState:'live',muted:false,enabled:true,addEventListener(type,fn){const a=listeners.get(type)||[];a.push(fn);listeners.set(type,a)},emit(type){for(const fn of listeners.get(type)||[])fn()},stop(){stopCount++;this.readyState='ended'}};return {track,getAudioTracks(){return [track]},getTracks(){return [track]}}}
Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{async getUserMedia(){gumCalls++;if(!defer){lastStream=makeStream();return lastStream;}return new Promise(r=>{resolver=()=>{lastStream=makeStream();r(lastStream)}})}}},configurable:true});
globalThis.chrome={runtime:{onMessage:{addListener(fn){listener=fn}},async sendMessage(msg){runtimeMessages.push(msg);return {ok:true}}}};
await import(`../extension/js/offscreen/index.js?qa=${Date.now()}`);
assert.equal(typeof listener,'function');
function invoke(msg){return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('timeout')),1200);const ret=listener(msg,{},v=>{clearTimeout(t);resolve(v)});if(ret===false){clearTimeout(t);resolve(undefined)}})}
let r=await invoke({target:'offscreen',type:S.MessageType.SessionStatus,tabId:7});assert.equal(r.active,false);
r=await invoke({target:'offscreen',type:S.MessageType.CaptureStart,tabId:7,streamId:'s',state:S.defaultAudioState(),protection:'off',stateRevision:1,protectionRevision:1});assert.equal(r.ok,true);
r=await invoke({target:'offscreen',type:S.MessageType.SessionStatus,tabId:7});assert.equal(r.active,true);assert.equal(r.sampleRate,48000);assert.deepEqual(r.activeTabs,[7]);assert.equal(r.trackReadyState,'live');assert.equal(r.trackMuted,false);assert.equal(r.contextState,'running');
lastStream.track.muted=true;lastStream.track.emit('mute');await new Promise(r=>setTimeout(r,0));assert.ok(runtimeMessages.some(m=>m.type===S.MessageType.SessionHealthChanged&&m.tabId===7&&m.trackMuted===true));r=await invoke({target:'offscreen',type:S.MessageType.SessionStatus,tabId:7});assert.equal(r.trackMuted,true);
lastStream.track.muted=false;lastStream.track.emit('unmute');
lastContext.state='suspended';r=await invoke({target:'offscreen',type:S.MessageType.SessionStatus,tabId:7});assert.equal(lastContext.state,'running');assert.equal(r.contextState,'running');
const calls=gumCalls;r=await invoke({target:'offscreen',type:S.MessageType.CaptureStart,tabId:7,streamId:'unused',state:S.defaultAudioState(),protection:'strong',stateRevision:2,protectionRevision:2});assert.equal(r.alreadyActive,true);assert.equal(gumCalls,calls);
r=await invoke({target:'offscreen',type:S.MessageType.MeterGet,tabId:7,spectrum:true,spectrumMode:'smooth'});assert.equal(r.active,true);assert.equal(r.meter.spectrum.length,96);assert.ok(r.meter.preProtection);assert.ok(r.meter.postProtection);
r=await invoke({target:'offscreen',type:S.MessageType.MeterGet,tabId:7,spectrum:true,spectrumMode:'fast',levels:false});assert.equal(r.active,true);assert.equal(r.meter.preProtection.peakDb,-120);assert.equal(r.meter.spectrum.length,96);
r=await invoke({target:'offscreen',type:S.MessageType.MeterGet,tabId:7,spectrum:true,spectrumMode:'warp'});assert.equal(r,undefined);
await invoke({target:'offscreen',type:S.MessageType.CaptureStop,tabId:7});r=await invoke({target:'offscreen',type:S.MessageType.SessionStatus,tabId:7});assert.equal(r.active,false);

// Concurrent duplicate starts share the pending getUserMedia work.
defer=true;const before=gumCalls;const p1=invoke({target:'offscreen',type:S.MessageType.CaptureStart,tabId:8,streamId:'p1',state:S.defaultAudioState(),protection:'off',stateRevision:3,protectionRevision:3});await new Promise(r=>setTimeout(r,0));const p2=invoke({target:'offscreen',type:S.MessageType.CaptureStart,tabId:8,streamId:'p2',state:S.defaultAudioState(),protection:'off',stateRevision:3,protectionRevision:3});resolver();const [a,b]=await Promise.all([p1,p2]);assert.equal(a.ok,true);assert.equal(b.ok,true);assert.equal(gumCalls,before+1);await invoke({target:'offscreen',type:S.MessageType.CaptureStop,tabId:8});defer=false;

// Stop while getUserMedia is pending invalidates generation and stops late stream.
defer=true;const p3=invoke({target:'offscreen',type:S.MessageType.CaptureStart,tabId:9,streamId:'p3',state:S.defaultAudioState(),protection:'off',stateRevision:4,protectionRevision:4});await new Promise(r=>setTimeout(r,0));await invoke({target:'offscreen',type:S.MessageType.CaptureStop,tabId:9});const beforeStops=stopCount;resolver();const cancelled=await p3;assert.equal(cancelled.ok,false);assert.match(cancelled.error,/cancelled/i);assert.ok(stopCount>beforeStops);defer=false;

assert.equal(await invoke({target:'offscreen',type:'STATE_SEТ',state:{}}),undefined);
console.log('offscreen_runtime.test.mjs: PASS');
