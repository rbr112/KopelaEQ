import assert from 'node:assert/strict';
import { detectArtworkMime, MAX_USER_ARTWORK_BYTES } from '../extension/js/popup/appearance/artwork-store.js';

const blob = (bytes, type='') => new Blob([Uint8Array.from(bytes)], { type });
assert.equal(await detectArtworkMime(blob([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])), 'image/png');
assert.equal(await detectArtworkMime(blob([0xff,0xd8,0xff,0xdb])), 'image/jpeg');
assert.equal(await detectArtworkMime(new Blob(['GIF89a\x01\x00'])), 'image/gif');
assert.equal(await detectArtworkMime(new Blob(['RIFFxxxxWEBP'])), 'image/webp');
assert.equal(await detectArtworkMime(new Blob(['<html>not an image</html>'], { type:'image/png' })), null);
assert.equal(MAX_USER_ARTWORK_BYTES, 12 * 1024 * 1024);
console.log('artwork_store.test.mjs: PASS');
