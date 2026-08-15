import assert from 'node:assert/strict';
import * as S from '../extension/js/shared/index.js';
const store={};
const legacy=S.defaultAudioState(); legacy.gainDb=4; legacy.eq.gains[0]=3.25; legacy.dynamics.enabled=true; legacy.stereo={...legacy.stereo,enabled:true,width:1.4};
store[S.STORAGE.AUDIO_STATE]=legacy;
let listener=null, removed=null, updated=null, statusChanged=null;
globalThis.chrome={
  storage:{local:{async get(keys){const a=typeof keys==='string'?[keys]:keys;const o={};for(const k of a)if(k in store)o[k]=store[k];return o;},async set(o){Object.assign(store,o);}}},
  offscreen:{async hasDocument(){return false;},async createDocument(){},async closeDocument(){}},
  runtime:{getURL:p=>p,onMessage:{addListener(fn){listener=fn;}},async sendMessage(){return {ok:true,active:false,activeTabs:[],pendingTabs:[]};}},
  tabCapture:{async getCapturedTabs(){return [];},onStatusChanged:{addListener(fn){statusChanged=fn;}}},
  tabs:{async get(id){return {id,audible:false}},onRemoved:{addListener(fn){removed=fn;}},onUpdated:{addListener(fn){updated=fn;}}}
};
await import(`../extension/js/background/index.js?qa=${Date.now()}`);
assert.equal(typeof listener,'function'); assert.equal(typeof removed,'function'); assert.equal(typeof updated,'function'); assert.equal(typeof statusChanged,'function');
function invoke(msg,sender={}){return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('timeout')),1000);const ret=listener(msg,sender,v=>{clearTimeout(t);resolve(v)}); if(ret===false && msg?.target==='offscreen'){clearTimeout(t);resolve(undefined);}})}
let r=await invoke({type:S.MessageType.StatusGet,tabId:1}); assert.equal(r.ok,true); assert.equal(r.state.gainDb,4); assert.equal(r.state.eq.gains[0],3.25); assert.equal(r.state.dynamics.enabled,false); assert.equal(r.state.stereo.enabled,false); assert.equal(r.state.reverb.enabled,false); assert.equal(r.state.delay.enabled,false); assert.equal(r.state.autoPan.enabled,false); assert.equal(r.state.exciter.enabled,false); assert.equal(r.state.pitchShift.enabled,false); assert.equal(store[S.STORAGE.AUDIO_BASELINE_VERSION],4);
r=await invoke({type:S.MessageType.PresetSelectionSet,name:'Bass Heavy (bass4)'},{tab:{id:1}}); assert.equal(r.name,'Bass Heavy (bass4)');
r=await invoke({type:S.MessageType.PresetSelectionGet},{tab:{id:1}}); assert.equal(r.name,'Bass Heavy (bass4)');
const p=S.defaultAudioState();p.eq.gains[0]=8.415624618530273;r=await invoke({type:S.MessageType.StateSet,tabId:1,state:p,persist:true,presetSelection:'Vivid (111)'});assert.equal(r.presetSelection,'Vivid (111)');assert.equal(store[S.STORAGE.AUDIO_STATE].eq.gains[0],8.415624618530273);
r=await invoke({type:'STATE_SEТ',tabId:1});assert.equal(r.ok,false);assert.match(r.error,/Unknown message/);
removed(1); await new Promise(r=>setTimeout(r,0)); r=await invoke({type:S.MessageType.PresetSelectionGet},{tab:{id:1}}); assert.equal(r.name,'');
console.log('background_runtime.test.mjs: PASS');
