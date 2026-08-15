import { MessageType, normalizeAudioState, normalizeProtection } from '../shared/index.js';
import type { AudioState, ProtectionMode, SpectrumMode } from '../shared/types.js';
import type { SessionStatusResponse, StatusResponse } from '../shared/messages.js';
import { withTimeout } from '../shared/bounded.js';
import { LatestWinsWriter } from '../shared/latest-wins.js';

export type CapturePhase = 'idle' | 'starting' | 'active' | 'stopping' | 'recovering';

export interface CaptureManagerStateProvider {
  getAudioState(): AudioState;
  getProtection(): ProtectionMode;
  getStateRevision?(): number;
  getProtectionRevision?(): number;
  isStateAuthoritative?(): boolean;
  isProtectionAuthoritative?(): boolean;
}

interface CapturedTabInfo {
  tabId: number;
  status: 'pending' | 'active' | 'stopped' | 'error' | string;
}

const AUDIBLE_MUTE_GRACE_MS = 700;
const RECOVERY_COOLDOWN_MS = 1800;
const CHROME_API_TIMEOUT_MS = 900;
const RECONCILE_PROBE_ATTEMPTS = 3;

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
  private readonly desiredTabs = new Set<number>();
  private readonly healthProbeGeneration = new Map<number, number>();
  private readonly recoveryInFlight = new Map<number, Promise<void>>();
  private readonly recoveryCooldownUntil = new Map<number, number>();
  private readonly stateWriters = new Map<number, LatestWinsWriter<AudioState>>();
  private readonly stateWriterActive = new Map<number, boolean>();
  private readonly protectionWriter: LatestWinsWriter<ProtectionMode>;
  private offscreenCreating: Promise<void> | null = null;
  private offscreenLifecycle: Promise<void> = Promise.resolve();

  constructor(private readonly stateProvider: CaptureManagerStateProvider) {
    this.protectionWriter = new LatestWinsWriter<ProtectionMode>(async ({ value, revision }) => {
      if (!(await this.hasOffscreenDocument())) return;
      await withTimeout(
        chrome.runtime.sendMessage({ target: 'offscreen', type: MessageType.ProtectionSet, protection: value, revision }),
        CHROME_API_TIMEOUT_MS,
        'Offscreen protection update'
      );
    });
  }

  phaseFor(tabId: number): CapturePhase { return this.tabPhases.get(tabId) || 'idle'; }
  private currentStateRevision(): number { return this.stateProvider.getStateRevision?.() ?? 0; }
  private currentProtectionRevision(): number { return this.stateProvider.getProtectionRevision?.() ?? 0; }
  private stateIsAuthoritative(): boolean { return this.stateProvider.isStateAuthoritative?.() ?? true; }
  private protectionIsAuthoritative(): boolean { return this.stateProvider.isProtectionAuthoritative?.() ?? true; }

  private setPhase(tabId: number, phase: CapturePhase): void {
    if (phase === 'idle') this.tabPhases.delete(tabId);
    else this.tabPhases.set(tabId, phase);
  }

  private setDesired(tabId: number, desired: boolean): void {
    if (desired) this.desiredTabs.add(tabId);
    else this.desiredTabs.delete(tabId);
  }

  private invalidateHealthProbe(tabId: number): void {
    this.healthProbeGeneration.set(tabId, (this.healthProbeGeneration.get(tabId) || 0) + 1);
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

  private enqueueOffscreenLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    let resolveValue!: (value: T | PromiseLike<T>) => void;
    let rejectValue!: (reason?: unknown) => void;
    const result = new Promise<T>((resolve, reject) => { resolveValue = resolve; rejectValue = reject; });
    const run = async () => {
      try { resolveValue(await operation()); }
      catch (error) { rejectValue(error); }
    };
    this.offscreenLifecycle = this.offscreenLifecycle.then(run, run).then(() => undefined, () => undefined);
    return result;
  }

  private stateWriterFor(tabId: number): LatestWinsWriter<AudioState> {
    let writer = this.stateWriters.get(tabId);
    if (writer) return writer;
    writer = new LatestWinsWriter<AudioState>(async ({ value, revision }) => {
      if (!(await this.hasOffscreenDocument())) {
        this.stateWriterActive.set(tabId, false);
        return;
      }
      const result = responseRecord(await withTimeout(
        chrome.runtime.sendMessage({ target: 'offscreen', type: MessageType.StateSet, state: value, tabId, revision }),
        CHROME_API_TIMEOUT_MS,
        'Offscreen state update'
      ));
      const active = Boolean(result.active);
      this.stateWriterActive.set(tabId, active);
      if (active) this.setPhase(tabId, 'active');
    });
    this.stateWriters.set(tabId, writer);
    return writer;
  }

  async hasOffscreenDocument(): Promise<boolean> {
    if (chrome.offscreen && typeof chrome.offscreen.hasDocument === 'function') {
      return withTimeout(chrome.offscreen.hasDocument(), CHROME_API_TIMEOUT_MS, 'Offscreen document probe');
    }
    if (chrome.runtime && typeof chrome.runtime.getContexts === 'function') {
      const contexts = await withTimeout(chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(this.offscreenUrl)]
      }), CHROME_API_TIMEOUT_MS, 'Runtime context probe');
      return contexts.length > 0;
    }
    return false;
  }

  private ensureOffscreenDocument(): Promise<void> {
    return this.enqueueOffscreenLifecycle(async () => {
      if (await this.hasOffscreenDocument()) return;
      if (this.offscreenCreating) return this.offscreenCreating;
      const creating = withTimeout(chrome.offscreen.createDocument({
        url: this.offscreenUrl,
        reasons: ['USER_MEDIA'],
        justification: 'Process the user-selected tab audio with Web Audio while the MV3 service worker is not a persistent document.'
      }), CHROME_API_TIMEOUT_MS, 'Offscreen document creation').finally(() => { this.offscreenCreating = null; });
      this.offscreenCreating = creating;
      return creating;
    });
  }

  async queryOffscreenStatus(tabId: number | null = null): Promise<SessionStatusResponse | null> {
    try {
      if (!(await this.hasOffscreenDocument())) {
        return {
          ok: true,
          active: false,
          activeTabs: [],
          pendingTabs: [],
          state: null,
          protection: this.stateProvider.getProtection(),
          trackReadyState: null,
          trackMuted: null,
          trackEnabled: null,
          contextState: null
        };
      }
      const payload: Record<string, unknown> = { target: 'offscreen', type: MessageType.SessionStatus };
      const id = validTabId(tabId);
      if (id !== null) payload.tabId = id;
      const result = await withTimeout(chrome.runtime.sendMessage(payload) as Promise<SessionStatusResponse>, CHROME_API_TIMEOUT_MS, 'Offscreen status');
      if (!result || result.ok !== true) return null;
      const activeTabs = Array.isArray(result.activeTabs) ? result.activeTabs : [];
      const protection = this.stateProvider.getProtection();
      if (activeTabs.length && normalizeProtection(result.protection) !== protection) {
        try {
          await withTimeout(chrome.runtime.sendMessage({ target: 'offscreen', type: MessageType.ProtectionSet, protection, revision: this.currentProtectionRevision() }), CHROME_API_TIMEOUT_MS, 'Protection sync');
          result.protection = protection;
        } catch { /* later reconciliation can retry */ }
      }
      return result;
    } catch {
      return null;
    }
  }

  private async queryOffscreenStatusConfirmed(tabId: number | null = null): Promise<SessionStatusResponse | null> {
    for (let attempt = 0; attempt < RECONCILE_PROBE_ATTEMPTS; attempt += 1) {
      const status = await this.queryOffscreenStatus(tabId);
      if (status) return status;
      if (attempt + 1 < RECONCILE_PROBE_ATTEMPTS) await delay(90);
    }
    return null;
  }

  private remoteSessionHealthy(remote: SessionStatusResponse | null): boolean {
    if (!remote?.active) return false;
    if (remote.trackReadyState === 'ended') return false;
    if (remote.trackEnabled === false) return false;
    if (remote.contextState === 'closed') return false;
    return true;
  }

  private async capturedTabsReliable(): Promise<CapturedTabInfo[] | null> {
    if (!chrome.tabCapture || typeof chrome.tabCapture.getCapturedTabs !== 'function') return [];
    try {
      const result = await withTimeout(chrome.tabCapture.getCapturedTabs(), CHROME_API_TIMEOUT_MS, 'Captured tab probe');
      return Array.isArray(result) ? result as CapturedTabInfo[] : [];
    } catch {
      return null;
    }
  }

  private async capturedTabs(): Promise<CapturedTabInfo[]> {
    return (await this.capturedTabsReliable()) || [];
  }

  private async capturedInfo(tabId: number): Promise<CapturedTabInfo | null> {
    const list = await this.capturedTabs();
    return list.find((item) => Number(item?.tabId) === tabId) || null;
  }

  private async tabAudible(tabId: number): Promise<boolean | null> {
    if (!chrome.tabs || typeof chrome.tabs.get !== 'function') return null;
    try {
      const tab = await withTimeout(chrome.tabs.get(tabId), CHROME_API_TIMEOUT_MS, 'Tab audible probe');
      return typeof tab?.audible === 'boolean' ? tab.audible : null;
    } catch {
      return null;
    }
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
      if (this.remoteSessionHealthy(status)) return status;
      const pending = Boolean(status && Array.isArray(status.pendingTabs) && status.pendingTabs.map(Number).includes(tabId));
      if (!pending) return status;
      await delay(50);
    }
    return this.queryOffscreenStatus(tabId);
  }

  async maybeCloseOffscreen(): Promise<void> {
    await this.enqueueOffscreenLifecycle(async () => {
      // desiredTabs is updated synchronously before per-tab queues run. A start on
      // another tab therefore vetoes a close even while this lifecycle task waits.
      if (this.desiredTabs.size || this.offscreenCreating || !(await this.hasOffscreenDocument())) return;
      const remote = await this.queryOffscreenStatus();
      if (!remote || this.desiredTabs.size) return;
      if ((remote.activeTabs?.length || 0) || (remote.pendingTabs?.length || 0)) return;
      const captures = await this.capturedTabs();
      if (this.desiredTabs.size) return;
      if (captures.some((item) => item && item.status !== 'stopped' && item.status !== 'error')) return;
      try { await withTimeout(chrome.offscreen.closeDocument(), CHROME_API_TIMEOUT_MS, 'Offscreen document close'); } catch { /* already closing/timed out */ }
    });
  }

  // CHROME-ERROR-TEXT-DEPENDENCY: см. заметку в RELEASE_CHECKLIST.md — сверять при апдейте minimum_chrome_version.
  private async getStreamIdSafely(tabId: number): Promise<{ streamId?: string; alreadyActive?: true; state?: AudioState | null }> {
    try {
      return { streamId: await withTimeout(chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }), CHROME_API_TIMEOUT_MS, 'Tab capture stream id') };
    } catch (error: unknown) {
      const text = error instanceof Error ? error.message : String(error || '');
      if (!/active stream|already.*captur|cannot capture/i.test(text)) throw error;

      const remote = await this.queryOffscreenStatus(tabId);
      if (this.remoteSessionHealthy(remote)) return { alreadyActive: true, state: remote?.state };

      if (await this.waitForCaptureRelease(tabId, 3000)) {
        return { streamId: await withTimeout(chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }), CHROME_API_TIMEOUT_MS, 'Tab capture stream id') };
      }
      const friendly = new Error('Previous audio session is still stopping. Try again in a moment.') as Error & { code?: string };
      friendly.code = 'STREAM_BUSY';
      throw friendly;
    }
  }

  private async stopRemoteSessionForRestart(tabId: number): Promise<void> {
    if (!(await this.hasOffscreenDocument())) return;
    try { await withTimeout(chrome.runtime.sendMessage({ target: 'offscreen', type: MessageType.CaptureStop, tabId }), CHROME_API_TIMEOUT_MS, 'Offscreen capture stop'); } catch { /* already gone */ }
  }

  private async startCaptureInternal(tabId: number): Promise<Record<string, unknown>> {
    this.setPhase(tabId, 'starting');
    try {
      let remote = await this.queryOffscreenStatus(tabId);
      if (this.remoteSessionHealthy(remote)) {
        this.setPhase(tabId, 'active');
        return { ok: true, active: true, alreadyActive: true };
      }

      if (remote?.active && !this.remoteSessionHealthy(remote)) {
        await this.stopRemoteSessionForRestart(tabId);
        await this.waitForCaptureRelease(tabId, 3000);
        remote = await this.queryOffscreenStatus(tabId);
      }

      if (remote && Array.isArray(remote.pendingTabs) && remote.pendingTabs.map(Number).includes(tabId)) {
        remote = await this.waitForOffscreenPending(tabId);
        if (this.remoteSessionHealthy(remote)) {
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

      const result = responseRecord(await withTimeout(chrome.runtime.sendMessage({
        target: 'offscreen',
        type: MessageType.CaptureStart,
        tabId,
        streamId: capture.streamId,
        state: this.stateProvider.getAudioState(),
        protection: this.stateProvider.getProtection(),
        stateRevision: this.currentStateRevision(),
        protectionRevision: this.currentProtectionRevision()
      }), CHROME_API_TIMEOUT_MS, 'Offscreen capture start'));
      if (result.ok !== true) throw new Error(typeof result.error === 'string' ? result.error : 'Audio engine did not start.');
      this.setPhase(tabId, 'active');
      this.recoveryCooldownUntil.delete(tabId);
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
      await this.stopRemoteSessionForRestart(tabId);
      const released = await this.waitForCaptureRelease(tabId, 3000);
      this.setPhase(tabId, released ? 'idle' : 'stopping');
      if (released) {
        this.stateWriters.delete(tabId);
        this.stateWriterActive.delete(tabId);
        await this.maybeCloseOffscreen();
      }
      return { ok: true, active: false, stopping: !released };
    } catch (error) {
      this.setPhase(tabId, 'idle');
      throw error;
    }
  }

  private scheduleRecovery(tabId: number, reason: string): void {
    if (!this.desiredTabs.has(tabId) || this.recoveryInFlight.has(tabId)) return;
    const cooldownUntil = this.recoveryCooldownUntil.get(tabId) || 0;
    if (Date.now() < cooldownUntil) return;

    const task = this.enqueueTabOperation(tabId, async () => {
      if (!this.desiredTabs.has(tabId)) return;
      this.setPhase(tabId, 'recovering');
      this.invalidateHealthProbe(tabId);
      try {
        await this.stopRemoteSessionForRestart(tabId);
        const released = await this.waitForCaptureRelease(tabId, 3500);
        if (!this.desiredTabs.has(tabId)) return;
        if (!released) throw new Error(`Capture recovery (${reason}) could not release the previous stream.`);
        await delay(120);
        if (!this.desiredTabs.has(tabId)) return;
        await this.startCaptureInternal(tabId);
      } catch (error) {
        this.recoveryCooldownUntil.set(tabId, Date.now() + RECOVERY_COOLDOWN_MS);
        if (this.desiredTabs.has(tabId)) this.setPhase(tabId, 'idle');
        console.warn('KopelaEQ capture recovery failed:', reason, error);
      }
    }).then(() => undefined, () => undefined).finally(() => {
      if (this.recoveryInFlight.get(tabId) === task) this.recoveryInFlight.delete(tabId);
    });
    this.recoveryInFlight.set(tabId, task);
  }

  private async probeHealthWhileAudible(tabId: number): Promise<void> {
    if (!this.desiredTabs.has(tabId)) return;
    const token = (this.healthProbeGeneration.get(tabId) || 0) + 1;
    this.healthProbeGeneration.set(tabId, token);

    const first = await this.queryOffscreenStatus(tabId);
    if (!this.desiredTabs.has(tabId) || this.healthProbeGeneration.get(tabId) !== token) return;
    if (!first?.active || first.trackReadyState === 'ended' || first.trackEnabled === false || first.contextState === 'closed') {
      this.scheduleRecovery(tabId, 'unhealthy-session');
      return;
    }
    if (first.trackMuted !== true) return;

    // A brief mute is normal while a media source swaps. Only recover when Chrome
    // still says the tab is producing audio and the captured track remains muted.
    await delay(AUDIBLE_MUTE_GRACE_MS);
    if (!this.desiredTabs.has(tabId) || this.healthProbeGeneration.get(tabId) !== token) return;
    const audible = await this.tabAudible(tabId);
    if (audible !== true) return;
    const second = await this.queryOffscreenStatus(tabId);
    if (!this.desiredTabs.has(tabId) || this.healthProbeGeneration.get(tabId) !== token) return;
    if (!second?.active || second.trackReadyState === 'ended' || second.trackEnabled === false || second.contextState === 'closed') {
      this.scheduleRecovery(tabId, 'unhealthy-session');
      return;
    }
    if (second.trackMuted === true) this.scheduleRecovery(tabId, 'audible-tab-muted-capture');
  }

  startCapture(tabIdValue: unknown): Promise<Record<string, unknown>> {
    const tabId = validTabId(tabIdValue);
    if (tabId === null) return Promise.reject(new Error('Invalid tab id.'));
    this.setDesired(tabId, true);
    this.invalidateHealthProbe(tabId);
    return this.enqueueTabOperation(tabId, () => this.startCaptureInternal(tabId)).catch((error) => {
      this.setDesired(tabId, false);
      throw error;
    });
  }

  stopCapture(tabIdValue: unknown): Promise<Record<string, unknown>> {
    const tabId = validTabId(tabIdValue);
    if (tabId === null) return Promise.resolve({ ok: true, active: false });
    this.setDesired(tabId, false);
    this.invalidateHealthProbe(tabId);
    this.recoveryCooldownUntil.delete(tabId);
    return this.enqueueTabOperation(tabId, () => this.stopCaptureInternal(tabId));
  }

  async propagateState(tabIdValue: unknown, state: AudioState, revision = this.currentStateRevision()): Promise<boolean> {
    const tabId = validTabId(tabIdValue);
    if (tabId === null) return false;
    await this.stateWriterFor(tabId).submit({ revision, value: state });
    return this.stateWriterActive.get(tabId) === true;
  }

  async propagateStateToAll(state: AudioState, revision = this.currentStateRevision()): Promise<void> {
    if (!(await this.hasOffscreenDocument())) return;
    try {
      await withTimeout(
        chrome.runtime.sendMessage({ target: 'offscreen', type: MessageType.StateSet, state, revision }),
        CHROME_API_TIMEOUT_MS,
        'Offscreen global state update'
      );
    } catch { /* a later status/state mutation can retry */ }
  }

  async propagateProtection(protection: ProtectionMode, revision = this.currentProtectionRevision()): Promise<void> {
    try { await this.protectionWriter.submit({ revision, value: protection }); }
    catch { /* a later status/protection mutation can retry */ }
  }

  async meter(tabIdValue: unknown, spectrum: boolean, spectrumMode: SpectrumMode = 'balanced', levels = true): Promise<Record<string, unknown>> {
    const tabId = validTabId(tabIdValue);
    if (tabId === null || !(await this.hasOffscreenDocument())) return { ok: true, active: false, meter: null };
    try {
      return responseRecord(await withTimeout(chrome.runtime.sendMessage({ target: 'offscreen', type: MessageType.MeterGet, tabId, spectrum, spectrumMode, levels }), CHROME_API_TIMEOUT_MS, 'Offscreen meter'));
    } catch {
      return { ok: true, active: false, meter: null };
    }
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
    if (active) {
      if (phase !== 'stopping' && phase !== 'recovering') this.setPhase(tabId, 'active');
    } else if (!remotePending && !browserPending && !stopping && phase !== 'starting' && phase !== 'recovering') {
      this.setPhase(tabId, 'idle');
    }
    return {
      ok: true,
      active,
      pending: ['starting','stopping','recovering'].includes(this.phaseFor(tabId)) || remotePending || browserPending,
      phase: this.phaseFor(tabId),
      state: active && remote?.state ? normalizeAudioState(remote.state) : this.stateProvider.getAudioState(),
      protection: this.stateProvider.getProtection(),
      stateAuthoritative: this.stateIsAuthoritative(),
      protectionAuthoritative: this.protectionIsAuthoritative(),
      stateRevision: this.currentStateRevision(),
      protectionRevision: this.currentProtectionRevision(),
      sampleRate: remote && Number.isFinite(Number(remote.sampleRate)) ? Number(remote.sampleRate) : null,
      trackReadyState: remote?.trackReadyState ?? null,
      trackMuted: remote?.trackMuted ?? null,
      trackEnabled: remote?.trackEnabled ?? null,
      contextState: remote?.contextState ?? null
    };
  }

  async reconcileExistingCaptures(): Promise<void> {
    // Recovery is destructive (stop/release/start), so never infer an orphan
    // from an uncertain IPC/API result. Require both sides to answer reliably.
    const [remote, browserCaptures] = await Promise.all([
      this.queryOffscreenStatusConfirmed(),
      this.capturedTabsReliable()
    ]);
    if (!remote || browserCaptures === null) return;

    const remoteTabs = new Set((remote.activeTabs || []).map(Number).filter(Number.isInteger));
    for (const tabId of remoteTabs) {
      this.setDesired(tabId, true);
      this.setPhase(tabId, 'active');
    }
    for (const info of browserCaptures) {
      if (!info || !Number.isInteger(info.tabId) || info.status === 'stopped' || info.status === 'error') continue;
      this.setDesired(info.tabId, true);
      if (!remoteTabs.has(info.tabId) && info.status === 'active') this.scheduleRecovery(info.tabId, 'orphan-browser-capture');
    }
  }

  onSessionEnded(tabIdValue: unknown): void {
    const tabId = validTabId(tabIdValue);
    if (tabId === null) return;
    this.setPhase(tabId, 'idle');
    this.invalidateHealthProbe(tabId);
    if (this.desiredTabs.has(tabId)) this.scheduleRecovery(tabId, 'media-track-ended');
    else void this.maybeCloseOffscreen();
  }

  onSessionHealthChanged(tabIdValue: unknown, trackMuted: boolean, readyState?: MediaStreamTrackState | null, contextState?: AudioContextState | null): void {
    const tabId = validTabId(tabIdValue);
    if (tabId === null || !this.desiredTabs.has(tabId)) return;
    if (!trackMuted) this.invalidateHealthProbe(tabId);
    if (readyState === 'ended' || contextState === 'closed') {
      this.scheduleRecovery(tabId, 'session-health-event');
      return;
    }
    if (trackMuted) void this.probeHealthWhileAudible(tabId);
  }

  onTabAudibleChanged(tabIdValue: unknown, audible: boolean): void {
    const tabId = validTabId(tabIdValue);
    if (tabId === null || !this.desiredTabs.has(tabId)) return;
    if (!audible) {
      this.invalidateHealthProbe(tabId);
      return;
    }
    void this.probeHealthWhileAudible(tabId);
  }

  onCaptureStatusChanged(info: CapturedTabInfo): void {
    if (!info || !Number.isInteger(info.tabId)) return;
    if (info.status === 'active') {
      if (this.desiredTabs.has(info.tabId)) this.setPhase(info.tabId, 'active');
      return;
    }
    if (info.status === 'stopped' || info.status === 'error') {
      this.invalidateHealthProbe(info.tabId);
      if (this.desiredTabs.has(info.tabId)) this.scheduleRecovery(info.tabId, `tab-capture-${info.status}`);
      else {
        if (this.phaseFor(info.tabId) !== 'starting') this.setPhase(info.tabId, 'idle');
        void this.maybeCloseOffscreen();
      }
    }
  }
}

export { validTabId };
