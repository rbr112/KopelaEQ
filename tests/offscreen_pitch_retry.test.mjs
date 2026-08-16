import assert from 'node:assert/strict';
import * as S from '../extension/js/shared/index.js';
import { ContextMock as BaseContextMock, NodeMock, Param } from './audio_mocks.mjs';

let addModuleCalls=0;
class ContextMock extends BaseContextMock {
  constructor(){
    super();
    this.audioWorklet={addModule:async()=>{addModuleCalls+=1;if(addModuleCalls===1)throw new Error('transient cold-load failure');}};
  }
}
class WorkletNodeMock extends NodeMock {
  constructor(context,name){super('worklet');this.context=context;this.name=name;this.parameters=new Map([['semitones',new Param(0,-12,0)]]);}
}
globalThis.AudioContext=ContextMock;
globalThis.AudioWorkletNode=WorkletNodeMock;
let listener=null;
const track={readyState:'live',muted:false,enabled:true,addEventListener(){},stop(){this.readyState='ended';}};
const stream={getAudioTracks(){return [track];},getTracks(){return [track];}};
Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{async getUserMedia(){return stream;}}},configurable:true});
globalThis.chrome={runtime:{getURL:p=>p,onMessage:{addListener(fn){listener=fn;}},async sendMessage(){return {ok:true};}}};
await import(`../extension/js/offscreen/index.js?pitch-retry=${Date.now()}`);
function invoke(message){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('offscreen response timeout')),4000);listener(message,{},value=>{clearTimeout(timer);resolve(value);});});}

const initial=S.defaultAudioState();
await invoke({target:'offscreen',type:S.MessageType.CaptureStart,tabId:5,streamId:'s5',state:initial,protection:'strong',stateRevision:1,protectionRevision:1});
const pitched=S.defaultAudioState();pitched.pitchShift.enabled=true;pitched.pitchShift.semitones=-5;
const response=await invoke({target:'offscreen',type:S.MessageType.StateSet,tabId:5,state:pitched,revision:2});
assert.equal(response.ok,true);
assert.equal(addModuleCalls,2,'cold AudioWorklet load should retry once after a transient failure');
const status=await invoke({target:'offscreen',type:S.MessageType.SessionStatus,tabId:5});
assert.equal(status.stateRevision,2,'applied revision must advance only after pitch graph is actually ready');
assert.equal(status.state.pitchShift.enabled,true);
assert.equal(status.state.pitchShift.semitones,-5);
await invoke({target:'offscreen',type:S.MessageType.CaptureStop,tabId:5});
console.log('offscreen_pitch_retry.test.mjs: PASS');
