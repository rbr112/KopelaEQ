import assert from 'node:assert/strict';
import * as S from '../extension/js/shared/index.js';

const desired=S.defaultAudioState();
desired.gainDb=4.5;
desired.pitchShift.enabled=true;
desired.pitchShift.semitones=-4;
const store={
  [S.STORAGE.AUDIO_STATE]:structuredClone(desired),
  [S.STORAGE.PROTECTION]:'light',
  [S.STORAGE.AUDIO_BASELINE_VERSION]:4
};
let listener=null;
let remoteRevision=27;
let remoteProtectionRevision=13;
let remoteState=S.defaultAudioState();
let remoteProtection='strong';
const stateWrites=[];
const protectionWrites=[];

const delay=(ms)=>new Promise(r=>setTimeout(r,ms));
globalThis.chrome={
  storage:{local:{
    async get(keys){const list=typeof keys==='string'?[keys]:keys;const out={};for(const key of list||[])if(key in store)out[key]=structuredClone(store[key]);return out;},
    async set(values){Object.assign(store,structuredClone(values));}
  }},
  offscreen:{async hasDocument(){return true;},async createDocument(){},async closeDocument(){}},
  runtime:{
    getURL:p=>p,
    onMessage:{addListener(fn){listener=fn;}},
    async sendMessage(message){
      if(message?.target!=='offscreen') return {ok:true};
      if(message.type===S.MessageType.SessionStatus){
        const tabId=Number(message.tabId);
        return {ok:true,active:tabId===9 || !Number.isInteger(tabId),activeTabs:[9],pendingTabs:[],state:structuredClone(remoteState),protection:remoteProtection,stateRevision:remoteRevision,protectionRevision:remoteProtectionRevision,trackReadyState:'live',trackMuted:false,trackEnabled:true,contextState:'running',sampleRate:48000};
      }
      if(message.type===S.MessageType.StateSet){
        stateWrites.push(structuredClone(message));
        if(Number(message.revision)>=remoteRevision){remoteRevision=Number(message.revision);remoteState=structuredClone(message.state);}
        return {ok:true,active:true,revision:remoteRevision};
      }
      if(message.type===S.MessageType.ProtectionSet){
        protectionWrites.push(structuredClone(message));
        if(Number(message.revision)>=remoteProtectionRevision){remoteProtectionRevision=Number(message.revision);remoteProtection=message.protection;}
        return {ok:true,revision:remoteProtectionRevision};
      }
      return {ok:true};
    }
  },
  tabCapture:{async getCapturedTabs(){return [{tabId:9,status:'active'}];},onStatusChanged:{addListener(){}}},
  tabs:{async get(id){return {id,audible:true};},onRemoved:{addListener(){}},onUpdated:{addListener(){}}}
};

await import(`../extension/js/background/index.js?restart=${Date.now()}`);
assert.equal(typeof listener,'function');

// Let startup reconciliation observe the surviving offscreen revision epoch.
for(let i=0;i<40 && (remoteRevision<=27 || remoteProtectionRevision<=13);i+=1) await delay(25);
assert.ok(remoteRevision>27,`background must rebase state revision above surviving offscreen epoch (got ${remoteRevision})`);
assert.ok(remoteProtectionRevision>13,`background must rebase protection revision above surviving offscreen epoch (got ${remoteProtectionRevision})`);
assert.equal(remoteState.gainDb,4.5);
assert.equal(remoteState.pitchShift.enabled,true);
assert.equal(remoteState.pitchShift.semitones,-4);
assert.equal(remoteProtection,'light');

function invoke(message){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('background response timeout')),5000);listener(message,{tab:{id:9}},value=>{clearTimeout(timer);resolve(value);});});}
const changed=structuredClone(desired);changed.pitchShift.semitones=-7;
const result=await invoke({type:S.MessageType.StateSet,tabId:9,state:changed,persist:true});
assert.equal(result.ok,true);
assert.equal(remoteState.pitchShift.semitones,-7,'first mutation after worker restart must reach surviving offscreen session');
assert.ok(stateWrites.at(-1).revision>27);

const status=await invoke({type:S.MessageType.StatusGet,tabId:9});
assert.equal(status.state.pitchShift.semitones,-7,'popup status must report background authoritative desired state');
assert.equal(status.stateAuthoritative,true);
console.log('background_restart_revision.test.mjs: PASS');
