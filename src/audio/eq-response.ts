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
  private validFrequencies = new Float32Array(0);
  private magnitude = new Float32Array(0);
  private phase = new Float32Array(0);
  private combined = new Float64Array(0);
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

  private ensureScratch(length: number): void {
    if (this.validFrequencies.length === length) return;
    this.validFrequencies = new Float32Array(length);
    this.magnitude = new Float32Array(length);
    this.phase = new Float32Array(length);
    this.combined = new Float64Array(length);
  }

  private validFrequencyArray(frequencies: ArrayLike<number>): Float32Array {
    this.ensureScratch(frequencies.length);
    const nyquist = this.sampleRate / 2;
    for (let i = 0; i < frequencies.length; i += 1) {
      const value = Number(frequencies[i]);
      this.validFrequencies[i] = Number.isFinite(value) && value >= 0 && value <= nyquist ? value : NaN;
    }
    return this.validFrequencies;
  }

  combinedDb(frequencies: ArrayLike<number>, eq: EqState): Float64Array {
    this.configure(eq);
    const freq = this.validFrequencyArray(frequencies);
    this.combined.fill(1);

    for (const node of this.nodes) {
      node.getFrequencyResponse(freq, this.magnitude, this.phase);
      for (let i = 0; i < this.combined.length; i += 1) {
        const mag = this.magnitude[i];
        if (!Number.isFinite(mag)) this.combined[i] = NaN;
        else if (Number.isFinite(this.combined[i])) this.combined[i] *= mag;
      }
    }

    // Return a fresh result because callers may retain it. The larger scratch
    // buffers above are reused across frames to avoid repeated GC pressure.
    const result = new Float64Array(this.combined.length);
    for (let i = 0; i < this.combined.length; i += 1) {
      const value = this.combined[i];
      result[i] = Number.isFinite(value) ? 20 * Math.log10(Math.max(1e-12, value)) : NaN;
    }
    return result;
  }

  bandDb(index: number, frequencies: ArrayLike<number>, eq: EqState): Float64Array {
    this.configure(eq);
    const freq = this.validFrequencyArray(frequencies);
    this.nodes[index].getFrequencyResponse(freq, this.magnitude, this.phase);
    const result = new Float64Array(freq.length);
    for (let i = 0; i < this.magnitude.length; i += 1) {
      const value = this.magnitude[i];
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
    this.validFrequencies = new Float32Array(0);
    this.magnitude = new Float32Array(0);
    this.phase = new Float32Array(0);
    this.combined = new Float64Array(0);
  }
}
