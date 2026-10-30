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
