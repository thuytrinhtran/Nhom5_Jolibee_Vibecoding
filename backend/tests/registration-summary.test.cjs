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
  const tables={registration_periods:[{...snapshot.period,schedules:[]}],branches:[snapshot.branch],departments:snapshot.departments,
    employees:snapshot.employees.map(e=>({...e,user:{is_active:e.is_active,role:e.role,branch_id:e.branch_id}})),
    shifts:snapshot.shifts,shift_registrations:snapshot.registrations,staffing_requirements:snapshot.requirements,
    employee_skills:snapshot.employees.flatMap(e=>(e.skills||[]).map(skill_name=>({employee_id:e.id,skill_name}))),
    shift_assignments:snapshot.existing,warning_configs:[]};
  const db={from(table){const query={table,filters:[],from:0,to:499};queries.push(query);
    const result=()=>({data:(tables[table]||[]).slice(query.from,query.to+1),error:fail?{message:'private failure'}:null});
    return {select(columns){query.columns=columns;return this},eq(k,v){query.filters.push([k,v]);return this},neq(){return this},gte(){return this},lte(){return this},or(){return this},order(){return this},range(a,b){query.from=a;query.to=b;return this},
      maybeSingle:async()=>{let data=result().data[0]??null;if(data&&table==='registration_periods'){const {schedules,...period}=data;data=period;}return{...result(),data}},single:async()=>({...result(),data:result().data[0]??null}),then(resolve){resolve(result())}};
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
  const snapshot=mockSummarySnapshot(branch),fixture=databaseFixture(snapshot);
  const mock=new MockRegistrationSummaryRepository();const real=new SupabaseRegistrationSummaryRepository(fixture.db);
  const a=summarizeRegistrations(await mock.load(branch,MOCK_PERIOD_ID));const b=summarizeRegistrations(await real.load(branch,MOCK_PERIOD_ID));
  assert.deepEqual(a.rows,b.rows);assert.deepEqual(a.period,b.period);assert.equal(a.source,'mock');assert.equal(b.source,'supabase');assert.equal(b.is_mock,false);
  assert.deepEqual(await mock.listPeriods(branch),await real.listPeriods(branch));
  for(const name of ['registration_periods','employees','staffing_requirements','branches'])assert.ok(fixture.queries.filter(q=>q.table===name).every(q=>q.filters.some(([k,v])=>(k==='branch_id'||(name==='branches'&&k==='id'))&&v===branch)));
  assert.ok(fixture.queries.find(q=>q.table==='shift_registrations').filters.some(([k,v])=>k==='status'&&v==='VALID'));
  assert.ok(fixture.queries.find(q=>q.table==='employee_skills').filters.some(([k,v])=>k==='employee.branch_id'&&v===branch));
});
test('Supabase pagination never silently caps the period list at one page',async()=>{
  const fixture=databaseFixture(mockSummarySnapshot(branch));fixture.tables.registration_periods=Array.from({length:501},(_,i)=>({id:String(i)}));
  assert.equal((await new SupabaseRegistrationSummaryRepository(fixture.db).listPeriods(branch)).length,501);
  assert.equal(fixture.queries.filter(q=>q.table==='registration_periods').length,2);
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
  const db={from(table){calls++;assert.equal(table,'registration_periods');return{select(){return this},eq(k,v){filters.push([k,v]);return this},maybeSingle:async()=>({data:null,error:null})}}};
  await assert.rejects(new SupabaseRegistrationSummaryRepository(db).load(branch,MOCK_PERIOD_ID),e=>e.status===404);
  assert.equal(calls,1);assert.ok(filters.some(([k,v])=>k==='branch_id'&&v===branch));
});
test('duplicate needs and incomplete employee skill data never become valid zero demand',()=>{
  const snapshot=mockSummarySnapshot(branch);snapshot.requirements.push({...snapshot.requirements[0]});
  let result=summarizeRegistrations(snapshot);assert.equal(row(result,'Bếp').required_count,null);assert.equal(row(result,'Bếp').status,'UNKNOWN');
  snapshot.requirements.pop();snapshot.employees[0].skills=undefined;
  result=summarizeRegistrations(snapshot);assert.equal(row(result,'Bếp').eligible_count,null);assert.ok(row(result,'Bếp').warnings.some(w=>w.code==='INCOMPLETE_EMPLOYEE_DATA'));
});
