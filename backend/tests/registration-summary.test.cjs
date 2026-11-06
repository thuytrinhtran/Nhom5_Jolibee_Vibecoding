// Explicit isolated writer-test opt-in; production defaults remain locked.
process.env.TV3_DRAFT_PERSISTENCE_ENABLED='true';
const {test}=require('node:test');const assert=require('node:assert/strict');
process.env.NODE_ENV='test';process.env.SUPABASE_URL ||= 'https://example.supabase.co';process.env.SUPABASE_SECRET_KEY ||= 'isolated-test-placeholder';
const {mockSummarySnapshot,MockRegistrationSummaryRepository,MOCK_PERIOD_ID}=require('../dist/repositories/registration-summary.mock.js');
const {SupabaseRegistrationSummaryRepository}=require('../dist/repositories/registration-summary.supabase.js');
const {registrationSummaryRepository}=require('../dist/repositories/registration-summary.repository.js');
const {summarizeRegistrations}=require('../dist/services/registration-summary.service.js');
const {createDraft}=require('../dist/services/scheduling.service.js');
const branch='00000000-0000-4000-8000-000000000001';
const row=(s,name,day='2026-11-02')=>s.rows.find(r=>r.department_name===name&&r.work_date===day);
function databaseFixture(snapshot,fail=false){
  const queries=[];
<<<<<<< Updated upstream
  const tables={registration_periods:[{...snapshot.period,open_at:'2026-10-01T00:00:00Z',close_at:'2026-10-02T00:00:00Z',schedules:[]}],branches:[snapshot.branch],departments:snapshot.departments,
    employees:snapshot.employees.map(e=>({...e,user:{is_active:e.is_active,role:e.role,branch_id:e.branch_id}})),
    registration_submissions_sourced:[...new Set(snapshot.registrations.map(r=>r.employee_id))].map(employee_id=>({employee_id,status:'VALID',submitted_at:'2026-10-01T01:00:00Z',updated_at:'2026-10-01T01:00:00Z',sample_batch_id:null})),
    shifts:snapshot.shifts,shift_registrations:snapshot.registrations.map(r=>({...r,submitted_at:'2026-10-01T01:00:00Z'})),staffing_requirements:snapshot.requirements,
=======
  const tables={registration_periods_effective:[{...snapshot.period,schedules:[]}],branches:[snapshot.branch],departments:snapshot.departments,
    employees:snapshot.employees.map(e=>({...e,user:{is_active:e.is_active,role:e.role,branch_id:e.branch_id}})),
    shifts:snapshot.shifts,shift_registrations:snapshot.registrations.map(r=>({...r,submitted_at:'2026-10-29T01:00:00Z'})),staffing_requirements:snapshot.requirements,
    registration_submissions_sourced:[...new Set(snapshot.registrations.filter(r=>r.status==='VALID').map(r=>r.employee_id))].map(employee_id=>({period_id:snapshot.period.id,employee_id,status:'VALID',submitted_at:'2026-10-29T01:00:00Z',sample_batch_id:null})),
>>>>>>> Stashed changes
    employee_skills:snapshot.employees.flatMap(e=>(e.skills||[]).map(skill_name=>({employee_id:e.id,skill_name}))),
    shift_assignments:snapshot.existing,warning_configs:[]};
  const db={from(table){const query={table,filters:[],from:0,to:499};queries.push(query);
    const result=()=>({data:(tables[table]||[]).slice(query.from,query.to+1),error:fail?(typeof fail==='object'?fail:{message:'private failure'}):null});
    return {select(columns){query.columns=columns;return this},eq(k,v){query.filters.push([k,v]);return this},neq(){return this},gte(){return this},lte(){return this},or(){return this},order(){return this},range(a,b){query.from=a;query.to=b;return this},
      maybeSingle:async()=>{let data=result().data[0]??null;if(data&&table==='registration_periods_effective'){const {schedules,...period}=data;data=period;}return{...result(),data}},single:async()=>({...result(),data:result().data[0]??null}),then(resolve){resolve(result())}};
  }};return{db,queries,tables};
}
test('deduplicates VALID registrations, separates eligibility and computes balanced/short/surplus',()=>{
  const snapshot=mockSummarySnapshot(branch);const summary=summarizeRegistrations(snapshot);
  assert.equal(row(summary,'Bếp').registered_count,2);assert.equal(row(summary,'Bếp').eligible_count,2);assert.equal(row(summary,'Bếp').status,'BALANCED');
  assert.ok(row(summary,'Bếp').warnings.some(w=>w.code==='DUPLICATE_REGISTRATION'));
  assert.equal(row(summary,'Thu ngân').shortage_count,1);assert.equal(row(summary,'Phục vụ').surplus_count,2);
  const kitchen=row(summary,'Bếp','2026-11-03');assert.equal(kitchen.registered_count,2);assert.equal(kitchen.eligible_count,1);assert.equal(kitchen.shortage_count,1);
  assert.ok(kitchen.warnings.some(w=>w.code==='SKILL_MISMATCH'));
  assert.equal(kitchen.other_department_registered_count,1);assert.equal(row(summary,'Phục vụ','2026-11-03').registered_count,1);
});
test('DRAFT/INVALID registrations never contribute and missing demand is UNKNOWN, not zero',()=>{
  const snapshot=mockSummarySnapshot(branch);
  snapshot.registrations.push({...snapshot.registrations[0],employee_id:snapshot.employees[6].id,status:'DRAFT'},
    {...snapshot.registrations[0],employee_id:snapshot.employees[6].id,status:'INVALID'});
  const summary=summarizeRegistrations(snapshot);assert.equal(row(summary,'Bếp').registered_count,2);
  const unknown=row(summary,'Bếp','2026-11-04');assert.equal(unknown.registered_count,1);assert.equal(unknown.required_count,null);assert.equal(unknown.eligible_count,null);assert.equal(unknown.shortage_count,null);assert.equal(unknown.status,'UNKNOWN');
});
test('out-of-branch employees and wrong-period/date records are excluded without exposing their IDs',()=>{
  const snapshot=mockSummarySnapshot(branch);
  const external={...snapshot.employees[0],id:'private-foreign-employee',branch_id:'foreign'};snapshot.employees.push(external);
  snapshot.registrations.push({...snapshot.registrations[0],employee_id:external.id},
    {...snapshot.registrations[0],period_id:'foreign-period'}, {...snapshot.registrations[0],work_date:'2026-11-20'});
  const summary=summarizeRegistrations(snapshot);assert.equal(row(summary,'Bếp').registered_count,2);
  assert.ok(summary.warnings.some(w=>w.code==='INVALID_REGISTRATION'));assert.ok(!JSON.stringify(summary).includes(external.id));
});
test('missing profile and malformed shift produce unknown eligibility; Crew Leader never fills regular demand',()=>{
  const snapshot=mockSummarySnapshot(branch);snapshot.employees[0].is_active=null;
  let summary=summarizeRegistrations(snapshot);assert.equal(row(summary,'Bếp').registered_count,2);assert.equal(row(summary,'Bếp').eligible_count,null);assert.equal(row(summary,'Bếp').confirmed_eligible_count,1);
  snapshot.employees[0].is_active=true;snapshot.employees[0].skill_level='CREW_LEADER';
  summary=summarizeRegistrations(snapshot);assert.equal(row(summary,'Bếp').eligible_count,1);
  snapshot.shifts[0].end_time='not-time';assert.equal(row(summarizeRegistrations(snapshot),'Bếp').eligible_count,null);
});
test('eligibility reuses existing engine overlap and configured hours, without generating assignments',()=>{
  const snapshot=mockSummarySnapshot(branch);snapshot.employees[0].max_weekly_hours=3;
  snapshot.existing.push({employee_id:snapshot.employees[1].id,work_date:'2026-11-02',shift_id:snapshot.shifts[0].id,department_id:snapshot.departments[0].id});
  const summary=summarizeRegistrations(snapshot);assert.equal(row(summary,'Bếp').registered_count,2);assert.equal(row(summary,'Bếp').eligible_count,0);assert.equal(row(summary,'Bếp').shortage_count,2);
  assert.ok(!('assignments' in summary));
});
test('Mock and Supabase adapters produce identical summary contract and branch-scoped VALID queries',async()=>{
  const snapshot=mockSummarySnapshot(branch);snapshot.registrations=[...new Map(snapshot.registrations.map(r=>[r.employee_id+'/'+r.work_date+'/'+r.shift_id,r])).values()];const fixture=databaseFixture(snapshot);
  const mock=new MockRegistrationSummaryRepository();const real=new SupabaseRegistrationSummaryRepository(fixture.db);
  const a=summarizeRegistrations(await mock.load(branch,MOCK_PERIOD_ID));const b=summarizeRegistrations(await real.load(branch,MOCK_PERIOD_ID));
<<<<<<< Updated upstream
  assert.deepEqual(a.rows.map(r=>({...r,warnings:r.warnings.filter(w=>w.code!=='DUPLICATE_REGISTRATION')})),b.rows);assert.equal(a.period.id,b.period.id);assert.equal(a.period.status,b.period.status);assert.equal(a.source,'mock');assert.equal(b.source,'supabase');assert.equal(b.is_mock,false);
  assert.equal((await real.listPeriods(branch))[0].status,'CLOSED');
  for(const name of ['registration_periods','employees','staffing_requirements','branches'])assert.ok(fixture.queries.filter(q=>q.table===name).every(q=>q.filters.some(([k,v])=>(k==='branch_id'||(name==='branches'&&k==='id'))&&v===branch)));
=======
  assert.deepEqual(a.rows,b.rows);assert.deepEqual(a.period,b.period);assert.equal(a.source,'mock');assert.equal(b.source,'supabase');assert.equal(b.is_mock,false);
  assert.deepEqual(await mock.listPeriods(branch),await real.listPeriods(branch));
  for(const name of ['registration_periods_effective','employees','staffing_requirements','branches'])assert.ok(fixture.queries.filter(q=>q.table===name).every(q=>q.filters.some(([k,v])=>(k==='branch_id'||(name==='branches'&&k==='id'))&&v===branch)));
>>>>>>> Stashed changes
  assert.ok(fixture.queries.find(q=>q.table==='shift_registrations').filters.some(([k,v])=>k==='status'&&v==='VALID'));
  assert.ok(fixture.queries.find(q=>q.table==='employee_skills').filters.some(([k,v])=>k==='employee.branch_id'&&v===branch));
});
test('Supabase pagination never silently caps the period list at one page',async()=>{
<<<<<<< Updated upstream
  const fixture=databaseFixture(mockSummarySnapshot(branch));fixture.tables.registration_periods=Array.from({length:501},(_,i)=>({id:String(i),open_at:'2026-10-01T00:00:00Z',close_at:'2026-10-02T00:00:00Z'}));
=======
  const fixture=databaseFixture(mockSummarySnapshot(branch));fixture.tables.registration_periods_effective=Array.from({length:501},(_,i)=>({id:String(i)}));
>>>>>>> Stashed changes
  assert.equal((await new SupabaseRegistrationSummaryRepository(fixture.db).listPeriods(branch)).length,501);
  assert.equal(fixture.queries.filter(q=>q.table==='registration_periods_effective').length,2);
});
test('mock is explicit development-only; database failures never fallback',async()=>{
  assert.equal(registrationSummaryRepository({NODE_ENV:'development',SCHEDULING_DATA_SOURCE:'mock'}).source,'mock');
  assert.equal(registrationSummaryRepository({NODE_ENV:'development'}).source,'supabase');
  for(const env of [{NODE_ENV:'production',SCHEDULING_DATA_SOURCE:'mock'},{NODE_ENV:'test',SCHEDULING_DATA_SOURCE:'mock'},{SCHEDULING_DATA_SOURCE:'other'}])assert.throws(()=>registrationSummaryRepository(env),e=>e.code==='INVALID_SUMMARY_MODE');
  const fixture=databaseFixture(mockSummarySnapshot(branch),true);
  await assert.rejects(new SupabaseRegistrationSummaryRepository(fixture.db).load(branch,MOCK_PERIOD_ID),e=>e.code==='SUMMARY_DATABASE_ERROR'&&!e.message.includes('private'));
});
test('default mock mode generates a draft in memory instead of a Supabase write',async()=>{
  const previous={NODE_ENV:process.env.NODE_ENV,source:process.env.SCHEDULING_DATA_SOURCE};
  process.env.NODE_ENV='development';process.env.SCHEDULING_DATA_SOURCE='mock';
  try{const generated=await createDraft(MOCK_PERIOD_ID,branch,branch);assert.equal(generated.source,'mock');assert.equal(generated.result.schedule.status,'DRAFT');assert.ok(generated.result.assignments.length>0);}
  finally{process.env.NODE_ENV=previous.NODE_ENV;if(previous.source===undefined)delete process.env.SCHEDULING_DATA_SOURCE;else process.env.SCHEDULING_DATA_SOURCE=previous.source;}
});

test('no registrations retains all declared needs with zero eligible supply',()=>{
  const snapshot=mockSummarySnapshot(branch);snapshot.registrations=[];
  const summary=summarizeRegistrations(snapshot);assert.equal(summary.rows.length,snapshot.requirements.length);
  for(const row of summary.rows){assert.equal(row.registered_count,0);assert.equal(row.eligible_count,0);assert.equal(row.shortage_count,row.required_count);}
});
test('Supabase period outside manager branch returns 404 before loading employee data',async()=>{
  const filters=[];let calls=0;
  const db={from(table){calls++;assert.equal(table,'registration_periods_effective');return{select(){return this},eq(k,v){filters.push([k,v]);return this},maybeSingle:async()=>({data:null,error:null})}}};
  await assert.rejects(new SupabaseRegistrationSummaryRepository(db).load(branch,MOCK_PERIOD_ID),e=>e.status===404);
  assert.equal(calls,1);assert.ok(filters.some(([k,v])=>k==='branch_id'&&v===branch));
});
test('duplicate needs and incomplete employee skill data never become valid zero demand',()=>{
  const snapshot=mockSummarySnapshot(branch);snapshot.requirements.push({...snapshot.requirements[0]});
  let result=summarizeRegistrations(snapshot);assert.equal(row(result,'Bếp').required_count,null);assert.equal(row(result,'Bếp').status,'UNKNOWN');
  snapshot.requirements.pop();snapshot.employees[0].skills=undefined;
  result=summarizeRegistrations(snapshot);assert.equal(row(result,'Bếp').eligible_count,null);assert.ok(row(result,'Bếp').warnings.some(w=>w.code==='INCOMPLETE_EMPLOYEE_DATA'));
});

test('Supabase availability follows TV2 confirmed non-sample header and row timestamps, employee and shift scope',async()=>{
  const snapshot=mockSummarySnapshot(branch),employee=snapshot.employees[0].id;
  const changes=[
    f=>f.tables.registration_submissions_sourced=f.tables.registration_submissions_sourced.filter(h=>h.employee_id!==employee),
    f=>f.tables.registration_submissions_sourced.find(h=>h.employee_id===employee).status='DRAFT',
    f=>f.tables.registration_submissions_sourced.find(h=>h.employee_id===employee).submitted_at=null,
    f=>f.tables.registration_submissions_sourced.find(h=>h.employee_id===employee).sample_batch_id='synthetic-audit-id',
    f=>f.tables.shift_registrations.filter(r=>r.employee_id===employee).forEach(r=>r.submitted_at=null),
    f=>f.tables.employees.find(e=>e.id===employee).status='INACTIVE',
    f=>f.tables.employees.find(e=>e.id===employee).skill_level='CREW_LEADER',
    f=>f.tables.employees.find(e=>e.id===employee).user.is_active=false,
    f=>f.tables.employees.find(e=>e.id===employee).user.branch_id='foreign',
    f=>f.tables.shift_registrations.filter(r=>r.employee_id===employee).forEach(r=>r.work_date='2026-12-01'),
  ];
  for(const change of changes){
    const f=databaseFixture(structuredClone(snapshot));change(f);
    const loaded=await new SupabaseRegistrationSummaryRepository(f.db).load(branch,MOCK_PERIOD_ID);
    assert.ok(!loaded.registrations.some(r=>r.employee_id===employee));assert.equal(loaded.source,'supabase');
    assert.ok(f.queries.some(q=>q.table==='registration_submissions_sourced'&&q.filters.some(([k,v])=>k==='period_id'&&v===MOCK_PERIOD_ID)));
  }
  const f=databaseFixture(snapshot);f.tables.shifts[0].is_active=false;
  assert.equal((await new SupabaseRegistrationSummaryRepository(f.db).load(branch,MOCK_PERIOD_ID)).registrations.length,0);
});

test('effective period status is authoritative and schema/access errors never fall back to raw tables or MOCK',async()=>{
  const f=databaseFixture(mockSummarySnapshot(branch));Object.assign(f.tables.registration_periods_effective[0],{status:'OPEN',stored_status:'PLANNED'});
  const repository=new SupabaseRegistrationSummaryRepository(f.db);
  assert.equal((await repository.listPeriods(branch))[0].status,'OPEN');assert.equal((await repository.load(branch,MOCK_PERIOD_ID)).period.status,'OPEN');
  assert.ok(!f.queries.some(q=>q.table==='registration_periods'));
  for(const [code,expected] of [['PGRST205','SUMMARY_SCHEMA_NOT_READY'],['42703','SUMMARY_SCHEMA_NOT_READY'],['PGRST200','SUMMARY_SCHEMA_NOT_READY'],['42501','SUMMARY_ACCESS_DENIED'],['XX000','SUMMARY_DATABASE_ERROR']]){
    const broken=databaseFixture(mockSummarySnapshot(branch),{code,message:'private-provider-details'});
    await assert.rejects(new SupabaseRegistrationSummaryRepository(broken.db).load(branch,MOCK_PERIOD_ID),e=>e.code===expected&&e.status===503&&!e.message.includes('private-'));
  }
});
