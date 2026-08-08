import assert from 'node:assert/strict';
import * as S from '../extension/js/shared/index.js';

let offscreenOpen=false, streamIdCalls=0, failActiveOnce=false, deferStreamId=false, deferredResolve=null;
const captured=new Map();
const sessions=new Map();
let protection='strong';
const chromeMock={
  offscreen:{
    async hasDocument(){return offscreenOpen;},
    async createDocument(){offscreenOpen=true;},
    async closeDocument(){offscreenOpen=false; sessions.clear();}
  },
  runtime:{
    getURL(p){return `chrome-extension://test/${p}`;},
    async sendMessage(msg){
      if(msg.type===S.MessageType.SessionStatus){
        const sess=sessions.get(Number(msg.tabId));
        return {ok:true,active:Boolean(sess),activeTabs:[...sessions.keys()],pendingTabs:[],state:sess?.state||null,protection:sess?.protection||protection,sampleRate:sess?44100:null};
      }
      if(msg.type===S.MessageType.CaptureStart){
        const tab=Number(msg.tabId); sessions.set(tab,{state:S.normalizeAudioState(msg.state),protection:msg.protection}); captured.set(tab,'active'); return {ok:true};
      }
      if(msg.type===S.MessageType.CaptureStop){ const tab=Number(msg.tabId); sessions.delete(tab); captured.delete(tab); return {ok:true}; }
      if(msg.type===S.MessageType.StateSet){ const sess=sessions.get(Number(msg.tabId)); if(sess)sess.state=S.normalizeAudioState(msg.state); return {ok:true,active:Boolean(sess)}; }
      if(msg.type===S.MessageType.ProtectionSet){ protection=msg.protection; for(const s of sessions.values())s.protection=protection; return {ok:true}; }
      if(msg.type===S.MessageType.MeterGet)return {ok:true,active:sessions.has(Number(msg.tabId)),meter:null};
      return {ok:false,error:'unknown'};
    }
  },
  tabCapture:{
    async getCapturedTabs(){return [...captured.entries()].map(([tabId,status])=>({tabId,status}));},
    async getMediaStreamId({targetTabId}){
      const tab=Number(targetTabId); streamIdCalls++;
      if(failActiveOnce){failActiveOnce=false; throw new Error('Cannot capture a tab with an active stream.');}
      if(captured.has(tab))throw new Error('Cannot capture a tab with an active stream.');
      if(!deferStreamId){captured.set(tab,'pending'); return `stream-${tab}`;}
      return new Promise(resolve=>{deferredResolve=()=>{captured.set(tab,'pending');resolve(`stream-${tab}`);};});
    }
  }
};
globalThis.chrome=chromeMock;
const {CaptureManager}=await import('../extension/js/background/capture-manager.js');
let state=S.defaultAudioState();
const manager=new CaptureManager({getAudioState:()=>state,getProtection:()=>protection});

let r=await manager.statusForTab(null); assert.equal(r.ok,false);
r=await manager.startCapture(1); assert.equal(r.ok,true); assert.equal(r.active,true); assert.equal(manager.phaseFor(1),'active');
const calls=streamIdCalls; r=await manager.startCapture(1); assert.equal(r.alreadyActive,true); assert.equal(streamIdCalls,calls);
r=await manager.statusForTab(1); assert.equal(r.sampleRate,44100);
state=S.defaultAudioState(); state.gainDb=7; assert.equal(await manager.propagateState(1,state),true); assert.equal(sessions.get(1).state.gainDb,7);
await manager.propagateProtection('medium'); assert.equal(sessions.get(1).protection,'medium');
await manager.stopCapture(1); assert.equal(captured.has(1),false); assert.equal(manager.phaseFor(1),'idle');

// Pending stream-id Start followed by Stop is serialized and releases capture.
deferStreamId=true;
const start=manager.startCapture(3); await new Promise(r=>setTimeout(r,0)); const stop=manager.stopCapture(3); deferredResolve();
assert.equal((await start).ok,true); assert.equal((await stop).ok,true); assert.equal(captured.has(3),false);

// Rapid Start -> Stop -> Start stays deterministic.
deferStreamId=false;
const [a,b,c]=await Promise.all([manager.startCapture(4),manager.stopCapture(4),manager.startCapture(4)]);
assert.equal(a.ok,true); assert.equal(b.ok,true); assert.equal(c.ok,true); assert.equal(c.active,true); assert.equal(captured.get(4),'active'); await manager.stopCapture(4);

// Browser active-stream race is swallowed and retried once.
failActiveOnce=true; r=await manager.startCapture(5); assert.equal(r.ok,true); assert.equal(r.active,true); await manager.stopCapture(5);

// Restart reconciliation: a fresh manager recovers a still-live offscreen session.
await manager.startCapture(6);
const manager2=new CaptureManager({getAudioState:()=>state,getProtection:()=>protection});
r=await manager2.statusForTab(6); assert.equal(r.active,true); assert.equal(r.phase,'active'); await manager2.stopCapture(6);

for(let i=0;i<100;i++){ const tab=100+i; assert.equal((await manager2.startCapture(tab)).ok,true); assert.equal((await manager2.stopCapture(tab)).ok,true); assert.equal(captured.has(tab),false); }
const both=await Promise.all([manager2.startCapture(901),manager2.startCapture(902)]);
assert.equal(both[0].active,true); assert.equal(both[1].active,true);
assert.equal(sessions.has(901),true); assert.equal(sessions.has(902),true);
await Promise.all([manager2.stopCapture(901),manager2.stopCapture(902)]);
assert.equal(captured.has(901),false); assert.equal(captured.has(902),false);
assert.equal(sessions.size,0);
console.log('capture_manager.test.mjs: PASS');
