import assert from 'node:assert/strict';
import { LatestWinsWriter } from '../extension/js/shared/latest-wins.js';

const writes=[];
let persisted=null;
const writer=new LatestWinsWriter(async ({revision,value})=>{
  writes.push(revision);
  if(revision===1) await new Promise(r=>setTimeout(r,55));
  persisted=value;
});

const first=writer.submit({revision:1,value:'old'});
await new Promise(r=>setTimeout(r,5));
const second=writer.submit({revision:2,value:'middle'});
const third=writer.submit({revision:3,value:'new'});
await Promise.all([first,second,third]);
assert.deepEqual(writes,[1,3],'queued intermediate revisions must collapse to the newest snapshot');
assert.equal(persisted,'new');

await writer.submit({revision:2,value:'stale-after-new'});
assert.deepEqual(writes,[1,3],'a stale revision arriving after a newer accepted revision must be ignored');
assert.equal(persisted,'new');
console.log('latest_wins.test.mjs: PASS');
