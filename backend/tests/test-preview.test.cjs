const {test}=require('node:test');
const assert=require('node:assert/strict');
process.env.NODE_ENV='test';
const {LD_TEST_BATCH_ID:BATCH,LD_TEST_BRANCH_ID:BRANCH,LD_TEST_PERIOD_ID:PERIOD}=require('../dist/services/test-preview-policy.js');
const {previewTestSchedule}=require('../dist/services/test-preview.service.js');
const {previewSchedule}=require('../dist/services/schedule-preview.service.js');
const {buildLDTestFixture}=require('../dist/services/ld-test-fixture.js');
const {tv2Availability}=require('../dist/registrations/tv3-source.js');
const {interval,reviewAssignments}=require('../dist/services/scheduling.engine.js');
const {schedulingInput}=require('../dist/services/scheduling-input.js');
const kitchen='22222222-2222-2222-2222-222222222222',service='e10533b2-57df-55e0-adf0-64894c2ca58a',cash='0a3de5e1-873b-5f7b-acfc-e71e5b8e97f8';
const dates=Array.from({length:7},(_,i)=>`2026-11-0${i+2}`);
function fixture(){
 const employees=[];
 for(const [d,levels] of [[kitchen,{NEW:3,REGULAR:13,CREW_TRAINING:6,CREW_LEADER:3}],[service,{NEW:2,REGULAR:13,CREW_TRAINING:3,CREW_LEADER:2}],[cash,{NEW:3,REGULAR:7,CREW_TRAINING:3,CREW_LEADER:2}]])
  for(const [level,count] of Object.entries(levels))for(let i=0;i<count;i++)employees.push({id:`${d}-${level}-${i}`,employee_code:`${d}-${level}-${i}`,full_name:'Existing',branch_id:BRANCH,department_id:d,skill_level:level,status:'ACTIVE',is_active:true,role:'NV',max_weekly_hours:null,skills:[]});
 const shifts=[['s','08:00:00','12:00:00'],['p','12:00:00','17:00:00'],['e','17:00:00','22:00:00']].map(([id,start_time,end_time])=>({id,name:id,start_time,end_time,is_active:true,branch_id:BRANCH}));
 const real=employees.filter(e=>e.department_id===kitchen&&e.skill_level==='REGULAR').slice(0,2).map(e=>e.id);
 const registrations=real.flatMap(employee_id=>dates.map(work_date=>({id:`real-${employee_id}-${work_date}`,period_id:PERIOD,employee_id,work_date,shift_id:'s',status:'VALID'})));
 const requirements=dates.flatMap(work_date=>[kitchen,service,cash].flatMap(department_id=>shifts.map(shift=>({id:`need-${work_date}-${department_id}-${shift.id}`,work_date,department_id,shift_id:shift.id,required_count:department_id===service&&shift.id==='s'?6:department_id===cash&&shift.id==='s'?3:5,required_skill_name:null,sales_forecast_ref:'KEEP',updated_at:'2026-10-31T00:00:00Z'}))));
 return {source:'supabase',branch:{id:BRANCH,name:'Le Duan'},period:{id:PERIOD,branch_id:BRANCH,work_start_date:dates[0],work_end_date:dates[6],status:'CLOSED',stored_status:'PLANNED',open_at:'2026-10-30T08:00:00Z',close_at:'2026-11-01T05:00:00Z'},employees,shifts,departments:[kitchen,service,cash].map(id=>({id,name:id})),registrations,requirements,existing:[],new_employee_count_threshold:null,registration_submission_employee_ids:real};
}
async function mode(fn,overrides={}){
 const values={NODE_ENV:'test',TV3_TEST_PREVIEW_ENABLED:'true',TV3_TEST_PREVIEW_BATCH_ID:BATCH,TV3_DRAFT_PERSISTENCE_ENABLED:'true',...overrides};
 const old=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));Object.assign(process.env,values);
 try{return await fn()}finally{for(const [k,v] of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
}
function repository(data){return {source:'supabase',load:async(b,p)=>{assert.equal(b,BRANCH);assert.equal(p,PERIOD);return structuredClone(data)},saveRequirement:()=>assert.fail('write'),clearRequirement:()=>assert.fail('write'),listPeriods:async()=>[]};}

test('default, malformed mode, wrong batch and production reject before any source access',async()=>{
 for(const env of [{TV3_TEST_PREVIEW_ENABLED:''},{TV3_TEST_PREVIEW_ENABLED:'false'},{TV3_TEST_PREVIEW_ENABLED:'TRUE'},{TV3_TEST_PREVIEW_BATCH_ID:'other'},{NODE_ENV:'production'}])await mode(async()=>{
  await assert.rejects(previewTestSchedule(PERIOD,BRANCH,{}, {load:()=>assert.fail('disabled mode must not read fixture or DB')}),e=>['TEST_PREVIEW_DISABLED','INVALID_TEST_PREVIEW_CONFIG'].includes(e.code));
 },env);
});

test('normal TV2 source excludes samples; explicit acceptance admits exactly one batch with all other checks intact',()=>{
 const x=fixture(),person=x.employees[0],header={employee_id:person.id,status:'VALID',submitted_at:'2026-11-01T06:00:00Z',updated_at:'2026-11-01T06:00:00Z',sample_batch_id:BATCH};
 const row={id:'sample',period_id:PERIOD,employee_id:person.id,work_date:dates[0],shift_id:'s',status:'VALID',submitted_at:header.submitted_at};
 const run=(h,r,batch)=>tv2Availability({headers:[h],rows:[r]},x.period,x.employees,x.shifts,batch).registrations.length;
 assert.equal(run(header,row),0);assert.equal(run(header,row,'other'),0);assert.equal(run(header,row,BATCH),1);
 for(const h of [{...header,status:'DRAFT'},{...header,submitted_at:null},{...header,sample_batch_id:'other'}])assert.equal(run(h,row,BATCH),0);
 for(const r of [{...row,status:'DRAFT'},{...row,submitted_at:null},{...row,work_date:'2026-11-09'},{...row,period_id:'other'},{...row,shift_id:'other'}])assert.equal(run(header,r,BATCH),0);
 assert.equal(run({...header,sample_batch_id:null},row),1);
});

test('in-memory fixture preserves all inputs, labels provenance and has 60–70 distinct people/day without overlaps',async()=>mode(async()=>{
 const data=fixture(),before=JSON.stringify(data),built=buildLDTestFixture(data,BATCH,'2026-11-01T06:00:00Z');
 assert.equal(JSON.stringify(data),before);assert.deepEqual(built.snapshot.requirements,data.requirements);assert.deepEqual(built.snapshot.period,data.period);
 assert.deepEqual(built.snapshot.employees.slice(0,60),data.employees);assert.deepEqual(built.snapshot.registrations.slice(0,data.registrations.length),data.registrations);
 assert.equal(built.metadata.virtual_employee_ids.length,17);assert.equal(built.metadata.fixture_people,68);assert.equal(built.metadata.fixture_registration_count,560);
 assert.ok(built.metadata.daily.every(d=>d.fixture_people===65&&d.total_people>=60&&d.total_people<=70));
 assert.ok(!built.metadata.fixture_employee_ids.some(id=>data.registration_submission_employee_ids.includes(id)));
 const keys=built.snapshot.registrations.map(r=>`${r.employee_id}/${r.work_date}/${r.shift_id}`);assert.equal(new Set(keys).size,keys.length);
 for(const a of built.snapshot.registrations)for(const b of built.snapshot.registrations.filter(b=>b.employee_id===a.employee_id&&b.id!==a.id)){
  const [s,t]=interval(a.work_date,data.shifts.find(s=>s.id===a.shift_id)),[u,v]=interval(b.work_date,data.shifts.find(s=>s.id===b.shift_id));assert.ok(!(s<v&&u<t));
 }
 const result=await previewTestSchedule(PERIOD,BRANCH,{period_id:PERIOD},repository(data));
 assert.equal(result.kind,'test-preview');assert.equal(result.test_mode,true);assert.equal(result.source,'test-fixture');assert.equal(result.persisted,false);assert.equal(result.persistence.enabled,false);
 assert.deepEqual(result.capabilities,{save_draft:false,publish:false,approval_handoff:false});assert.ok(result.result.shortages.length>0);assert.ok(result.result.composition_shortages.length>0);
 assert.equal(reviewAssignments(schedulingInput(built.snapshot),result.result.assignments).assigned_count,result.result.assigned_count);
 const real=await previewSchedule(PERIOD,BRANCH,{},repository(data));assert.equal(real.context.valid_registration_count,data.registrations.length);assert.equal(real.context.employees.length,60);assert.equal(real.source,'supabase');assert.notEqual(result.input_revision,real.input_revision);
}));

test('foreign scope, client batch overrides, OPEN periods and changed source fail closed',async()=>mode(async()=>{
 const x=fixture(),repo=repository(x);
 for(const body of [{batch_id:BATCH},{test_mode:true},{assignments:[]},{schedule_id:'saved'}])await assert.rejects(previewTestSchedule(PERIOD,BRANCH,body,repo),e=>e.code==='INVALID_TEST_PREVIEW');
 await assert.rejects(previewTestSchedule(PERIOD,'other',{},repo),e=>e.code==='TEST_FIXTURE_SCOPE');
 await assert.rejects(previewTestSchedule('other',BRANCH,{},repo),e=>e.code==='TEST_FIXTURE_SCOPE');
 x.period.status='OPEN';await assert.rejects(previewTestSchedule(PERIOD,BRANCH,{},repo),e=>e.code==='PERIOD_NOT_CLOSED');x.period.status='CLOSED';
 x.registration_submission_employee_ids.push(x.employees.find(e=>e.department_id===service&&e.skill_level==='REGULAR').id);
 await assert.rejects(previewTestSchedule(PERIOD,BRANCH,{},repo),e=>e.code==='TEST_FIXTURE_SOURCE_CHANGED');
 delete x.registration_submission_employee_ids;assert.throws(()=>buildLDTestFixture(x,BATCH),e=>e.code==='TEST_FIXTURE_SOURCE_CHANGED');
}));

test('test mode blocks direct draft writer services even with persistence explicitly enabled',async()=>mode(async()=>{
 const {isDraftPersistenceEnabled,requireDraftPersistenceEnabled}=require('../dist/services/draft-write-policy.js');
 const {createDraft}=require('../dist/services/scheduling.service.js'),{persistPreview}=require('../dist/services/draft-persistence.service.js');
 const {supabaseAdmin:db}=require('../dist/config/supabase.js'),old={from:db.from,rpc:db.rpc};
 db.from=()=>assert.fail('writer touched DB');db.rpc=()=>assert.fail('writer called RPC');
 try{assert.equal(isDraftPersistenceEnabled(),false);assert.throws(requireDraftPersistenceEnabled,e=>e.code==='TEST_PREVIEW_READ_ONLY');
  await assert.rejects(createDraft(PERIOD,'actor',BRANCH),e=>e.code==='TEST_PREVIEW_READ_ONLY');
  await assert.rejects(persistPreview(PERIOD,BRANCH,'actor',{}),e=>e.code==='TEST_PREVIEW_READ_ONLY');
 }finally{Object.assign(db,old);}
}));

test('a test preview cannot be replayed into real persistence after test mode is disabled',async()=>{
 const data=fixture();let plan;
 await mode(async()=>{plan=await previewTestSchedule(PERIOD,BRANCH,{},repository(data));});
 const {persistPreview}=require('../dist/services/draft-persistence.service.js');
 const repos=require('../dist/repositories/registration-summary.repository.js'),{supabaseAdmin:db}=require('../dist/config/supabase.js');
 const old={from:db.from,rpc:db.rpc,repository:repos.registrationSummaryRepository};
 db.from=table=>{assert.equal(table,'audit_logs');return {select(){return this},eq(){return this},maybeSingle:async()=>({data:null})};};
 db.rpc=()=>assert.fail('fixture must not reach persistence RPC');repos.registrationSummaryRepository=()=>repository(data);
 try{await mode(async()=>{
  const assignments=plan.result.assignments.map(({employee_id,work_date,shift_id,department_id})=>({employee_id,work_date,shift_id,department_id}));
  await assert.rejects(persistPreview(PERIOD,BRANCH,'actor',{period_id:PERIOD,assignments,input_revision:plan.input_revision,request_id:'00000000-0000-4000-8000-000000000001'}),e=>e.code==='PREVIEW_STALE');
 },{TV3_TEST_PREVIEW_ENABLED:'false'});}finally{db.from=old.from;db.rpc=old.rpc;repos.registrationSummaryRepository=old.repository;}
});

test('HTTP requires QL/branch, ignores client activation and blocks draft, edits, demand and publication before DB',async()=>{
 const app=require('../dist/server.js').default,{supabaseAdmin:db}=require('../dist/config/supabase.js');
 const repos=require('../dist/repositories/registration-summary.repository.js');
 const original={getUser:db.auth.getUser,from:db.from,rpc:db.rpc,repository:repos.registrationSummaryRepository};let role='QL',branch=BRANCH,loads=0;
 const user='00000000-0000-4000-8000-000000000001';db.auth.getUser=async()=>({data:{user:{id:user}}});
 db.from=table=>{assert.ok(['users','branches','employees'].includes(table),'only auth profile SELECTs outside repository');return {select(){return this},eq(){return this},maybeSingle:async()=>({data:null}),single:async()=>({data:table==='users'?{id:user,role,branch_id:branch,is_active:true,must_change_password:false}:table==='employees'?null:{name:'Branch'}})};};
 db.rpc=()=>assert.fail('RPC forbidden');repos.registrationSummaryRepository=()=>({...repository(fixture()),load:async()=>{loads++;return fixture()}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/schedules`;
 const request=(path,body={period_id:PERIOD},auth=true,method='POST')=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer fixture'}:{})},body:JSON.stringify(body)});
 try{
  await mode(async()=>{assert.equal((await request('/test-preview',{period_id:PERIOD,test_mode:true})).status,403);assert.equal(loads,0);},{TV3_TEST_PREVIEW_ENABLED:'false'});
  await mode(async()=>{
   assert.equal((await request('/test-preview',{},false)).status,401);role='NV';assert.equal((await request('/test-preview')).status,403);role='QL';branch='other';assert.equal((await request('/test-preview')).status,403);branch=BRANCH;
   const response=await request('/test-preview');assert.equal(response.status,200);assert.equal((await response.json()).result.test_metadata.batch_id,BATCH);
   const reads=loads;
   for(const [path,method] of [['/drafts','POST'],['/generate','POST'],[`/${user}/draft-assignments`,'PATCH'],[`/periods/${PERIOD}/requirements`,'PUT'],[`/periods/${PERIOD}/requirements`,'DELETE'],[`/${user}/approval-handoff`,'POST'],[`/workflow/${user}/publish`,'POST'],[`/workflow/${user}/submit`,'POST'],[`/workflow/${user}/decision`,'POST'],[`/workflow/${user}/resubmit`,'POST'],['/preview/apply-adjustment','POST']]){
    const blocked=await request(path,{},true,method);assert.equal(blocked.status,403,path);assert.equal((await blocked.json()).code,'TEST_PREVIEW_READ_ONLY');
   }assert.equal(loads,reads);
  });
 }finally{db.auth.getUser=original.getUser;db.from=original.from;db.rpc=original.rpc;repos.registrationSummaryRepository=original.repository;await new Promise(r=>server.close(r));}
});
