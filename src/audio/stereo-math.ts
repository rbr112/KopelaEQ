import { effectiveStereoWidth, normalizeStereo } from '../shared/state.js';

export interface StereoCoefficients { width: number; leftGain: number; rightGain: number; swap: boolean; }
export function stereoCoefficients(value: unknown): StereoCoefficients {
  const next = normalizeStereo(value);
  return {
    width: effectiveStereoWidth(next),
    leftGain: next.balance > 0 ? 1 - next.balance : 1,
    rightGain: next.balance < 0 ? 1 + next.balance : 1,
    swap: next.swap
  };
}
export function processStereoFrame(left: number, right: number, value: unknown): readonly [number, number] {
  const c = stereoCoefficients(value);
  const mid = (left + right) * 0.5;
  const side = (left - right) * 0.5 * c.width;
  const l = (mid + side) * c.leftGain;
  const r = (mid - side) * c.rightGain;
  return c.swap ? [r, l] : [l, r];
}
