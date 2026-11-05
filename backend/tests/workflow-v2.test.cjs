const {test}=require('node:test'),assert=require('node:assert/strict');
process.env.NODE_ENV='test';
const {supabaseAdmin:db}=require('../dist/config/supabase.js');
const {transitionSchedule,workflowEnabled}=require('../dist/services/schedule-workflow.service.js');
const id='00000000-0000-4000-8000-000000000001',request_id='00000000-0000-4000-8000-000000000002';
test('workflow is opt-in, test-preview read-only, rejects forged fields and passes only authenticated identity to RPC',async()=>{
 const original={rpc:db.rpc,workflow:process.env.TV4_WORKFLOW_PERSISTENCE_ENABLED,test:process.env.TV3_TEST_PREVIEW_ENABLED,source:process.env.SCHEDULING_DATA_SOURCE};
 const actor={id,role:'QL',branch_id:'branch'};let calls=[];
 db.rpc=async(name,args)=>{calls.push({name,args});return{data:{schedule:{id,status:'PENDING_APPROVAL',version:1}},error:null}};
 try{
  delete process.env.TV4_WORKFLOW_PERSISTENCE_ENABLED;delete process.env.TV3_TEST_PREVIEW_ENABLED;process.env.SCHEDULING_DATA_SOURCE='supabase';
  assert.equal(workflowEnabled(),false);
  const body={request_id,expected_version:1,note:'Checked'};
  await assert.rejects(transitionSchedule(id,actor,body,'SUBMIT'),e=>e.code==='WORKFLOW_PERSISTENCE_DISABLED');assert.equal(calls.length,0);
  process.env.TV4_WORKFLOW_PERSISTENCE_ENABLED='true';process.env.TV3_TEST_PREVIEW_ENABLED='true';
  await assert.rejects(transitionSchedule(id,actor,body,'SUBMIT'),e=>e.code==='TEST_PREVIEW_READ_ONLY');
  delete process.env.TV3_TEST_PREVIEW_ENABLED;
  for(const invalid of [{...body,actor_id:'forged'},{...body,test_mode:true},{...body,expected_version:'1'},{...body,request_id:'bad'}])await assert.rejects(transitionSchedule(id,actor,invalid,'SUBMIT'),e=>e.status===400);
  await assert.rejects(transitionSchedule(id,{...actor,role:'NV'},body,'SUBMIT'),e=>e.status===403);
  // Expired deadlines are checked atomically after receipt replay in SQL.
  for(const feedback_deadline_at of ['','invalid'])await assert.rejects(transitionSchedule(id,actor,{expected_version:1,request_id,feedback_deadline_at},'PUBLISH'),e=>e.code==='INVALID_FEEDBACK_DEADLINE');
  assert.equal(calls.length,0);
  await transitionSchedule(id,actor,body,'SUBMIT');assert.equal(calls[0].name,'tv4_transition_schedule_v2');assert.equal(calls[0].args.p_actor_id,id);assert.equal(calls[0].args.p_expected_version,1);
  db.rpc=async()=>({data:null,error:{code:'40001',message:'STALE_SCHEDULE_VERSION'}});
  await assert.rejects(transitionSchedule(id,actor,body,'SUBMIT'),e=>e.status===409&&e.code==='STALE_SCHEDULE_VERSION');
 }finally{db.rpc=original.rpc;for(const [key,value] of Object.entries({TV4_WORKFLOW_PERSISTENCE_ENABLED:original.workflow,TV3_TEST_PREVIEW_ENABLED:original.test,SCHEDULING_DATA_SOURCE:original.source})){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test('scoped workflow resolves the stored schedule period and never calls writers outside the approved scope',async()=>{
 const saved={...process.env},original={from:db.from,rpc:db.rpc};let calls=0,target;
 Object.assign(process.env,{NODE_ENV:'development',SCHEDULING_DATA_SOURCE:'supabase',TV4_WORKFLOW_PERSISTENCE_ENABLED:'true',TV3_TEST_PREVIEW_ENABLED:'false',TV3_WRITE_SCOPE_ENABLED:'true',TV3_WRITE_PROJECT_REF:'wlbpprpiieonjrqglicv',SUPABASE_URL:'https://wlbpprpiieonjrqglicv.supabase.co',TV3_WRITE_BRANCH_ID:'11111111-1111-1111-1111-111111111111',TV3_WRITE_PERIOD_ID:'79a979cc-8347-48b5-a411-f03bd8aceb92'});
 db.from=table=>{assert.equal(table,'schedules');const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:target,error:null})};return q;};
 db.rpc=async()=>{calls++;return{data:{schedule:{id}},error:null}};
 try{
  const body={expected_version:1,request_id},actor={id,role:'QL'};
  for(const row of [{period_id:'other',branch_id:process.env.TV3_WRITE_BRANCH_ID},{period_id:process.env.TV3_WRITE_PERIOD_ID,branch_id:'other'}]){target=row;await assert.rejects(transitionSchedule(id,actor,body,'SUBMIT'),e=>e.code==='WORKFLOW_SCOPE_FORBIDDEN');}
  assert.equal(calls,0);target=null;await assert.rejects(transitionSchedule(id,actor,body,'SUBMIT'),e=>e.code==='SCHEDULE_NOT_FOUND');
  target={period_id:process.env.TV3_WRITE_PERIOD_ID,branch_id:process.env.TV3_WRITE_BRANCH_ID};await transitionSchedule(id,actor,body,'SUBMIT');assert.equal(calls,1);
 }finally{Object.assign(db,original);for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
