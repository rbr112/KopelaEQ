import { ARTWORK_STORE_NAME, BACKGROUND_STORE_NAME, openAppearanceDb, requestResult, transactionDone, type StoredImageFit, type StoredImageMime, type StoredImageRecord } from '../../shared/appearance-media-db.js';

export type UserArtworkFit = StoredImageFit;
export type UserArtworkRecord = StoredImageRecord;
export interface UserArtworkInfo extends Omit<UserArtworkRecord, 'blob'> {}

export const MAX_USER_ARTWORK_BYTES = 12 * 1024 * 1024;
export const MAX_USER_IMAGE_WIDTH = 4096;
export const MAX_USER_IMAGE_HEIGHT = 4096;
export const MAX_USER_IMAGE_PIXELS = 16 * 1024 * 1024;
export const MAX_USER_GIF_FRAMES = 400;
export const USER_ARTWORK_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const);

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function u16le(bytes: Uint8Array, offset: number): number { return bytes[offset] | (bytes[offset + 1] << 8); }
function u16be(bytes: Uint8Array, offset: number): number { return (bytes[offset] << 8) | bytes[offset + 1]; }
function u24le(bytes: Uint8Array, offset: number): number { return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16); }
function u32be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function detectMimeFromBytes(bytes: Uint8Array): StoredImageMime | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG' && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a')) return 'image/gif';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
  return null;
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let pos = 2;
  const sof = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
  while (pos + 4 <= bytes.length) {
    while (pos < bytes.length && bytes[pos] !== 0xff) pos += 1;
    while (pos < bytes.length && bytes[pos] === 0xff) pos += 1;
    if (pos >= bytes.length) break;
    const marker = bytes[pos++];
    if (marker === 0xd8 || marker === 0x01) continue;
    if (marker === 0xd9 || marker === 0xda) break;
    if (pos + 2 > bytes.length) break;
    const length = u16be(bytes, pos);
    if (length < 2 || pos + length > bytes.length) break;
    if (sof.has(marker) && length >= 7) {
      return { height: u16be(bytes, pos + 3), width: u16be(bytes, pos + 5) };
    }
    pos += length;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30) return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8X') return { width: 1 + u24le(bytes, 24), height: 1 + u24le(bytes, 27) };
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const b1 = bytes[21], b2 = bytes[22], b3 = bytes[23], b4 = bytes[24];
    return {
      width: 1 + (b1 | ((b2 & 0x3f) << 8)),
      height: 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10))
    };
  }
  if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
  }
  return null;
}

function skipGifSubBlocks(bytes: Uint8Array, start: number): number {
  let pos = start;
  while (pos < bytes.length) {
    const size = bytes[pos++];
    if (size === 0) return pos;
    pos += size;
    if (pos > bytes.length) return bytes.length;
  }
  return pos;
}

function gifFrameCount(bytes: Uint8Array): number {
  if (bytes.length < 13) return 0;
  let pos = 13;
  const globalPacked = bytes[10];
  if (globalPacked & 0x80) pos += 3 * (1 << ((globalPacked & 0x07) + 1));
  let frames = 0;
  while (pos < bytes.length) {
    const block = bytes[pos++];
    if (block === 0x3b) break;
    if (block === 0x21) {
      if (pos >= bytes.length) break;
      pos += 1; // extension label
      pos = skipGifSubBlocks(bytes, pos);
      continue;
    }
    if (block === 0x2c) {
      frames += 1;
      if (frames > MAX_USER_GIF_FRAMES) return frames;
      if (pos + 9 > bytes.length) break;
      const packed = bytes[pos + 8];
      pos += 9;
      if (packed & 0x80) pos += 3 * (1 << ((packed & 0x07) + 1));
      if (pos >= bytes.length) break;
      pos += 1; // LZW minimum code size
      pos = skipGifSubBlocks(bytes, pos);
      continue;
    }
    break;
  }
  return frames;
}

export interface ArtworkProbe {
  mimeType: StoredImageMime;
  width: number;
  height: number;
  frames: number;
}

export async function inspectArtworkBlob(blob: Blob): Promise<ArtworkProbe> {
  if (blob.size <= 0) throw new Error('Image file is empty.');
  if (blob.size > MAX_USER_ARTWORK_BYTES) throw new Error(`Image is too large. Maximum is ${Math.round(MAX_USER_ARTWORK_BYTES / 1024 / 1024)} MB.`);
  // This happens only on an explicit upload. Reading at most 12 MB once is much
  // safer than asking the renderer/GPU to decode an unbounded-dimension image.
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mimeType = detectMimeFromBytes(bytes);
  if (!mimeType) throw new Error('Unsupported image. Use PNG, JPG, WebP or GIF.');

  let dimensions: { width: number; height: number } | null = null;
  let frames = 1;
  if (mimeType === 'image/png') {
    if (bytes.length >= 24 && ascii(bytes, 12, 4) === 'IHDR') dimensions = { width: u32be(bytes, 16), height: u32be(bytes, 20) };
  } else if (mimeType === 'image/gif') {
    if (bytes.length >= 10) dimensions = { width: u16le(bytes, 6), height: u16le(bytes, 8) };
    frames = gifFrameCount(bytes);
  } else if (mimeType === 'image/jpeg') dimensions = jpegDimensions(bytes);
  else dimensions = webpDimensions(bytes);

  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) throw new Error('Could not read image dimensions.');
  const { width, height } = dimensions;
  if (width > MAX_USER_IMAGE_WIDTH || height > MAX_USER_IMAGE_HEIGHT || width * height > MAX_USER_IMAGE_PIXELS) {
    throw new Error(`Image dimensions are too large. Maximum is ${MAX_USER_IMAGE_WIDTH}×${MAX_USER_IMAGE_HEIGHT} and ${Math.round(MAX_USER_IMAGE_PIXELS / 1024 / 1024)} megapixels.`);
  }
  if (mimeType === 'image/gif' && frames > MAX_USER_GIF_FRAMES) throw new Error(`Animated GIF has too many frames. Maximum is ${MAX_USER_GIF_FRAMES}.`);
  return { mimeType, width, height, frames };
}

export async function detectArtworkMime(blob: Blob): Promise<StoredImageMime | null> {
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  return detectMimeFromBytes(head);
}

class LocalImageStore {
  constructor(private readonly storeName: string) {}

  async get(themeId: string): Promise<UserArtworkRecord | null> {
    const db = await openAppearanceDb();
    const tx = db.transaction(this.storeName, 'readonly');
    const value = await requestResult(tx.objectStore(this.storeName).get(themeId)) as UserArtworkRecord | undefined;
    return value && value.blob instanceof Blob ? value : null;
  }

  async put(themeId: string, blob: Blob, filename: string, fit: UserArtworkFit): Promise<UserArtworkRecord> {
    const probe = await inspectArtworkBlob(blob);
    const record: UserArtworkRecord = {
      themeId,
      blob: blob.slice(0, blob.size, probe.mimeType),
      filename: String(filename || 'image').slice(0, 160),
      mimeType: probe.mimeType,
      size: blob.size,
      fit: fit === 'contain' ? 'contain' : 'cover',
      updatedAt: Date.now()
    };
    const db = await openAppearanceDb();
    const tx = db.transaction(this.storeName, 'readwrite');
    const done = transactionDone(tx);
    await requestResult(tx.objectStore(this.storeName).put(record));
    await done;
    return record;
  }

  async remove(themeId: string): Promise<void> {
    const db = await openAppearanceDb();
    const tx = db.transaction(this.storeName, 'readwrite');
    const done = transactionDone(tx);
    await requestResult(tx.objectStore(this.storeName).delete(themeId));
    await done;
  }
}

export class ArtworkStore extends LocalImageStore { constructor() { super(ARTWORK_STORE_NAME); } }
export class BackgroundStore extends LocalImageStore { constructor() { super(BACKGROUND_STORE_NAME); } }
