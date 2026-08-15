import { STORAGE } from '../shared/constants.js';
import type { WorkspaceState } from '../shared/types.js';
import type { PopupElements } from './popup-elements.js';

export interface PanelManagerOptions {
  elements: PopupElements;
  workspace: WorkspaceState;
  onError: (message: string) => void;
  onPanelOpen?: (panelId: string) => void;
}

const PRIMARY_PANELS = [
  'helpPanel', 'appearancePanel', 'presetPanel', 'protectionPanel', 'dynamicsPanel', 'stereoPanel',
  'effectsPanel', 'pitchPanel', 'reverbPanel', 'autoPanPanel', 'meterPanel'
] as const;

const EFFECT_DETAIL_PANELS = ['pitchPanel', 'reverbPanel', 'autoPanPanel'] as const;

export class PanelManager {
  private zCounter = 30;
  private readonly closeTimers = new Map<string, number>();
  private readonly scrollHintBound = new WeakSet<HTMLElement>();
  private readonly resizeObservers = new WeakMap<HTMLElement, ResizeObserver>();
  private readonly els: PopupElements;
  private readonly workspace: WorkspaceState;
  private readonly onError: (message: string) => void;
  private readonly onPanelOpen?: (panelId: string) => void;

  constructor(options: PanelManagerOptions) {
    this.els = options.elements;
    this.workspace = options.workspace;
    this.onError = options.onError;
    this.onPanelOpen = options.onPanelOpen;
  }

  bind(): void {
    this.els.helpButton.addEventListener('click', () => this.togglePrimary('helpPanel'));
    this.els.appearanceButton.addEventListener('click', () => this.togglePrimary('appearancePanel'));
    this.els.moreButton.addEventListener('click', () => this.togglePrimary('presetPanel'));
    this.els.protectionButton.addEventListener('click', () => this.togglePrimary('protectionPanel'));
    this.els.dynamicsButton.addEventListener('click', () => this.togglePrimary('dynamicsPanel'));
    this.els.stereoButton.addEventListener('click', () => this.togglePrimary('stereoPanel'));
    this.els.effectsButton.addEventListener('click', () => this.toggleEffectsLauncher());
    this.els.pitchButton.addEventListener('click', () => this.openEffect('pitchPanel'));
    this.els.reverbButton.addEventListener('click', () => this.openEffect('reverbPanel'));
    this.els.autoPanButton.addEventListener('click', () => this.openEffect('autoPanPanel'));
    this.els.meterButton.addEventListener('click', () => this.toggleToolPanel('meterPanel'));
    this.bindDisclosure(this.els.dynamicsAdvancedToggle, this.els.dynamicsAdvancedBody, this.els.dynamicsPanel);

    document.addEventListener('click', (event) => {
      const target = event.target as Element | null;
      const close = target?.closest('[data-close]') as HTMLElement | null;
      if (close) { this.close(close.dataset.close || ''); return; }
      const back = target?.closest('[data-back-effects]');
      if (back) { this.openPrimary('effectsPanel'); return; }
      const workspaceBack = target?.closest('[data-back-workspace]');
      if (workspaceBack) { this.close((workspaceBack as HTMLElement).closest<HTMLElement>('.floating-panel')?.id || ''); return; }

      // Clicking the main canvas/toolbar/background dismisses the current
      // settings inspector. In themed layouts every Audio Tool is exclusive.
      if (!target?.closest('.floating-panel, .control-strip, .eq-toolbar, .preset-control, .top-actions')) {
        this.closePrimaryPanels();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') {
        const sheetId = document.documentElement.dataset.toolSheet;
        const sheet = sheetId ? this.panel(sheetId) : null;
        if (sheet && !sheet.hidden) {
          const focusable = [...sheet.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null);
          if (focusable.length) {
            const first = focusable[0], last = focusable[focusable.length - 1];
            const active = document.activeElement;
            if (event.shiftKey && (active === first || !sheet.contains(active))) { last.focus(); event.preventDefault(); return; }
            if (!event.shiftKey && (active === last || !sheet.contains(active))) { first.focus(); event.preventDefault(); return; }
          }
        }
      }
      if (event.key !== 'Escape') return;
      const visible = [...document.querySelectorAll<HTMLElement>('.floating-panel:not([hidden]):not(.is-closing)')];
      if (!visible.length) return;
      visible.sort((a, b) => Number(b.style.zIndex || 0) - Number(a.style.zIndex || 0));
      this.close(visible[0].id);
      event.preventDefault();
    });

    for (const panel of document.querySelectorAll<HTMLElement>('.floating-panel')) {
      this.makeDraggable(panel);
      this.keepReachable(panel);
    }
    this.syncTriggerStates();
  }

  open(id: string): void {
    if (id === 'meterPanel' && this.layoutId() === 'classic') this.openIndependent(id);
    else this.openPrimary(id);
  }

  close(id: string): void {
    const panel = document.getElementById(id) as HTMLElement | null;
    if (panel) this.hide(panel);
    this.syncPresentationState();
    this.syncTriggerStates();
    this.triggerForPanel(id)?.focus({ preventScroll: true });
  }

  restoreVisible(): void {
    for (const panel of document.querySelectorAll<HTMLElement>('.floating-panel:not([hidden]):not(.is-closing)')) this.restore(panel);
    // A theme/layout change can alter a visible panel's presentation without
    // reopening it (e.g. Classic floating Appearance -> Rice inspector).
    this.syncPresentationState();
    this.syncTriggerStates();
  }

  private panel(id: string): HTMLElement | null {
    return document.getElementById(id) as HTMLElement | null;
  }

  private isVisible(id: string): boolean {
    const panel = this.panel(id);
    return Boolean(panel && !panel.hidden && !panel.classList.contains('is-closing'));
  }

  private show(id: string): void {
    const panel = this.panel(id);
    if (!panel) return;
    this.onPanelOpen?.(id);
    const pending = this.closeTimers.get(id);
    if (pending !== undefined) { window.clearTimeout(pending); this.closeTimers.delete(id); }
    panel.classList.remove('is-closing');
    panel.removeAttribute('aria-hidden');
    panel.style.pointerEvents = '';
    panel.hidden = false;
    panel.style.zIndex = String(++this.zCounter);
    if (panel.id === 'dynamicsPanel') {
      const scroller = panel.querySelector<HTMLElement>('.floating-body');
      if (scroller) scroller.scrollTop = 0;
    }
    this.fitAboveControlStrip(panel);
    this.restore(panel);
    const presentation = this.presentationFor(panel);
    if (presentation === 'tool-sheet') {
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.style.zIndex = String(Math.max(90, ++this.zCounter));
    }
    this.syncPresentationState();
    requestAnimationFrame(() => {
      const target = panel.querySelector<HTMLElement>('[data-back-workspace], [data-back-effects], button, input, select, [tabindex]:not([tabindex="-1"])');
      target?.focus({ preventScroll: true });
    });
  }

  private closePrimaryPanels(except = ''): void {
    for (const id of PRIMARY_PANELS) {
      if (id === except) continue;
      // Classic keeps Meter as the one intentionally independent floating
      // surface. Rice/Nocturne treat it like every other Audio Tool.
      if (this.layoutId() === 'classic' && id === 'meterPanel') continue;
      const panel = this.panel(id);
      if (panel && !panel.hidden && !panel.classList.contains('is-closing')) this.hide(panel);
    }
    this.syncPresentationState();
    this.syncTriggerStates();
  }

  private hide(panel: HTMLElement): void {
    const pending = this.closeTimers.get(panel.id);
    if (pending !== undefined) window.clearTimeout(pending);

    panel.removeAttribute('aria-modal');
    if (panel.getAttribute('role') === 'dialog') panel.removeAttribute('role');

    const themed = this.layoutId() !== 'classic';
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (!themed || reducedMotion) {
      panel.hidden = true;
      panel.classList.remove('is-closing');
      panel.removeAttribute('aria-hidden');
      panel.style.pointerEvents = '';
      this.closeTimers.delete(panel.id);
      return;
    }

    panel.classList.add('is-closing');
    panel.setAttribute('aria-hidden', 'true');
    panel.style.pointerEvents = 'none';
    const timer = window.setTimeout(() => {
      panel.hidden = true;
      panel.classList.remove('is-closing');
      panel.removeAttribute('aria-hidden');
      panel.style.pointerEvents = '';
      this.closeTimers.delete(panel.id);
    }, 230);
    this.closeTimers.set(panel.id, timer);
  }

  private openPrimary(id: string): void {
    this.closePrimaryPanels(id);
    this.show(id);
    this.syncTriggerStates();
  }

  private togglePrimary(id: string): void {
    if (this.isVisible(id)) { this.close(id); return; }
    this.openPrimary(id);
  }

  private toggleEffectsLauncher(): void {
    const detailOpen = EFFECT_DETAIL_PANELS.some((id) => this.isVisible(id));
    if (detailOpen) { this.openPrimary('effectsPanel'); return; }
    this.togglePrimary('effectsPanel');
  }

  private openEffect(id: string): void {
    this.openPrimary(id);
  }

  private openIndependent(id: string): void {
    this.show(id);
    this.syncTriggerStates();
  }

  private toggleIndependent(id: string): void {
    if (this.isVisible(id)) this.close(id);
    else this.openIndependent(id);
  }


  private toggleToolPanel(id: string): void {
    if (this.layoutId() === 'classic' && id === 'meterPanel') this.toggleIndependent(id);
    else this.togglePrimary(id);
  }

  private setExpanded(element: HTMLElement | undefined, expanded: boolean): void {
    if (!element) return;
    element.classList.toggle('is-open', expanded);
    element.setAttribute('aria-expanded', String(expanded));
  }

  private syncTriggerStates(): void {
    this.setExpanded(this.els.helpButton, this.isVisible('helpPanel'));
    this.setExpanded(this.els.appearanceButton, this.isVisible('appearancePanel'));
    this.setExpanded(this.els.moreButton, this.isVisible('presetPanel'));
    this.setExpanded(this.els.protectionButton, this.isVisible('protectionPanel'));
    this.setExpanded(this.els.dynamicsButton, this.isVisible('dynamicsPanel'));
    this.setExpanded(this.els.stereoButton, this.isVisible('stereoPanel'));
    this.setExpanded(this.els.meterButton, this.isVisible('meterPanel'));

    const anyEffectPanel = this.isVisible('effectsPanel') || EFFECT_DETAIL_PANELS.some((id) => this.isVisible(id));
    this.setExpanded(this.els.effectsButton, anyEffectPanel);
    this.setExpanded(this.els.pitchButton, this.isVisible('pitchPanel'));
    this.setExpanded(this.els.reverbButton, this.isVisible('reverbPanel'));
    this.setExpanded(this.els.autoPanButton, this.isVisible('autoPanPanel'));
  }

  private bindDisclosure(button: HTMLElement, body: HTMLElement, panel: HTMLElement): void {
    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') === 'true';
      const nextExpanded = !expanded;
      button.setAttribute('aria-expanded', String(nextExpanded));
      body.hidden = !nextExpanded;
      panel.classList.toggle('has-expanded-content', nextExpanded);
      requestAnimationFrame(() => {
        if (panel.hidden) return;
        this.restore(panel);
        this.syncScrollableHint(panel);
      });
    });
  }

  private syncScrollableHint(panel: HTMLElement): void {
    if (panel.id !== 'dynamicsPanel') return;
    const scroller = panel.querySelector<HTMLElement>('.floating-body');
    if (!scroller) return;
    const sync = (): void => {
      const canScrollDown = panel.classList.contains('has-expanded-content') && scroller.scrollHeight - scroller.scrollTop > scroller.clientHeight + 3;
      panel.classList.toggle('can-scroll-down', canScrollDown);
    };
    sync();
    if (!this.scrollHintBound.has(scroller)) {
      scroller.addEventListener('scroll', sync, { passive: true });
      this.scrollHintBound.add(scroller);
    }
  }

  private keepReachable(panel: HTMLElement): void {
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => {
      if (panel.hidden) return;
      if (this.layoutId() !== 'classic') { this.placeThemed(panel); return; }
      const rect = panel.getBoundingClientRect();
      const pos = this.clamp(panel, rect.left, rect.top);
      if (Math.abs(pos.left - rect.left) > 0.5) panel.style.left = `${pos.left}px`;
      if (Math.abs(pos.top - rect.top) > 0.5) panel.style.top = `${pos.top}px`;
    });
    observer.observe(panel);
    this.resizeObservers.set(panel, observer);
  }


  private reservesControlStrip(panel: HTMLElement): boolean {
    // The module strip is persistent navigation. No floating panel may cover it;
    // otherwise users can open a panel and lose the control needed to close or
    // switch it.
    return (PRIMARY_PANELS as readonly string[]).includes(panel.id);
  }

  private panelBottomBoundary(panel: HTMLElement): number {
    // Classic keeps its horizontal module strip at the bottom. Rice/Nocturne
    // present the same triggers as side navigation, so reserving everything
    // above the strip's top would collapse panels to a few pixels.
    if (document.documentElement.dataset.layout !== 'classic') return window.innerHeight - 4;
    if (!this.reservesControlStrip(panel)) return window.innerHeight - 4;
    const strip = document.querySelector<HTMLElement>('.control-strip');
    if (!strip) return window.innerHeight - 4;
    return Math.max(120, Math.min(window.innerHeight - 4, strip.getBoundingClientRect().top - 8));
  }

  private fitAboveControlStrip(panel: HTMLElement): void {
    // Persistent module navigation must always remain visible/clickable.
    const maxHeight = Math.max(120, this.panelBottomBoundary(panel) - 4);
    panel.style.maxHeight = `${Math.floor(maxHeight)}px`;
  }

  private defaultPosition(panel: HTMLElement): { left: number; top: number } {
    return { left: Number(panel.dataset.defaultLeft || 20), top: Number(panel.dataset.defaultTop || 80) };
  }

  private clamp(panel: HTMLElement, left: number, top: number): { left: number; top: number } {
    this.fitAboveControlStrip(panel);
    const maxLeft = Math.max(4, window.innerWidth - panel.offsetWidth - 4);
    const maxTop = Math.max(4, this.panelBottomBoundary(panel) - panel.offsetHeight);
    return { left: Math.max(4, Math.min(maxLeft, left)), top: Math.max(4, Math.min(maxTop, top)) };
  }

  private layoutId(): string {
    return document.documentElement.dataset.layout || 'classic';
  }

  private triggerForPanel(panelId: string): HTMLElement | null {
    const map: Record<string, string> = {
      appearancePanel: 'appearanceButton',
      helpPanel: 'helpButton',
      presetPanel: 'moreButton',
      protectionPanel: 'protectionButton',
      dynamicsPanel: 'dynamicsButton',
      stereoPanel: 'stereoButton',
      effectsPanel: 'effectsButton',
      pitchPanel: 'effectsButton',
      reverbPanel: 'effectsButton',
      autoPanPanel: 'effectsButton',
      meterPanel: 'meterButton'
    };
    const id = map[panelId];
    return id ? document.getElementById(id) as HTMLElement | null : null;
  }

  private presentationFor(panel: HTMLElement): 'floating' | 'dock-popover' | 'workspace-page' | 'tool-page' | 'tool-sheet' | 'appearance-inspector' {
    const layout = this.layoutId();
    if (layout === 'rice') {
      // Appearance is a side inspector: the main EQ remains at full 1:1 size.
      // It temporarily replaces the Audio Tools column while visual settings are edited.
      if (panel.id === 'appearancePanel') return 'appearance-inspector';
      if (panel.id === 'helpPanel') return 'dock-popover';
      return 'workspace-page';
    }
    if (layout === 'nocturne') {
      if (panel.id === 'appearancePanel') return 'appearance-inspector';
      if (panel.id === 'helpPanel') return 'tool-sheet';
      return 'workspace-page';
    }
    return 'floating';
  }

  private syncPresentationState(): void {
    const root = document.documentElement;
    delete root.dataset.workspacePage;
    delete root.dataset.toolPage;
    delete root.dataset.toolSheet;
    delete root.dataset.appearanceInspector;
    for (const panel of document.querySelectorAll<HTMLElement>('.floating-panel:not([hidden]):not(.is-closing)')) {
      const presentation = this.presentationFor(panel);
      panel.dataset.presentation = presentation;
      if (presentation === 'workspace-page') root.dataset.workspacePage = panel.id;
      else if (presentation === 'tool-page') root.dataset.toolPage = panel.id;
      else if (presentation === 'tool-sheet') root.dataset.toolSheet = panel.id;
      else if (presentation === 'appearance-inspector') root.dataset.appearanceInspector = panel.id;
    }
    this.syncWorkspaceAccessibility();
  }

  private syncWorkspaceAccessibility(): void {
    const root = document.documentElement;
    const workspaceOpen = Boolean(root.dataset.workspacePage);
    const appearanceInspectorOpen = Boolean(root.dataset.appearanceInspector);
    for (const target of document.querySelectorAll<HTMLElement>('.eq-section, .statusbar')) {
      target.inert = workspaceOpen;
      if (workspaceOpen) target.setAttribute('aria-hidden', 'true');
      else target.removeAttribute('aria-hidden');
    }
    const shell = document.querySelector<HTMLElement>('.app-shell');
    if (shell) {
      shell.inert = appearanceInspectorOpen;
      if (appearanceInspectorOpen) shell.setAttribute('aria-hidden', 'true');
      else shell.removeAttribute('aria-hidden');
    }
  }

  private placeThemed(panel: HTMLElement): void {
    const layout = this.layoutId();
    const trigger = this.triggerForPanel(panel.id);
    panel.dataset.presentation = this.presentationFor(panel);
    if (layout === 'classic' || !trigger) return;

    // Theme panels are anchored to their real trigger. They overlay the shell
    // rather than participating in layout, so opening one never moves the EQ.
    const triggerRect = trigger.getBoundingClientRect();
    const primaryEl = document.querySelector<HTMLElement>('.primary-surface');
    const primary = primaryEl?.getBoundingClientRect();
    const toolSurface = document.querySelector<HTMLElement>('.control-strip')?.getBoundingClientRect();
    const presentation = this.presentationFor(panel);
    const gap = layout === 'rice' ? 8 : 12;
    let left = triggerRect.left - panel.offsetWidth - gap;
    let top = triggerRect.top + (triggerRect.height - panel.offsetHeight) / 2;

    if (presentation === 'appearance-inspector') {
      left = Math.max(574, window.innerWidth - panel.offsetWidth - 8);
      top = 14;
    } else if (presentation === 'workspace-page' && primary) {
      const header = primaryEl?.querySelector<HTMLElement>('.topbar')?.getBoundingClientRect();
      left = primary.left + 10;
      top = (header?.bottom || primary.top + 48) + 6;
    } else if (presentation === 'tool-page' && toolSurface) {
      // Keep Audio Tools visible. Detail panels open immediately to the left
      // as an overlay over the main workspace instead of replacing the rail.
      left = toolSurface.left - panel.offsetWidth - gap;
      top = toolSurface.top;
    } else if (presentation === 'tool-sheet') {
      left = (window.innerWidth - panel.offsetWidth) / 2;
      top = (window.innerHeight - panel.offsetHeight) / 2;
    } else if (layout === 'rice' && primary) {
      const laneLeft = primary.right + 8;
      const laneRight = triggerRect.left - 8;
      if (panel.offsetWidth <= laneRight - laneLeft) left = laneLeft;
    }

    if (panel.id === 'helpPanel' && layout === 'rice') {
      left = Math.min(window.innerWidth - panel.offsetWidth - 8, Math.max(8, triggerRect.right - panel.offsetWidth));
      top = triggerRect.bottom + 8;
    }

    const pos = this.clamp(panel, left, top);
    panel.style.right = 'auto';
    panel.style.left = `${pos.left}px`;
    panel.style.top = `${pos.top}px`;
  }

  private restore(panel: HTMLElement): void {
    if (this.layoutId() !== 'classic') {
      this.placeThemed(panel);
      requestAnimationFrame(() => this.syncScrollableHint(panel));
      return;
    }
    panel.dataset.presentation = 'floating';
    panel.style.right = '';
    const defaults = this.defaultPosition(panel);
    const saved = this.workspace[panel.id] && typeof this.workspace[panel.id] === 'object' ? this.workspace[panel.id] : defaults;
    const rawLeft = Number(saved.left);
    const rawTop = Number(saved.top);
    const pos = this.clamp(panel, Number.isFinite(rawLeft) ? rawLeft : defaults.left, Number.isFinite(rawTop) ? rawTop : defaults.top);
    panel.style.left = `${pos.left}px`;
    panel.style.top = `${pos.top}px`;
    requestAnimationFrame(() => this.syncScrollableHint(panel));
  }

  private makeDraggable(panel: HTMLElement): void {
    const handle = panel.querySelector<HTMLElement>('.floating-head');
    if (!handle) return;
    let drag: { pointerId: number; dx: number; dy: number } | null = null;

    handle.addEventListener('pointerdown', (event) => {
      if (this.layoutId() !== 'classic') return;
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
      if (this.layoutId() !== 'classic') return;
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
