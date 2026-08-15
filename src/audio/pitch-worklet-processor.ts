import { GranularPitchShifter } from './pitch-shift-core.js';

class KopelaEqPitchShiftProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(): readonly AudioWorkletParameterDescriptor[] {
    return [{ name: 'semitones', defaultValue: 0, minValue: -12, maxValue: 0, automationRate: 'k-rate' }];
  }

  private readonly shifter: GranularPitchShifter;

  constructor() {
    super();
    this.shifter = new GranularPitchShifter(sampleRate, 2048, 2);
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    if (!output.length) return true;
    if (!input.length) {
      for (const channel of output) channel.fill(0);
      return true;
    }
    const semitones = parameters.semitones?.[0] ?? 0;
    this.shifter.processBlock(input, output, semitones);
    return true;
  }
}

registerProcessor('kopelaeq-pitch-shift', KopelaEqPitchShiftProcessor);
