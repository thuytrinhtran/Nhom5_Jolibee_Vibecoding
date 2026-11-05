const {test}=require('node:test'),assert=require('node:assert/strict');
process.env.DEV_IMPORT_ENABLED='false';
const {supabaseAdmin:db}=require('../dist/config/supabase.js');
const {transitionSchedule}=require('../dist/services/schedule-workflow.service.js');
test('publication replay reaches atomic receipt recovery after deadline; new expired requests still fail',async()=>{
 const env={...process.env},original={from:db.from,rpc:db.rpc};
 Object.assign(process.env,{NODE_ENV:'development',SCHEDULING_DATA_SOURCE:'supabase',TV4_WORKFLOW_PERSISTENCE_ENABLED:'true',TV3_TEST_PREVIEW_ENABLED:'false',TV3_WRITE_SCOPE_ENABLED:'true',TV3_WRITE_PROJECT_REF:'wlbpprpiieonjrqglicv',SUPABASE_URL:'https://wlbpprpiieonjrqglicv.supabase.co',TV3_WRITE_BRANCH_ID:'11111111-1111-1111-1111-111111111111',TV3_WRITE_PERIOD_ID:'79a979cc-8347-48b5-a411-f03bd8aceb92'});
 const id='00000000-0000-4000-8000-000000000001',request='00000000-0000-4000-8000-000000000002';let calls=0;
 let receipt;
 db.from=table=>{assert.ok(['schedules','audit_logs'].includes(table));let requested;const q={select:()=>q,eq:(key,value)=>{if(key==='new_data->>request_id')requested=value;return q;},maybeSingle:async()=>({data:table==='schedules'?{id,period_id:process.env.TV3_WRITE_PERIOD_ID,branch_id:process.env.TV3_WRITE_BRANCH_ID}:requested===request?receipt:null})};return q;};
 db.rpc=async(name,args)=>{calls++;assert.equal(name,'tv4_transition_schedule_v2');assert.equal(args.p_action,'PUBLISH');return args.p_request_id===request?{data:{reused:true,schedule:{id,status:'PUBLISHED',version:1}}}:{error:{code:'P0001',message:'INVALID_FEEDBACK_DEADLINE'}};};
 try{
  const actor={id,role:'QL',branch_id:process.env.TV3_WRITE_BRANCH_ID},body={expected_version:1,request_id:request,feedback_deadline_at:new Date(Date.now()-60000).toISOString()};
  receipt={actor_id:id,new_data:{workflow_request:{schedule_id:id,version:1,action:'PUBLISH',reason:null,feedback_deadline_at:body.feedback_deadline_at}}};
  assert.equal((await transitionSchedule(id,actor,body,'PUBLISH')).reused,true);
  await assert.rejects(transitionSchedule(id,actor,{...body,request_id:'00000000-0000-4000-8000-000000000003'},'PUBLISH'),e=>e.code==='INVALID_FEEDBACK_DEADLINE'&&e.status===400);
  for(const feedback_deadline_at of ['invalid',''])await assert.rejects(transitionSchedule(id,actor,{...body,feedback_deadline_at},'PUBLISH'),e=>e.code==='INVALID_FEEDBACK_DEADLINE');
  await assert.rejects(transitionSchedule(id,{...actor,role:'NV'},body,'PUBLISH'),e=>e.code==='FORBIDDEN');
  await assert.rejects(transitionSchedule(id,actor,{...body,feedback_deadline_at:new Date(Date.now()-120000).toISOString()},'PUBLISH'),e=>e.code==='REQUEST_CONFLICT');assert.equal(calls,1);
 }finally{Object.assign(db,original);for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
