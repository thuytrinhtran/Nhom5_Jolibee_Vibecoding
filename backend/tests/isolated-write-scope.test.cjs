const {test}=require('node:test'),assert=require('node:assert/strict');
// No real credentials or remote requests, even if a mocked method is missed.
process.env.NODE_ENV='test';process.env.SUPABASE_URL='http://127.0.0.1:9';process.env.SUPABASE_SECRET_KEY='isolated-test-placeholder';
const scope=require('../dist/services/draft-write-scope.js');
const {draftPersistenceAvailability}=require('../dist/services/draft-write-policy.js');
const {supabaseAdmin:db}=require('../dist/config/supabase.js');
const repositories=require('../dist/repositories/registration-summary.repository.js');
const {previewSchedule}=require('../dist/services/schedule-preview.service.js');
const {persistPreview}=require('../dist/services/draft-persistence.service.js');
const {createDraft}=require('../dist/services/scheduling.service.js');
const {transitionSchedule}=require('../dist/services/schedule-workflow.service.js');
const {schedulingInput}=require('../dist/services/scheduling-input.js');
const app=require('../dist/server.js').default;
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const project='abcdefghijklmnopqrst',branch=id(1),period=id(2),manager=id(3),supervisor=id(4),employee=id(5),department=id(6),shift=id(7);
const env={NODE_ENV:'production',SCHEDULING_DATA_SOURCE:'supabase',DEV_IMPORT_ENABLED:'false',
 TV3_DRAFT_PERSISTENCE_ENABLED:'true',TV4_WORKFLOW_PERSISTENCE_ENABLED:'true',TV3_TEST_PREVIEW_ENABLED:'false',
 TV3_WRITE_SCOPE_ENABLED:'true',TV3_WRITE_SCOPE_MODE:'isolated-test',TV3_TEST_PROJECT_REF:project,TV3_WRITE_PROJECT_REF:project,
 SUPABASE_URL:`https://${project}.supabase.co`,TV3_WRITE_BRANCH_ID:branch,TV3_WRITE_PERIOD_ID:period,
 TV3_WRITE_START_DATE:'2026-11-09',TV3_WRITE_END_DATE:'2026-11-15'};
const dates={id:period,branch_id:branch,work_start_date:'2026-11-09',work_end_date:'2026-11-15',status:'CLOSED'};
const restoreEnv=old=>{for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old);};

test('isolated policy accepts one approved test project/branch/week in production and rejects shared projects',()=>{
 assert.equal(scope.draftPeriodWriteScopeAllowed(dates,env),true);
 assert.equal(scope.draftPeriodWriteScopeAllowed({...dates,id:id(99)},env),false);
 assert.equal(scope.draftPeriodWriteScopeAllowed({...dates,branch_id:id(99)},env),false);
 for(const changed of [{work_start_date:'2026-11-02'},{work_end_date:'2026-11-22'},{work_start_date:undefined}])
  assert.equal(scope.draftPeriodWriteScopeAllowed({...dates,...changed},env),false);
 for(const changed of [{TV3_WRITE_SCOPE_ENABLED:'false'},{TV3_WRITE_SCOPE_MODE:'manual-test'},
  {TV3_WRITE_PROJECT_REF:'anotherprojectabcdef'},{SUPABASE_URL:'https://anotherprojectabcdef.supabase.co'},
  {SUPABASE_URL:`https://${project}.supabase.co.evil.example`},{SUPABASE_URL:`https://user@${project}.supabase.co`},
  {SUPABASE_URL:`https://${project}.supabase.co?project=test`},{TV3_WRITE_BRANCH_ID:'invalid'},
  {TV3_WRITE_START_DATE:'2026-11-02'},{TV3_WRITE_END_DATE:'2026-11-22'}])
  assert.equal(scope.draftPeriodWriteScopeAllowed(dates,{...env,...changed}),false,JSON.stringify(changed));
 const shared='wlbpprpiieonjrqglicv';
 assert.equal(scope.draftPeriodWriteScopeAllowed(dates,{...env,TV3_TEST_PROJECT_REF:shared,TV3_WRITE_PROJECT_REF:shared,SUPABASE_URL:`https://${shared}.supabase.co`}),false);
 assert.equal(scope.draftPeriodWriteScopeAllowed(dates,{NODE_ENV:'production'}),false);
 assert.equal(scope.draftPeriodWriteScopeAllowed(dates,{...env,SUPABASE_URL:`https://${project}.supabase.co/rest/v1/`}),true);
});

test('every missing isolated scope field fails closed instead of selecting legacy defaults',()=>{
 for(const key of ['NODE_ENV','TV3_WRITE_SCOPE_MODE','TV3_WRITE_SCOPE_ENABLED','TV3_TEST_PROJECT_REF','TV3_WRITE_PROJECT_REF',
  'SUPABASE_URL','TV3_WRITE_BRANCH_ID','TV3_WRITE_PERIOD_ID','TV3_WRITE_START_DATE','TV3_WRITE_END_DATE']){
  const missing={...env};delete missing[key];assert.equal(scope.draftPeriodWriteScopeAllowed(dates,missing),false,key);
 }
});

test('preview availability distinguishes source, read-only mode, open period, scope and persistence gates',()=>{
 const check=(changes={},p=dates,source='supabase')=>draftPersistenceAvailability(p,source,false,{...env,...changes});
 assert.equal(check().enabled,true);
 for(const flag of [undefined,'false','TRUE','1',' true '])assert.equal(check({TV3_DRAFT_PERSISTENCE_ENABLED:flag}).code,'DRAFT_PERSISTENCE_DISABLED');
 assert.equal(check({TV3_TEST_PREVIEW_ENABLED:'true'}).code,'TEST_PREVIEW_READ_ONLY');
 assert.equal(check({}, {...dates,status:'OPEN'}).code,'PERIOD_NOT_CLOSED');
 assert.equal(check({TV3_WRITE_SCOPE_ENABLED:'false'}).code,'DRAFT_WRITE_SCOPE_FORBIDDEN');
 assert.equal(check({}, {...dates,work_end_date:'2026-11-22'}).code,'DRAFT_WRITE_SCOPE_FORBIDDEN');
 assert.equal(check({},dates,'mock').code,'MOCK_READ_ONLY');
});

function fixture(){return {source:'supabase',branch:{id:branch,name:'Synthetic test branch'},period:{...dates},
 departments:[{id:department,name:'Kitchen'}],employees:[{id:employee,full_name:'Synthetic employee',branch_id:branch,
  department_id:department,skill_level:'NEW',status:'ACTIVE',is_active:true,role:'NV',skills:[],max_weekly_hours:40}],
 shifts:[{id:shift,name:'Morning',start_time:'08:00:00',end_time:'12:00:00',is_active:true,branch_id:branch}],
 registrations:[{id:id(8),period_id:period,employee_id:employee,work_date:'2026-11-09',shift_id:shift,status:'VALID'}],
 requirements:[{id:id(9),department_id:department,work_date:'2026-11-09',shift_id:shift,required_count:1,required_skill_name:null}],
 existing:[],new_employee_count_threshold:null};}

async function mocked(run){
 const oldEnv={...process.env},old={from:db.from,rpc:db.rpc,getUser:db.auth.getUser,repository:repositories.registrationSummaryRepository};
 Object.assign(process.env,env);
 const state={snapshot:fixture(),storedPeriod:{...dates},periodError:null,schedules:[],assignments:[],calls:[],receipts:new Map(),ruleVersion:'tv3.rules.v2',rpcError:null};
 const repo={source:'supabase',load:async()=>structuredClone(state.snapshot),listPeriods:async()=>[{...state.snapshot.period,schedules:state.schedules}]};
 repositories.registrationSummaryRepository=()=>repo;
 db.from=table=>{let fields;const filters={};const q={select(value){fields=value;return q},eq(k,v){filters[k]=v;return q},order(){return q},limit(){return q},
  async maybeSingle(){
   if(table==='registration_periods')return {data:state.storedPeriod,error:state.periodError};
   if(table==='employees')return {data:{id:employee,user_id:employee,branch_id:branch,status:'ACTIVE',full_name:'Synthetic employee',skill_level:'NEW',department_id:department,departments:{name:'Kitchen'}},error:null};
   if(table==='schedules')return {data:state.schedules.find(s=>s.id===filters.id)??null,error:null};
   if(table==='audit_logs')return {data:state.receipts.get(filters['new_data->>request_id'])??null,error:null};
   throw Error('Unexpected mocked table '+table+' '+fields);
  },then(resolve,reject){return Promise.resolve({data:table==='shift_assignments'?state.assignments:[],error:null}).then(resolve,reject);},async single(){
   if(table==='users'){const who=filters.id;return {data:{id:who,role:who===manager?'QL':who===supervisor||who===id(44)?'GS':'NV',branch_id:branch,is_active:true,must_change_password:false}};}
   if(table==='branches')return {data:{name:'Synthetic test branch'}};
   throw Error('Unexpected identity lookup '+table);
  }};return q;};
 db.auth.getUser=async token=>({data:{user:{id:token==='manager'?manager:token==='supervisor'?supervisor:token==='outside-supervisor'?id(44):employee}},error:null});
 db.rpc=async(name,args)=>{
  state.calls.push({name,args});if(state.rpcError)return {error:state.rpcError,data:null};
  if(name==='persist_schedule_draft'){
   if(args.p_request_id&&state.receipts.has(args.p_request_id))return {data:{reused:true,result:state.receipts.get(args.p_request_id).new_data.response_result},error:null};
   if(!args.p_result)return {data:{input:{...schedulingInput(state.snapshot),rule_version:state.ruleVersion}},error:null};
   assert.equal(args.p_actor_id,manager);assert.equal(args.p_snapshot.rule_version,'tv3.rules.v2');
   const version=args.p_schedule_id?args.p_expected_version+1:1;
   const schedule={id:id(19+version),period_id:period,branch_id:branch,status:'DRAFT',version,created_by:manager,created_at:'2026-11-06T00:00:00Z'};state.schedules.push(schedule);
   state.assignments=args.p_result.assignments.map((a,i)=>({...a,id:id(100+i),status:'DRAFT',assignment_source:'REGULAR'}));
   const result={schedule,assignments:args.p_result.assignments};
   state.receipts.set(args.p_request_id,{actor_id:manager,entity_id:schedule.id,new_data:{request_fingerprint:args.p_fingerprint,response_result:result}});
   return {data:{reused:false,result},error:null};
  }
  if(name==='tv4_transition_schedule_v2'){
   const schedule=state.schedules.find(s=>s.id===args.p_schedule_id);
   schedule.status=args.p_action==='SUBMIT'?'PENDING_APPROVAL':args.p_action==='PUBLISH'?'PUBLISHED':args.p_action;
   return {data:{schedule:{...schedule}},error:null};
  }
  throw Error('Unexpected RPC '+name);
 };
 try{await run(state,repo);}finally{db.from=old.from;db.rpc=old.rpc;db.auth.getUser=old.getUser;repositories.registrationSummaryRepository=old.repository;restoreEnv(oldEnv);}
}
const draftBody=p=>({period_id:period,input_revision:p.input_revision,request_id:id(30),assignments:p.result.assignments.map(({employee_id,work_date,shift_id,department_id})=>({employee_id,work_date,shift_id,department_id}))});

test('production isolated preview saves a server-verified DRAFT and recovers an idempotent retry (mock RPC)',()=>mocked(async s=>{
 const p=await previewSchedule(period,branch,{});assert.equal(p.persistence.enabled,true);
 assert.equal(p.result.shortages.length,0);assert.equal(p.result.coverage[0].missing_experienced_count,1);
 const body=draftBody(p),saved=await persistPreview(period,branch,manager,body);
 assert.equal(saved.result.schedule.status,'DRAFT');assert.equal(s.calls.filter(c=>c.args.p_result).length,1);
 const retry=await persistPreview(period,branch,manager,body);assert.equal(retry.reused,true);assert.equal(s.calls.filter(c=>c.args.p_result).length,1);
 // Date checks also precede the recovery RPC, not only first-time writes.
 s.storedPeriod.work_end_date='2026-11-22';
 const count=s.calls.length;await assert.rejects(persistPreview(period,branch,manager,body),e=>e.code==='DRAFT_WRITE_SCOPE_FORBIDDEN');assert.equal(s.calls.length,count);
}));

test('stored dates and failed scope reads block both new and legacy writers before any RPC',()=>mocked(async s=>{
 for(const changed of [{work_start_date:'2026-11-02'},{work_end_date:'2026-11-22'},{id:id(99)},{branch_id:id(99)}]){
  s.storedPeriod={...dates,...changed};
  await assert.rejects(persistPreview(period,branch,manager,{}),e=>e.code==='DRAFT_WRITE_SCOPE_FORBIDDEN');
  await assert.rejects(createDraft(period,manager,branch),e=>e.code==='DRAFT_WRITE_SCOPE_FORBIDDEN');
 }
 s.storedPeriod={...dates};s.periodError={code:'DEPENDENCY_FAILED'};
 await assert.rejects(persistPreview(period,branch,manager,{}),e=>e.code==='DRAFT_WRITE_SCOPE_UNAVAILABLE');assert.equal(s.calls.length,0);
}));

test('isolated demand writers validate the actual period dates before changing any requirement',()=>mocked(async(s,repo)=>{
 const demand=require('../dist/services/staffing-demand.service.js');
 const input={work_date:'2026-11-09',shift_id:shift,department_id:department,required_count:1,required_skill_name:null,sales_forecast_ref:null,expected_updated_at:'2026-11-06T00:00:00Z'};
 repo.saveRequirement=()=>assert.fail('No out-of-date requirement write');repo.clearRequirement=()=>assert.fail('No out-of-date requirement delete');
 s.snapshot.period.work_end_date='2026-11-22';
 await assert.rejects(demand.saveDemand(period,branch,manager,input,repo),e=>e.code==='DRAFT_WRITE_SCOPE_FORBIDDEN');
 const {work_date,shift_id,department_id,expected_updated_at}=input;
 await assert.rejects(demand.clearDemand(period,branch,{work_date,shift_id,department_id,expected_updated_at},repo),e=>e.code==='DRAFT_WRITE_SCOPE_FORBIDDEN');
 await assert.rejects(demand.saveDemandBatch(period,branch,manager,{items:[{operation:'save',input}]},repo),e=>e.code==='DRAFT_WRITE_SCOPE_FORBIDDEN');
 assert.equal(s.calls.length,0);
}));

test('RPC contract mismatch, stale preview, locked publication and invalid manual plans never reach a write RPC',()=>mocked(async s=>{
 const p=await previewSchedule(period,branch,{}),body=draftBody(p);
 s.ruleVersion='tv3.rules.v1';await assert.rejects(persistPreview(period,branch,manager,body),e=>e.code==='PERSISTENCE_CONTRACT_MISMATCH');
 s.ruleVersion='tv3.rules.v2';s.snapshot.requirements[0].required_count=2;
 await assert.rejects(persistPreview(period,branch,manager,body),e=>e.code==='PREVIEW_STALE');
 s.snapshot.requirements[0].required_count=1;s.schedules=[{id:id(20),version:1,status:'PUBLISHED'}];
 await assert.rejects(persistPreview(period,branch,manager,body),e=>e.code==='PERIOD_LOCKED');s.schedules=[];
 await assert.rejects(persistPreview(period,branch,manager,{...body,assignments:[{...body.assignments[0],department_id:id(99)}]}),e=>e.status===422);
 s.snapshot.employees[0].max_weekly_hours=2;
 const limited=await previewSchedule(period,branch,{});
 await assert.rejects(persistPreview(period,branch,manager,{...body,input_revision:limited.input_revision}),e=>e.status===422);
 s.snapshot.employees[0].max_weekly_hours=40;
 s.snapshot.shifts.push({...s.snapshot.shifts[0],id:id(70)});
 s.snapshot.registrations.push({...s.snapshot.registrations[0],id:id(71),shift_id:id(70)});
 s.snapshot.requirements.push({...s.snapshot.requirements[0],id:id(72),shift_id:id(70)});
 const overlap=await previewSchedule(period,branch,{});
 await assert.rejects(persistPreview(period,branch,manager,{...body,input_revision:overlap.input_revision,
  assignments:[body.assignments[0],{...body.assignments[0],shift_id:id(70)}]}),e=>e.code==='SHIFT_OVERLAP');
 assert.equal(s.calls.filter(c=>c.args.p_result).length,0);
}));

test('mock-RPC lifecycle preserves rejected version and submits a revised DRAFT before approval/publication',()=>mocked(async s=>{
 let next=40;
 const ql={id:manager,role:'QL',branch_id:branch},gs={id:supervisor,role:'GS',branch_id:null};
 const move=(schedule,actor,action,extra={})=>transitionSchedule(schedule.id,actor,{expected_version:schedule.version,request_id:id(++next),...extra},action);
 const p=await previewSchedule(period,branch,{}),first=(await persistPreview(period,branch,manager,draftBody(p))).result.schedule;
 assert.equal((await move(first,ql,'SUBMIT')).schedule.status,'PENDING_APPROVAL');
 assert.equal((await move(first,gs,'NEEDS_REVISION',{reason:'Kiểm tra lại phương án'})).schedule.status,'NEEDS_REVISION');
 const revised=await previewSchedule(period,branch,{schedule_id:first.id,expected_version:1,use_saved_assignments:true});
 const second=(await persistPreview(period,branch,manager,{...draftBody(revised),request_id:id(++next),expected_version:1},first.id)).result.schedule;
 assert.equal(second.version,2);assert.notEqual(second.id,first.id);assert.equal(first.status,'NEEDS_REVISION');
 await move(second,ql,'SUBMIT');await move(second,gs,'APPROVED');
 const published=await move(second,ql,'PUBLISH',{feedback_deadline_at:new Date(Date.now()+86400000).toISOString()});
 assert.equal(published.schedule.status,'PUBLISHED');
 assert.deepEqual(s.calls.filter(c=>c.name==='tv4_transition_schedule_v2').map(c=>c.args.p_action),['SUBMIT','NEEDS_REVISION','SUBMIT','APPROVED','PUBLISH']);
 const writes=s.calls.filter(c=>c.name==='persist_schedule_draft'&&c.args.p_result);assert.equal(writes.length,2);assert.equal(writes[1].args.p_expected_version,1);
 await assert.rejects(previewSchedule(period,branch,{}),e=>e.code==='PERIOD_LOCKED');
}));

test('workflow resolves stored scope for QL and GS, including denied dates and missing configuration',()=>mocked(async s=>{
 s.schedules=[{id:id(20),period_id:period,branch_id:branch,status:'DRAFT',version:1}];
 const body={expected_version:1,request_id:id(31)};
 const ql={id:manager,role:'QL',branch_id:branch},gs={id:supervisor,role:'GS',branch_id:null};
 assert.equal((await transitionSchedule(id(20),ql,body,'SUBMIT')).schedule.status,'PENDING_APPROVAL');
 assert.equal((await transitionSchedule(id(20),gs,body,'APPROVED')).schedule.status,'APPROVED');
 await assert.rejects(transitionSchedule(id(20),ql,body,'APPROVED'),e=>e.status===403);
 await assert.rejects(transitionSchedule(id(20),gs,{...body,feedback_deadline_at:new Date(Date.now()+86400000).toISOString()},'PUBLISH'),e=>e.status===403);
 await assert.rejects(transitionSchedule(id(20),gs,body,'NEEDS_REVISION'),e=>e.code==='REASON_REQUIRED');
 s.storedPeriod.work_end_date='2026-11-22';const count=s.calls.length;
 await assert.rejects(transitionSchedule(id(20),gs,body,'APPROVED'),e=>e.code==='WORKFLOW_SCOPE_FORBIDDEN');assert.equal(s.calls.length,count);
 s.storedPeriod={...dates};delete process.env.TV3_WRITE_SCOPE_ENABLED;
 await assert.rejects(transitionSchedule(id(20),ql,body,'SUBMIT'),e=>e.code==='WORKFLOW_SCOPE_FORBIDDEN');
}));

test('HTTP enforces schedule roles and propagates RPC authorization/status/version refusals (mock RPC)',()=>mocked(async s=>{
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}/api/schedules`;
 const call=(path,token,body)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
 try{
  const p=await previewSchedule(period,branch,{}),body=draftBody(p);
  assert.equal((await call('/drafts',null,body)).status,401);
  for(const token of ['employee','supervisor'])assert.equal((await call('/drafts',token,body)).status,403);
  const saved=await call('/drafts','manager',body);assert.equal(saved.status,200);
  const prefix='/workflow/'+id(20),version={expected_version:1,request_id:id(33)};
  assert.equal((await call(prefix+'/decision','manager',{...version,decision:'APPROVED'})).status,403);
  assert.equal((await call(prefix+'/publish','supervisor',version)).status,403);
  assert.equal((await call(prefix+'/submit','employee',version)).status,403);
  assert.equal((await call(prefix+'/submit','manager',version)).status,200);
  s.rpcError={code:'42501',message:'FORBIDDEN'};
  assert.equal((await call(prefix+'/decision','outside-supervisor',{...version,decision:'APPROVED'})).status,403);
  s.rpcError={code:'40001',message:'STALE_SCHEDULE_VERSION'};
  assert.equal((await call(prefix+'/decision','supervisor',{...version,decision:'APPROVED'})).status,409);
  s.rpcError={code:'P0001',message:'INVALID_SCHEDULE_STATUS'};
  assert.equal((await call(prefix+'/publish','manager',{...version,feedback_deadline_at:new Date(Date.now()+86400000).toISOString()})).status,409);
  s.storedPeriod.work_end_date='2026-11-22';
  const registration=await fetch(base.replace('/schedules','/registrations')+'/'+period+'/me',{method:'PUT',headers:{Authorization:'Bearer employee','Content-Type':'application/json'},body:JSON.stringify({mode:'draft',preferences:[]})});
  assert.equal(registration.status,403,'TV2 cannot write a period whose stored dates are outside the isolated scope');
 }finally{await new Promise(r=>server.close(r));}
}));
