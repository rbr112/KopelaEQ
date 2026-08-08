export interface BypassProcessor {
  connectInput(): void;
  disconnectInput(): void;
}

export interface BypassGateOptions {
  tau?: number;
  settleMs?: number;
}

export const DEFAULT_TAU = 0.0025;
export const DEFAULT_SETTLE_MS = 14;

function ramp(param: AudioParam, value: number, context: BaseAudioContext, tau: number): void {
  const now = context.currentTime;
  try {
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, Math.max(0.0001, tau));
  } catch {
    try { param.value = value; } catch { /* unsupported AudioParam */ }
  }
}

/**
 * Owns the click-free dry/wet transition and processor-input lifetime.
 * The processor adapter remains topology-aware; BypassGate deliberately does not.
 */
export class BypassGate {
  private readonly tau: number;
  private readonly settleMs: number;
  private desiredEnabled = false;
  private connected = false;
  private disposed = false;
  private transition = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly context: BaseAudioContext,
    private readonly dry: GainNode,
    private readonly wet: GainNode,
    private readonly processor: BypassProcessor,
    options: BypassGateOptions = {}
  ) {
    this.tau = Number.isFinite(options.tau) ? Math.max(0.0001, Number(options.tau)) : DEFAULT_TAU;
    this.settleMs = Number.isFinite(options.settleMs) ? Math.max(0, Number(options.settleMs)) : DEFAULT_SETTLE_MS;
  }

  setEnabled(enabled: boolean, immediate = false): void {
    if (this.disposed) return;
    const desired = Boolean(enabled);
    const transition = ++this.transition;
    this.desiredEnabled = desired;
    this.clearTimer();

    if (immediate) {
      if (desired && !this.connected) this.connectProcessor();
      if (!desired && this.connected) this.disconnectProcessor();
      this.dry.gain.value = desired ? 0 : 1;
      this.wet.gain.value = desired ? 1 : 0;
      return;
    }

    if (desired) {
      if (!this.connected) this.connectProcessor();
      ramp(this.dry.gain, 0, this.context, this.tau);
      ramp(this.wet.gain, 1, this.context, this.tau);
      return;
    }

    ramp(this.dry.gain, 1, this.context, this.tau);
    ramp(this.wet.gain, 0, this.context, this.tau);
    if (!this.connected) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.disposed || transition !== this.transition || this.desiredEnabled) return;
      this.disconnectProcessor();
    }, this.settleMs);
  }

  refresh(immediate = false): void {
    if (this.disposed || !this.desiredEnabled) return;
    const transition = ++this.transition;
    this.clearTimer();

    if (immediate) {
      if (this.connected) this.disconnectProcessor();
      this.connectProcessor();
      this.dry.gain.value = 0;
      this.wet.gain.value = 1;
      return;
    }

    ramp(this.dry.gain, 1, this.context, this.tau);
    ramp(this.wet.gain, 0, this.context, this.tau);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.disposed || transition !== this.transition || !this.desiredEnabled) return;
      if (this.connected) this.disconnectProcessor();
      this.connectProcessor();
      ramp(this.dry.gain, 0, this.context, this.tau);
      ramp(this.wet.gain, 1, this.context, this.tau);
    }, this.settleMs);
  }

  private connectProcessor(): void {
    this.processor.connectInput();
    this.connected = true;
  }

  private disconnectProcessor(): void {
    this.processor.disconnectInput();
    this.connected = false;
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    ++this.transition;
    this.clearTimer();
    if (this.connected) this.disconnectProcessor();
  }

  /** Test/debug snapshot. Not used by the audio path. */
  get debugState(): Readonly<{ enabled: boolean; connected: boolean; disposed: boolean; transitioning: boolean }> {
    return Object.freeze({
      enabled: this.desiredEnabled,
      connected: this.connected,
      disposed: this.disposed,
      transitioning: this.timer !== null
    });
  }
}
