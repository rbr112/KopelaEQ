/**
 * Constants shared by the accepted legacy Pitch Down processor and the popup's
 * latency readout. Keeping the arithmetic here lets the popup report latency
 * without importing/initializing the full realtime shifter implementation.
 */
export const FIXED_LATENCY_SAMPLES_48K = 2304; // 48 ms at 48 kHz, matches 1.23.1.
export const LEGACY_GRAIN_SIZE = 2176;
export const LEGACY_MIN_DELAY_SAMPLES = 128;

export function pitchShiftLatencyMs(sampleRate: number): number {
  const rate = Math.max(8000, Number(sampleRate) || 48000);
  const latencySamples = Math.max(
    LEGACY_GRAIN_SIZE + LEGACY_MIN_DELAY_SAMPLES,
    Math.round((FIXED_LATENCY_SAMPLES_48K * rate) / 48000)
  );
  return (latencySamples / rate) * 1000;
}
