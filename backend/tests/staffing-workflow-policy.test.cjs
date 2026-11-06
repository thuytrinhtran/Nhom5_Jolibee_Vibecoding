const {test}=require('node:test'),assert=require('node:assert/strict');
process.env.SUPABASE_URL='http://127.0.0.1:9';process.env.SUPABASE_SECRET_KEY='isolated-fixture';
const {workflowWriteAvailability}=require('../dist/services/workflow-write-policy.js');
const {inspectSchedule}=require('../dist/services/schedule-review.service.js');
const {workflowReview,transitionSchedule}=require('../dist/services/schedule-workflow.service.js');
const scheduling=require('../dist/services/scheduling.service.js');
const repositories=require('../dist/repositories/registration-summary.repository.js');
const {supabaseAdmin:db}=require('../dist/config/supabase.js');
function fixture(count){return {source:'supabase',branch:{id:'branch',name:'Branch'},period:{id:'period',branch_id:'branch',work_start_date:'2026-11-09',work_end_date:'2026-11-15',status:'CLOSED'},employees:[0,1,2].map(n=>({id:'e'+n,branch_id:'branch',department_id:'d',full_name:'Employee '+n,skill_level:'NEW',status:'ACTIVE',role:'NV',is_active:true,skills:[],max_weekly_hours:40})),shifts:[{id:'s',name:'Morning',start_time:'08:00',end_time:'12:00',is_active:true}],departments:[{id:'d',name:'Kitchen'}],requirements:[{id:'r',department_id:'d',work_date:'2026-11-09',shift_id:'s',required_count:count,required_skill_name:null}],registrations:[0,1,2].map(n=>({employee_id:'e'+n,work_date:'2026-11-09',shift_id:'s',status:'VALID',period_id:'period'})),existing:[],new_employee_count_threshold:null};}
const id='00000000-0000-4000-8000-000000000001',request_id='00000000-0000-4000-8000-000000000002';
test('under/full/over staffing and experience remain warnings through inspection, review and the real RPC boundary',async()=>{
 const old={...process.env},original={read:scheduling.readDraft,repository:repositories.registrationSummaryRepository,rpc:db.rpc};
 Object.assign(process.env,{NODE_ENV:'test',SCHEDULING_DATA_SOURCE:'supabase',TV3_TEST_PREVIEW_ENABLED:'false',TV4_WORKFLOW_PERSISTENCE_ENABLED:'true',TV3_WRITE_SCOPE_ENABLED:'false'});delete process.env.TV3_WRITE_SCOPE_MODE;
 let data,saved,calls=0;
 scheduling.readDraft=async()=>saved;
 repositories.registrationSummaryRepository=()=>({source:'supabase',load:async()=>data,listPeriods:async()=>[{id:'period',schedules:[saved.schedule]}]});
 db.rpc=async(name,args)=>{calls++;assert.equal(name,'tv4_transition_schedule_v2');assert.equal(args.p_expected_version,5);assert.ok(!('can_submit' in args));return{data:{reused:false,schedule:{...saved.schedule,status:args.p_action==='SUBMIT'?'PENDING_APPROVAL':'APPROVED'}},error:null};};
 try{
  for(const [required,assigned,warning] of [[3,1,'STAFFING_SHORTAGE'],[2,2,null],[1,3,'STAFFING_EXCESS']]){
   data=fixture(required);saved={schedule:{id,version:5,status:'DRAFT',branch_id:'branch',period_id:'period',schedule_group_id:'group',created_by:'manager',created_at:'2026-11-06T00:00:00Z'},assignments:data.employees.slice(0,assigned).map(e=>({id:e.id,employee_id:e.id,work_date:'2026-11-09',shift_id:'s',department_id:'d',status:'DRAFT',assignment_source:'REGULAR'})),generation_snapshot:{coverage:[]}};
   const checked=await inspectSchedule(id,'branch',5);assert.equal(checked.validation.can_submit,true);assert.equal(checked.validation.hard_constraints,'PASS');assert.equal(checked.validation.issues.length,0);assert.ok(checked.validation.warnings.some(w=>w.code==='EXPERIENCE_SHORTAGE'));if(warning)assert.ok(checked.validation.warnings.some(w=>w.code===warning));
   assert.equal((await workflowReview(id,'branch',5)).ready,true);
   assert.equal((await transitionSchedule(id,{id:'manager',role:'QL',branch_id:'branch'},{expected_version:5,request_id},'SUBMIT')).schedule.status,'PENDING_APPROVAL');
   assert.equal((await transitionSchedule(id,{id:'supervisor',role:'GS'},{expected_version:5,request_id},'APPROVED')).schedule.status,'APPROVED');
  }
  assert.equal(calls,6);
  db.rpc=async()=>({data:null,error:{code:'PGRST202',message:'function missing'}});
  await assert.rejects(transitionSchedule(id,{id:'manager',role:'QL'},{expected_version:5,request_id},'SUBMIT'),e=>e.status===503&&e.code==='WORKFLOW_UNAVAILABLE');
  db.rpc=async()=>({data:null,error:{code:'P0001',message:'HARD_CONSTRAINT_FAILED'}});
  await assert.rejects(transitionSchedule(id,{id:'manager',role:'QL'},{expected_version:5,request_id},'SUBMIT'),e=>e.code==='HARD_CONSTRAINT_FAILED');
  saved.assignments.push({...saved.assignments[0]});assert.equal((await inspectSchedule(id,'branch',5)).validation.can_submit,false);
 }finally{scheduling.readDraft=original.read;repositories.registrationSummaryRepository=original.repository;db.rpc=original.rpc;for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old);}
});
test('availability explains disabled flag, test-preview, mock and write-scope without changing configuration',()=>{
 const old={...process.env};
 try{
  delete process.env.TV3_WRITE_SCOPE_MODE;Object.assign(process.env,{TV3_TEST_PREVIEW_ENABLED:'false',TV4_WORKFLOW_PERSISTENCE_ENABLED:'false',TV3_WRITE_SCOPE_ENABLED:'false'});
  assert.equal(workflowWriteAvailability('p','b','supabase').code,'WORKFLOW_PERSISTENCE_DISABLED');assert.match(workflowWriteAvailability('p','b','supabase').message,/TV4_WORKFLOW_PERSISTENCE_ENABLED/);
  process.env.TV4_WORKFLOW_PERSISTENCE_ENABLED='true';process.env.TV3_TEST_PREVIEW_ENABLED='true';assert.equal(workflowWriteAvailability('p','b','supabase').code,'TEST_PREVIEW_READ_ONLY');
  process.env.TV3_TEST_PREVIEW_ENABLED='false';assert.equal(workflowWriteAvailability('p','b','mock').code,'MOCK_READ_ONLY');
  process.env.TV3_WRITE_SCOPE_ENABLED='true';assert.equal(workflowWriteAvailability('p','b','supabase').code,'WORKFLOW_SCOPE_FORBIDDEN');assert.equal(process.env.TV3_WRITE_SCOPE_ENABLED,'true');
 }finally{for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old);}
});
