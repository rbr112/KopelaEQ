import assert from 'node:assert/strict';
import { AppearanceService } from '../extension/js/popup/appearance/appearance-service.js';
import { STORAGE } from '../extension/js/shared/constants.js';

const records = { artwork:new Map(), background:new Map() };
const calls = { artworkSetFit:0, backgroundSetFit:0 };
class FakeStore {
  constructor(kind){ this.kind=kind; }
  async get(themeId){ return records[this.kind].get(themeId) || null; }
  async put(themeId, blob, filename, fit){
    await new Promise((resolve)=>setTimeout(resolve, 35));
    const rec={themeId,blob,filename,mimeType:'image/png',size:blob.size,fit,updatedAt:Date.now()};
    records[this.kind].set(themeId,rec); return rec;
  }
  async setFit(themeId, fit){ calls[this.kind === 'artwork' ? 'artworkSetFit' : 'backgroundSetFit'] += 1; const rec=await this.get(themeId); if(!rec)return null; const next={...rec,fit}; records[this.kind].set(themeId,next); return next; }
  async remove(themeId){ records[this.kind].delete(themeId); }
}
globalThis.__KopelaMediaStoreCtors = {
  ArtworkStore: class extends FakeStore { constructor(){ super('artwork'); } },
  BackgroundStore: class extends FakeStore { constructor(){ super('background'); } }
};
const store={ [STORAGE.APPEARANCE]:{schemaVersion:1,themeId:'builtin.rice',layoutId:'rice'}, [STORAGE.MEDIA_HINTS]:{'builtin.rice':'preloaded-cover','builtin.rice::background':'none'} };
globalThis.document={documentElement:{dataset:{},classList:{remove(){}},style:{setProperty(){}}}};
globalThis.localStorage={setItem(){},getItem(){return null;}};
globalThis.chrome={runtime:{getURL:(p)=>`chrome-extension://test/${p}`},storage:{local:{async get(keys){const out={};for(const k of (typeof keys==='string'?[keys]:keys))if(k in store)out[k]=structuredClone(store[k]);return out;},async set(v){Object.assign(store,structuredClone(v));}}}};

const service=new AppearanceService();
await service.load();
const png=new Blob([Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])],{type:'image/png'});
const upload=service.setUserArtwork(png,'rice.png','cover');
await service.set('builtin.nocturne','nocturne');
await upload;
assert.ok(records.artwork.has('builtin.rice'), 'upload must stay attached to theme active when operation started');
assert.equal(records.artwork.has('builtin.nocturne'), false, 'theme switch must not retarget an in-flight upload');
assert.equal(service.currentState.themeId,'builtin.nocturne');
assert.equal(service.currentUserArtwork,null, 'completed old-theme upload must not install into current theme UI');

const bgUpload=service.setUserBackground(png,'night.png','contain');
await service.set('builtin.rice','rice');
await bgUpload;
assert.ok(records.background.has('builtin.nocturne'), 'background upload must keep original theme id');
assert.equal(records.background.has('builtin.rice'), false);



// Fit is metadata-only now: changing Cover/Contain must not rewrite a potentially
// 12 MB Blob through IndexedDB.
await service.set('builtin.rice','rice');
await service.setUserArtwork(png,'fresh.png','cover');
await service.setUserArtworkFit('contain');
assert.equal(calls.artworkSetFit, 0, 'artwork fit should be persisted in lightweight media hints');
assert.equal(store[STORAGE.MEDIA_HINTS]['builtin.rice'], 'custom-contain');
await service.setUserBackground(png,'fresh-bg.png','cover');
await service.setUserBackgroundFit('contain');
assert.equal(calls.backgroundSetFit, 0, 'background fit should be persisted in lightweight media hints');
assert.equal(store[STORAGE.MEDIA_HINTS]['builtin.rice::background'], 'custom-contain');

delete globalThis.__KopelaMediaStoreCtors;
console.log('appearance_media_race.test.mjs: PASS');
