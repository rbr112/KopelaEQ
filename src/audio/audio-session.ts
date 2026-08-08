import {
  EQ_BANDS, EQ_TYPES, PROTECTION_PROFILES, dbToLinear,
  dynamicParams, normalizeAudioState, normalizeProtection
} from '../shared/index.js';
import type { AudioState, CompressorParams, MeterSnapshot, ProtectionMode, SpectrumMode, StereoMeterSnapshot } from '../shared/types.js';
import { BypassGate } from './bypass-gate.js';

interface DynamicsBand {
  filters: BiquadFilterNode[];
  compressor: DynamicsCompressorNode;
}

export interface AudioSessionOptions {
  onEnded?: (tabId: number) => void | Promise<void>;
}

export function safeDisconnect(node: AudioNode | null | undefined, destination?: AudioNode): void {
  if (!node) return;
  try {
    if (destination) node.disconnect(destination);
    else node.disconnect();
  } catch { /* already disconnected */ }
}

function smooth(param: AudioParam, value: number, context: BaseAudioContext, timeConstant = 0.012): void {
  const now = context.currentTime;
  let target = Number(value);
  if (!Number.isFinite(target)) return;
  const min = Number(param.minValue);
  const max = Number(param.maxValue);
  if (Number.isFinite(min)) target = Math.max(min, target);
  if (Number.isFinite(max)) target = Math.min(max, target);
  try {
    param.cancelScheduledValues(now);
    param.setTargetAtTime(target, now, Math.max(0.0001, timeConstant));
  } catch {
    try { param.value = target; } catch { /* unsupported/out-of-range AudioParam */ }
  }
}

function setCompressor(node: DynamicsCompressorNode, params: CompressorParams, context: BaseAudioContext, timeConstant = 0.012): void {
  smooth(node.threshold, params.threshold, context, timeConstant);
  smooth(node.knee, params.knee, context, timeConstant);
  smooth(node.ratio, params.ratio, context, timeConstant);
  smooth(node.attack, params.attack, context, timeConstant);
  smooth(node.release, params.release, context, timeConstant);
}

function eqBandChanged(a: AudioState, b: AudioState, i: number): boolean {
  return a.eq.enabled !== b.eq.enabled
    || a.eq.frequencies[i] !== b.eq.frequencies[i]
    || a.eq.gains[i] !== b.eq.gains[i]
    || a.eq.qs[i] !== b.eq.qs[i];
}

function dynamicsChanged(a: AudioState, b: AudioState): boolean {
  const x = a.dynamics;
  const y = b.dynamics;
  return x.enabled !== y.enabled || x.mode !== y.mode || x.amount !== y.amount || x.response !== y.response
    || x.lowCrossoverHz !== y.lowCrossoverHz || x.highCrossoverHz !== y.highCrossoverHz;
}

export class AudioSession {
  readonly context: AudioContext;
  readonly tabId: number;
  readonly stream: MediaStream;
  state: AudioState;
  protection: ProtectionMode;
  private disposed = false;

  private levelMeteringConnected = false;
  private spectrumMeteringConnected = false;
  private meterIdleTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly source: MediaStreamAudioSourceNode;
  private readonly inputGain: GainNode;
  private readonly masterGain: GainNode;
  private readonly eqFilters: BiquadFilterNode[];

  private readonly dynamicsIn: GainNode;
  private readonly dynamicsDry: GainNode;
  private readonly dynamicsWet: GainNode;
  private readonly dynamicsOut: GainNode;
  private readonly normalCompressor: DynamicsCompressorNode;
  private readonly low: DynamicsBand;
  private readonly mid: DynamicsBand;
  private readonly high: DynamicsBand;
  private readonly dynamicsGate: BypassGate;

  private readonly protectionIn: GainNode;
  private readonly protectionDry: GainNode;
  private readonly protectionWet: GainNode;
  private readonly protectionOut: GainNode;
  private readonly limiter: DynamicsCompressorNode;
  private readonly protectionGate: BypassGate;

  private readonly spectrumAnalyser: AnalyserNode;
  private readonly preMeterSplitter: ChannelSplitterNode;
  private readonly preLeftAnalyser: AnalyserNode;
  private readonly preRightAnalyser: AnalyserNode;
  private readonly preLeftTimeData: Float32Array;
  private readonly preRightTimeData: Float32Array;
  private readonly meterSplitter: ChannelSplitterNode;
  private readonly leftAnalyser: AnalyserNode;
  private readonly rightAnalyser: AnalyserNode;
  private readonly leftTimeData: Float32Array;
  private readonly rightTimeData: Float32Array;
  private freqData: Float32Array;
  private readonly onEnded?: (tabId: number) => void | Promise<void>;

  constructor(context: AudioContext, tabId: number, stream: MediaStream, state: unknown, protection: unknown, options: AudioSessionOptions = {}) {
    this.context = context;
    this.tabId = tabId;
    this.stream = stream;
    this.state = normalizeAudioState(state);
    this.protection = normalizeProtection(protection);
    this.onEnded = options.onEnded;

    this.source = context.createMediaStreamSource(stream);
    this.inputGain = context.createGain();
    this.masterGain = context.createGain();
    this.eqFilters = new Array(EQ_BANDS).fill(null).map((_, index) => {
      const filter = context.createBiquadFilter();
      filter.type = EQ_TYPES[index];
      return filter;
    });

    this.dynamicsIn = context.createGain();
    this.dynamicsDry = context.createGain();
    this.dynamicsWet = context.createGain();
    this.dynamicsOut = context.createGain();
    this.normalCompressor = context.createDynamicsCompressor();
    this.low = this.createBand('low');
    this.mid = this.createBand('mid');
    this.high = this.createBand('high');

    this.protectionIn = context.createGain();
    this.protectionDry = context.createGain();
    this.protectionWet = context.createGain();
    this.protectionOut = context.createGain();
    this.limiter = context.createDynamicsCompressor();

    this.spectrumAnalyser = context.createAnalyser();
    this.spectrumAnalyser.fftSize = 8192;
    this.spectrumAnalyser.minDecibels = -100;
    this.spectrumAnalyser.maxDecibels = 0;
    this.spectrumAnalyser.smoothingTimeConstant = 0.5;
    this.preMeterSplitter = context.createChannelSplitter(2);
    this.preLeftAnalyser = context.createAnalyser();
    this.preRightAnalyser = context.createAnalyser();
    this.preLeftAnalyser.fftSize = 512;
    this.preRightAnalyser.fftSize = 512;
    this.preLeftTimeData = new Float32Array(this.preLeftAnalyser.fftSize);
    this.preRightTimeData = new Float32Array(this.preRightAnalyser.fftSize);

    this.meterSplitter = context.createChannelSplitter(2);
    this.leftAnalyser = context.createAnalyser();
    this.rightAnalyser = context.createAnalyser();
    this.leftAnalyser.fftSize = 512;
    this.rightAnalyser.fftSize = 512;
    this.leftTimeData = new Float32Array(this.leftAnalyser.fftSize);
    this.rightTimeData = new Float32Array(this.rightAnalyser.fftSize);
    this.freqData = new Float32Array(this.spectrumAnalyser.frequencyBinCount);

    this.wireGraph();
    this.dynamicsGate = new BypassGate(context, this.dynamicsDry, this.dynamicsWet, {
      connectInput: () => this.connectDynamicsProcessorInput(),
      disconnectInput: () => this.disconnectDynamicsProcessorInput()
    });
    this.protectionGate = new BypassGate(context, this.protectionDry, this.protectionWet, {
      connectInput: () => this.connectProtectionProcessorInput(),
      disconnectInput: () => this.disconnectProtectionProcessorInput()
    });
    this.applyState(this.state, true);
    this.applyProtection(this.protection, true);

    for (const track of stream.getAudioTracks()) {
      track.addEventListener('ended', () => { void this.handleEnded(); }, { once: true });
    }
  }

  private createBand(name: 'low' | 'mid' | 'high'): DynamicsBand {
    const filters: BiquadFilterNode[] = [];
    if (name === 'low') {
      for (let i = 0; i < 2; i += 1) {
        const f = this.context.createBiquadFilter();
        f.type = 'lowpass'; f.Q.value = Math.SQRT1_2; filters.push(f);
      }
    } else if (name === 'high') {
      for (let i = 0; i < 2; i += 1) {
        const f = this.context.createBiquadFilter();
        f.type = 'highpass'; f.Q.value = Math.SQRT1_2; filters.push(f);
      }
    } else {
      for (let i = 0; i < 2; i += 1) {
        const f = this.context.createBiquadFilter();
        f.type = 'highpass'; f.Q.value = Math.SQRT1_2; filters.push(f);
      }
      for (let i = 0; i < 2; i += 1) {
        const f = this.context.createBiquadFilter();
        f.type = 'lowpass'; f.Q.value = Math.SQRT1_2; filters.push(f);
      }
    }
    return { filters, compressor: this.context.createDynamicsCompressor() };
  }

  private wireGraph(): void {
    this.source.connect(this.inputGain);
    let node: AudioNode = this.inputGain;
    for (const filter of this.eqFilters) { node.connect(filter); node = filter; }
    node.connect(this.masterGain);

    this.masterGain.connect(this.dynamicsIn);
    this.dynamicsIn.connect(this.dynamicsDry);
    this.dynamicsDry.connect(this.dynamicsOut);
    this.dynamicsWet.connect(this.dynamicsOut);

    this.normalCompressor.connect(this.dynamicsWet);
    for (const band of [this.low, this.mid, this.high]) {
      for (let i = 0; i < band.filters.length - 1; i += 1) band.filters[i].connect(band.filters[i + 1]);
      band.filters[band.filters.length - 1].connect(band.compressor);
      band.compressor.connect(this.dynamicsWet);
    }

    this.dynamicsOut.connect(this.protectionIn);
    this.protectionIn.connect(this.protectionDry);
    this.protectionDry.connect(this.protectionOut);
    this.protectionWet.connect(this.protectionOut);
    this.limiter.connect(this.protectionWet);
    this.protectionOut.connect(this.context.destination);

    this.preMeterSplitter.connect(this.preLeftAnalyser, 0);
    this.preMeterSplitter.connect(this.preRightAnalyser, 1);
    this.meterSplitter.connect(this.leftAnalyser, 0);
    this.meterSplitter.connect(this.rightAnalyser, 1);
  }

  private disconnectDynamicsProcessorInput(): void {
    safeDisconnect(this.dynamicsIn, this.normalCompressor);
    safeDisconnect(this.dynamicsIn, this.low.filters[0]);
    safeDisconnect(this.dynamicsIn, this.mid.filters[0]);
    safeDisconnect(this.dynamicsIn, this.high.filters[0]);
  }

  private connectDynamicsProcessorInput(): void {
    this.disconnectDynamicsProcessorInput();
    // Topology stays inside Dynamics: BypassGate only controls when input is live.
    if (this.state.dynamics.mode === 'multiband') {
      this.dynamicsIn.connect(this.low.filters[0]);
      this.dynamicsIn.connect(this.mid.filters[0]);
      this.dynamicsIn.connect(this.high.filters[0]);
    } else {
      this.dynamicsIn.connect(this.normalCompressor);
    }
  }

  private dynamicsEnabled(): boolean {
    const d = this.state.dynamics;
    return d.enabled && d.amount > 0.0001;
  }

  private updateCrossovers(timeConstant = 0.012): void {
    const d = this.state.dynamics;
    for (const f of this.low.filters) smooth(f.frequency, d.lowCrossoverHz, this.context, timeConstant);
    smooth(this.mid.filters[0].frequency, d.lowCrossoverHz, this.context, timeConstant);
    smooth(this.mid.filters[1].frequency, d.lowCrossoverHz, this.context, timeConstant);
    smooth(this.mid.filters[2].frequency, d.highCrossoverHz, this.context, timeConstant);
    smooth(this.mid.filters[3].frequency, d.highCrossoverHz, this.context, timeConstant);
    for (const f of this.high.filters) smooth(f.frequency, d.highCrossoverHz, this.context, timeConstant);
  }

  private updateDynamicsParams(timeConstant = 0.012): void {
    const base = dynamicParams(this.state.dynamics);
    setCompressor(this.normalCompressor, base, this.context, timeConstant);
    setCompressor(this.low.compressor, { ...base, release: Math.min(1, base.release * 1.18) }, this.context, timeConstant);
    setCompressor(this.mid.compressor, base, this.context, timeConstant);
    setCompressor(this.high.compressor, { ...base, attack: Math.max(0.001, base.attack * 0.8) }, this.context, timeConstant);
  }

  applyState(next: unknown, immediate = false): void {
    const previous = this.state;
    const normalized = normalizeAudioState(next);
    this.state = normalized;
    const tau = immediate ? 0.0001 : 0.012;

    if (immediate || previous.gainDb !== normalized.gainDb) {
      if (immediate) this.masterGain.gain.value = dbToLinear(normalized.gainDb);
      else smooth(this.masterGain.gain, dbToLinear(normalized.gainDb), this.context, tau);
    }

    for (let i = 0; i < this.eqFilters.length; i += 1) {
      if (!immediate && !eqBandChanged(previous, normalized, i)) continue;
      const filter = this.eqFilters[i];
      const frequency = normalized.eq.frequencies[i];
      const q = normalized.eq.qs[i];
      const gain = normalized.eq.enabled ? normalized.eq.gains[i] : 0;
      if (immediate) {
        filter.frequency.value = frequency;
        filter.Q.value = q;
        filter.gain.value = gain;
      } else {
        smooth(filter.frequency, frequency, this.context, tau);
        smooth(filter.Q, q, this.context, tau);
        smooth(filter.gain, gain, this.context, tau);
      }
    }

    if (immediate || dynamicsChanged(previous, normalized)) {
      const previousEnabled = previous.dynamics.enabled && previous.dynamics.amount > 0.0001;
      const nextEnabled = this.dynamicsEnabled();
      const topologyChanged = previous.dynamics.mode !== normalized.dynamics.mode;
      this.updateCrossovers(tau);
      this.updateDynamicsParams(tau);
      if (!immediate && previousEnabled && nextEnabled && topologyChanged) this.dynamicsGate.refresh(false);
      else this.dynamicsGate.setEnabled(nextEnabled, immediate);
    }
  }

  private disconnectProtectionProcessorInput(): void { safeDisconnect(this.protectionIn, this.limiter); }
  private connectProtectionProcessorInput(): void {
    this.disconnectProtectionProcessorInput();
    this.protectionIn.connect(this.limiter);
  }

  applyProtection(next: unknown, immediate = false): void {
    const normalized = normalizeProtection(next);
    const profile = PROTECTION_PROFILES[normalized];
    this.protection = normalized;
    if (profile) {
      if (immediate) {
        this.limiter.threshold.value = profile.threshold;
        this.limiter.knee.value = profile.knee;
        this.limiter.ratio.value = profile.ratio;
        this.limiter.attack.value = profile.attack;
        this.limiter.release.value = profile.release;
      } else setCompressor(this.limiter, profile, this.context, 0.012);
    }
    this.protectionGate.setEnabled(Boolean(profile), immediate);
  }

  private setLevelMeteringConnected(enabled: boolean): void {
    if (enabled === this.levelMeteringConnected) return;
    if (enabled) {
      // Side-chain only: neither splitter/analyser chain connects to destination.
      this.protectionIn.connect(this.preMeterSplitter);
      this.protectionOut.connect(this.meterSplitter);
    } else {
      safeDisconnect(this.protectionIn, this.preMeterSplitter);
      safeDisconnect(this.protectionOut, this.meterSplitter);
    }
    this.levelMeteringConnected = enabled;
  }

  private setSpectrumMeteringConnected(enabled: boolean): void {
    if (enabled === this.spectrumMeteringConnected) return;
    if (enabled) this.protectionOut.connect(this.spectrumAnalyser);
    else safeDisconnect(this.protectionOut, this.spectrumAnalyser);
    this.spectrumMeteringConnected = enabled;
  }

  private ensureMeteringActive(includeLevels: boolean, includeSpectrum: boolean): void {
    this.setLevelMeteringConnected(includeLevels);
    this.setSpectrumMeteringConnected(includeSpectrum);
    if (this.meterIdleTimer !== null) clearTimeout(this.meterIdleTimer);
    this.meterIdleTimer = setTimeout(() => this.disconnectMetering(), 1200);
  }

  private disconnectMetering(): void {
    if (this.meterIdleTimer !== null) clearTimeout(this.meterIdleTimer);
    this.meterIdleTimer = null;
    this.setLevelMeteringConnected(false);
    this.setSpectrumMeteringConnected(false);
  }

  private getDynamicsReduction(): number {
    const d = this.state.dynamics;
    if (!d.enabled || d.amount <= 0.0001) return 0;
    if (d.mode === 'normal') return Number(this.normalCompressor.reduction || 0);
    return Math.min(
      Number(this.low.compressor.reduction || 0),
      Number(this.mid.compressor.reduction || 0),
      Number(this.high.compressor.reduction || 0)
    );
  }

  private readStereoMeter(leftAnalyser: AnalyserNode, rightAnalyser: AnalyserNode, leftData: Float32Array, rightData: Float32Array): StereoMeterSnapshot {
    leftAnalyser.getFloatTimeDomainData(leftData);
    rightAnalyser.getFloatTimeDomainData(rightData);

    let leftPeak = 0;
    let rightPeak = 0;
    let sumSquares = 0;
    const count = Math.min(leftData.length, rightData.length);
    for (let i = 0; i < count; i += 1) {
      const left = leftData[i];
      const right = rightData[i];
      leftPeak = Math.max(leftPeak, Math.abs(left));
      rightPeak = Math.max(rightPeak, Math.abs(right));
      sumSquares += (left * left) + (right * right);
    }

    const rms = Math.sqrt(sumSquares / Math.max(1, count * 2));
    const toDb = (linear: number): number => linear > 1e-7 ? 20 * Math.log10(linear) : -120;
    const clampDb = (db: number): number => Math.max(-120, Math.min(12, db));
    return {
      leftPeakDb: clampDb(toDb(leftPeak)),
      rightPeakDb: clampDb(toDb(rightPeak)),
      peakDb: clampDb(toDb(Math.max(leftPeak, rightPeak))),
      rmsDb: clampDb(toDb(rms))
    };
  }

  private applySpectrumMode(mode: SpectrumMode): void {
    const smoothing = mode === 'fast' ? 0.15 : mode === 'smooth' ? 0.82 : 0.5;
    if (Math.abs(this.spectrumAnalyser.smoothingTimeConstant - smoothing) > 0.001) {
      this.spectrumAnalyser.smoothingTimeConstant = smoothing;
    }
  }

  getMeter(includeSpectrum: boolean, spectrumMode: SpectrumMode = 'balanced', includeLevels = true): MeterSnapshot {
    this.ensureMeteringActive(includeLevels, includeSpectrum);
    const silentMeter: StereoMeterSnapshot = { leftPeakDb: -120, rightPeakDb: -120, peakDb: -120, rmsDb: -120 };
    const preProtection = includeLevels
      ? this.readStereoMeter(this.preLeftAnalyser, this.preRightAnalyser, this.preLeftTimeData, this.preRightTimeData)
      : silentMeter;
    const postProtection = includeLevels
      ? this.readStereoMeter(this.leftAnalyser, this.rightAnalyser, this.leftTimeData, this.rightTimeData)
      : silentMeter;

    const meter: MeterSnapshot = {
      sampleRate: this.context.sampleRate,
      preProtection,
      postProtection,
      peakDb: postProtection.peakDb,
      rmsDb: postProtection.rmsDb,
      gainReductionDb: this.protection === 'off' ? 0 : Number(this.limiter.reduction || 0),
      dynamicsReductionDb: this.getDynamicsReduction()
    };

    if (includeSpectrum) {
      this.applySpectrumMode(spectrumMode);
      if (this.freqData.length !== this.spectrumAnalyser.frequencyBinCount) {
        this.freqData = new Float32Array(this.spectrumAnalyser.frequencyBinCount);
      }
      this.spectrumAnalyser.getFloatFrequencyData(this.freqData);
      const bins = 96;
      const spectrum = new Array<number>(bins);
      const nyquist = this.context.sampleRate / 2;
      for (let i = 0; i < bins; i += 1) {
        const f0 = 20 * Math.pow(1000, i / bins);
        const f1 = 20 * Math.pow(1000, (i + 1) / bins);
        const start = Math.max(0, Math.floor((f0 / nyquist) * this.freqData.length));
        const end = Math.min(this.freqData.length, Math.max(start + 1, Math.ceil((f1 / nyquist) * this.freqData.length)));
        let max = -120;
        for (let j = start; j < end; j += 1) if (this.freqData[j] > max) max = this.freqData[j];
        spectrum[i] = Number.isFinite(max) ? max : -120;
      }
      meter.spectrum = spectrum;
    }
    return meter;
  }

  private async handleEnded(): Promise<void> {
    if (this.disposed) return;
    this.dispose();
    await this.onEnded?.(this.tabId);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disconnectMetering();
    this.dynamicsGate.dispose();
    this.protectionGate.dispose();
    for (const track of this.stream.getTracks()) {
      try { track.stop(); } catch { /* no-op */ }
    }

    for (const node of [
      this.source, this.inputGain, this.masterGain, ...this.eqFilters,
      this.dynamicsIn, this.dynamicsDry, this.dynamicsWet, this.dynamicsOut,
      this.normalCompressor, ...this.low.filters, this.low.compressor,
      ...this.mid.filters, this.mid.compressor, ...this.high.filters, this.high.compressor,
      this.protectionIn, this.protectionDry, this.protectionWet, this.protectionOut,
      this.limiter, this.spectrumAnalyser, this.preMeterSplitter, this.preLeftAnalyser, this.preRightAnalyser, this.meterSplitter, this.leftAnalyser, this.rightAnalyser
    ]) safeDisconnect(node);
  }
}
