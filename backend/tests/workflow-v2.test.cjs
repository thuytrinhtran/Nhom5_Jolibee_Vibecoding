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
  assert.equal(calls.length,0);
  await transitionSchedule(id,actor,body,'SUBMIT');assert.equal(calls[0].name,'tv4_transition_schedule_v2');assert.equal(calls[0].args.p_actor_id,id);assert.equal(calls[0].args.p_expected_version,1);
  db.rpc=async()=>({data:null,error:{code:'40001',message:'STALE_SCHEDULE_VERSION'}});
  await assert.rejects(transitionSchedule(id,actor,body,'SUBMIT'),e=>e.status===409&&e.code==='STALE_SCHEDULE_VERSION');
 }finally{db.rpc=original.rpc;for(const [key,value] of Object.entries({TV4_WORKFLOW_PERSISTENCE_ENABLED:original.workflow,TV3_TEST_PREVIEW_ENABLED:original.test,SCHEDULING_DATA_SOURCE:original.source})){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
