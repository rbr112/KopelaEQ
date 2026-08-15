import * as S from '../shared/index.js';
import { DEFAULT_SAMPLE_RATE, NativeEqResponse } from '../audio/eq-response.js';
import type { AudioState } from '../shared/types.js';
import type { EqAppearance } from './appearance/theme-types.js';
import type { PopupElements } from './popup-elements.js';
import { EqBandEditor } from './eq-band-editor.js';
import {
  GRAPH_MIN_GAIN as MIN_GAIN, GRAPH_MAX_GAIN as MAX_GAIN,
  getPlot, freqToX, freqToMarkerX, xToFreq, gainToY, yToGain
} from './eq-geometry.js';

export interface EqUIOptions {
  elements: PopupElements;
  getState: () => AudioState;
  onStateChange: (persist: boolean) => void;
  onEdited: () => void;
  schedulePersist: () => void;
  getAnalyzerState: () => { enabled: boolean; spectrum: number[] | null };
  getAppearance: () => EqAppearance;
}

function formatFrequency(value: unknown): string {
  const n = Number(value);
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 1 : 2).replace(/\.0+$/, '')} kHz` : `${Math.round(n)} Hz`;
}

function colorWithAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(color || '').trim());
  if (!match) return color;
  const a = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 1));
  return `rgba(${parseInt(match[1], 16)}, ${parseInt(match[2], 16)}, ${parseInt(match[3], 16)}, ${a})`;
}

const LEGACY_FREQUENCY_TICKS = [5,10,20,40,80,160,320,640,1280,2560,5120,10240,20000] as const;
const LEGACY_FREQUENCY_LABELS = new Set<number>([5,20,80,320,1280,5120,20000]);
const AUDIO_FREQUENCY_TICKS = [10,20,30,50,70,100,150,250,350,500,700,1000,1500,2000,3500,5000,7000,10000,15000,20000] as const;
const AUDIO_FREQUENCY_LABELS = new Set<number>([20,50,100,250,500,1000,2000,5000,10000,20000]);
const FULL_GAIN_TICKS = [30,20,10,0,-10,-20,-30] as const;

function arraysEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

export class EqUI {
  private readonly els: PopupElements;
  private readonly getState: () => AudioState;
  private readonly onStateChange: (persist: boolean) => void;
  private readonly onEdited: () => void;
  private readonly schedulePersist: () => void;
  private readonly getAnalyzerState: EqUIOptions['getAnalyzerState'];
  private readonly getAppearance: EqUIOptions['getAppearance'];
  private drawQueued = false;
  private responseCache = { samples: -1, sampleRate: 0, enabled: false, frequencies: [] as number[], gains: [] as number[], qs: [] as number[], points: new Float64Array(0) };
  private responseFrequencyCache: { key: string; values: Float32Array } = { key: '', values: new Float32Array(0) };
  private readonly singleFrequency = new Float32Array(1);
  private hoveredEqBand = -1;
  private bandEditor: EqBandEditor | null = null;
  private engineSampleRate = DEFAULT_SAMPLE_RATE;
  private readonly eqResponse = new NativeEqResponse(this.engineSampleRate);

  constructor(options: EqUIOptions) {
    this.els = options.elements;
    this.getState = options.getState;
    this.onStateChange = options.onStateChange;
    this.onEdited = options.onEdited;
    this.schedulePersist = options.schedulePersist;
    this.getAnalyzerState = options.getAnalyzerState;
    this.getAppearance = options.getAppearance;
  }

  private viewGainLimit(): number {
    const preferred = Math.max(6, Math.min(30, Number(this.getAppearance().viewGain) || 30));
    if (preferred >= 30) return 30;
    const maxBand = Math.max(0, ...this.getState().eq.gains.map((value) => Math.abs(Number(value) || 0)));
    if (maxBand <= preferred - 1) return preferred;
    for (const candidate of [18, 24, 30]) if (candidate >= preferred && maxBand <= candidate - 2) return candidate;
    return 30;
  }

  bind(): void {
    const canvas = this.els.eqCanvas as HTMLCanvasElement;
    let drag: { index: number; qMode: boolean; startY: number; startQ: number; pointerId?: number } | null = null;

    this.bandEditor = new EqBandEditor({
      elements: this.els,
      getEq: () => this.getState().eq,
      totalDbAt: (freq) => this.responseDbAtFrequency(freq),
      onChange: (persist) => {
        this.onEdited();
        this.onStateChange(persist);
        this.queueDraw();
      }
    });
    this.bandEditor.bind();

    const pointFromEvent = (event: PointerEvent | MouseEvent | WheelEvent): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const nearest = (point: { x: number; y: number }, radius = 15): number => {
      const state = this.getState();
      const plot = getPlot(canvas);
      let best = -1, bestD = radius;
      for (let i = 0; i < S.EQ_BANDS; i += 1) {
        const pointGain = this.viewGainLimit();
        const d = Math.hypot(point.x - freqToMarkerX(state.eq.frequencies[i], plot), point.y - gainToY(state.eq.gains[i], plot, -pointGain, pointGain));
        if (d < bestD) { best = i; bestD = d; }
      }
      return best;
    };
    const showTooltip = (index: number, point: { x: number; y: number }): void => {
      const state = this.getState();
      if (index < 0) {
        if (this.hoveredEqBand !== -1) { this.hoveredEqBand = -1; this.queueDraw(); }
        this.els.canvasTooltip.hidden = true;
        return;
      }
      if (this.hoveredEqBand !== index) { this.hoveredEqBand = index; this.queueDraw(); }
      if (this.bandEditor?.selectedIndex === index && !drag) { this.els.canvasTooltip.hidden = true; return; }
      const totalHere = this.responseDbAtFrequency(state.eq.frequencies[index]);
      const typeLabel = S.EQ_TYPES[index] === 'lowshelf' ? 'Low Shelf' : (S.EQ_TYPES[index] === 'highshelf' ? 'High Shelf' : 'Peak');
      const qText = S.EQ_TYPES[index] === 'peaking' ? ` · Q ${state.eq.qs[index].toFixed(2)}` : '';
      this.els.canvasTooltip.textContent = `${typeLabel} · ${formatFrequency(state.eq.frequencies[index])} · Band ${state.eq.gains[index].toFixed(1)} dB · Total ${totalHere.toFixed(1)} dB${qText}`;
      this.els.canvasTooltip.hidden = false;
      this.els.canvasTooltip.style.left = `${Math.min(canvas.clientWidth - 300, Math.max(4, point.x + 10))}px`;
      this.els.canvasTooltip.style.top = `${Math.max(4, point.y - 34)}px`;
    };

    canvas.addEventListener('pointerdown', (event: PointerEvent) => {
      const state = this.getState();
      const point = pointFromEvent(event);
      const index = nearest(point);
      if (index < 0) return;
      this.bandEditor?.select(index);
      drag = { index, qMode: event.shiftKey && S.EQ_TYPES[index] === 'peaking', startY: point.y, startQ: state.eq.qs[index] };
      canvas.setPointerCapture(event.pointerId);
      showTooltip(index, point);
      this.queueDraw();
      event.preventDefault();
    });
    canvas.addEventListener('pointermove', (event: PointerEvent) => {
      const state = this.getState();
      const point = pointFromEvent(event);
      if (!drag) { showTooltip(nearest(point), point); return; }
      const plot = getPlot(canvas);
      const useQ = (drag.qMode || event.shiftKey) && S.EQ_TYPES[drag.index] === 'peaking';
      if (useQ) {
        state.eq.qs[drag.index] = S.clamp(drag.startQ * Math.exp((drag.startY - point.y) / 70), S.Q_MIN, S.Q_MAX);
      } else {
        state.eq.frequencies[drag.index] = S.clamp(xToFreq(point.x, plot), S.FREQ_MIN, S.FREQ_MAX);
        const viewGain = this.viewGainLimit();
        state.eq.gains[drag.index] = S.clamp(yToGain(point.y, plot, -viewGain, viewGain), S.EQ_GAIN_MIN, S.EQ_GAIN_MAX);
      }
      this.onEdited();
      this.onStateChange(false);
      this.bandEditor?.sync();
      showTooltip(drag.index, point);
    });
    canvas.addEventListener('pointerup', (event: PointerEvent) => {
      if (!drag) return;
      drag = null;
      this.els.canvasTooltip.hidden = true;
      this.onStateChange(true);
      this.bandEditor?.sync();
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* no-op */ }
    });
    canvas.addEventListener('pointercancel', () => { drag = null; });
    canvas.addEventListener('pointerleave', () => { if (!drag) { this.hoveredEqBand = -1; this.els.canvasTooltip.hidden = true; this.queueDraw(); } });
    canvas.addEventListener('wheel', (event: WheelEvent) => {
      const index = nearest(pointFromEvent(event), 18);
      if (index < 0 || !this.bandEditor?.adjustQ(index, event.deltaY)) return;
      event.preventDefault();
      showTooltip(index, pointFromEvent(event));
      this.schedulePersist();
    }, { passive: false });
    canvas.addEventListener('dblclick', (event: MouseEvent) => {
      const state = this.getState();
      const point = pointFromEvent(event);
      const index = nearest(point);
      if (index < 0) return;
      this.bandEditor?.select(index);
      state.eq.gains[index] = 0;
      if (S.EQ_TYPES[index] === 'peaking') state.eq.qs[index] = S.DEFAULT_Q;
      this.onEdited();
      this.onStateChange(true);
      this.bandEditor?.sync();
    });
    canvas.addEventListener('keydown', (event: KeyboardEvent) => {
      const index = this.bandEditor?.selectedIndex ?? -1;
      if (index < 0) return;
      if (event.key === 'Escape') { this.bandEditor?.clear(); this.queueDraw(); return; }
      if ((event.key === '[' || event.key === ']') && S.EQ_TYPES[index] === 'peaking') {
        const delta = event.key === ']' ? -60 : 60;
        if (this.bandEditor?.adjustQ(index, delta)) {
          event.preventDefault();
          this.onStateChange(true);
        }
      }
    });
  }

  syncBandEditor(): void { this.bandEditor?.sync(); }

  closeBandEditor(): void {
    this.bandEditor?.clear();
    this.hoveredEqBand = -1;
    if (this.els.canvasTooltip) this.els.canvasTooltip.hidden = true;
    this.queueDraw();
  }

  setSampleRate(value: unknown): boolean {
    const next = Number(value);
    if (!Number.isFinite(next) || next < 8000) return false;
    const normalized = Math.round(next);
    if (normalized === this.engineSampleRate) return false;
    this.engineSampleRate = normalized;
    this.eqResponse.setSampleRate(normalized);
    this.responseCache.samples = -1;
    return true;
  }

  queueDraw(): void {
    if (this.drawQueued) return;
    this.drawQueued = true;
    requestAnimationFrame(() => { this.drawQueued = false; this.draw(); });
  }

  private resizeCanvas(): { ctx: CanvasRenderingContext2D; rect: DOMRect } {
    const canvas = this.els.eqCanvas as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable.');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, rect };
  }

  private responseDbAtFrequency(freq: number): number {
    this.singleFrequency[0] = freq;
    const result = this.eqResponse.combinedDb(this.singleFrequency, this.getState().eq);
    const db = result[0];
    return Number.isFinite(db) ? Math.max(MIN_GAIN, Math.min(MAX_GAIN, db)) : NaN;
  }

  private responseFrequenciesFor(plot: ReturnType<typeof getPlot>, samples: number): Float32Array {
    const key = `${samples}:${plot.left.toFixed(2)}:${plot.width.toFixed(2)}`;
    if (this.responseFrequencyCache.key === key) return this.responseFrequencyCache.values;
    const values = new Float32Array(samples + 1);
    for (let i = 0; i <= samples; i += 1) values[i] = xToFreq(plot.left + (i / samples) * plot.width, plot);
    this.responseFrequencyCache = { key, values };
    return values;
  }

  private responseCacheMatches(samples: number, state: AudioState): boolean {
    const cache = this.responseCache;
    return cache.samples === samples
      && cache.sampleRate === this.engineSampleRate
      && cache.enabled === state.eq.enabled
      && arraysEqual(cache.frequencies, state.eq.frequencies)
      && arraysEqual(cache.gains, state.eq.gains)
      && arraysEqual(cache.qs, state.eq.qs);
  }

  private refreshResponseCache(samples: number, responseFreqs: Float32Array, state: AudioState): void {
    const points = this.eqResponse.combinedDb(responseFreqs, state.eq);
    for (let i = 0; i < points.length; i += 1) {
      const db = points[i];
      points[i] = Number.isFinite(db) ? Math.max(MIN_GAIN, Math.min(MAX_GAIN, db)) : NaN;
    }
    this.responseCache = {
      samples, sampleRate: this.engineSampleRate, enabled: state.eq.enabled,
      frequencies: [...state.eq.frequencies], gains: [...state.eq.gains], qs: [...state.eq.qs], points
    };
  }

  private draw(): void {
    const state = this.getState();
    const { enabled: analyzerEnabled, spectrum: lastSpectrum } = this.getAnalyzerState();
    const { ctx, rect } = this.resizeCanvas();
    const plot = getPlot(this.els.eqCanvas);
    const appearance = this.getAppearance();
    const viewGain = this.viewGainLimit();
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = colorWithAlpha(appearance.background, appearance.surfaceOpacity ?? 1); ctx.fillRect(0, 0, rect.width, rect.height);

    const freqTicks = appearance.gridStyle === 'audio' ? AUDIO_FREQUENCY_TICKS : LEGACY_FREQUENCY_TICKS;
    const labelSet = appearance.gridStyle === 'audio' ? AUDIO_FREQUENCY_LABELS : LEGACY_FREQUENCY_LABELS;
    ctx.font = appearance.gridStyle === 'audio' ? '10px system-ui, sans-serif' : '10px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const freq of freqTicks) {
      const x = freqToX(freq, plot);
      ctx.strokeStyle = labelSet.has(freq) ? appearance.gridMajor : appearance.gridMinor;
      ctx.lineWidth = labelSet.has(freq) ? 1 : 0.75;
      ctx.beginPath(); ctx.moveTo(x, plot.top); ctx.lineTo(x, plot.bottom); ctx.stroke();
      if (labelSet.has(freq)) {
        ctx.fillStyle = appearance.label;
        const label = freq >= 1000 ? `${Number((freq / 1000).toFixed(freq < 10000 ? 1 : 0))}k` : String(freq);
        ctx.fillText(label, x, plot.bottom + 7);
      }
    }

    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const gainTicks = viewGain === 30 ? FULL_GAIN_TICKS : [viewGain, viewGain / 2, 0, -viewGain / 2, -viewGain];
    for (const gain of gainTicks) {
      const y = gainToY(gain, plot, -viewGain, viewGain);
      ctx.strokeStyle = gain === 0 ? appearance.axis : appearance.gridMajor;
      ctx.lineWidth = gain === 0 ? 1.15 : 1;
      ctx.beginPath(); ctx.moveTo(plot.left, y); ctx.lineTo(plot.right, y); ctx.stroke();
      ctx.fillStyle = gain === 0 ? appearance.labelStrong : appearance.label;
      ctx.fillText(gain > 0 ? `+${gain}` : String(gain), plot.left - 7, y);
    }

    if (analyzerEnabled && Array.isArray(lastSpectrum)) {
      ctx.save(); ctx.beginPath(); let started = false;
      const bins = lastSpectrum.length;
      for (let i = 0; i < bins; i += 1) {
        const x = plot.left + (i / Math.max(1, bins - 1)) * plot.width;
        const db = Math.max(-100, Math.min(0, lastSpectrum[i]));
        const y = plot.top + ((0 - db) / 100) * plot.height;
        if (!started) { ctx.moveTo(x, plot.bottom); ctx.lineTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      if (started) {
        ctx.lineTo(plot.right, plot.bottom); ctx.closePath();
        ctx.fillStyle = appearance.spectrumFill; ctx.fill();
        ctx.strokeStyle = appearance.spectrumStroke; ctx.lineWidth = 1; ctx.stroke();
      }
      if (appearance.showSpectrumScale) {
        ctx.font = '9px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = appearance.spectrumLabel;
        for (const dbfs of [0, -50, -100]) {
          const y = plot.top + ((0 - dbfs) / 100) * plot.height;
          ctx.fillText(dbfs === 0 ? '0 dBFS' : String(dbfs), plot.right - 4, y);
        }
      }
      ctx.restore();
    }

    const samples = Math.max(180, Math.floor(plot.width));
    const responseFreqs = this.responseFrequenciesFor(plot, samples);

    const activeEqBand = this.hoveredEqBand >= 0 ? this.hoveredEqBand : (this.bandEditor?.selectedIndex ?? -1);
    if (activeEqBand >= 0 && activeEqBand < S.EQ_BANDS && state.eq.enabled) {
      const bandPoints = this.eqResponse.bandDb(activeEqBand, responseFreqs, state.eq);
      ctx.save(); ctx.beginPath(); let startedBand = false;
      for (let i = 0; i <= samples; i += 1) {
        const db = bandPoints[i]; if (!Number.isFinite(db)) { startedBand = false; continue; }
        const x = plot.left + (i / samples) * plot.width;
        const y = gainToY(Math.max(MIN_GAIN, Math.min(MAX_GAIN, db)), plot, -viewGain, viewGain);
        if (!startedBand) { ctx.moveTo(x, y); startedBand = true; } else ctx.lineTo(x, y);
      }
      ctx.setLineDash([5, 4]); ctx.strokeStyle = appearance.bandGuide; ctx.lineWidth = 1.15; ctx.stroke(); ctx.restore();
    }

    if (!this.responseCacheMatches(samples, state)) this.refreshResponseCache(samples, responseFreqs, state);

    // The two rice-inspired layouts use a subtle response wash under the curve.
    // Fill each finite segment independently so low sample-rate Nyquist gaps never
    // create a polygon across invalid frequencies.
    const fillSegment = (start: number, end: number): void => {
      if (!state.eq.enabled || end - start < 1) return;
      ctx.beginPath();
      for (let i = start; i <= end; i += 1) {
        const x = plot.left + (i / samples) * plot.width;
        const y = gainToY(this.responseCache.points[i], plot, -viewGain, viewGain);
        if (i === start) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      const startX = plot.left + (start / samples) * plot.width;
      const endX = plot.left + (end / samples) * plot.width;
      ctx.lineTo(endX, plot.bottom);
      ctx.lineTo(startX, plot.bottom);
      ctx.closePath();
      ctx.fillStyle = appearance.fill;
      ctx.fill();
    };
    let segmentStart = -1;
    for (let i = 0; i <= samples; i += 1) {
      const finite = Number.isFinite(this.responseCache.points[i]);
      if (finite && segmentStart < 0) segmentStart = i;
      const segmentEnds = segmentStart >= 0 && (!finite || i === samples);
      if (segmentEnds) {
        const end = finite && i === samples ? i : i - 1;
        fillSegment(segmentStart, end);
        segmentStart = -1;
      }
    }

    ctx.beginPath();
    let startedResponse = false;
    for (let i = 0; i <= samples; i += 1) {
      const db = this.responseCache.points[i]; if (!Number.isFinite(db)) { startedResponse = false; continue; }
      const x = plot.left + (i / samples) * plot.width; const y = gainToY(db, plot, -viewGain, viewGain);
      if (!startedResponse) { ctx.moveTo(x, y); startedResponse = true; } else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = state.eq.enabled ? appearance.curve : appearance.curveDisabled;
    ctx.lineWidth = appearance.curveWidth;
    ctx.stroke();

    if (activeEqBand >= 0 && activeEqBand < S.EQ_BANDS) {
      const x = freqToMarkerX(state.eq.frequencies[activeEqBand], plot);
      const bandY = gainToY(state.eq.gains[activeEqBand], plot, -viewGain, viewGain);
      const totalDb = this.responseDbAtFrequency(state.eq.frequencies[activeEqBand]);
      if (Number.isFinite(totalDb)) {
        const totalY = gainToY(totalDb, plot, -viewGain, viewGain);
        ctx.save(); ctx.setLineDash([2, 3]); ctx.strokeStyle = appearance.totalGuide; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, bandY); ctx.lineTo(x, totalY); ctx.stroke(); ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(x, totalY, 3.2, 0, Math.PI * 2); ctx.fillStyle = appearance.totalPoint; ctx.fill(); ctx.strokeStyle = appearance.totalPointStroke; ctx.lineWidth = 1.4; ctx.stroke(); ctx.restore();
      }
    }

    for (let i = 0; i < S.EQ_BANDS; i += 1) {
      const x = freqToMarkerX(state.eq.frequencies[i], plot); const y = gainToY(state.eq.gains[i], plot, -viewGain, viewGain);
      const basePoint = appearance.pointStyle === 'bands' ? appearance.bandColors[i % appearance.bandColors.length] : appearance.point;
      const pointColor = this.bandEditor?.selectedIndex === i ? appearance.pointSelected : (this.hoveredEqBand === i ? appearance.pointHover : basePoint);
      const pointRadius = appearance.pointRadius;
      ctx.beginPath(); ctx.arc(x, y, pointRadius, 0, Math.PI * 2);
      if (appearance.pointShape === 'ring') {
        ctx.fillStyle = appearance.background; ctx.fill();
        ctx.strokeStyle = pointColor; ctx.lineWidth = this.bandEditor?.selectedIndex === i ? 2.35 : 1.75; ctx.stroke();
      } else {
        ctx.fillStyle = pointColor; ctx.fill();
        ctx.strokeStyle = appearance.pointStroke; ctx.lineWidth = 2; ctx.stroke();
      }
      if (this.bandEditor?.selectedIndex === i) {
        ctx.beginPath(); ctx.arc(x, y, pointRadius + 3.1, 0, Math.PI * 2); ctx.strokeStyle = appearance.selectedRing; ctx.lineWidth = 1.05; ctx.stroke();
      }
    }
  }
}
