import { STORAGE } from '../shared/constants.js';

export interface PanelManagerOptions {
  elements: Record<string, any>;
  workspace: Record<string, any>;
  onError: (message: string) => void;
}

export class PanelManager {
  private zCounter = 30;
  private readonly els: Record<string, any>;
  private readonly workspace: Record<string, any>;
  private readonly onError: (message: string) => void;

  constructor(options: PanelManagerOptions) {
    this.els = options.elements;
    this.workspace = options.workspace;
    this.onError = options.onError;
  }

  bind(): void {
    this.els.helpButton.addEventListener('click', () => this.open('helpPanel'));
    this.els.moreButton.addEventListener('click', () => this.open('presetPanel'));
    this.els.protectionButton.addEventListener('click', () => this.open('protectionPanel'));
    this.els.dynamicsButton.addEventListener('click', () => this.open('dynamicsPanel'));
    this.els.meterButton.addEventListener('click', () => this.open('meterPanel'));
    this.bindDisclosure(this.els.dynamicsAdvancedToggle, this.els.dynamicsAdvancedBody, this.els.dynamicsPanel);

    document.addEventListener('click', (event) => {
      const close = (event.target as Element | null)?.closest('[data-close]') as HTMLElement | null;
      if (close) this.close(close.dataset.close || '');
    });

    for (const panel of document.querySelectorAll<HTMLElement>('.floating-panel')) {
      this.makeDraggable(panel);
      this.keepReachable(panel);
    }
  }

  open(id: string): void {
    const panel = document.getElementById(id) as HTMLElement | null;
    if (!panel) return;
    panel.hidden = false;
    panel.style.zIndex = String(++this.zCounter);
    this.restore(panel);
  }

  close(id: string): void {
    const panel = document.getElementById(id) as HTMLElement | null;
    if (panel) panel.hidden = true;
  }

  restoreVisible(): void {
    for (const panel of document.querySelectorAll<HTMLElement>('.floating-panel:not([hidden])')) this.restore(panel);
  }

  private bindDisclosure(button: HTMLElement, body: HTMLElement, panel: HTMLElement): void {
    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!expanded));
      body.hidden = expanded;
      requestAnimationFrame(() => {
        if (panel.hidden) return;
        const rect = panel.getBoundingClientRect();
        const pos = this.clamp(panel, rect.left, rect.top);
        panel.style.left = `${pos.left}px`;
        panel.style.top = `${pos.top}px`;
      });
    });
  }

  private keepReachable(panel: HTMLElement): void {
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => {
      if (panel.hidden) return;
      const rect = panel.getBoundingClientRect();
      const pos = this.clamp(panel, rect.left, rect.top);
      if (Math.abs(pos.left - rect.left) > 0.5) panel.style.left = `${pos.left}px`;
      if (Math.abs(pos.top - rect.top) > 0.5) panel.style.top = `${pos.top}px`;
    });
    observer.observe(panel);
    (panel as any).__kopelaResizeObserver = observer;
  }

  private defaultPosition(panel: HTMLElement): { left: number; top: number } {
    return { left: Number(panel.dataset.defaultLeft || 20), top: Number(panel.dataset.defaultTop || 80) };
  }

  private clamp(panel: HTMLElement, left: number, top: number): { left: number; top: number } {
    const maxLeft = Math.max(4, window.innerWidth - panel.offsetWidth - 4);
    const maxTop = Math.max(4, window.innerHeight - panel.offsetHeight - 4);
    return { left: Math.max(4, Math.min(maxLeft, left)), top: Math.max(4, Math.min(maxTop, top)) };
  }

  private restore(panel: HTMLElement): void {
    const defaults = this.defaultPosition(panel);
    const saved = this.workspace[panel.id] && typeof this.workspace[panel.id] === 'object' ? this.workspace[panel.id] : defaults;
    const rawLeft = Number(saved.left);
    const rawTop = Number(saved.top);
    const pos = this.clamp(panel, Number.isFinite(rawLeft) ? rawLeft : defaults.left, Number.isFinite(rawTop) ? rawTop : defaults.top);
    panel.style.left = `${pos.left}px`;
    panel.style.top = `${pos.top}px`;
  }

  private makeDraggable(panel: HTMLElement): void {
    const handle = panel.querySelector<HTMLElement>('.floating-head');
    if (!handle) return;
    let drag: { pointerId: number; dx: number; dy: number } | null = null;

    handle.addEventListener('pointerdown', (event) => {
      if ((event.target as Element | null)?.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      drag = { pointerId: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
      handle.setPointerCapture(event.pointerId);
      panel.style.zIndex = String(++this.zCounter);
      event.preventDefault();
    });

    handle.addEventListener('pointermove', (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const pos = this.clamp(panel, event.clientX - drag.dx, event.clientY - drag.dy);
      panel.style.left = `${pos.left}px`;
      panel.style.top = `${pos.top}px`;
    });

    const finish = async (event: PointerEvent): Promise<void> => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag = null;
      const rect = panel.getBoundingClientRect();
      this.workspace[panel.id] = { left: Math.round(rect.left), top: Math.round(rect.top) };
      try { await chrome.storage.local.set({ [STORAGE.WORKSPACE]: this.workspace }); }
      catch (error: unknown) { this.onError(error instanceof Error ? error.message : String(error)); }
    };
    handle.addEventListener('pointerup', (event) => { void finish(event); });
    handle.addEventListener('pointercancel', (event) => { void finish(event); });
    handle.addEventListener('dblclick', async (event) => {
      if ((event.target as Element | null)?.closest('button')) return;
      const defaults = this.defaultPosition(panel);
      const pos = this.clamp(panel, defaults.left, defaults.top);
      panel.style.left = `${pos.left}px`;
      panel.style.top = `${pos.top}px`;
      delete this.workspace[panel.id];
      try { await chrome.storage.local.set({ [STORAGE.WORKSPACE]: this.workspace }); }
      catch (error: unknown) { this.onError(error instanceof Error ? error.message : String(error)); }
    });

    panel.addEventListener('pointerdown', () => { panel.style.zIndex = String(++this.zCounter); });
  }
}
