import { MessageType, normalizeAudioState, normalizeProtection } from '../shared/index.js';
import type { AudioState, ProtectionMode, SpectrumMode } from '../shared/types.js';
import type { SessionStatusResponse, StatusResponse } from '../shared/messages.js';

export type CapturePhase = 'idle' | 'starting' | 'active' | 'stopping';

export interface CaptureManagerStateProvider {
  getAudioState(): AudioState;
  getProtection(): ProtectionMode;
}

interface CapturedTabInfo {
  tabId: number;
  status: 'pending' | 'active' | 'stopped' | 'error' | string;
}

function validTabId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


function responseRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
export class CaptureManager {
  private readonly offscreenUrl = 'offscreen.html';
  private readonly tabQueues = new Map<number, Promise<unknown>>();
  private readonly tabPhases = new Map<number, CapturePhase>();
  private offscreenCreating: Promise<void> | null = null;

  constructor(private readonly stateProvider: CaptureManagerStateProvider) {}

  phaseFor(tabId: number): CapturePhase { return this.tabPhases.get(tabId) || 'idle'; }

  private setPhase(tabId: number, phase: CapturePhase): void {
    if (phase === 'idle') this.tabPhases.delete(tabId);
    else this.tabPhases.set(tabId, phase);
  }

  private enqueueTabOperation<T>(tabId: number, operation: () => Promise<T>): Promise<T> {
    const previous = this.tabQueues.get(tabId) || Promise.resolve();
    const run = previous.catch(() => undefined).then(operation);
    const tail = run.catch(() => undefined);
    this.tabQueues.set(tabId, tail);
    void tail.finally(() => {
      if (this.tabQueues.get(tabId) === tail) this.tabQueues.delete(tabId);
    });
    return run;
  }

  async hasOffscreenDocument(): Promise<boolean> {
    if (chrome.offscreen && typeof chrome.offscreen.hasDocument === 'function') return chrome.offscreen.hasDocument();
    if (chrome.runtime && typeof chrome.runtime.getContexts === 'function') {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(this.offscreenUrl)]
      });
      return contexts.length > 0;
    }
    return false;
  }

  private async ensureOffscreenDocument(): Promise<void> {
    if (await this.hasOffscreenDocument()) return;
    if (this.offscreenCreating) return this.offscreenCreating;
    const creating: Promise<void> = chrome.offscreen.createDocument({
      url: this.offscreenUrl,
      reasons: ['USER_MEDIA'],
      justification: 'Process the user-selected tab audio with Web Audio while the MV3 service worker is not a persistent document.'
    }).finally(() => { this.offscreenCreating = null; });
    this.offscreenCreating = creating;
    return creating;
  }

  async queryOffscreenStatus(tabId: number | null = null): Promise<SessionStatusResponse | null> {
    if (!(await this.hasOffscreenDocument())) {
      return { ok: true, active: false, activeTabs: [], pendingTabs: [], state: null, protection: this.stateProvider.getProtection() };
    }
    try {
      const payload: Record<string, unknown> = { target: 'offscreen', type: MessageType.SessionStatus };
      const id = validTabId(tabId);
      if (id !== null) payload.tabId = id;
      const result = await chrome.runtime.sendMessage(payload) as SessionStatusResponse;
      if (!result || result.ok !== true) return null;
      const activeTabs = Array.isArray(result.activeTabs) ? result.activeTabs : [];
      const protection = this.stateProvider.getProtection();
      if (activeTabs.length && normalizeProtection(result.protection) !== protection) {
        try {
          await chrome.runtime.sendMessage({ target: 'offscreen', type: MessageType.ProtectionSet, protection });
          result.protection = protection;
        } catch { /* later reconciliation can retry */ }
      }
      return result;
    } catch {
      return null;
    }
  }

  private async capturedTabs(): Promise<CapturedTabInfo[]> {
    if (!chrome.tabCapture || typeof chrome.tabCapture.getCapturedTabs !== 'function') return [];
    try {
      const result = await chrome.tabCapture.getCapturedTabs();
      return Array.isArray(result) ? result as CapturedTabInfo[] : [];
    } catch {
      return [];
    }
  }

  private async capturedInfo(tabId: number): Promise<CapturedTabInfo | null> {
    const list = await this.capturedTabs();
    return list.find((item) => Number(item?.tabId) === tabId) || null;
  }

  private async waitForCaptureRelease(tabId: number, timeoutMs = 3000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const info = await this.capturedInfo(tabId);
      if (!info || info.status === 'stopped' || info.status === 'error') return true;
      await delay(60);
    }
    const info = await this.capturedInfo(tabId);
    return !info || info.status === 'stopped' || info.status === 'error';
  }

  private async waitForOffscreenPending(tabId: number, timeoutMs = 3000): Promise<SessionStatusResponse | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await this.queryOffscreenStatus(tabId);
      if (status?.active) return status;
      const pending = Boolean(status && Array.isArray(status.pendingTabs) && status.pendingTabs.map(Number).includes(tabId));
      if (!pending) return status;
      await delay(50);
    }
    return this.queryOffscreenStatus(tabId);
  }

  async maybeCloseOffscreen(): Promise<void> {
    if (this.offscreenCreating || !(await this.hasOffscreenDocument())) return;
    const remote = await this.queryOffscreenStatus();
    if (!remote) return;
    if ((remote.activeTabs?.length || 0) || (remote.pendingTabs?.length || 0)) return;
    const captures = await this.capturedTabs();
    if (captures.some((item) => item && item.status !== 'stopped' && item.status !== 'error')) return;
    try { await chrome.offscreen.closeDocument(); } catch { /* already closing */ }
  }

  private async getStreamIdSafely(tabId: number): Promise<{ streamId?: string; alreadyActive?: true; state?: AudioState | null }> {
    try {
      return { streamId: await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }) };
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : String(error || '');
      if (!/active stream|already.*captur|cannot capture/i.test(text)) throw error;

      const remote = await this.queryOffscreenStatus(tabId);
      if (remote?.active) return { alreadyActive: true, state: remote.state };

      if (await this.waitForCaptureRelease(tabId, 3000)) {
        return { streamId: await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }) };
      }
      const friendly = new Error('Previous audio session is still stopping. Try again in a moment.') as Error & { code?: string };
      friendly.code = 'STREAM_BUSY';
      throw friendly;
    }
  }

  private async startCaptureInternal(tabId: number): Promise<Record<string, unknown>> {
    this.setPhase(tabId, 'starting');
    try {
      let remote = await this.queryOffscreenStatus(tabId);
      if (remote?.active) {
        this.setPhase(tabId, 'active');
        return { ok: true, active: true, alreadyActive: true };
      }

      if (remote && Array.isArray(remote.pendingTabs) && remote.pendingTabs.map(Number).includes(tabId)) {
        remote = await this.waitForOffscreenPending(tabId);
        if (remote?.active) {
          this.setPhase(tabId, 'active');
          return { ok: true, active: true, alreadyActive: true };
        }
      }

      const info = await this.capturedInfo(tabId);
      if (info && info.status !== 'stopped' && info.status !== 'error') {
        if (!(await this.waitForCaptureRelease(tabId, 3000))) {
          const error = new Error('Previous audio session is still stopping. Try again in a moment.') as Error & { code?: string };
          error.code = 'STREAM_BUSY';
          throw error;
        }
      }

      await this.ensureOffscreenDocument();
      const capture = await this.getStreamIdSafely(tabId);
      if (capture.alreadyActive) {
        this.setPhase(tabId, 'active');
        return { ok: true, active: true, alreadyActive: true };
      }
      if (!capture.streamId) throw new Error('Chrome did not return a tab audio stream id.');

      const result = responseRecord(await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: MessageType.CaptureStart,
        tabId,
        streamId: capture.streamId,
        state: this.stateProvider.getAudioState(),
        protection: this.stateProvider.getProtection()
      }));
      if (result.ok !== true) throw new Error(typeof result.error === 'string' ? result.error : 'Audio engine did not start.');
      this.setPhase(tabId, 'active');
      return { ok: true, active: true, alreadyActive: result.alreadyActive === true };
    } catch (error) {
      this.setPhase(tabId, 'idle');
      await this.maybeCloseOffscreen();
      throw error;
    }
  }

  private async stopCaptureInternal(tabId: number): Promise<Record<string, unknown>> {
    this.setPhase(tabId, 'stopping');
    try {
      if (await this.hasOffscreenDocument()) {
        try { await chrome.runtime.sendMessage({ target: 'offscreen', type: MessageType.CaptureStop, tabId }); } catch { /* already gone */ }
      }
      const released = await this.waitForCaptureRelease(tabId, 3000);
      this.setPhase(tabId, released ? 'idle' : 'stopping');
      if (released) await this.maybeCloseOffscreen();
      return { ok: true, active: false, stopping: !released };
    } catch (error) {
      this.setPhase(tabId, 'idle');
      throw error;
    }
  }

  startCapture(tabIdValue: unknown): Promise<Record<string, unknown>> {
    const tabId = validTabId(tabIdValue);
    if (tabId === null) return Promise.reject(new Error('Invalid tab id.'));
    return this.enqueueTabOperation(tabId, () => this.startCaptureInternal(tabId));
  }

  stopCapture(tabIdValue: unknown): Promise<Record<string, unknown>> {
    const tabId = validTabId(tabIdValue);
    if (tabId === null) return Promise.resolve({ ok: true, active: false });
    return this.enqueueTabOperation(tabId, () => this.stopCaptureInternal(tabId));
  }

  async propagateState(tabIdValue: unknown, state: AudioState): Promise<boolean> {
    const tabId = validTabId(tabIdValue);
    if (tabId === null || !(await this.hasOffscreenDocument())) return false;
    try {
      const result = responseRecord(await chrome.runtime.sendMessage({ target: 'offscreen', type: MessageType.StateSet, state, tabId }));
      if (result.active) this.setPhase(tabId, 'active');
      return Boolean(result.active);
    } catch { return false; }
  }

  async propagateProtection(protection: ProtectionMode): Promise<void> {
    if (!(await this.hasOffscreenDocument())) return;
    try { await chrome.runtime.sendMessage({ target: 'offscreen', type: MessageType.ProtectionSet, protection }); } catch { /* no receiver */ }
  }

  async meter(tabIdValue: unknown, spectrum: boolean, spectrumMode: SpectrumMode = 'balanced', levels = true): Promise<Record<string, unknown>> {
    const tabId = validTabId(tabIdValue);
    if (tabId === null || !(await this.hasOffscreenDocument())) return { ok: true, active: false, meter: null };
    const remote = await this.queryOffscreenStatus(tabId);
    if (!remote?.active) return { ok: true, active: false, meter: null };
    return responseRecord(await chrome.runtime.sendMessage({ target: 'offscreen', type: MessageType.MeterGet, tabId, spectrum, spectrumMode, levels }));
  }

  async statusForTab(tabIdValue: unknown): Promise<StatusResponse> {
    const tabId = validTabId(tabIdValue);
    if (tabId === null) return { ok: false, error: 'Invalid tab id.' };
    const remote = await this.queryOffscreenStatus(tabId);
    const info = await this.capturedInfo(tabId);
    const phase = this.phaseFor(tabId);
    const remotePending = Boolean(remote && Array.isArray(remote.pendingTabs) && remote.pendingTabs.map(Number).includes(tabId));
    const browserPending = Boolean(info && info.status === 'pending');
    const stopping = phase === 'stopping' && Boolean(info && info.status === 'active');
    const active = Boolean(remote?.active);
    if (active) this.setPhase(tabId, 'active');
    else if (!remotePending && !browserPending && !stopping && phase !== 'starting') this.setPhase(tabId, 'idle');
    return {
      ok: true,
      active,
      pending: this.phaseFor(tabId) === 'starting' || this.phaseFor(tabId) === 'stopping' || remotePending || browserPending,
      phase: this.phaseFor(tabId),
      state: active && remote?.state ? normalizeAudioState(remote.state) : this.stateProvider.getAudioState(),
      protection: this.stateProvider.getProtection(),
      sampleRate: remote && Number.isFinite(Number(remote.sampleRate)) ? Number(remote.sampleRate) : null
    };
  }

  onSessionEnded(tabIdValue: unknown): void {
    const tabId = validTabId(tabIdValue);
    if (tabId !== null) this.setPhase(tabId, 'idle');
    void this.maybeCloseOffscreen();
  }

  onCaptureStatusChanged(info: CapturedTabInfo): void {
    if (!info || !Number.isInteger(info.tabId)) return;
    if (info.status === 'active') this.setPhase(info.tabId, 'active');
    if (info.status === 'stopped' || info.status === 'error') {
      if (this.phaseFor(info.tabId) !== 'starting') this.setPhase(info.tabId, 'idle');
      void this.maybeCloseOffscreen();
    }
  }
}

export { validTabId };
