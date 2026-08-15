import assert from 'node:assert/strict';
import { inspectArtworkBlob, MAX_USER_GIF_FRAMES } from '../extension/js/popup/appearance/artwork-store.js';

function pngHeader(width, height) {
  const b = new Uint8Array(24);
  b.set([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a], 0);
  b.set([0,0,0,13,0x49,0x48,0x44,0x52], 8);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, width, false); dv.setUint32(20, height, false);
  return new Blob([b], { type:'image/png' });
}

assert.deepEqual(await inspectArtworkBlob(pngHeader(1024, 1024)), { mimeType:'image/png', width:1024, height:1024, frames:1 });
await assert.rejects(() => inspectArtworkBlob(pngHeader(5000, 100)), /dimensions are too large/i);

function oversizedGifFrames(count) {
  const chunks = [];
  const header = new Uint8Array(13);
  header.set([...Buffer.from('GIF89a')], 0);
  header[6]=1; header[8]=1; // logical screen 1x1, no global color table
  chunks.push(header);
  for (let i=0;i<count;i++) {
    // image separator + 9-byte descriptor, no local table, then min code size
    // and an empty data sub-block. Enough for the structural frame scanner.
    chunks.push(Uint8Array.from([0x2c,0,0,0,0,1,0,1,0,0, 2, 0]));
  }
  chunks.push(Uint8Array.from([0x3b]));
  return new Blob(chunks, { type:'image/gif' });
}

await assert.rejects(() => inspectArtworkBlob(oversizedGifFrames(MAX_USER_GIF_FRAMES + 1)), /too many frames/i);
console.log('media_limits.test.mjs: PASS');
