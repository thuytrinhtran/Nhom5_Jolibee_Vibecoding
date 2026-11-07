const {test}=require('node:test');
const assert=require('node:assert/strict');
process.env.NODE_ENV='test';
const {supabaseAdmin}=require('../dist/config/supabase.js');
const {loadProfileDetails,ProfileUnavailable}=require('../dist/utils/profile-details.js');
test('shared profile reader reports related-query failure instead of silently omitting profile',async()=>{
  const original=supabaseAdmin.from;
  try{
    supabaseAdmin.from=()=>({select(){return this;},eq(){return this;},single:async()=>({error:{code:'offline'}}),maybeSingle:async()=>({error:{code:'offline'}})});
    await assert.rejects(loadProfileDetails('fixture','QL','branch'),ProfileUnavailable);
    await assert.rejects(loadProfileDetails('fixture','NV',null),ProfileUnavailable);
  }finally{supabaseAdmin.from=original;}
});
test('concurrent related-profile reads are scoped, shared only while pending and invalidated by writes',async()=>{
 const original=supabaseAdmin.from,{invalidatePendingReads}=require('../dist/services/read-coalescing.js');let reads=0;const pending=[];
 try{
  supabaseAdmin.from=()=>({select(){return this;},eq(){return this;},single(){reads++;return new Promise(resolve=>pending.push(()=>resolve({data:{name:'Branch'},error:null})));}});
  const a=loadProfileDetails('same','QL','branch'),b=loadProfileDetails('same','QL','branch');assert.equal(reads,1);
  const other=loadProfileDetails('other','QL','branch');assert.equal(reads,2);
  invalidatePendingReads();const fresh=loadProfileDetails('same','QL','branch');assert.equal(reads,3);
  pending.splice(0).forEach(done=>done());await Promise.all([a,b,other,fresh]);
  const next=loadProfileDetails('same','QL','branch');assert.equal(reads,4);pending.splice(0).forEach(done=>done());await next;
 }finally{supabaseAdmin.from=original;invalidatePendingReads();}
});
