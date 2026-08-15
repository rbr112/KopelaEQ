import { DEFAULT_FREQUENCIES, DEFAULT_Q, EQ_BANDS, EQ_GAIN_MAX, EQ_GAIN_MIN, EQ_TYPES, FREQ_MAX, FREQ_MIN, Q_MAX, Q_MIN, clamp } from '../shared/index.js';
import type { EqState } from '../shared/types.js';
import type { PopupElements } from './popup-elements.js';

export interface EqBandEditorOptions {
  elements: PopupElements;
  getEq: () => EqState;
  totalDbAt: (frequency: number) => number;
  onChange: (persist: boolean) => void;
}

function typeLabel(index: number): string {
  return EQ_TYPES[index] === 'lowshelf' ? 'Low Shelf' : EQ_TYPES[index] === 'highshelf' ? 'High Shelf' : 'Peak';
}

export class EqBandEditor {
  selectedIndex = -1;
  private readonly els: PopupElements;
  private readonly getEq: () => EqState;
  private readonly totalDbAt: (frequency: number) => number;
  private readonly onChange: (persist: boolean) => void;

  constructor(options: EqBandEditorOptions) {
    this.els = options.elements;
    this.getEq = options.getEq;
    this.totalDbAt = options.totalDbAt;
    this.onChange = options.onChange;
  }

  bind(): void {
    this.els.bandInspectorClose.addEventListener('click', () => this.clear());
    this.els.bandResetButton.addEventListener('click', () => this.resetSelected());
    this.bindNumber(this.els.bandFrequency, 'frequency');
    this.bindNumber(this.els.bandGain, 'gain');
    this.bindNumber(this.els.bandQ, 'q');
    const inspector = this.els.bandInspector as HTMLElement;
    for (const button of inspector.querySelectorAll<HTMLButtonElement>('[data-band-step]')) {
      button.addEventListener('click', (event: MouseEvent) => {
        const field = button.dataset.bandStep as 'frequency' | 'gain' | 'q' | undefined;
        const direction = Number(button.dataset.direction) < 0 ? -1 : 1;
        if (!field) return;
        this.stepField(field, direction, event.shiftKey);
      });
    }
    document.addEventListener('click', (event: MouseEvent) => {
      if (this.selectedIndex < 0) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest('#bandInspector')) return;
      if (target.closest('#presetPickerButton, #helpButton, #appearanceButton, #moreButton, .module-button')) this.clear();
    });
  }

  private bindNumber(input: HTMLInputElement, field: 'frequency' | 'gain' | 'q'): void {
    const apply = (persist: boolean): void => {
      if (this.selectedIndex < 0) return;
      const eq = this.getEq();
      const raw = Number(input.value);
      if (!Number.isFinite(raw)) { this.sync(); return; }
      if (field === 'frequency') eq.frequencies[this.selectedIndex] = clamp(raw, FREQ_MIN, FREQ_MAX);
      else if (field === 'gain') eq.gains[this.selectedIndex] = clamp(raw, EQ_GAIN_MIN, EQ_GAIN_MAX);
      else {
        if (EQ_TYPES[this.selectedIndex] !== 'peaking') { this.sync(); return; }
        eq.qs[this.selectedIndex] = clamp(raw, Q_MIN, Q_MAX);
      }
      this.onChange(persist);
      this.sync();
    };
    input.addEventListener('focus', () => requestAnimationFrame(() => input.select()));
    input.addEventListener('input', () => apply(false));
    input.addEventListener('change', () => apply(true));
    input.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
      if (event.key === 'Escape') { event.preventDefault(); this.sync(); input.blur(); }
    });
  }


  private stepField(field: 'frequency' | 'gain' | 'q', direction: -1 | 1, fine: boolean): void {
    if (this.selectedIndex < 0) return;
    const i = this.selectedIndex;
    const eq = this.getEq();
    if (field === 'q' && EQ_TYPES[i] !== 'peaking') return;

    if (field === 'frequency') {
      const current = eq.frequencies[i];
      const coarse = current < 100 ? 1 : current < 500 ? 5 : current < 2000 ? 10 : current < 10000 ? 50 : 100;
      const step = fine ? Math.max(1, coarse / 5) : coarse;
      eq.frequencies[i] = clamp(Math.round((current + direction * step) * 10) / 10, FREQ_MIN, FREQ_MAX);
    } else if (field === 'gain') {
      const step = fine ? 0.1 : 0.5;
      eq.gains[i] = clamp(Math.round((eq.gains[i] + direction * step) * 10) / 10, EQ_GAIN_MIN, EQ_GAIN_MAX);
    } else {
      const step = fine ? 0.02 : 0.1;
      eq.qs[i] = clamp(Math.round((eq.qs[i] + direction * step) * 100) / 100, Q_MIN, Q_MAX);
    }

    this.onChange(true);
    this.sync();
  }

  select(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= EQ_BANDS) return;
    this.selectedIndex = index;
    document.documentElement.dataset.bandEditor = 'open';
    this.els.bandInspector.hidden = false;
    this.sync();
  }

  clear(): void {
    this.selectedIndex = -1;
    delete document.documentElement.dataset.bandEditor;
    this.els.bandInspector.hidden = true;
  }

  sync(): void {
    if (this.selectedIndex < 0) return;
    const i = this.selectedIndex;
    const eq = this.getEq();
    const isPeak = EQ_TYPES[i] === 'peaking';
    this.els.bandIndexLabel.textContent = `BAND ${i + 1}`;
    this.els.bandTypeLabel.textContent = typeLabel(i);
    this.els.bandFrequency.value = String(Math.round(eq.frequencies[i] * 10) / 10);
    this.els.bandGain.value = eq.gains[i].toFixed(1);
    this.els.bandQ.value = isPeak ? eq.qs[i].toFixed(2) : '';
    this.els.bandQ.placeholder = isPeak ? '' : '—';
    this.els.bandQ.disabled = !isPeak;
    const inspector = this.els.bandInspector as HTMLElement;
    for (const button of inspector.querySelectorAll<HTMLButtonElement>('[data-band-step="q"]')) button.disabled = !isPeak;
    this.els.bandQUnit.textContent = isPeak ? 'Q' : 'n/a';
    this.els.bandHint.textContent = isPeak ? 'Type · −/+ · wheel point → Q' : 'Type · −/+ · drag shelf';
    const total = this.totalDbAt(eq.frequencies[i]);
    this.els.bandTotalReadout.textContent = Number.isFinite(total) ? `Total ${total >= 0 ? '+' : ''}${total.toFixed(1)} dB` : 'Total —';
  }

  adjustQ(index: number, deltaY: number): boolean {
    if (index < 0 || EQ_TYPES[index] !== 'peaking') return false;
    const eq = this.getEq();
    const factor = Math.exp(-deltaY * 0.0018);
    eq.qs[index] = clamp(eq.qs[index] * factor, Q_MIN, Q_MAX);
    this.select(index);
    this.onChange(false);
    this.sync();
    return true;
  }

  resetSelected(): void {
    if (this.selectedIndex < 0) return;
    const i = this.selectedIndex;
    const eq = this.getEq();
    eq.frequencies[i] = DEFAULT_FREQUENCIES[i];
    eq.gains[i] = 0;
    eq.qs[i] = DEFAULT_Q;
    this.onChange(true);
    this.sync();
  }
}
