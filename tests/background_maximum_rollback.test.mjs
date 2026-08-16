import assert from 'node:assert/strict';
import * as S from '../extension/js/shared/index.js';

const store={
  [S.STORAGE.AUDIO_STATE]:S.defaultAudioState(),
  [S.STORAGE.AUDIO_BASELINE_VERSION]:4,
  [S.STORAGE.PROTECTION]:'strong'
};
let listener=null,protectionRuntime='strong',protectionCalls=[];
globalThis.chrome={
  storage:{local:{async get(keys){const list=typeof keys==='string'?[keys]:keys;const out={};for(const k of list||[])if(k in store)out[k]=store[k];return out;},async set(values){Object.assign(store,values);}}},
  offscreen:{async hasDocument(){return true;},async createDocument(){},async closeDocument(){}},
  runtime:{
    getURL:p=>p,
    onMessage:{addListener(fn){listener=fn;}},
    async sendMessage(message){
      if(message.type===S.MessageType.SessionStatus)return {ok:true,active:false,activeTabs:[],pendingTabs:[],protection:protectionRuntime,protectionRevision:0};
      if(message.type===S.MessageType.ProtectionSet){
        protectionCalls.push({mode:message.protection,revision:message.revision});
        if(message.protection==='maximum')return {ok:false,error:'Maximum limiter AudioWorklet failed to load.'};
        protectionRuntime=message.protection;
        return {ok:true,revision:message.revision};
      }
      return {ok:true,active:false};
    }
  },
  tabCapture:{async getCapturedTabs(){return [];},onStatusChanged:{addListener(){}}},
  tabs:{async get(id){return {id,audible:false};},onRemoved:{addListener(){}},onUpdated:{addListener(){}}}
};
await import(`../extension/js/background/index.js?max-rollback=${Date.now()}`);
function invoke(message){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('background response timeout')),3000);listener(message,{},value=>{clearTimeout(timer);resolve(value);});});}

const failed=await invoke({type:S.MessageType.ProtectionSet,protection:'maximum'});
assert.equal(failed.ok,false);
assert.match(failed.error,/Maximum limiter AudioWorklet failed/i);
assert.equal(store[S.STORAGE.PROTECTION],'strong','failed Maximum must not become durable storage state');
assert.equal(protectionRuntime,'strong','runtime must converge back to the last working mode');
const tail=protectionCalls.slice(-2);
assert.deepEqual(tail.map(x=>x.mode),['maximum','strong']);
assert.ok(tail[1].revision>tail[0].revision,'rollback must use a newer revision');
const status=await invoke({type:S.MessageType.StatusGet,tabId:1});
assert.equal(status.protection,'strong');
console.log('background_maximum_rollback.test.mjs: PASS');
