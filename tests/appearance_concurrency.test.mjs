import assert from 'node:assert/strict';
import { AppearanceService } from '../extension/js/popup/appearance/appearance-service.js';
import { STORAGE } from '../extension/js/shared/constants.js';

const delay=(ms)=>new Promise(r=>setTimeout(r,ms));
const store={
  [STORAGE.APPEARANCE]:{schemaVersion:1,themeId:'builtin.rice',layoutId:'rice'},
  [STORAGE.MEDIA_HINTS]:{}
};
let appearanceWrites=0;
globalThis.document={documentElement:{dataset:{},classList:{remove(){}},style:{setProperty(){}}}};
globalThis.localStorage={setItem(){},getItem(){return null;}};
globalThis.chrome={runtime:{getURL:p=>`chrome-extension://test/${p}`},storage:{local:{
  async get(keys){const list=typeof keys==='string'?[keys]:keys;const out={};for(const k of list||[])if(k in store)out[k]=structuredClone(store[k]);return out;},
  async set(values){
    if(STORAGE.APPEARANCE in values){appearanceWrites+=1;if(values[STORAGE.APPEARANCE].themeId==='builtin.nocturne')await delay(70);}
    Object.assign(store,structuredClone(values));
  }
}}};
const service=new AppearanceService();
await service.load();
appearanceWrites=0;
const nocturne=service.set('builtin.nocturne','nocturne');
await delay(3);
const rice=service.set('builtin.rice','rice');
await Promise.all([nocturne,rice]);
assert.equal(service.currentState.themeId,'builtin.rice');
assert.equal(store[STORAGE.APPEARANCE].themeId,'builtin.rice','slow older appearance write must not win after a newer selection');
assert.equal(store[STORAGE.APPEARANCE].layoutId,'rice');
assert.equal(appearanceWrites,2);
console.log('appearance_concurrency.test.mjs: PASS');
