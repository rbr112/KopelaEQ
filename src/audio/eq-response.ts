import { EQ_TYPES } from '../shared/constants.js';
import type { EqState } from '../shared/types.js';

export const DEFAULT_SAMPLE_RATE = 48000;

function normalizeSampleRate(sampleRate: unknown): number {
  const value = Number(sampleRate);
  return Number.isFinite(value) && value >= 8000 ? Math.round(value) : DEFAULT_SAMPLE_RATE;
}

export class NativeEqResponse {
  private context: OfflineAudioContext | null = null;
  private nodes: BiquadFilterNode[] = [];
  sampleRate = 0;

  constructor(sampleRate = DEFAULT_SAMPLE_RATE) {
    this.setSampleRate(sampleRate);
  }

  setSampleRate(sampleRate: unknown): boolean {
    const normalized = normalizeSampleRate(sampleRate);
    if (this.context && this.sampleRate === normalized) return false;
    this.dispose();
    this.sampleRate = normalized;
    this.context = new OfflineAudioContext(1, 1, normalized);
    this.nodes = EQ_TYPES.map((type) => {
      const node = this.context!.createBiquadFilter();
      node.type = type;
      return node;
    });
    return true;
  }

  private configure(eq: EqState): void {
    for (let i = 0; i < this.nodes.length; i += 1) {
      const node = this.nodes[i];
      node.type = EQ_TYPES[i];
      node.frequency.value = eq.frequencies[i];
      node.Q.value = eq.qs[i];
      node.gain.value = eq.enabled ? eq.gains[i] : 0;
    }
  }

  private validFrequencyArray(frequencies: ArrayLike<number>): Float32Array {
    const nyquist = this.sampleRate / 2;
    const valid = new Float32Array(frequencies.length);
    for (let i = 0; i < frequencies.length; i += 1) {
      const value = Number(frequencies[i]);
      valid[i] = Number.isFinite(value) && value >= 0 && value <= nyquist ? value : NaN;
    }
    return valid;
  }

  combinedDb(frequencies: ArrayLike<number>, eq: EqState): Float64Array {
    this.configure(eq);
    const freq = this.validFrequencyArray(frequencies);
    const combined = new Float64Array(freq.length);
    combined.fill(1);
    const magnitude = new Float32Array(freq.length);
    const phase = new Float32Array(freq.length);

    for (const node of this.nodes) {
      node.getFrequencyResponse(freq, magnitude, phase);
      for (let i = 0; i < combined.length; i += 1) {
        const mag = magnitude[i];
        if (!Number.isFinite(mag)) combined[i] = NaN;
        else if (Number.isFinite(combined[i])) combined[i] *= mag;
      }
    }

    const result = new Float64Array(combined.length);
    for (let i = 0; i < combined.length; i += 1) {
      const value = combined[i];
      result[i] = Number.isFinite(value) ? 20 * Math.log10(Math.max(1e-12, value)) : NaN;
    }
    return result;
  }

  bandDb(index: number, frequencies: ArrayLike<number>, eq: EqState): Float64Array {
    this.configure(eq);
    const freq = this.validFrequencyArray(frequencies);
    const magnitude = new Float32Array(freq.length);
    const phase = new Float32Array(freq.length);
    this.nodes[index].getFrequencyResponse(freq, magnitude, phase);
    const result = new Float64Array(freq.length);
    for (let i = 0; i < magnitude.length; i += 1) {
      const value = magnitude[i];
      result[i] = Number.isFinite(value) ? 20 * Math.log10(Math.max(1e-12, value)) : NaN;
    }
    return result;
  }

  dispose(): void {
    for (const node of this.nodes) {
      try { node.disconnect(); } catch { /* visual-only node */ }
    }
    this.nodes = [];
    this.context = null;
  }
}
