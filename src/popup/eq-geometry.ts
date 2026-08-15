export interface PlotRect { left: number; top: number; right: number; bottom: number; width: number; height: number; }
export const GRAPH_MIN_FREQ = 5;
export const GRAPH_MAX_FREQ = 20000;
export const GRAPH_MIN_GAIN = -30;
export const GRAPH_MAX_GAIN = 30;

export function getPlot(canvas: HTMLCanvasElement): PlotRect {
  const rect = canvas.getBoundingClientRect();
  return { left: 40, top: 12, right: rect.width - 12, bottom: rect.height - 28, width: rect.width - 52, height: rect.height - 40 };
}
export function freqToX(freq: number, plot: PlotRect): number {
  const safe = Number.isFinite(freq) ? Math.max(GRAPH_MIN_FREQ, Math.min(GRAPH_MAX_FREQ, freq)) : GRAPH_MIN_FREQ;
  const t = Math.log(safe / GRAPH_MIN_FREQ) / Math.log(GRAPH_MAX_FREQ / GRAPH_MIN_FREQ);
  return plot.left + t * plot.width;
}

/** Keeps the complete EQ marker circle inside the visible plot rectangle. */
export function freqToMarkerX(freq: number, plot: PlotRect, radius = 6.4): number {
  const x = freqToX(freq, plot);
  return Math.max(plot.left + radius, Math.min(plot.right - radius, x));
}
export function xToFreq(x: number, plot: PlotRect): number {
  const t = Math.max(0, Math.min(1, (x - plot.left) / plot.width));
  return GRAPH_MIN_FREQ * Math.pow(GRAPH_MAX_FREQ / GRAPH_MIN_FREQ, t);
}
export function gainToY(gain: number, plot: PlotRect, minGain = GRAPH_MIN_GAIN, maxGain = GRAPH_MAX_GAIN): number {
  const safeMin = Number.isFinite(minGain) ? minGain : GRAPH_MIN_GAIN;
  const safeMax = Number.isFinite(maxGain) && maxGain > safeMin ? maxGain : GRAPH_MAX_GAIN;
  const safe = Number.isFinite(gain) ? Math.max(safeMin, Math.min(safeMax, gain)) : 0;
  return plot.top + ((safeMax - safe) / (safeMax - safeMin)) * plot.height;
}
export function yToGain(y: number, plot: PlotRect, minGain = GRAPH_MIN_GAIN, maxGain = GRAPH_MAX_GAIN): number {
  const safeMin = Number.isFinite(minGain) ? minGain : GRAPH_MIN_GAIN;
  const safeMax = Number.isFinite(maxGain) && maxGain > safeMin ? maxGain : GRAPH_MAX_GAIN;
  const t = Math.max(0, Math.min(1, (y - plot.top) / plot.height));
  return safeMax - t * (safeMax - safeMin);
}
