import assert from 'node:assert/strict';
import { AppearanceService } from '../extension/js/popup/appearance/appearance-service.js';
import { STORAGE } from '../extension/js/shared/constants.js';

const records={artwork:new Map(),background:new Map()};
let mediaRemovals=0;
class FakeStore {
  constructor(kind){this.kind=kind;}
  async get(themeId){return records[this.kind].get(themeId)||null;}
  async put(themeId,blob,filename,fit){const rec={themeId,blob,filename,mimeType:blob.type||'image/png',size:blob.size,fit,updatedAt:Date.now()};records[this.kind].set(themeId,rec);return rec;}
  async remove(themeId){mediaRemovals+=1;records[this.kind].delete(themeId);}
}
globalThis.__KopelaMediaStoreCtors={
  ArtworkStore:class extends FakeStore{constructor(){super('artwork');}},
  BackgroundStore:class extends FakeStore{constructor(){super('background');}}
};
globalThis.document={documentElement:{dataset:{},classList:{remove(){}},style:{setProperty(){}}}};
globalThis.localStorage={setItem(){},getItem(){return null;}};
const store={
  [STORAGE.APPEARANCE]:{schemaVersion:1,themeId:'builtin.rice',layoutId:'rice'},
  [STORAGE.MEDIA_HINTS]:{'builtin.rice':'preloaded-cover'},
  [STORAGE.CUSTOM_THEMES]:[{schemaVersion:1,id:'user.atomic',name:'Atomic',extends:'builtin.rice',preferredLayout:'rice',tokens:{}}],
  [STORAGE.SURFACE_OVERRIDES]:{}
};
let failNextMediaHint=false;
let failCustomThemeWrite=false;
globalThis.chrome={runtime:{getURL:p=>`chrome-extension://test/${p}`},storage:{local:{
  async get(keys){const list=typeof keys==='string'?[keys]:Array.isArray(keys)?keys:Object.keys(keys||{});const out={};for(const key of list)if(key in store)out[key]=structuredClone(store[key]);return out;},
  async set(values){
    if(failNextMediaHint && STORAGE.MEDIA_HINTS in values){failNextMediaHint=false;throw new Error('simulated hint write crash');}
    if(failCustomThemeWrite && STORAGE.CUSTOM_THEMES in values)throw new Error('simulated registry write failure');
    Object.assign(store,structuredClone(values));
  }
}}};
const png=new Blob([Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])],{type:'image/png'});

// Simulate a crash/failure after IndexedDB Blob commit but before the hint commit.
const service1=new AppearanceService();
await service1.load();
failNextMediaHint=true;
await assert.rejects(()=>service1.setUserArtwork(png,'journal.png','contain'),/simulated hint write crash/);
assert.ok(records.artwork.has('builtin.rice'),'Blob committed before simulated crash');
assert.equal(store[STORAGE.MEDIA_HINTS]['builtin.rice'],'preloaded-cover','old hint must remain until recovery');
assert.equal(store[STORAGE.MEDIA_ARTWORK_JOURNAL]?.operation,'put','journal must survive interrupted operation');

const service2=new AppearanceService();
await service2.load();
assert.equal(store[STORAGE.MEDIA_HINTS]['builtin.rice'],'custom-contain','restart must finish the committed Blob/hint transaction');
assert.equal(store[STORAGE.MEDIA_ARTWORK_JOURNAL],null,'completed recovery must clear journal');

// Simulate the inverse remove crash: Blob deletion commits, hint write fails.
failNextMediaHint=true;
await assert.rejects(()=>service2.removeUserArtwork(),/simulated hint write crash/);
assert.equal(records.artwork.has('builtin.rice'),false);
assert.equal(store[STORAGE.MEDIA_ARTWORK_JOURNAL]?.operation,'remove');
const service3=new AppearanceService();
await service3.load();
assert.equal(store[STORAGE.MEDIA_HINTS]['builtin.rice'],'none','restart must finish an interrupted removal');
assert.equal(store[STORAGE.MEDIA_ARTWORK_JOURNAL],null);

// Custom-theme deletion must commit registry removal before destructive Blob cleanup.
await service3.ensureCustomThemesLoaded();
records.artwork.set('user.atomic',{themeId:'user.atomic',blob:png,filename:'atomic.png',mimeType:'image/png',size:png.size,fit:'cover',updatedAt:1});
records.background.set('user.atomic',{themeId:'user.atomic',blob:png,filename:'atomic-bg.png',mimeType:'image/png',size:png.size,fit:'cover',updatedAt:1});
const removalsBefore=mediaRemovals;
failCustomThemeWrite=true;
await assert.rejects(()=>service3.removeCustomTheme('user.atomic'),/simulated registry write failure/);
assert.equal(service3.isCustomTheme('user.atomic'),true,'failed authoritative registry write must restore in-memory theme');
assert.equal(records.artwork.has('user.atomic'),true,'media must not be deleted before registry commit');
assert.equal(records.background.has('user.atomic'),true);
assert.equal(mediaRemovals,removalsBefore);
failCustomThemeWrite=false;
await service3.removeCustomTheme('user.atomic');
assert.equal(service3.isCustomTheme('user.atomic'),false);
assert.equal(records.artwork.has('user.atomic'),false);
assert.equal(records.background.has('user.atomic'),false);
console.log('appearance_media_journal.test.mjs: PASS');
delete globalThis.__KopelaMediaStoreCtors;
