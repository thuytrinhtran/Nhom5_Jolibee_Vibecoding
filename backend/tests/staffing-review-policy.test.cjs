const {test}=require('node:test'),assert=require('node:assert/strict');
process.env.NODE_ENV='test';process.env.SUPABASE_URL='http://127.0.0.1:9';process.env.SUPABASE_SECRET_KEY='isolated-test-placeholder';
const {supabaseAdmin:db}=require('../dist/config/supabase.js');
const repositories=require('../dist/repositories/registration-summary.repository.js');
const {validateSchedule,prepareApprovalHandoff}=require('../dist/services/schedule-review.service.js');
const {workflowReview,transitionSchedule}=require('../dist/services/schedule-workflow.service.js');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const branch=id(1),period=id(2),schedule=id(3),actor=id(4),department=id(5),shift=id(6),day='2026-11-09';
const assignment=employee_id=>({id:id(100+Number(employee_id.slice(-2))),employee_id,work_date:day,shift_id:shift,department_id:department,status:'DRAFT',assignment_source:'REGULAR'});

async function fixture({required=2,eligible=2,assigned=2}={},run){
 const old={from:db.from,rpc:db.rpc,repository:repositories.registrationSummaryRepository};
 const snapshot={source:'supabase',branch:{id:branch,name:'Synthetic branch'},period:{id:period,branch_id:branch,work_start_date:day,work_end_date:'2026-11-15',status:'CLOSED'},
  departments:[{id:department,name:'Kitchen'}],shifts:[{id:shift,name:'Morning',start_time:'08:00:00',end_time:'12:00:00',is_active:true,branch_id:branch}],
  employees:Array.from({length:eligible},(_,i)=>({id:id(20+i),full_name:'Synthetic '+i,branch_id:branch,department_id:department,skill_level:'REGULAR',status:'ACTIVE',is_active:true,role:'NV',skills:[],max_weekly_hours:40})),
  requirements:[{id:id(7),work_date:day,shift_id:shift,department_id:department,required_count:required,required_skill_name:null}],existing:[],new_employee_count_threshold:null};
 snapshot.registrations=snapshot.employees.map((e,i)=>({id:id(40+i),period_id:period,employee_id:e.id,work_date:day,shift_id:shift,status:'VALID'}));
 const saved={id:schedule,period_id:period,branch_id:branch,status:'DRAFT',version:1,schedule_group_id:id(8),created_by:actor,created_at:'2026-11-06T00:00:00Z'};
 const state={snapshot,saved,assignments:snapshot.employees.slice(0,assigned).map(e=>assignment(e.id))};
 snapshot.existing=structuredClone(state.assignments);
 repositories.registrationSummaryRepository=()=>({source:'supabase',load:async()=>structuredClone(snapshot),listPeriods:async()=>[{...snapshot.period,schedules:[{...saved}]}]});
 db.rpc=()=>assert.fail('Review/preparation must never execute an RPC');
 db.from=table=>{const q={select(){return q},eq(){return q},order(){return q},limit(){return q},maybeSingle:async()=>({data:table==='schedules'?{...saved}:null,error:null}),
  then(resolve,reject){return Promise.resolve({data:table==='shift_assignments'?structuredClone(state.assignments):[],error:null}).then(resolve,reject);}};return q;};
 try{await run(state);}finally{db.from=old.from;db.rpc=old.rpc;repositories.registrationSummaryRepository=old.repository;}
}

for(const [name,required,eligible,assigned,complete,warning] of [
 ['shortage',2,1,1,false,'STAFFING_SHORTAGE'],['balanced',2,2,2,true,null],['surplus candidates',1,3,1,true,'CANDIDATE_SURPLUS'],
])test(name+' can prepare and review a valid saved DRAFT without bypassing hard rules',()=>fixture({required,eligible,assigned},async()=>{
 const v=await validateSchedule(schedule,branch,1);
 assert.equal(v.hard_constraints,'PASS');assert.equal(v.data_complete,true);assert.equal(v.coverage_complete,complete);assert.equal(v.can_submit,true);
 assert.equal(v.issues.length,0);if(warning)assert.ok(v.warnings.some(w=>w.code===warning));
 const prepared=await prepareApprovalHandoff(schedule,branch,actor,{expected_version:1});
 assert.equal(prepared.payload.schedule_id,schedule);assert.equal(prepared.payload.validation.can_submit,true);assert.equal(prepared.delivery.sent,false);
 const reviewed=await workflowReview(schedule,branch,1);assert.equal(reviewed.ready,true);assert.equal(reviewed.validation.coverage_complete,complete);
}));

test('experience shortages remain visible warnings while submission is allowed',()=>fixture({},async s=>{
 s.snapshot.employees.forEach(e=>{e.skill_level='NEW';});
 const v=await validateSchedule(schedule,branch,1);assert.equal(v.can_submit,true);assert.ok(v.warnings.some(w=>w.code==='EXPERIENCE_SHORTAGE'));
}));

test('actual assignments above declared demand are hard failures, not surplus-candidate warnings',()=>fixture({required:1,eligible:2,assigned:2},async()=>{
 const v=await validateSchedule(schedule,branch,1);assert.equal(v.hard_constraints,'FAIL');assert.equal(v.can_submit,false);assert.ok(v.issues.some(i=>i.code==='DEMAND_EXCEEDED'));
 assert.equal((await prepareApprovalHandoff(schedule,branch,actor,{expected_version:1})).payload,null);
}));

test('existing coverage above demand cannot be presented as a valid shortage-policy exception',()=>fixture({required:1,eligible:3,assigned:0},async s=>{
 s.snapshot.existing=s.snapshot.employees.map(e=>assignment(e.id));
 const v=await validateSchedule(schedule,branch,1);assert.equal(v.hard_constraints,'FAIL');assert.equal(v.can_submit,false);assert.ok(v.issues.some(i=>i.code==='DEMAND_EXCEEDED'));
}));

for(const [name,change,code] of [
 ['inactive employee',s=>{s.snapshot.employees[0].is_active=false;},'INACTIVE_EMPLOYEE'],
 ['missing registration',s=>{s.snapshot.registrations=[];},'REGISTRATION_REQUIRED'],
 ['wrong department',s=>{s.snapshot.employees[0].department_id=id(99);},'DEPARTMENT_MISMATCH'],
 ['missing required skill',s=>{s.snapshot.requirements[0].required_skill_name='HOT_KITCHEN';},'SKILL_MISMATCH'],
 ['weekly hours exceeded',s=>{s.snapshot.employees[0].max_weekly_hours=2;},'WEEKLY_LIMIT_EXCEEDED'],
 ['overlapping shifts',s=>{
  s.snapshot.shifts.push({...s.snapshot.shifts[0],id:id(60),start_time:'09:00:00',end_time:'13:00:00'});
  s.snapshot.requirements.push({...s.snapshot.requirements[0],id:id(61),shift_id:id(60)});
  s.snapshot.registrations.push({...s.snapshot.registrations[0],id:id(62),shift_id:id(60)});
  s.assignments.push({...s.assignments[0],id:id(63),shift_id:id(60)});s.snapshot.existing=structuredClone(s.assignments);
 },'SHIFT_OVERLAP'],
])test(name+' still blocks submission and handoff',()=>fixture({required:1,eligible:1,assigned:1},async s=>{
 change(s);const v=await validateSchedule(schedule,branch,1);
 assert.equal(v.hard_constraints,'FAIL');assert.equal(v.can_submit,false);assert.ok(v.issues.some(i=>i.code===code),JSON.stringify(v.issues));
 assert.equal((await prepareApprovalHandoff(schedule,branch,actor,{expected_version:1})).payload,null);
}));

test('missing demand, open registration, published state and version changes remain blockers',()=>fixture({},async s=>{
 s.snapshot.requirements=[];let v=await validateSchedule(schedule,branch,1);assert.equal(v.can_submit,false);assert.equal(v.data_complete,false);
 s.snapshot.requirements=[{id:id(7),work_date:day,shift_id:shift,department_id:department,required_count:2,required_skill_name:null}];
 s.snapshot.period.status='OPEN';v=await validateSchedule(schedule,branch,1);assert.equal(v.can_submit,false);assert.ok(v.issues.some(i=>i.code==='PERIOD_NOT_CLOSED'));
 s.snapshot.period.status='CLOSED';s.saved.status='PUBLISHED';v=await validateSchedule(schedule,branch,1);assert.equal(v.can_submit,false);
 s.saved.status='DRAFT';s.saved.version=2;await assert.rejects(validateSchedule(schedule,branch,1),e=>e.code==='SCHEDULE_VERSION_CHANGED');
}));

test('old SQL coverage gate is a rollout error, while over-assignment remains a hard rejection',async()=>{
 const oldEnv={...process.env},rpc=db.rpc;
 Object.assign(process.env,{NODE_ENV:'test',SCHEDULING_DATA_SOURCE:'supabase',TV3_WRITE_SCOPE_ENABLED:'false',TV3_TEST_PREVIEW_ENABLED:'false',TV4_WORKFLOW_PERSISTENCE_ENABLED:'true'});
 try{
  const body={expected_version:1,request_id:id(90)},ql={id:actor,role:'QL',branch_id:branch};
  db.rpc=async()=>({data:null,error:{code:'P0001',message:'COVERAGE_INCOMPLETE'}});
  await assert.rejects(transitionSchedule(schedule,ql,body,'SUBMIT'),e=>e.status===503&&e.code==='WORKFLOW_STAFFING_POLICY_NOT_MIGRATED');
  db.rpc=async()=>({data:null,error:{code:'P0001',message:'DEMAND_EXCEEDED'}});
  await assert.rejects(transitionSchedule(schedule,ql,body,'SUBMIT'),e=>e.status===409&&e.code==='DEMAND_EXCEEDED');
 }finally{db.rpc=rpc;for(const k of Object.keys(process.env))if(!(k in oldEnv))delete process.env[k];Object.assign(process.env,oldEnv);}
});
