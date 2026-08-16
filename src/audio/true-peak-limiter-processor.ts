import { TruePeakLimiterCore } from './true-peak-limiter-core.js';

class KopelaEqTruePeakLimiterProcessor extends AudioWorkletProcessor {
  private readonly limiter = new TruePeakLimiterCore(sampleRate, {
    ceilingDbTp: -1.25,
    safetyMarginDb: 0.25,
    lookaheadMs: 5,
    releaseMs: 80,
    holdMs: 6
  });
  private framesSinceMeter = 0;

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    if (!output.length) return true;

    this.limiter.processBlock(input, output);
    this.framesSinceMeter += output[0]?.length ?? 0;
    if (this.framesSinceMeter >= sampleRate / 20) {
      this.framesSinceMeter = 0;
      this.port.postMessage({ type: 'meter', ...this.limiter.metrics() });
    }
    return true;
  }
}

registerProcessor('kopelaeq-true-peak-limiter', KopelaEqTruePeakLimiterProcessor);
