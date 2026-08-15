/**
 * Realtime down-pitch shifting used by the AudioWorklet.
 *
 * 1.23.5 intentionally supports only neutral/negative pitch. The experimental
 * positive paths from 1.23.2-1.23.4 were removed because repeated listening
 * checks found unacceptable robotic coloration on speech. Negative shifts keep
 * the accepted 1.23.1 two-head delay-line algorithm byte-for-byte.
 */

import { FIXED_LATENCY_SAMPLES_48K, LEGACY_GRAIN_SIZE, LEGACY_MIN_DELAY_SAMPLES, pitchShiftLatencyMs as calculatePitchShiftLatencyMs } from './pitch-latency.js';

function clampShift(value: number): number {
  return Math.max(-12, Math.min(0, Number(value) || 0));
}

class LegacyDownPitchShifter {
  readonly sampleRate: number;
  readonly grainSize: number;
  readonly channels: number;
  readonly latencySamples: number;

  private readonly capacity: number;
  private readonly mask: number;
  private readonly buffers: Float32Array[];
  private writeIndex = 0;
  private written = 0;
  private phase = 0;

  constructor(sampleRate: number, grainSize = LEGACY_GRAIN_SIZE, channels = 2) {
    this.sampleRate = Math.max(8000, Number(sampleRate) || 48000);
    this.grainSize = Math.max(256, Math.round(grainSize));
    this.channels = Math.max(1, Math.round(channels));
    // Scale the historical 48 kHz latency by sample rate so the user-visible
    // delay stays approximately constant on 44.1/48/96 kHz devices.
    this.latencySamples = Math.max(this.grainSize + LEGACY_MIN_DELAY_SAMPLES, Math.round((FIXED_LATENCY_SAMPLES_48K * this.sampleRate) / 48000));
    let capacity = 1;
    while (capacity < this.latencySamples + this.grainSize * 3) capacity <<= 1;
    this.capacity = capacity;
    this.mask = capacity - 1;
    this.buffers = Array.from({ length: this.channels }, () => new Float32Array(capacity));
  }

  reset(): void {
    for (const buffer of this.buffers) buffer.fill(0);
    this.writeIndex = 0;
    this.written = 0;
    this.phase = 0;
  }

  private sampleAt(channel: number, delaySamples: number): number {
    const buffer = this.buffers[channel] ?? this.buffers[0];
    let position = this.writeIndex - delaySamples;
    while (position < 0) position += this.capacity;
    while (position >= this.capacity) position -= this.capacity;
    const floor = Math.floor(position);
    const i0 = floor & this.mask;
    const i1 = (i0 + 1) & this.mask;
    const frac = position - floor;
    return buffer[i0] * (1 - frac) + buffer[i1] * frac;
  }

  processBlock(input: readonly Float32Array[], output: readonly Float32Array[], semitones: number): void {
    const frames = output[0]?.length ?? 0;
    if (!frames) return;
    const shift = Math.min(0, clampShift(semitones));
    const ratio = Math.pow(2, shift / 12);
    const delta = Math.abs(1 - ratio);
    const phaseIncrement = delta > 1e-9 ? delta / this.grainSize : 0;

    for (let i = 0; i < frames; i += 1) {
      for (let ch = 0; ch < this.channels; ch += 1) {
        const source = input[ch] ?? input[0];
        this.buffers[ch][this.writeIndex] = source ? source[i] ?? 0 : 0;
      }

      if (this.written < this.latencySamples + 2) {
        for (let ch = 0; ch < output.length; ch += 1) output[ch][i] = 0;
      } else if (delta <= 1e-9) {
        for (let ch = 0; ch < output.length; ch += 1) {
          output[ch][i] = this.sampleAt(Math.min(ch, this.channels - 1), this.latencySamples);
        }
      } else {
        const phaseA = this.phase;
        const phaseB = (this.phase + 0.5) % 1;
        const delayA = LEGACY_MIN_DELAY_SAMPLES + phaseA * this.grainSize;
        const delayB = LEGACY_MIN_DELAY_SAMPLES + phaseB * this.grainSize;
        const weightA = 0.5 - 0.5 * Math.cos(2 * Math.PI * phaseA);
        const weightB = 0.5 - 0.5 * Math.cos(2 * Math.PI * phaseB);
        const weightSum = Math.max(1e-9, weightA + weightB);
        for (let ch = 0; ch < output.length; ch += 1) {
          const channel = Math.min(ch, this.channels - 1);
          output[ch][i] = (this.sampleAt(channel, delayA) * weightA + this.sampleAt(channel, delayB) * weightB) / weightSum;
        }
        this.phase += phaseIncrement;
        if (this.phase >= 1) this.phase -= Math.floor(this.phase);
      }

      this.writeIndex = (this.writeIndex + 1) & this.mask;
      this.written += 1;
    }
  }
}

/**
 * Compatibility wrapper retained so existing AudioWorklet/tests do not need a
 * public API rename in a maintenance release. Positive values are clamped to
 * neutral and are not exposed by state normalization or the UI.
 */
export class GranularPitchShifter {
  readonly sampleRate: number;
  readonly grainSize: number;
  readonly channels: number;
  readonly latencySamples: number;

  private readonly down: LegacyDownPitchShifter;

  constructor(sampleRate: number, grainSize = 2048, channels = 2) {
    this.sampleRate = Math.max(8000, Number(sampleRate) || 48000);
    this.grainSize = Math.max(512, Math.round(grainSize));
    this.channels = Math.max(1, Math.round(channels));
    this.down = new LegacyDownPitchShifter(this.sampleRate, LEGACY_GRAIN_SIZE, this.channels);
    this.latencySamples = this.down.latencySamples;
  }

  reset(): void {
    this.down.reset();
  }

  processBlock(input: readonly Float32Array[], output: readonly Float32Array[], semitones: number): void {
    this.down.processBlock(input, output, clampShift(semitones));
  }
}

/** Compatibility export for existing tests/worklet consumers. */
export function pitchShiftLatencyMs(sampleRate: number): number {
  return calculatePitchShiftLatencyMs(sampleRate);
}
