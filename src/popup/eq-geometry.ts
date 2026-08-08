export interface PlotRect { left: number; top: number; right: number; bottom: number; width: number; height: number; }
export const GRAPH_MIN_FREQ = 20;
export const GRAPH_MAX_FREQ = 20000;
export const GRAPH_MIN_GAIN = -30;
export const GRAPH_MAX_GAIN = 30;

export function getPlot(canvas: HTMLCanvasElement): PlotRect {
  const rect = canvas.getBoundingClientRect();
  return { left: 40, top: 12, right: rect.width - 12, bottom: rect.height - 28, width: rect.width - 52, height: rect.height - 40 };
}
export function freqToX(freq: number, plot: PlotRect): number {
  const t = Math.log(freq / GRAPH_MIN_FREQ) / Math.log(GRAPH_MAX_FREQ / GRAPH_MIN_FREQ);
  return plot.left + t * plot.width;
}
export function xToFreq(x: number, plot: PlotRect): number {
  const t = Math.max(0, Math.min(1, (x - plot.left) / plot.width));
  return GRAPH_MIN_FREQ * Math.pow(GRAPH_MAX_FREQ / GRAPH_MIN_FREQ, t);
}
export function gainToY(gain: number, plot: PlotRect): number {
  return plot.top + ((GRAPH_MAX_GAIN - gain) / (GRAPH_MAX_GAIN - GRAPH_MIN_GAIN)) * plot.height;
}
export function yToGain(y: number, plot: PlotRect): number {
  const t = Math.max(0, Math.min(1, (y - plot.top) / plot.height));
  return GRAPH_MAX_GAIN - t * (GRAPH_MAX_GAIN - GRAPH_MIN_GAIN);
}
