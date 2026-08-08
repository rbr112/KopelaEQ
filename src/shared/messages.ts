import type { AudioState, MeterSnapshot, ProtectionMode, SpectrumMode } from './types.js';

export const MessageType = Object.freeze({
  CaptureStart: 'CAPTURE_START',
  CaptureStop: 'CAPTURE_STOP',
  StatusGet: 'STATUS_GET',
  StateSet: 'STATE_SET',
  ProtectionSet: 'PROTECTION_SET',
  PresetSelectionGet: 'PRESET_SELECTION_GET',
  PresetSelectionSet: 'PRESET_SELECTION_SET',
  MeterGet: 'METER_GET',
  SessionEnded: 'SESSION_ENDED',
  SessionStatus: 'SESSION_STATUS'
} as const);

export type MessageTypeValue = typeof MessageType[keyof typeof MessageType];

export type BackgroundMessage =
  | { type: typeof MessageType.CaptureStart; tabId?: number | null }
  | { type: typeof MessageType.CaptureStop; tabId?: number | null }
  | { type: typeof MessageType.StatusGet; tabId?: number | null }
  | { type: typeof MessageType.StateSet; tabId?: number | null; state: unknown; persist?: boolean; presetSelection?: unknown }
  | { type: typeof MessageType.ProtectionSet; protection: unknown }
  | { type: typeof MessageType.PresetSelectionGet; tabId?: number | null }
  | { type: typeof MessageType.PresetSelectionSet; tabId?: number | null; name: unknown }
  | { type: typeof MessageType.MeterGet; tabId?: number | null; spectrum?: boolean; spectrumMode?: SpectrumMode; levels?: boolean }
  | { type: typeof MessageType.SessionEnded; tabId: number };

export type OffscreenMessage =
  | { target: 'offscreen'; type: typeof MessageType.CaptureStart; tabId: number; streamId: string; state: AudioState; protection: ProtectionMode }
  | { target: 'offscreen'; type: typeof MessageType.CaptureStop; tabId: number }
  | { target: 'offscreen'; type: typeof MessageType.SessionStatus; tabId?: number }
  | { target: 'offscreen'; type: typeof MessageType.StateSet; tabId?: number; state: AudioState }
  | { target: 'offscreen'; type: typeof MessageType.ProtectionSet; protection: ProtectionMode }
  | { target: 'offscreen'; type: typeof MessageType.MeterGet; tabId: number; spectrum?: boolean; spectrumMode?: SpectrumMode; levels?: boolean };

export type RuntimeMessage = BackgroundMessage | OffscreenMessage;

export interface BaseResponse { ok: boolean; error?: string; code?: string; }
export interface CaptureResponse extends BaseResponse { active?: boolean; pending?: boolean; alreadyActive?: boolean; stopping?: boolean; }
export interface StatusResponse extends BaseResponse {
  active?: boolean;
  pending?: boolean;
  phase?: 'idle' | 'starting' | 'active' | 'stopping';
  state?: AudioState | null;
  protection?: ProtectionMode;
  sampleRate?: number | null;
}
export interface PresetSelectionResponse extends BaseResponse { name?: string; presetSelection?: string; }
export interface MeterResponse extends BaseResponse { active?: boolean; meter?: MeterSnapshot | null; }
export interface SessionStatusResponse extends BaseResponse {
  active?: boolean;
  activeTabs?: number[];
  pendingTabs?: number[];
  state?: AudioState | null;
  protection?: ProtectionMode;
  sampleRate?: number | null;
}

export type ResponseFor<M extends BackgroundMessage> =
  M extends { type: typeof MessageType.StatusGet } ? StatusResponse :
  M extends { type: typeof MessageType.MeterGet } ? MeterResponse :
  M extends { type: typeof MessageType.PresetSelectionGet | typeof MessageType.PresetSelectionSet } ? PresetSelectionResponse :
  M extends { type: typeof MessageType.StateSet } ? BaseResponse & { state?: AudioState; presetSelection?: string } :
  M extends { type: typeof MessageType.ProtectionSet } ? BaseResponse & { protection?: ProtectionMode } :
  CaptureResponse;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function finiteTabId(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0;
}

function validSpectrumMode(value: unknown): value is SpectrumMode {
  return value === 'fast' || value === 'balanced' || value === 'smooth';
}

function validMeterOptions(input: Record<string, unknown>): boolean {
  if (input.spectrum !== undefined && typeof input.spectrum !== 'boolean') return false;
  if (input.levels !== undefined && typeof input.levels !== 'boolean') return false;
  if (input.spectrumMode !== undefined && !validSpectrumMode(input.spectrumMode)) return false;
  return true;
}

export function parseBackgroundMessage(input: unknown): BackgroundMessage | null {
  if (!isRecord(input) || input.target === 'offscreen' || typeof input.type !== 'string') return null;
  if (!finiteTabId(input.tabId)) return null;
  switch (input.type) {
    case MessageType.CaptureStart:
    case MessageType.CaptureStop:
    case MessageType.StatusGet:
    case MessageType.PresetSelectionGet:
      return input as BackgroundMessage;
    case MessageType.StateSet:
      if (!Object.prototype.hasOwnProperty.call(input, 'state')) return null;
      if (input.persist !== undefined && typeof input.persist !== 'boolean') return null;
      return input as BackgroundMessage;
    case MessageType.ProtectionSet:
      if (!Object.prototype.hasOwnProperty.call(input, 'protection')) return null;
      return input as BackgroundMessage;
    case MessageType.PresetSelectionSet:
      if (!Object.prototype.hasOwnProperty.call(input, 'name')) return null;
      return input as BackgroundMessage;
    case MessageType.MeterGet:
      return validMeterOptions(input) ? input as BackgroundMessage : null;
    case MessageType.SessionEnded:
      return Number.isInteger(Number(input.tabId)) ? input as BackgroundMessage : null;
    default:
      return null;
  }
}

export function parseOffscreenMessage(input: unknown): OffscreenMessage | null {
  if (!isRecord(input) || input.target !== 'offscreen' || typeof input.type !== 'string') return null;
  if (!finiteTabId(input.tabId)) return null;
  switch (input.type) {
    case MessageType.CaptureStart:
      if (typeof input.streamId !== 'string' || !input.streamId) return null;
      if (!Number.isInteger(Number(input.tabId))) return null;
      if (!Object.prototype.hasOwnProperty.call(input, 'state')) return null;
      if (!Object.prototype.hasOwnProperty.call(input, 'protection')) return null;
      return input as OffscreenMessage;
    case MessageType.CaptureStop:
      return Number.isInteger(Number(input.tabId)) ? input as OffscreenMessage : null;
    case MessageType.MeterGet:
      return Number.isInteger(Number(input.tabId)) && validMeterOptions(input) ? input as OffscreenMessage : null;
    case MessageType.SessionStatus:
      return input as OffscreenMessage;
    case MessageType.StateSet:
      return Object.prototype.hasOwnProperty.call(input, 'state') ? input as OffscreenMessage : null;
    case MessageType.ProtectionSet:
      return Object.prototype.hasOwnProperty.call(input, 'protection') ? input as OffscreenMessage : null;
    default:
      return null;
  }
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled message: ${JSON.stringify(value)}`);
}
