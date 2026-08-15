import { normalizeAutoPan, normalizeReverb } from '../shared/state.js';
import type { AutoPanState, ReverbType } from '../shared/types.js';
import { BypassGate } from './bypass-gate.js';
import { generateReverbImpulseChannel } from './reverb-impulse.js';

function safeDisconnect(node: AudioNode, destination?: AudioNode): void {
  try { destination ? node.disconnect(destination) : node.disconnect(); } catch { /* already disconnected */ }
}

function smooth(param: AudioParam, value: number, context: BaseAudioContext, immediate: boolean, tau = 0.012): void {
  if (immediate) { param.value = value; return; }
  try {
    param.cancelScheduledValues(context.currentTime);
    param.setTargetAtTime(value, context.currentTime, tau);
  } catch { param.value = value; }
}

abstract class BaseStage {
  readonly input: GainNode;
  readonly dry: GainNode;
  readonly wet: GainNode;
  readonly output: GainNode;
  protected readonly gate: BypassGate;

  constructor(protected readonly context: AudioContext, processor: { connectInput(): void; disconnectInput(): void }) {
    this.input = context.createGain();
    this.dry = context.createGain();
    this.wet = context.createGain();
    this.output = context.createGain();
    this.input.connect(this.dry);
    this.dry.connect(this.output);
    this.wet.connect(this.output);
    this.gate = new BypassGate(context, this.dry, this.wet, processor);
    this.gate.setEnabled(false, true);
  }

  protected disconnectBase(): void {
    this.gate.dispose();
    for (const node of [this.input, this.dry, this.wet, this.output]) safeDisconnect(node);
  }
}

function makeImpulse(context: AudioContext, type: ReverbType): AudioBuffer {
  const left = generateReverbImpulseChannel(context.sampleRate, type, 0);
  const right = generateReverbImpulseChannel(context.sampleRate, type, 1);
  const buffer = context.createBuffer(2, left.length, context.sampleRate);
  buffer.getChannelData(0).set(left);
  buffer.getChannelData(1).set(right);
  return buffer;
}

export class ReverbStage extends BaseStage {
  private readonly convolver: ConvolverNode;
  private readonly directGain: GainNode;
  private readonly effectGain: GainNode;
  private impulseType: ReverbType | null = null;

  constructor(context: AudioContext) {
    let connect = () => {};
    let disconnect = () => {};
    super(context, { connectInput: () => connect(), disconnectInput: () => disconnect() });
    this.convolver = context.createConvolver();
    this.convolver.normalize = true;
    this.directGain = context.createGain();
    this.effectGain = context.createGain();
    this.directGain.connect(this.wet);
    this.convolver.connect(this.effectGain);
    this.effectGain.connect(this.wet);
    connect = () => { this.input.connect(this.directGain); this.input.connect(this.convolver); };
    disconnect = () => { safeDisconnect(this.input, this.directGain); safeDisconnect(this.input, this.convolver); };
  }

  apply(value: unknown, immediate = false): void {
    const next = normalizeReverb(value);
    if (next.enabled && this.impulseType !== next.type) {
      this.convolver.buffer = makeImpulse(this.context, next.type);
      this.impulseType = next.type;
    }
    smooth(this.directGain.gain, 1 - next.mix, this.context, immediate);
    smooth(this.effectGain.gain, next.mix, this.context, immediate);
    this.gate.setEnabled(next.enabled && next.mix > 0.0001, immediate);
  }

  dispose(): void {
    this.disconnectBase();
    for (const node of [this.convolver, this.directGain, this.effectGain]) safeDisconnect(node);
  }
}

export class AutoPanStage extends BaseStage {
  private readonly panner: StereoPannerNode;
  private state: AutoPanState = normalizeAutoPan(null);
  private oscillator: OscillatorNode | null = null;
  private depthGain: GainNode | null = null;

  constructor(context: AudioContext) {
    let connect = () => {};
    let disconnect = () => {};
    super(context, { connectInput: () => connect(), disconnectInput: () => disconnect() });
    this.panner = context.createStereoPanner();
    this.panner.connect(this.wet);
    connect = () => this.connectProcessor();
    disconnect = () => this.disconnectProcessor();
  }

  private connectProcessor(): void {
    this.input.connect(this.panner);
    const oscillator = this.context.createOscillator();
    const depth = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = this.state.rateHz;
    depth.gain.value = this.state.depth;
    oscillator.connect(depth);
    depth.connect(this.panner.pan);
    oscillator.start();
    this.oscillator = oscillator;
    this.depthGain = depth;
  }

  private disconnectProcessor(): void {
    safeDisconnect(this.input, this.panner);
    if (this.oscillator) {
      try { this.oscillator.stop(); } catch { /* already stopped */ }
      safeDisconnect(this.oscillator);
    }
    if (this.depthGain) safeDisconnect(this.depthGain);
    this.oscillator = null;
    this.depthGain = null;
    this.panner.pan.value = 0;
  }

  apply(value: unknown, immediate = false): void {
    const next = normalizeAutoPan(value);
    this.state = next;
    if (this.oscillator) smooth(this.oscillator.frequency, next.rateHz, this.context, immediate);
    if (this.depthGain) smooth(this.depthGain.gain, next.depth, this.context, immediate);
    this.gate.setEnabled(next.enabled && next.depth > 0.0001, immediate);
  }

  dispose(): void {
    this.disconnectBase();
    this.disconnectProcessor();
    safeDisconnect(this.panner);
  }
}
