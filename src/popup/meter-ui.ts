import type { MeterSnapshot, ProtectionMode, SpectrumMode } from '../shared/types.js';
import type { MeterResponse } from '../shared/messages.js';
import type { PopupElements } from './popup-elements.js';

export interface MeterRuntimeState {
  captureActive: boolean;
  activeTabId: number | null;
  protection: ProtectionMode;
  analyzerEnabled: boolean;
  spectrumFrozen: boolean;
  spectrumMode: SpectrumMode;
}

export interface MeterUIOptions {
  elements: PopupElements;
  getRuntime: () => MeterRuntimeState;
  requestMeter: (tabId: number, spectrum: boolean, spectrumMode: SpectrumMode, levels: boolean) => Promise<MeterResponse>;
  onCaptureStopped: () => void;
  onSpectrum: (spectrum: number[] | null) => void;
  onDraw: () => void;
  onStatus: (text: string) => void;
  onError: (message: string) => void;
}

const CLIP_HOLD_MS = 1500;

export class MeterUI {
  private readonly els: PopupElements;
  private readonly getRuntime: () => MeterRuntimeState;
  private readonly requestMeter: MeterUIOptions['requestMeter'];
  private readonly onCaptureStopped: () => void;
  private readonly onSpectrum: (spectrum: number[] | null) => void;
  private readonly onDraw: () => void;
  private readonly onStatus: (text: string) => void;
  private readonly onError: (message: string) => void;
  private lastMeter: MeterSnapshot | null = null;
  private prePeakHoldDb = -120;
  private postPeakHoldDb = -120;
  private preClipHoldUntil = 0;
  private postClipHoldUntil = 0;
  private pollInFlight = false;
  private pollGeneration = 0;

  constructor(options: MeterUIOptions) {
    this.els = options.elements;
    this.getRuntime = options.getRuntime;
    this.requestMeter = options.requestMeter;
    this.onCaptureStopped = options.onCaptureStopped;
    this.onSpectrum = options.onSpectrum;
    this.onDraw = options.onDraw;
    this.onStatus = options.onStatus;
    this.onError = options.onError;
  }

  bind(): void {
    this.els.meterHoldReset.addEventListener('click', () => this.resetPeakHold());
  }

  reset(): void {
    this.pollGeneration += 1;
    this.lastMeter = null;
    this.resetPeakHold();
  }

  private dbLabel(value: number): string {
    return value <= -100 ? '−∞' : `${value.toFixed(1)} dB`;
  }

  private meterWidth(db: number, min = -60, max = 3): string {
    return `${Math.max(0, Math.min(100, ((db - min) / (max - min)) * 100))}%`;
  }

  private setMeterBar(bar: HTMLElement, db: number): void {
    bar.style.width = this.meterWidth(db);
    bar.classList.toggle('is-over', db > 0);
  }

  private setClipState(el: HTMLElement, peakDb: number, stage: 'pre' | 'post'): void {
    const now = performance.now();
    let holdUntil = stage === 'pre' ? this.preClipHoldUntil : this.postClipHoldUntil;
    if (peakDb > 0) holdUntil = now + CLIP_HOLD_MS;
    if (stage === 'pre') this.preClipHoldUntil = holdUntil;
    else this.postClipHoldUntil = holdUntil;
    const overHeld = now < holdUntil;
    const near = !overHeld && peakDb > -1;
    el.textContent = overHeld ? 'OVER' : (near ? 'NEAR' : 'SAFE');
    el.dataset.level = overHeld ? 'over' : (near ? 'near' : 'safe');
    el.classList.toggle('is-over', overHeld);
  }

  resetPeakHold(): void {
    this.prePeakHoldDb = -120;
    this.postPeakHoldDb = -120;
    this.preClipHoldUntil = 0;
    this.postClipHoldUntil = 0;
    this.updateMeterUi();
  }

  updateMeterUi(): void {
    const m = this.lastMeter;
    const protection = this.getRuntime().protection;
    if (!m) {
      for (const id of ['preLeftValue','preRightValue','preRmsValue','postLeftValue','postRightValue','postRmsValue','preHoldValue','postHoldValue']) this.els[id].textContent = '−∞';
      this.els.grValue.textContent = '0.0 dB'; this.els.dynGrValue.textContent = '0.0 dB';
      for (const id of ['preLeftBar','preRightBar','preRmsBar','postLeftBar','postRightBar','postRmsBar','grBar','dynGrBar']) {
        this.els[id].style.width = '0%'; this.els[id].classList.remove('is-over');
      }
      this.els.preClipState.textContent = 'SAFE'; this.els.preClipState.dataset.level = 'safe'; this.els.preClipState.classList.remove('is-over');
      this.els.postClipState.textContent = 'SAFE'; this.els.postClipState.dataset.level = 'safe'; this.els.postClipState.classList.remove('is-over');
      this.els.protectionActivity.dataset.state = 'bypassed';
      const activityLabel = this.els.protectionActivity.querySelector<HTMLElement>('strong');
      if (activityLabel) activityLabel.textContent = protection === 'off' ? 'Protection off' : 'Protection idle';
      this.els.protectionActivityValue.textContent = '0.0 dB';
      return;
    }

    const pre = m.preProtection ?? { leftPeakDb: m.peakDb, rightPeakDb: m.peakDb, peakDb: m.peakDb, rmsDb: m.rmsDb };
    const post = m.postProtection ?? { leftPeakDb: m.peakDb, rightPeakDb: m.peakDb, peakDb: m.peakDb, rmsDb: m.rmsDb };
    this.prePeakHoldDb = Math.max(this.prePeakHoldDb, pre.peakDb);
    this.postPeakHoldDb = Math.max(this.postPeakHoldDb, post.peakDb);
    for (const [id, value] of [
      ['preLeftValue', pre.leftPeakDb], ['preRightValue', pre.rightPeakDb], ['preRmsValue', pre.rmsDb],
      ['postLeftValue', post.leftPeakDb], ['postRightValue', post.rightPeakDb], ['postRmsValue', post.rmsDb]
    ] as const) this.els[id].textContent = this.dbLabel(value);
    this.els.preHoldValue.textContent = this.dbLabel(this.prePeakHoldDb);
    this.els.postHoldValue.textContent = this.dbLabel(this.postPeakHoldDb);
    this.setMeterBar(this.els.preLeftBar, pre.leftPeakDb); this.setMeterBar(this.els.preRightBar, pre.rightPeakDb); this.setMeterBar(this.els.preRmsBar, pre.rmsDb);
    this.setMeterBar(this.els.postLeftBar, post.leftPeakDb); this.setMeterBar(this.els.postRightBar, post.rightPeakDb); this.setMeterBar(this.els.postRmsBar, post.rmsDb);
    this.setClipState(this.els.preClipState, pre.peakDb, 'pre'); this.setClipState(this.els.postClipState, post.peakDb, 'post');

    const gr = Math.abs(Math.min(0, m.gainReductionDb || 0));
    const dgr = Math.abs(Math.min(0, m.dynamicsReductionDb || 0));
    this.els.grValue.textContent = `${gr.toFixed(1)} dB`;
    this.els.dynGrValue.textContent = `${dgr.toFixed(1)} dB`;
    this.els.grBar.style.width = `${Math.min(100, gr / 18 * 100)}%`;
    this.els.dynGrBar.style.width = `${Math.min(100, dgr / 18 * 100)}%`;
    const engaged = protection !== 'off' && gr >= 0.05;
    this.els.protectionActivity.dataset.state = engaged ? 'active' : 'bypassed';
    const activityLabel = this.els.protectionActivity.querySelector<HTMLElement>('strong');
    if (activityLabel) activityLabel.textContent = protection === 'off' ? 'Protection off' : (engaged ? 'Protection working' : 'Protection idle');
    this.els.protectionActivityValue.textContent = engaged ? `−${gr.toFixed(1)} dB` : '0.0 dB';
  }

  async pollMeters(): Promise<void> {
    if (this.pollInFlight) return;
    const runtime = this.getRuntime();
    const meterVisible = !this.els.meterPanel.hidden;
    const needSpectrum = runtime.analyzerEnabled && !runtime.spectrumFrozen;
    const needLevels = meterVisible;
    if (!runtime.captureActive || (!needSpectrum && !needLevels) || runtime.activeTabId === null) return;

    const generation = this.pollGeneration;
    const tabId = runtime.activeTabId;
    this.pollInFlight = true;
    try {
      const result = await this.requestMeter(tabId, needSpectrum, runtime.spectrumMode, needLevels);
      const current = this.getRuntime();
      if (generation !== this.pollGeneration || current.activeTabId !== tabId || !current.captureActive) return;
      if (result.active === false) {
        this.lastMeter = null;
        this.onSpectrum(null);
        this.resetPeakHold();
        this.onCaptureStopped();
        this.onStatus('Processing stopped');
        return;
      }
      this.lastMeter = result.meter ?? null;
      if (!current.spectrumFrozen && this.lastMeter && Array.isArray(this.lastMeter.spectrum)) this.onSpectrum(this.lastMeter.spectrum.slice());
      if (!this.els.meterPanel.hidden) this.updateMeterUi();
      if (current.analyzerEnabled) this.onDraw();
    } catch (error: unknown) {
      // Capture can disappear while the popup is polling; only surface durable errors.
      if (error instanceof Error && !/closed|stopped|capture/i.test(error.message)) this.onError(error.message);
    } finally {
      this.pollInFlight = false;
    }
  }
}
