const {test}=require('node:test'),assert=require('node:assert/strict');
const {supabaseAdmin:db}=require('../dist/config/supabase.js');
const {readScheduleSourceState}=require('../dist/services/schedule-source-state.js');
test('missing snapshot, unavailable RPC and malformed replies never default to CURRENT',async()=>{
 const original=db.rpc;let calls=0;
 db.rpc=async()=>{calls++;throw Error('must not call for legacy audit');};
 try{
  assert.deepEqual(await readScheduleSourceState('s','b',1,false),{source_state:'UNKNOWN',source_reason:'SOURCE_SNAPSHOT_MISSING'});assert.equal(calls,0);
  db.rpc=async()=>({error:{code:'PGRST202'}});assert.equal((await readScheduleSourceState('s','b',1,true)).source_state,'UNKNOWN');
  db.rpc=async()=>({data:{source_state:'unexpected'}});assert.equal((await readScheduleSourceState('s','b',1,true)).source_state,'UNKNOWN');
  for(const state of ['CURRENT','CHANGED','UNKNOWN']){
   db.rpc=async(name,args)=>{assert.equal(name,'tv4_schedule_source_state');assert.deepEqual(args,{p_schedule_id:'s',p_branch_id:'b',p_expected_version:2});return {data:{source_state:state,source_reason:state==='CURRENT'?null:'reason'}};};
   assert.equal((await readScheduleSourceState('s','b',2,true)).source_state,state);
  }
 }finally{db.rpc=original;}
});
