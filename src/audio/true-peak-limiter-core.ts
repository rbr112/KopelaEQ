export interface TruePeakLimiterOptions {
  ceilingDbTp?: number;
  safetyMarginDb?: number;
  lookaheadMs?: number;
  releaseMs?: number;
  holdMs?: number;
}

export interface TruePeakLimiterMetrics {
  reductionDb: number;
  inputTruePeakDb: number;
  outputTruePeakDb: number;
}

const EPSILON = 1e-12;
const DETECTOR_TAPS = 24;
const DETECTOR_PHASES = Object.freeze([0.25, 0.5, 0.75]);

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

function linearToDb(value: number): number {
  return value > EPSILON ? 20 * Math.log10(value) : -160;
}

function sinc(value: number): number {
  if (Math.abs(value) < 1e-12) return 1;
  const x = Math.PI * value;
  return Math.sin(x) / x;
}

function blackman(index: number, length: number): number {
  if (length <= 1) return 1;
  const phase = (2 * Math.PI * index) / (length - 1);
  return 0.42 - (0.5 * Math.cos(phase)) + (0.08 * Math.cos(2 * phase));
}

/**
 * Small polyphase sinc interpolator used only for peak detection. It does not
 * oversample the audio path itself. The detector deliberately runs several
 * samples behind the incoming stream; the limiter's lookahead buffer is much
 * longer than that detector latency, so the gain change still happens before
 * the corresponding sample reaches the output.
 */
export class FourXTruePeakDetector {
  private readonly coefficients: number[][];
  private readonly history: Float64Array;
  private writeIndex = 0;
  private count = 0;

  constructor() {
    this.history = new Float64Array(DETECTOR_TAPS);
    this.coefficients = DETECTOR_PHASES.map((phase) => {
      // At the moment a new sample n arrives, estimate the interval roughly
      // roughly half a detector window behind n so a symmetric kernel has all future taps.
      const targetFromOldest = ((DETECTOR_TAPS / 2) - 1) + phase;
      const coeffs = new Array<number>(DETECTOR_TAPS);
      let sum = 0;
      for (let i = 0; i < DETECTOR_TAPS; i += 1) {
        const coefficient = sinc(targetFromOldest - i) * blackman(i, DETECTOR_TAPS);
        coeffs[i] = coefficient;
        sum += coefficient;
      }
      // Preserve DC exactly for every phase. This also keeps the detector from
      // falsely reporting gain on flat signals because of the finite window.
      if (Math.abs(sum) > EPSILON) {
        for (let i = 0; i < coeffs.length; i += 1) coeffs[i] /= sum;
      }
      return coeffs;
    });
  }

  push(sample: number): number {
    const clean = Number.isFinite(sample) ? sample : 0;
    this.history[this.writeIndex] = clean;
    this.writeIndex = (this.writeIndex + 1) % DETECTOR_TAPS;
    this.count = Math.min(DETECTOR_TAPS, this.count + 1);

    let peak = Math.abs(clean);
    if (this.count < DETECTOR_TAPS) return peak;

    // writeIndex is now the oldest history sample.
    for (const phase of this.coefficients) {
      let value = 0;
      for (let i = 0; i < DETECTOR_TAPS; i += 1) {
        value += this.history[(this.writeIndex + i) % DETECTOR_TAPS] * phase[i];
      }
      peak = Math.max(peak, Math.abs(value));
    }
    return peak;
  }

  reset(): void {
    this.history.fill(0);
    this.writeIndex = 0;
    this.count = 0;
  }
}

/**
 * Stereo-linked, lookahead, true-peak-aware final peak catcher for Maximum mode.
 *
 * The expensive part is only the 4x detector. Audio remains at the native
 * context sample rate. The output is delayed by a few milliseconds so a peak
 * detected on the undelayed signal can lower gain before that peak arrives at
 * the speakers. A short hold plus smooth release keeps isolated catches from turning into rapid
 * loudness modulation. A conservative internal margin plus post-limit TP feedback
 * is used instead of claiming mathematical brickwall reconstruction guarantees.
 */
export class TruePeakLimiterCore {
  readonly sampleRate: number;
  readonly ceilingDbTp: number;
  readonly safetyMarginDb: number;
  readonly lookaheadFrames: number;
  readonly latencySeconds: number;
  readonly releaseMs: number;
  readonly holdFrames: number;

  private readonly targetCeilingLinear: number;
  private readonly workingCeilingLinear: number;
  private readonly releaseStep: number;
  private readonly leftDetector = new FourXTruePeakDetector();
  private readonly rightDetector = new FourXTruePeakDetector();
  private readonly outLeftDetector = new FourXTruePeakDetector();
  private readonly outRightDetector = new FourXTruePeakDetector();
  private readonly delayLeft: Float32Array;
  private readonly delayRight: Float32Array;
  private delayIndex = 0;
  private gain = 1;
  private holdRemaining = 0;
  private lastInputTruePeak = 0;
  private lastOutputTruePeak = 0;

  constructor(sampleRateValue: number, options: TruePeakLimiterOptions = {}) {
    const rate = Number(sampleRateValue);
    this.sampleRate = Number.isFinite(rate) && rate >= 8000 ? rate : 48000;
    this.ceilingDbTp = Number.isFinite(options.ceilingDbTp) ? Number(options.ceilingDbTp) : -1.25;
    this.safetyMarginDb = Number.isFinite(options.safetyMarginDb) ? Math.max(0, Number(options.safetyMarginDb)) : 0.25;
    const lookaheadMs = Number.isFinite(options.lookaheadMs) ? Math.max(1, Number(options.lookaheadMs)) : 5;
    this.releaseMs = Number.isFinite(options.releaseMs) ? Math.max(20, Number(options.releaseMs)) : 80;
    const holdMs = Number.isFinite(options.holdMs) ? Math.max(0, Number(options.holdMs)) : 6;
    this.lookaheadFrames = Math.max(8, Math.ceil((lookaheadMs / 1000) * this.sampleRate));
    this.latencySeconds = this.lookaheadFrames / this.sampleRate;
    this.holdFrames = Math.max(0, Math.round((holdMs / 1000) * this.sampleRate));
    this.targetCeilingLinear = dbToLinear(this.ceilingDbTp);
    this.workingCeilingLinear = dbToLinear(this.ceilingDbTp - this.safetyMarginDb);
    this.releaseStep = 1 - Math.exp(-1 / ((this.releaseMs / 1000) * this.sampleRate));
    // +1 makes the simple circular read/write scheme delay exactly lookaheadFrames.
    this.delayLeft = new Float32Array(this.lookaheadFrames + 1);
    this.delayRight = new Float32Array(this.lookaheadFrames + 1);
  }

  reset(): void {
    this.delayLeft.fill(0);
    this.delayRight.fill(0);
    this.delayIndex = 0;
    this.gain = 1;
    this.holdRemaining = 0;
    this.lastInputTruePeak = 0;
    this.lastOutputTruePeak = 0;
    this.leftDetector.reset();
    this.rightDetector.reset();
    this.outLeftDetector.reset();
    this.outRightDetector.reset();
  }

  processBlock(input: Float32Array[], output: Float32Array[]): void {
    if (!output.length) return;
    const leftIn = input[0] ?? null;
    const rightIn = input[1] ?? leftIn;
    const leftOut = output[0];
    const rightOut = output[1] ?? output[0];
    const frames = leftOut?.length ?? rightOut?.length ?? 0;
    if (!frames) return;

    let blockInputPeak = 0;
    let blockOutputPeak = 0;

    for (let i = 0; i < frames; i += 1) {
      const left = leftIn && i < leftIn.length && Number.isFinite(leftIn[i]) ? leftIn[i] : 0;
      const right = rightIn && i < rightIn.length && Number.isFinite(rightIn[i]) ? rightIn[i] : left;

      // The detector is stereo linked: a peak in either channel lowers both by
      // the same gain, preserving balance and phantom-center position.
      const detectedPeak = Math.max(this.leftDetector.push(left), this.rightDetector.push(right));
      blockInputPeak = Math.max(blockInputPeak, detectedPeak);
      const requiredGain = detectedPeak > this.workingCeilingLinear
        ? Math.max(0, this.workingCeilingLinear / detectedPeak)
        : 1;

      if (requiredGain < this.gain) {
        // Instant detector-side attack is safe because the audio itself is
        // delayed by lookaheadFrames. The listener hears the gain change before
        // the detected transient arrives, not after it has clipped.
        this.gain = requiredGain;
        this.holdRemaining = this.holdFrames;
      } else if (this.holdRemaining > 0) {
        // A short hold keeps one transient from producing a rapid gain bounce.
        // This is deliberately time-based only; it never follows program loudness.
        this.holdRemaining -= 1;
      } else {
        this.gain += (1 - this.gain) * this.releaseStep;
      }

      const readIndex = (this.delayIndex + 1) % this.delayLeft.length;
      const delayedLeft = this.delayLeft[readIndex];
      const delayedRight = this.delayRight[readIndex];
      this.delayLeft[this.delayIndex] = left;
      this.delayRight[this.delayIndex] = right;
      this.delayIndex = readIndex;

      let outLeft = delayedLeft * this.gain;
      let outRight = delayedRight * this.gain;

      // Last-resort sample-peak ceiling. This is intentionally linked between
      // channels and normally does nothing because lookahead already handled the
      // transient. It prevents malformed/extreme input from escaping at > ceiling.
      const rawOutPeak = Math.max(Math.abs(outLeft), Math.abs(outRight));
      if (rawOutPeak > this.workingCeilingLinear) {
        const correction = this.workingCeilingLinear / rawOutPeak;
        outLeft *= correction;
        outRight *= correction;
        this.gain = Math.min(this.gain, this.gain * correction);
        this.holdRemaining = this.holdFrames;
      }

      const reconstructedOutPeak = Math.max(this.outLeftDetector.push(outLeft), this.outRightDetector.push(outRight));
      blockOutputPeak = Math.max(blockOutputPeak, reconstructedOutPeak);
      if (reconstructedOutPeak > this.targetCeilingLinear) {
        // Feedback for the next samples if limiting itself generated a new
        // inter-sample overshoot. The 0.35 dB working margin makes this rare.
        this.gain = Math.min(this.gain, this.gain * (this.targetCeilingLinear / reconstructedOutPeak));
        this.holdRemaining = this.holdFrames;
      }

      leftOut[i] = outLeft;
      if (rightOut !== leftOut) rightOut[i] = outRight;
    }

    this.lastInputTruePeak = blockInputPeak;
    this.lastOutputTruePeak = blockOutputPeak;
  }

  metrics(): TruePeakLimiterMetrics {
    return {
      reductionDb: Math.min(0, linearToDb(this.gain)),
      inputTruePeakDb: linearToDb(this.lastInputTruePeak),
      outputTruePeakDb: linearToDb(this.lastOutputTruePeak)
    };
  }
}
