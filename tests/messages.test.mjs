import assert from 'node:assert/strict';
import { MessageType, parseBackgroundMessage, parseOffscreenMessage } from '../extension/js/shared/index.js';
const valid = parseBackgroundMessage({type:MessageType.StateSet,tabId:7,state:{gainDb:1},persist:false,presetSelection:'Vivid (111)'});
assert.equal(valid.type,MessageType.StateSet); assert.equal(valid.tabId,7); assert.equal(valid.persist,false);
assert.equal(parseBackgroundMessage({type:'STATE_SEТ',tabId:7}),null); // Cyrillic T
assert.equal(parseBackgroundMessage({type:MessageType.CaptureStart,tabId:'bad'}),null);
assert.equal(parseBackgroundMessage(null),null);
assert.equal(parseBackgroundMessage({type:MessageType.MeterGet,tabId:7,spectrum:true,spectrumMode:'fast'}).spectrumMode,'fast');
assert.equal(parseBackgroundMessage({type:MessageType.MeterGet,tabId:7,spectrumMode:'warp'}),null);
assert.equal(parseBackgroundMessage({type:MessageType.MeterGet,tabId:7,spectrum:'yes'}),null);
assert.equal(parseBackgroundMessage({type:MessageType.MeterGet,tabId:7,levels:'yes'}),null);
assert.equal(parseOffscreenMessage({target:'offscreen',type:MessageType.CaptureStart,tabId:1,streamId:'x',state:{},protection:'off'}).streamId,'x');
assert.equal(parseOffscreenMessage({target:'offscreen',type:MessageType.CaptureStart,tabId:1,streamId:''}),null);
assert.equal(parseOffscreenMessage({target:'offscreen',type:MessageType.MeterGet,tabId:1,spectrum:true,spectrumMode:'smooth'}).spectrumMode,'smooth');
assert.equal(parseOffscreenMessage({target:'offscreen',type:MessageType.MeterGet,tabId:1,spectrumMode:'warp'}),null);
assert.equal(parseOffscreenMessage({target:'other',type:MessageType.SessionStatus,tabId:1}),null);
assert.equal(parseBackgroundMessage({type:MessageType.StateSet,tabId:7,state:{},persist:'no'}),null);
assert.equal(parseOffscreenMessage({target:'offscreen',type:MessageType.CaptureStart,tabId:1,streamId:'x'}),null);
assert.equal(parseOffscreenMessage({target:'offscreen',type:MessageType.StateSet,tabId:1}),null);
assert.equal(parseOffscreenMessage({target:'offscreen',type:MessageType.ProtectionSet}),null);

console.log('messages.test.mjs: PASS');
