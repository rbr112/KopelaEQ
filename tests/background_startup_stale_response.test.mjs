import assert from 'node:assert/strict';
import * as S from '../extension/js/shared/index.js';

const original=S.defaultAudioState(); original.gainDb=6;
let listener=null;
let firstGet=true;
const store={
  [S.STORAGE.AUDIO_STATE]:original,
  [S.STORAGE.PROTECTION]:'light',
  [S.STORAGE.AUDIO_BASELINE_VERSION]:4
};
const delay=(ms)=>new Promise(r=>setTimeout(r,ms));
globalThis.chrome={
  storage:{local:{
    async get(keys){
      const list=typeof keys==='string'?[keys]:keys;
      const snapshot={}; for(const key of list||[])if(key in store)snapshot[key]=structuredClone(store[key]);
      if(firstGet){firstGet=false;await delay(1580);}
      return snapshot;
    },
    async set(values){Object.assign(store,structuredClone(values));}
  }},
  offscreen:{async hasDocument(){return false;},async createDocument(){},async closeDocument(){}},
  runtime:{getURL:p=>p,onMessage:{addListener(fn){listener=fn;}},async sendMessage(){return {ok:true,active:false,activeTabs:[],pendingTabs:[]};}},
  tabCapture:{async getCapturedTabs(){return [];},onStatusChanged:{addListener(){}}},
  tabs:{async get(id){return {id,audible:false};},onRemoved:{addListener(){}},onUpdated:{addListener(){}}}
};
await import(`../extension/js/background/index.js?stale=${Date.now()}`);
function invoke(message){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('background response timeout')),5000);listener(message,{tab:{id:4}},value=>{clearTimeout(timer);resolve(value);});});}

const early=await invoke({type:S.MessageType.StatusGet,tabId:4});
assert.equal(early.stateAuthoritative,false);
const user=S.defaultAudioState(); user.gainDb=9;
const changed=await invoke({type:S.MessageType.StateSet,tabId:4,state:user,persist:true});
assert.equal(changed.state.gainDb,9);
await delay(260); // the original slow startup read has now completed with gain=6
const final=await invoke({type:S.MessageType.StatusGet,tabId:4});
assert.equal(final.stateAuthoritative,true);
assert.equal(final.state.gainDb,9,'late startup snapshot must not overwrite newer user state');
assert.equal(store[S.STORAGE.AUDIO_STATE].gainDb,9,'late startup snapshot must not overwrite persisted newer user state');
console.log('background_startup_stale_response.test.mjs: PASS');
