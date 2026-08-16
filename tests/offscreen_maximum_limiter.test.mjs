import assert from 'node:assert/strict';
import * as S from '../extension/js/shared/index.js';
import { ContextMock as BaseContextMock, NodeMock, Param } from './audio_mocks.mjs';

let addModuleCalls=0;
class ContextMock extends BaseContextMock {
  constructor(){
    super();
    this.audioWorklet={addModule:async(url)=>{
      addModuleCalls+=1;
      assert.match(url,/true-peak-limiter-processor\.js$/);
      if(addModuleCalls<=3) throw new Error('simulated Maximum worklet load failure');
    }};
  }
}
class WorkletNodeMock extends NodeMock {
  constructor(context,name){super('worklet');this.context=context;this.name=name;this.parameters=new Map([['semitones',new Param(0,-12,0)]]);this.port={onmessage:null,postMessage(){}};}
}
globalThis.AudioContext=ContextMock;
globalThis.AudioWorkletNode=WorkletNodeMock;
let listener=null;
const track={readyState:'live',muted:false,enabled:true,addEventListener(){},stop(){this.readyState='ended';}};
const stream={getAudioTracks(){return [track];},getTracks(){return [track];}};
Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{async getUserMedia(){return stream;}}},configurable:true});
globalThis.chrome={runtime:{getURL:p=>p,onMessage:{addListener(fn){listener=fn;}},async sendMessage(){return {ok:true};}}};
await import(`../extension/js/offscreen/index.js?maximum=${Date.now()}`);
function invoke(message){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('offscreen response timeout')),5000);listener(message,{},value=>{clearTimeout(timer);resolve(value);});});}

const initial=S.defaultAudioState();
let response=await invoke({target:'offscreen',type:S.MessageType.CaptureStart,tabId:15,streamId:'s15',state:initial,protection:'strong',stateRevision:1,protectionRevision:1});
assert.equal(response.ok,true);

// A failed Maximum module load must not advertise/apply Maximum.
response=await invoke({target:'offscreen',type:S.MessageType.ProtectionSet,protection:'maximum',revision:2});
assert.equal(response.ok,false);
assert.match(response.error,/simulated Maximum worklet load failure/i);
let status=await invoke({target:'offscreen',type:S.MessageType.SessionStatus,tabId:15});
assert.equal(status.protection,'strong');
assert.equal(status.protectionRevision,1);
assert.equal(addModuleCalls,3,'Maximum loader should retry transient failures three times');

// A later request can retry cleanly and becomes authoritative only after the graph exists.
response=await invoke({target:'offscreen',type:S.MessageType.ProtectionSet,protection:'maximum',revision:3});
assert.equal(response.ok,true);
assert.equal(addModuleCalls,4);
status=await invoke({target:'offscreen',type:S.MessageType.SessionStatus,tabId:15});
assert.equal(status.protection,'maximum');
assert.equal(status.protectionRevision,3);

await invoke({target:'offscreen',type:S.MessageType.CaptureStop,tabId:15});
console.log('offscreen_maximum_limiter.test.mjs: PASS');
