interface ChromeTab {
  id?: number;
  url?: string;
  active?: boolean;
  audible?: boolean;
  windowId?: number;
}

interface ChromeMessageSender {
  tab?: ChromeTab;
  url?: string;
  id?: string;
}

interface ChromeRuntimeContext {
  contextType?: string;
  documentUrl?: string;
}

interface ChromeRuntimeMessageEvent {
  addListener(
    callback: (
      message: unknown,
      sender: ChromeMessageSender,
      sendResponse: (response?: unknown) => void
    ) => boolean | void
  ): void;
}

interface ChromeRuntimeApi {
  id: string;
  onMessage: ChromeRuntimeMessageEvent;
  sendMessage(message: unknown): Promise<unknown>;
  getURL(path: string): string;
  getContexts?(filter: { contextTypes?: string[]; documentUrls?: string[] }): Promise<ChromeRuntimeContext[]>;
}

interface ChromeStorageArea {
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove?(keys: string | string[]): Promise<void>;
}

interface ChromeStorageApi {
  local: ChromeStorageArea;
  sync?: ChromeStorageArea;
}

interface ChromeTabsRemovedEvent {
  addListener(callback: (tabId: number, removeInfo?: unknown) => void): void;
}

interface ChromeTabUpdateInfo {
  audible?: boolean;
  status?: 'loading' | 'complete';
}

interface ChromeTabsUpdatedEvent {
  addListener(callback: (tabId: number, changeInfo: ChromeTabUpdateInfo, tab: ChromeTab) => void): void;
}

interface ChromeTabsApi {
  query(queryInfo: { active?: boolean; currentWindow?: boolean }): Promise<ChromeTab[]>;
  get(tabId: number): Promise<ChromeTab>;
  onRemoved: ChromeTabsRemovedEvent;
  onUpdated: ChromeTabsUpdatedEvent;
}

type ChromeTabCaptureState = 'pending' | 'active' | 'stopped' | 'error';

interface ChromeTabCaptureInfo {
  tabId: number;
  status: ChromeTabCaptureState;
  fullscreen?: boolean;
}

interface ChromeTabCaptureStatusEvent {
  addListener(callback: (info: ChromeTabCaptureInfo) => void): void;
}

interface ChromeTabCaptureApi {
  getCapturedTabs(): Promise<ChromeTabCaptureInfo[]>;
  getMediaStreamId(options?: { targetTabId?: number; consumerTabId?: number }): Promise<string>;
  onStatusChanged: ChromeTabCaptureStatusEvent;
}

interface ChromeOffscreenApi {
  hasDocument?(): Promise<boolean>;
  createDocument(options: { url: string; reasons: string[]; justification: string }): Promise<void>;
  closeDocument(): Promise<void>;
}

interface ChromeNamespace {
  runtime: ChromeRuntimeApi;
  storage: ChromeStorageApi;
  tabs: ChromeTabsApi;
  tabCapture: ChromeTabCaptureApi;
  offscreen: ChromeOffscreenApi;
}

declare const chrome: ChromeNamespace;
