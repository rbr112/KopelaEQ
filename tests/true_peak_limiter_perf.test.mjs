import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { TruePeakLimiterCore } from '../extension/js/audio/true-peak-limiter-core.js';

const sampleRate=48000,blockFrames=128,blocks=12000;
const limiter=new TruePeakLimiterCore(sampleRate);
const left=new Float32Array(blockFrames),right=new Float32Array(blockFrames),outL=new Float32Array(blockFrames),outR=new Float32Array(blockFrames);
for(let i=0;i<blockFrames;i++){left[i]=1.2*Math.sin(i*0.19);right[i]=0.8*Math.sin(i*0.11);}
const timings=[];
for(let i=0;i<blocks;i++){
  const start=performance.now();
  limiter.processBlock([left,right],[outL,outR]);
  timings.push(performance.now()-start);
}
timings.sort((a,b)=>a-b);
const q=(p)=>timings[Math.floor((timings.length-1)*p)];
const avg=timings.reduce((a,b)=>a+b,0)/timings.length;
const deadline=(blockFrames/sampleRate)*1000;
const misses=timings.filter(v=>v>deadline).length;
assert.ok(q(.99)<0.75,`Maximum limiter p99 ${q(.99).toFixed(3)} ms exceeds 0.75 ms budget`);
assert.ok(misses<=Math.ceil(blocks*0.002),`Maximum limiter missed ${misses}/${blocks} 48 kHz callback deadlines`);
console.log(`true_peak_limiter_perf.test.mjs: PASS (avg ${avg.toFixed(4)} ms, p95 ${q(.95).toFixed(4)} ms, p99 ${q(.99).toFixed(4)} ms, max ${timings.at(-1).toFixed(4)} ms, deadline ${deadline.toFixed(4)} ms)`);
