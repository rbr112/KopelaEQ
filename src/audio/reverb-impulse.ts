import type { ReverbType } from '../shared/types.js';

interface ReverbProfile {
  durationSeconds: number;
  decayPower: number;
  diffuseStartMs: number;
  diffuseAttackMs: number;
  tailGain: number;
  dampingStartHz: number;
  dampingEndHz: number;
  earlyReflections: ReadonlyArray<readonly [delayMs: number, gain: number]>;
}

function profileFor(type: ReverbType): ReverbProfile {
  if (type === 'hall') {
    return {
      durationSeconds: 1.45,
      decayPower: 3.05,
      diffuseStartMs: 5,
      diffuseAttackMs: 20,
      tailGain: 0.30,
      dampingStartHz: 10500,
      dampingEndHz: 2600,
      earlyReflections: [[11, 0.48], [23, 0.34], [37, 0.22]]
    };
  }
  if (type === 'plate') {
    return {
      durationSeconds: 0.82,
      decayPower: 2.1,
      diffuseStartMs: 2,
      diffuseAttackMs: 13,
      tailGain: 0.33,
      dampingStartHz: 12500,
      dampingEndHz: 4200,
      earlyReflections: [[5, 0.42], [12, 0.30], [21, 0.20]]
    };
  }
  return {
    durationSeconds: 0.46,
    decayPower: 2.7,
    diffuseStartMs: 3,
    diffuseAttackMs: 18,
    tailGain: 0.28,
    dampingStartHz: 9800,
    dampingEndHz: 3000,
    earlyReflections: [[7, 0.46], [14, 0.31], [24, 0.20]]
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smoothstep01(value: number): number {
  const x = clamp01(value);
  return x * x * (3 - (2 * x));
}

function seedFor(type: ReverbType, channel: number): number {
  const base = type === 'hall' ? 0x71d35a9b : type === 'plate' ? 0x2f61c4e7 : 0x19b873cd;
  return (base ^ Math.imul(channel + 1, 0x9e3779b1)) >>> 0;
}

/**
 * Generate one deterministic channel of a synthetic room IR.
 *
 * The diffuse tail deliberately has no periodic amplitude modulation. It ramps
 * in over the first ~13-20 ms, uses independent channel noise, and is run
 * through a progressively darker one-pole low-pass so high frequencies decay
 * faster than the body of the tail. Discrete early reflections provide the
 * initial room cues before the diffuse field reaches full level.
 */
export function generateReverbImpulseChannel(sampleRate: number, type: ReverbType, channel: number): Float32Array {
  const profile = profileFor(type);
  const length = Math.max(64, Math.round(sampleRate * profile.durationSeconds));
  const data = new Float32Array(length);
  let seed = seedFor(type, channel);
  let lowPassed = 0;

  const random = (): number => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (((seed >>> 0) / 0xffffffff) * 2) - 1;
  };

  for (let i = 0; i < length; i += 1) {
    const normalizedTime = i / Math.max(1, length - 1);
    const timeMs = (i * 1000) / sampleRate;
    const attack = smoothstep01((timeMs - profile.diffuseStartMs) / profile.diffuseAttackMs);
    const envelope = Math.pow(1 - normalizedTime, profile.decayPower);
    const cutoffHz = profile.dampingStartHz
      * Math.pow(profile.dampingEndHz / profile.dampingStartHz, normalizedTime);
    const alpha = 1 - Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
    lowPassed += alpha * (random() - lowPassed);
    data[i] = lowPassed * attack * envelope * profile.tailGain;
  }

  for (let reflectionIndex = 0; reflectionIndex < profile.earlyReflections.length; reflectionIndex += 1) {
    const [baseDelayMs, baseGain] = profile.earlyReflections[reflectionIndex];
    // A small, non-periodic per-channel timing offset decorrelates L/R without
    // imposing a shared modulation frequency on the reverb tail.
    const offsetMs = channel === 0
      ? (-0.55 - (reflectionIndex * 0.17))
      : (0.75 + (reflectionIndex * 0.23));
    const index = Math.min(length - 1, Math.max(0, Math.round(((baseDelayMs + offsetMs) / 1000) * sampleRate)));
    const stereoGain = channel === 0 ? 1 : (0.94 - (reflectionIndex * 0.025));
    data[index] += baseGain * stereoGain;
  }

  return data;
}
