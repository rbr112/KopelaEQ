import assert from 'node:assert/strict';
import * as S from '../extension/js/shared/index.js';

const EXPECTED_ACTIVE_STREAM_ERRORS = Object.freeze([
  'Cannot capture a tab with an active stream.',
  'An active stream is already capturing this tab.',
  'Cannot capture this tab because it is already being captured.'
]);

let offscreenOpen=false, streamIdCalls=0, failActiveOnce=false, deferStreamId=false, deferredResolve=null;
const tabAudible=new Map();
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
        return {ok:true,active:Boolean(sess),activeTabs:[...sessions.keys()],pendingTabs:[],state:sess?.state||null,protection:sess?.protection||protection,sampleRate:sess?44100:null,trackReadyState:sess?.trackReadyState??null,trackMuted:sess?.trackMuted??null,trackEnabled:sess?.trackEnabled??null,contextState:sess?.contextState??null};
      }
      if(msg.type===S.MessageType.CaptureStart){
        const tab=Number(msg.tabId); sessions.set(tab,{state:S.normalizeAudioState(msg.state),protection:msg.protection,trackReadyState:'live',trackMuted:false,trackEnabled:true,contextState:'running'}); captured.set(tab,'active'); return {ok:true};
      }
      if(msg.type===S.MessageType.CaptureStop){ const tab=Number(msg.tabId); sessions.delete(tab); captured.delete(tab); return {ok:true}; }
      if(msg.type===S.MessageType.StateSet){ const sess=sessions.get(Number(msg.tabId)); if(sess)sess.state=S.normalizeAudioState(msg.state); return {ok:true,active:Boolean(sess)}; }
      if(msg.type===S.MessageType.ProtectionSet){ protection=msg.protection; for(const s of sessions.values())s.protection=protection; return {ok:true}; }
      if(msg.type===S.MessageType.MeterGet)return {ok:true,active:sessions.has(Number(msg.tabId)),meter:null};
      return {ok:false,error:'unknown'};
    }
  },
  tabs:{async get(tabId){return {id:Number(tabId),audible:tabAudible.get(Number(tabId))===true};}},
  tabCapture:{
    async getCapturedTabs(){return [...captured.entries()].map(([tabId,status])=>({tabId,status}));},
    async getMediaStreamId({targetTabId}){
      const tab=Number(targetTabId); streamIdCalls++;
      if(failActiveOnce){failActiveOnce=false; throw new Error(EXPECTED_ACTIVE_STREAM_ERRORS[0]);}
      if(captured.has(tab))throw new Error(EXPECTED_ACTIVE_STREAM_ERRORS[0]);
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

// Cross-tab lifecycle race: stopping A must not close the shared offscreen
// document while B has already declared intent to start.
await manager2.startCapture(70);
const stopA=manager2.stopCapture(70);
const startB=manager2.startCapture(71);
const [,startedB]=await Promise.all([stopA,startB]);
assert.equal(startedB.active,true);
assert.equal(offscreenOpen,true,'offscreen must remain open for a concurrently starting tab');
assert.equal(sessions.has(71),true);
await manager2.stopCapture(71);


// Media transitions: a muted capture is not automatically treated as broken.
await manager2.startCapture(50);
let baselineCalls=streamIdCalls;
tabAudible.set(50,false);
sessions.get(50).trackMuted=true;
manager2.onSessionHealthChanged(50,true,'live','running');
await new Promise(r=>setTimeout(r,850));
assert.equal(streamIdCalls,baselineCalls,'paused/non-audible tab must not be recaptured');

// A short mute while an audible tab swaps media is tolerated if unmute arrives inside the grace window.
tabAudible.set(50,true);
sessions.get(50).trackMuted=true;
manager2.onSessionHealthChanged(50,true,'live','running');
setTimeout(()=>{ const sess=sessions.get(50); if(sess)sess.trackMuted=false; manager2.onSessionHealthChanged(50,false,'live','running'); },120);
await new Promise(r=>setTimeout(r,850));
assert.equal(streamIdCalls,baselineCalls,'brief mute/unmute must not restart capture');

// If Chrome still reports the tab as audible while the captured track remains muted,
// the session is inconsistent and a controlled recapture is justified.
sessions.get(50).trackMuted=true;
manager2.onTabAudibleChanged(50,true);
await new Promise(r=>setTimeout(r,1150));
assert.ok(streamIdCalls>baselineCalls,'audible + persistently muted capture should recover');
assert.equal(sessions.get(50).trackMuted,false);
await manager2.stopCapture(50);

// A definitively ended track is always recoverable while user intent is still ON.
await manager2.startCapture(51);
baselineCalls=streamIdCalls;
manager2.onSessionHealthChanged(51,false,'ended','running');
await new Promise(r=>setTimeout(r,500));
assert.ok(streamIdCalls>baselineCalls,'ended track should trigger controlled recovery');
await manager2.stopCapture(51);


// A captured tab whose AudioContext is not running is not healthy: Chrome has
// already suppressed native tab playback, so keeping this session would be silent.
await manager2.startCapture(52);
baselineCalls=streamIdCalls;
sessions.get(52).contextState='suspended';
r=await manager2.startCapture(52);
assert.equal(r.ok,true);
assert.ok(streamIdCalls>baselineCalls,'suspended output context should force a controlled recapture');
assert.equal(sessions.get(52).contextState,'running');
await manager2.stopCapture(52);


// Restart reconciliation must not tear down a healthy browser capture because
// the first offscreen status probes fail transiently.
await manager2.startCapture(61);
baselineCalls=streamIdCalls;
const originalSendMessage=chromeMock.runtime.sendMessage.bind(chromeMock.runtime);
let transientStatusFailures=2;
chromeMock.runtime.sendMessage=async (msg)=>{
  if(msg.type===S.MessageType.SessionStatus && transientStatusFailures>0){ transientStatusFailures--; throw new Error('transient IPC'); }
  return originalSendMessage(msg);
};
const manager3=new CaptureManager({getAudioState:()=>state,getProtection:()=>protection});
await manager3.reconcileExistingCaptures();
await new Promise(r=>setTimeout(r,250));
assert.equal(streamIdCalls,baselineCalls,'transient reconciliation IPC must not recapture a healthy session');
assert.equal(manager3.phaseFor(61),'active');
chromeMock.runtime.sendMessage=originalSendMessage;
await manager3.stopCapture(61);

for (const text of EXPECTED_ACTIVE_STREAM_ERRORS) assert.match(text, /active stream|already.*captur|cannot capture/i);
console.log('capture_manager.test.mjs: PASS');
