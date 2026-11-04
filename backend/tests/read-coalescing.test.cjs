const {test}=require('node:test'),assert=require('node:assert/strict');
const {coalesceRead,invalidatePendingReads}=require('../dist/services/read-coalescing.js');
test('same-scope pending reads share one operation, settled data is never cached',async()=>{
 let finish,calls=0;const read=()=>{calls++;return new Promise(r=>finish=r);};const a=coalesceRead('branch/week',read),b=coalesceRead('branch/week',read);assert.equal(calls,1);finish('current');assert.deepEqual(await Promise.all([a,b]),['current','current']);assert.equal(await coalesceRead('branch/week',async()=>{calls++;return'fresh'}),'fresh');assert.equal(calls,2);
});
test('write invalidation isolates reads across mutations and scopes',async()=>{
 let finish;const before=coalesceRead('same',()=>new Promise(r=>finish=r));invalidatePendingReads();assert.equal(await coalesceRead('same',async()=> 'after write'),'after write');assert.equal(await coalesceRead('other branch',async()=> 'other'),'other');finish('before');assert.equal(await before,'before');assert.equal(await coalesceRead('same',async()=> 'newest'),'newest');
});
