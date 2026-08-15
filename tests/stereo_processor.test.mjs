import assert from 'node:assert/strict';
import { processStereoFrame } from '../extension/js/audio/stereo-math.js';
import { StereoStage } from '../extension/js/audio/stereo-stage.js';
import { ContextMock } from './audio_mocks.mjs';

const sr=48000, n=48000;
const left=new Float64Array(n), right=new Float64Array(n);
for(let i=0;i<n;i++){left[i]=Math.sin(2*Math.PI*1000*i/sr);right[i]=Math.sin(2*Math.PI*2000*i/sr);}
const monoL=new Float64Array(n),monoR=new Float64Array(n);
for(let i=0;i<n;i++){[monoL[i],monoR[i]]=processStereoFrame(left[i],right[i],{enabled:true,width:0,balance:0,mono:false,swap:false});}
for(let i=0;i<n;i++)assert.equal(monoL[i],monoR[i]);
function binAmp(a,f){let re=0,im=0;for(let i=0;i<a.length;i++){const p=2*Math.PI*f*i/sr;re+=a[i]*Math.cos(p);im-=a[i]*Math.sin(p);}return 2*Math.hypot(re,im)/a.length;}
assert.ok(binAmp(monoL,1000)>.45&&binAmp(monoL,2000)>.45);
const [sl,sr2]=processStereoFrame(.25,-.75,{enabled:true,width:1,balance:0,mono:false,swap:true});assert.equal(sl,-.75);assert.equal(sr2,.25);
const ctx=new ContextMock();const stage=new StereoStage(ctx);stage.apply({enabled:true,width:1,balance:0,mono:false,swap:false},true);
assert.equal(stage.debugState.processorConnected,false);assert.deepEqual(stage.input.connections.map(c=>c.dest),[stage.dry]);
stage.apply({enabled:true,width:0,balance:0,mono:false,swap:false},true);assert.equal(stage.debugState.processorConnected,true);assert.ok(stage.input.connections.some(c=>c.dest.kind==='splitter'));
stage.apply({enabled:false,width:2,balance:1,mono:false,swap:true},true);assert.equal(stage.debugState.processorConnected,false);assert.deepEqual(stage.input.connections.map(c=>c.dest),[stage.dry]);
console.log('stereo_processor.test.mjs: PASS');
