import assert from 'node:assert/strict';
import * as S from '../extension/js/shared/index.js';
import { ContextMock as BaseContextMock } from './audio_mocks.mjs';

let workletResolver=null;
let deferWorklet=false;
class ContextMock extends BaseContextMock {
  constructor(){
    super();
    this.audioWorklet={addModule:async()=>{
      if(!deferWorklet)return;
      await new Promise(resolve=>{workletResolver=resolve;});
    }};
  }
}
globalThis.AudioContext=ContextMock;
let listener=null;
const track={readyState:'live',muted:false,enabled:true,addEventListener(){},stop(){this.readyState='ended';}};
const stream={getAudioTracks(){return [track];},getTracks(){return [track];}};
Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{async getUserMedia(){return stream;}}},configurable:true});
globalThis.chrome={runtime:{getURL:p=>p,onMessage:{addListener(fn){listener=fn;}},async sendMessage(){return {ok:true};}}};
await import(`../extension/js/offscreen/index.js?generation=${Date.now()}`);
function invoke(message){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('offscreen response timeout')),2000);listener(message,{},value=>{clearTimeout(timer);resolve(value);});});}

const initial=S.defaultAudioState();
await invoke({target:'offscreen',type:S.MessageType.CaptureStart,tabId:12,streamId:'s12',state:initial,protection:'strong',stateRevision:1,protectionRevision:1});

deferWorklet=true;
const stale=S.defaultAudioState(); stale.gainDb=1; stale.pitchShift.enabled=true; stale.pitchShift.semitones=-4;
const newest=S.defaultAudioState(); newest.gainDb=8;
const oldRequest=invoke({target:'offscreen',type:S.MessageType.StateSet,tabId:12,state:stale,revision:2});
while(!workletResolver) await new Promise(r=>setTimeout(r,0));
const newRequest=invoke({target:'offscreen',type:S.MessageType.StateSet,tabId:12,state:newest,revision:3});
const newResponse=await newRequest;
assert.equal(newResponse.revision,3);
workletResolver();
await oldRequest;
const status=await invoke({target:'offscreen',type:S.MessageType.SessionStatus,tabId:12});
assert.equal(status.stateRevision,3);
assert.equal(status.state.gainDb,8,'stale worklet-loading StateSet must not overwrite newer state');
assert.equal(status.state.pitchShift.enabled,false);
await invoke({target:'offscreen',type:S.MessageType.CaptureStop,tabId:12});
console.log('offscreen_state_generation.test.mjs: PASS');
