const BUILTIN_ARTWORK = new Map<string, string>([
  ['builtin.rice.landscape', 'artwork/rice-landscape.svg'],
  ['builtin.nocturne.night', 'artwork/nocturne-night.svg']
]);

export function resolveArtworkAsset(assetId: string): string | null {
  const path = BUILTIN_ARTWORK.get(assetId);
  if (!path) return null;
  try {
    return chrome.runtime.getURL(path);
  } catch {
    return path;
  }
}
