import { normalizeStereo } from '../shared/state.js';
import { stereoCoefficients } from './stereo-math.js';
import type { StereoState } from '../shared/types.js';
import { BypassGate } from './bypass-gate.js';

function safeDisconnect(node: AudioNode, destination?: AudioNode): void {
  try { destination ? node.disconnect(destination) : node.disconnect(); } catch { /* already disconnected */ }
}

function setParam(param: AudioParam, value: number, context: BaseAudioContext, immediate: boolean): void {
  if (immediate) { param.value = value; return; }
  const now = context.currentTime;
  try {
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, 0.012);
  } catch { param.value = value; }
}

/** Mid/Side stereo processor with a physically disconnected wet input while bypassed. */
export class StereoStage {
  readonly input: GainNode;
  readonly dry: GainNode;
  readonly wet: GainNode;
  readonly output: GainNode;

  private readonly splitter: ChannelSplitterNode;
  private readonly merger: ChannelMergerNode;
  private readonly midLeft: GainNode;
  private readonly midRight: GainNode;
  private readonly midSum: GainNode;
  private readonly sideLeft: GainNode;
  private readonly sideRight: GainNode;
  private readonly sideSum: GainNode;
  private readonly sideGain: GainNode;
  private readonly leftSum: GainNode;
  private readonly rightInvert: GainNode;
  private readonly rightSum: GainNode;
  private readonly balanceLeftGain: GainNode;
  private readonly balanceRightGain: GainNode;
  private readonly gate: BypassGate;
  private state: StereoState = normalizeStereo(null);

  constructor(private readonly context: AudioContext) {
    this.input = context.createGain();
    this.dry = context.createGain();
    this.wet = context.createGain();
    this.output = context.createGain();
    this.splitter = context.createChannelSplitter(2);
    this.merger = context.createChannelMerger(2);
    this.midLeft = context.createGain(); this.midLeft.gain.value = 0.5;
    this.midRight = context.createGain(); this.midRight.gain.value = 0.5;
    this.midSum = context.createGain();
    this.sideLeft = context.createGain(); this.sideLeft.gain.value = 0.5;
    this.sideRight = context.createGain(); this.sideRight.gain.value = -0.5;
    this.sideSum = context.createGain();
    this.sideGain = context.createGain();
    this.leftSum = context.createGain();
    this.rightInvert = context.createGain(); this.rightInvert.gain.value = -1;
    this.rightSum = context.createGain();
    this.balanceLeftGain = context.createGain();
    this.balanceRightGain = context.createGain();

    this.input.connect(this.dry);
    this.dry.connect(this.output);
    this.wet.connect(this.output);

    this.splitter.connect(this.midLeft, 0);
    this.splitter.connect(this.midRight, 1);
    this.midLeft.connect(this.midSum);
    this.midRight.connect(this.midSum);
    this.splitter.connect(this.sideLeft, 0);
    this.splitter.connect(this.sideRight, 1);
    this.sideLeft.connect(this.sideSum);
    this.sideRight.connect(this.sideSum);
    this.sideSum.connect(this.sideGain);
    this.midSum.connect(this.leftSum);
    this.sideGain.connect(this.leftSum);
    this.midSum.connect(this.rightSum);
    this.sideGain.connect(this.rightInvert);
    this.rightInvert.connect(this.rightSum);
    this.leftSum.connect(this.balanceLeftGain);
    this.rightSum.connect(this.balanceRightGain);
    this.wireMerger(false);
    this.merger.connect(this.wet);

    this.gate = new BypassGate(context, this.dry, this.wet, {
      connectInput: () => this.input.connect(this.splitter),
      disconnectInput: () => safeDisconnect(this.input, this.splitter)
    });
    this.gate.setEnabled(false, true);
  }

  private wireMerger(swapped: boolean): void {
    safeDisconnect(this.balanceLeftGain, this.merger);
    safeDisconnect(this.balanceRightGain, this.merger);
    this.balanceLeftGain.connect(this.merger, 0, swapped ? 1 : 0);
    this.balanceRightGain.connect(this.merger, 0, swapped ? 0 : 1);
  }

  apply(value: unknown, immediate = false): void {
    const previous = this.state;
    const next = normalizeStereo(value);
    this.state = next;
    const { width, leftGain: left, rightGain: right } = stereoCoefficients(next);
    setParam(this.sideGain.gain, width, this.context, immediate);
    setParam(this.balanceLeftGain.gain, left, this.context, immediate);
    setParam(this.balanceRightGain.gain, right, this.context, immediate);
    if (previous.swap !== next.swap) this.wireMerger(next.swap);

    // Neutral Stereo is a real bypass even when the UI toggle is on. This keeps
    // width=100%, balance=0, mono=off, swap=off bit-identical to the dry path.
    const active = next.enabled && (Math.abs(width - 1) > 1e-7 || Math.abs(next.balance) > 1e-7 || next.swap);
    this.gate.setEnabled(active, immediate);
  }

  dispose(): void {
    this.gate.dispose();
    for (const node of [
      this.input, this.dry, this.wet, this.output, this.splitter, this.merger,
      this.midLeft, this.midRight, this.midSum, this.sideLeft, this.sideRight,
      this.sideSum, this.sideGain, this.leftSum, this.rightInvert, this.rightSum,
      this.balanceLeftGain, this.balanceRightGain
    ]) safeDisconnect(node);
  }

  get debugState(): Readonly<{ enabled: boolean; processorConnected: boolean }> {
    return Object.freeze({ enabled: this.state.enabled, processorConnected: this.gate.debugState.connected });
  }
}
