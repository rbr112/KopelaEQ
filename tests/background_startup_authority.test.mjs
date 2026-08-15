import assert from 'node:assert/strict';
import * as S from '../extension/js/shared/index.js';

const persisted=S.defaultAudioState(); persisted.gainDb=6;
let listener=null;
let getCount=0;
const store={
  [S.STORAGE.AUDIO_STATE]:persisted,
  [S.STORAGE.PROTECTION]:'light',
  [S.STORAGE.AUDIO_BASELINE_VERSION]:4
};
const delay=(ms)=>new Promise(r=>setTimeout(r,ms));
globalThis.chrome={
  storage:{local:{
    async get(keys){getCount+=1;if(getCount===1)await delay(1580);const list=typeof keys==='string'?[keys]:keys;const out={};for(const key of list||[])if(key in store)out[key]=structuredClone(store[key]);return out;},
    async set(values){Object.assign(store,structuredClone(values));}
  }},
  offscreen:{async hasDocument(){return false;},async createDocument(){},async closeDocument(){}},
  runtime:{getURL:p=>p,onMessage:{addListener(fn){listener=fn;}},async sendMessage(){return {ok:true,active:false,activeTabs:[],pendingTabs:[]};}},
  tabCapture:{async getCapturedTabs(){return [];},onStatusChanged:{addListener(){}}},
  tabs:{async get(id){return {id,audible:false};},onRemoved:{addListener(){}},onUpdated:{addListener(){}}}
};
await import(`../extension/js/background/index.js?startup=${Date.now()}`);
function invoke(message){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('background response timeout')),5000);listener(message,{tab:{id:3}},value=>{clearTimeout(timer);resolve(value);});});}

// The bounded startup finishes before the original Chrome promise. Defaults may
// be shown temporarily, but must be explicitly marked non-authoritative.
const early=await invoke({type:S.MessageType.StatusGet,tabId:3});
assert.equal(early.stateAuthoritative,false);
assert.equal(early.protectionAuthoritative,false);
assert.equal(early.state.gainDb,0);
assert.equal(early.protection,'strong');

await delay(260);
const hydrated=await invoke({type:S.MessageType.StatusGet,tabId:3});
assert.equal(hydrated.stateAuthoritative,true);
assert.equal(hydrated.protectionAuthoritative,true);
assert.equal(hydrated.state.gainDb,6);
assert.equal(hydrated.protection,'light');

// A late startup response must not beat a user mutation made after timeout.
// This slice uses the now-authoritative state; a separate race is covered by
// background_concurrency, where mutations always own a newer revision.
console.log('background_startup_authority.test.mjs: PASS');
