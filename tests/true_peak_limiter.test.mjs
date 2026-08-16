import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { FourXTruePeakDetector, TruePeakLimiterCore } from '../extension/js/audio/true-peak-limiter-core.js';

const db=(x)=>x>1e-12?20*Math.log10(x):-160;

function sinc(x){if(Math.abs(x)<1e-12)return 1;const p=Math.PI*x;return Math.sin(p)/p;}
function blackman(index,length){const phase=(2*Math.PI*index)/(length-1);return 0.42-(0.5*Math.cos(phase))+(0.08*Math.cos(2*phase));}
function referenceTruePeak16x(samples){
  const taps=64,center=31,phases=[];
  for(let q=0;q<16;q++){
    const phase=q/16,coeffs=[];let sum=0;
    for(let j=0;j<taps;j++){const c=sinc(center+phase-j)*blackman(j,taps);coeffs.push(c);sum+=c;}
    phases.push(coeffs.map(c=>c/sum));
  }
  let peak=0;
  for(let n=center;n<samples.length-(taps-center);n++){
    const oldest=n-center;
    for(const coeffs of phases){let value=0;for(let j=0;j<taps;j++)value+=samples[oldest+j]*coeffs[j];peak=Math.max(peak,Math.abs(value));}
  }
  return peak;
}

// A quarter-sample-phase 12 kHz sine has only -3.01 dBFS raw samples while the
// reconstructed waveform reaches ~0 dBTP. The 4x detector must see that hidden peak.
{
  const detector=new FourXTruePeakDetector();
  let samplePeak=0,truePeak=0;
  for(let i=0;i<3000;i++){
    const x=Math.sin((2*Math.PI*12000*i/48000)+(Math.PI/4));
    samplePeak=Math.max(samplePeak,Math.abs(x));
    truePeak=Math.max(truePeak,detector.push(x));
  }
  assert.ok(samplePeak<0.71);
  assert.ok(truePeak>0.995,`expected inter-sample peak near 1.0, got ${truePeak}`);
  assert.ok(db(truePeak)-db(samplePeak)>2.9,'detector should expose ~3 dB hidden inter-sample peak');
}

// Maximum should catch the same signal even though no individual input sample is
// anywhere near 0 dBFS. Output TP stays below the -1 dBTP target with margin.
{
  const sr=48000, frames=sr/2, block=128;
  const left=new Float32Array(frames),right=new Float32Array(frames);
  const outL=new Float32Array(frames),outR=new Float32Array(frames);
  for(let i=0;i<frames;i++) left[i]=right[i]=Math.sin((2*Math.PI*12000*i/sr)+(Math.PI/4));
  const limiter=new TruePeakLimiterCore(sr);
  for(let i=0;i<frames;i+=block){
    limiter.processBlock([left.subarray(i,i+block),right.subarray(i,i+block)],[outL.subarray(i,i+block),outR.subarray(i,i+block)]);
  }
  // Verify with an independent 16x/64-tap reconstruction, not the limiter's
  // own detector, so the test cannot pass merely because both share the same bias.
  const outputTp=referenceTruePeak16x(outL.subarray(limiter.lookaheadFrames+64));
  assert.ok(db(outputTp)<=-1.0+0.05,`independent reconstructed output TP escaped target: ${db(outputTp).toFixed(3)} dBTP`);
  assert.ok(limiter.metrics().reductionDb<-1,'hidden TP should cause real gain reduction');
}


// Below-ceiling program material must remain bit-transparent apart from the
// intentional lookahead delay. Maximum is a peak catcher, not a fixed gain cut.
{
  const sr=48000, limiter=new TruePeakLimiterCore(sr), frames=sr/4, block=128;
  const left=new Float32Array(frames), right=new Float32Array(frames), outL=new Float32Array(frames), outR=new Float32Array(frames);
  for(let i=0;i<frames;i++){left[i]=0.35*Math.sin(2*Math.PI*997*i/sr);right[i]=0.21*Math.sin(2*Math.PI*733*i/sr);}
  for(let i=0;i<frames;i+=block) limiter.processBlock([left.subarray(i,i+block),right.subarray(i,i+block)],[outL.subarray(i,i+block),outR.subarray(i,i+block)]);
  let maxDelta=0;
  for(let i=limiter.lookaheadFrames+64;i<frames;i++){
    maxDelta=Math.max(maxDelta,Math.abs(outL[i]-left[i-limiter.lookaheadFrames]),Math.abs(outR[i]-right[i-limiter.lookaheadFrames]));
  }
  assert.ok(maxDelta<2e-6,`sub-ceiling Maximum path must not change gain: ${maxDelta}`);
  assert.ok(Math.abs(limiter.metrics().reductionDb)<0.001,'idle peak catcher must report 0 dB reduction');
}

// One isolated overload is caught, held briefly, then smoothly returns to unity
// instead of leaving the rest of the program permanently quieter.
{
  const sr=48000, limiter=new TruePeakLimiterCore(sr,{lookaheadMs:5,holdMs:6,releaseMs:80});
  const frames=Math.round(sr*0.45), block=128;
  const left=new Float32Array(frames),right=new Float32Array(frames),outL=new Float32Array(frames),outR=new Float32Array(frames);
  left[300]=right[300]=1.8;
  for(let i=0;i<frames;i+=block) limiter.processBlock([left.subarray(i,i+block),right.subarray(i,i+block)],[outL.subarray(i,i+block),outR.subarray(i,i+block)]);
  assert.ok(Math.abs(limiter.metrics().reductionDb)<0.08,`isolated catch should recover close to unity, got ${limiter.metrics().reductionDb.toFixed(3)} dB`);
}

// Stereo linking: an overload in L applies the same instantaneous gain to R.
{
  const sr=48000, limiter=new TruePeakLimiterCore(sr,{lookaheadMs:4});
  const frames=limiter.lookaheadFrames+600;
  const left=new Float32Array(frames),right=new Float32Array(frames),outL=new Float32Array(frames),outR=new Float32Array(frames);
  for(let i=0;i<frames;i++){left[i]=1.4;right[i]=0.35;}
  for(let i=0;i<frames;i+=128) limiter.processBlock([left.subarray(i,i+128),right.subarray(i,i+128)],[outL.subarray(i,i+128),outR.subarray(i,i+128)]);
  const i=limiter.lookaheadFrames+300;
  assert.ok(Math.abs(outR[i])>1e-5);
  assert.ok(Math.abs((outL[i]/outR[i])-4)<1e-3,'linked limiter must preserve L/R ratio');
}

// The limiter is intentionally a detector-only 4x design, not full-rate 4x DSP.
// Keep a broad CPU guard so an accidental O(N^2) rewrite is caught without making
// the test flaky across CI machines.
{
  const sr=48000, limiter=new TruePeakLimiterCore(sr),block=128,seconds=5;
  const left=new Float32Array(block),right=new Float32Array(block),outL=new Float32Array(block),outR=new Float32Array(block);
  for(let i=0;i<block;i++){left[i]=1.1*Math.sin(i*0.17);right[i]=0.9*Math.sin(i*0.13);}
  const blocks=Math.ceil(sr*seconds/block);
  const started=performance.now();
  for(let i=0;i<blocks;i++) limiter.processBlock([left,right],[outL,outR]);
  const elapsed=performance.now()-started;
  assert.ok(elapsed<2500,`Maximum limiter core is unexpectedly heavy: ${elapsed.toFixed(1)} ms for ${seconds}s audio`);
}

console.log('true_peak_limiter.test.mjs: PASS');
