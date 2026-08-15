import { STORAGE } from '../shared/constants.js';

const PRELOADED_MEDIA_VERSION = 1;
const RICE_THEME_ID = 'builtin.rice';

function mediaState(value: unknown): Record<string, string> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, string>) } : {};
}

/**
 * Seed only lightweight metadata. The bundled portrait itself stays a normal
 * extension asset and is rendered directly from chrome.runtime.getURL(). This
 * makes it behave like an already-uploaded local artwork without copying or
 * decoding a Blob during install/startup. A real user upload still goes to
 * IndexedDB and takes precedence.
 */
export async function ensurePreloadedUserMedia(freshInstall = false): Promise<void> {
  const stored = await chrome.storage.local.get([STORAGE.PRELOADED_MEDIA_VERSION, STORAGE.MEDIA_HINTS]);
  if (Number(stored[STORAGE.PRELOADED_MEDIA_VERSION] || 0) >= PRELOADED_MEDIA_VERSION) return;

  const hints = mediaState(stored[STORAGE.MEDIA_HINTS]);
  if (!hints[RICE_THEME_ID]) hints[RICE_THEME_ID] = 'preloaded-cover';
  // A truly fresh install cannot have legacy IndexedDB media. Mark empty slots
  // up front so the first popup open does not wake IndexedDB just to prove that.
  if (freshInstall) {
    hints[`${RICE_THEME_ID}::background`] = 'none';
    hints['builtin.nocturne'] = 'none';
    hints['builtin.nocturne::background'] = 'none';
  }
  await chrome.storage.local.set({
    [STORAGE.PRELOADED_MEDIA_VERSION]: PRELOADED_MEDIA_VERSION,
    [STORAGE.MEDIA_HINTS]: hints
  });
}
