import assert from 'node:assert/strict';
import * as S from '../extension/js/shared/index.js';

const store={
  [S.STORAGE.AUDIO_STATE]:S.defaultAudioState(),
  [S.STORAGE.PROTECTION]:'strong',
  [S.STORAGE.AUDIO_BASELINE_VERSION]:4
};
let listener=null;
let runtimeState=S.defaultAudioState();
let runtimeProtection='strong';
let stateRuntimeWrites=0;
let stateStorageWrites=0;
let protectionRuntimeWrites=0;
let protectionStorageWrites=0;

const delay=(ms)=>new Promise(r=>setTimeout(r,ms));
globalThis.chrome={
  storage:{local:{
    async get(keys){const list=typeof keys==='string'?[keys]:keys;const out={};for(const key of list||[])if(key in store)out[key]=structuredClone(store[key]);return out;},
    async set(values){
      if(S.STORAGE.AUDIO_STATE in values){stateStorageWrites+=1;if(values[S.STORAGE.AUDIO_STATE].eq.gains[0]===1)await delay(70);}
      if(S.STORAGE.PROTECTION in values){protectionStorageWrites+=1;if(values[S.STORAGE.PROTECTION]==='light')await delay(60);}
      Object.assign(store,structuredClone(values));
    }
  }},
  offscreen:{async hasDocument(){return true;},async createDocument(){},async closeDocument(){}},
  runtime:{
    getURL:p=>p,
    onMessage:{addListener(fn){listener=fn;}},
    async sendMessage(message){
      if(message?.target!=='offscreen') return {ok:true};
      if(message.type===S.MessageType.SessionStatus)return {ok:true,active:false,activeTabs:[],pendingTabs:[]};
      if(message.type===S.MessageType.StateSet){stateRuntimeWrites+=1;if(message.state.eq.gains[0]===1)await delay(80);runtimeState=structuredClone(message.state);return {ok:true,active:true};}
      if(message.type===S.MessageType.ProtectionSet){protectionRuntimeWrites+=1;if(message.protection==='light')await delay(65);runtimeProtection=message.protection;return {ok:true};}
      return {ok:true,active:false};
    }
  },
  tabCapture:{async getCapturedTabs(){return [];},onStatusChanged:{addListener(){}}},
  tabs:{async get(id){return {id,audible:false};},onRemoved:{addListener(){}},onUpdated:{addListener(){}}}
};

await import(`../extension/js/background/index.js?race=${Date.now()}`);
assert.equal(typeof listener,'function');
await delay(20); // allow late startup convergence messages to drain
stateRuntimeWrites=0; stateStorageWrites=0; protectionRuntimeWrites=0; protectionStorageWrites=0;
function invoke(message){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('background response timeout')),4000);listener(message,{tab:{id:9}},value=>{clearTimeout(timer);resolve(value);});});}

const stateCalls=[];
for(let i=1;i<=24;i+=1){const next=S.defaultAudioState();next.eq.gains[0]=i;stateCalls.push(invoke({type:S.MessageType.StateSet,tabId:9,state:next,persist:true}));}
await Promise.all(stateCalls);
assert.equal(store[S.STORAGE.AUDIO_STATE].eq.gains[0],24,'storage must end at newest state');
assert.equal(runtimeState.eq.gains[0],24,'audio runtime must end at newest state');
assert.ok(stateStorageWrites<24,`storage writes should collapse (got ${stateStorageWrites})`);
assert.ok(stateRuntimeWrites<24,`runtime writes should collapse (got ${stateRuntimeWrites})`);

const p1=invoke({type:S.MessageType.ProtectionSet,protection:'light'});
const p2=invoke({type:S.MessageType.ProtectionSet,protection:'off'});
const p3=invoke({type:S.MessageType.ProtectionSet,protection:'strong'});
await Promise.all([p1,p2,p3]);
assert.equal(store[S.STORAGE.PROTECTION],'strong','protection storage must be latest-wins');
assert.equal(runtimeProtection,'strong','protection runtime must be latest-wins');
assert.ok(protectionStorageWrites<3,`protection storage writes should collapse (got ${protectionStorageWrites})`);
assert.ok(protectionRuntimeWrites<3,`protection runtime writes should collapse (got ${protectionRuntimeWrites})`);

const status=await invoke({type:S.MessageType.StatusGet,tabId:9});
assert.equal(status.state.eq.gains[0],24);
assert.equal(status.protection,'strong');
console.log(`background_concurrency.test.mjs: PASS (state storage/runtime ${stateStorageWrites}/${stateRuntimeWrites}, protection ${protectionStorageWrites}/${protectionRuntimeWrites})`);
