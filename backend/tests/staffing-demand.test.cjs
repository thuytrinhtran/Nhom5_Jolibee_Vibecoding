const {test}=require('node:test');const assert=require('node:assert/strict');
process.env.NODE_ENV='test';process.env.SUPABASE_URL ||= 'https://example.supabase.co';process.env.SUPABASE_SECRET_KEY ||= 'isolated-test-placeholder';
const {readDemand,saveDemand,validateDemandInput}=require('../dist/services/staffing-demand.service.js');
const {MockRegistrationSummaryRepository,MOCK_PERIOD_ID,mockSummarySnapshot}=require('../dist/repositories/registration-summary.mock.js');
const {SupabaseRegistrationSummaryRepository}=require('../dist/repositories/registration-summary.supabase.js');
const {ScheduleError}=require('../dist/services/scheduling.engine.js');
const branch='00000000-0000-4000-8000-000000000003',actor='00000000-0000-4000-8000-000000000004';
const repo=new MockRegistrationSummaryRepository();
function input(snapshot,day='2026-11-05'){return{work_date:day,shift_id:snapshot.shifts[0].id,department_id:snapshot.departments[0].id,required_count:2,required_skill_name:'Bếp nóng',sales_forecast_ref:'Nguồn dự báo tuần — mô phỏng',expected_updated_at:null};}
test('validate count, date, foreign fields, skill length and expected revision before writing',()=>{
  const valid=input(mockSummarySnapshot(branch));assert.equal(validateDemandInput({...valid,required_count:0}).required_count,0);
  for(const change of [{required_count:-1},{required_count:1.2},{required_count:'2'},{required_count:null},{required_count:2147483648},{work_date:'2026-02-30'},{shift_id:'bad'},{department_id:'bad'},
    {branch_id:'foreign'},{created_by:'spoofed'},{required_skill_name:'a'.repeat(101)},{sales_forecast_ref:44},{expected_updated_at:undefined},{expected_updated_at:'not-time'}]){
    assert.throws(()=>validateDemandInput({...valid,...change}),e=>e.status===400);
  }
});
test('mock demand create/read/update retains creator, forecast and revisions across adapter instances',async()=>{
  const data=await readDemand(MOCK_PERIOD_ID,branch,repo),body=input(data);
  const created=await saveDemand(MOCK_PERIOD_ID,branch,actor,body,repo);assert.equal(created.is_mock,true);assert.equal(created.requirement.created_by,actor);
  let loaded=await readDemand(MOCK_PERIOD_ID,branch,new MockRegistrationSummaryRepository());let saved=loaded.requirements.find(r=>r.id===created.requirement.id);
  assert.equal(saved.sales_forecast_ref,body.sales_forecast_ref);assert.equal(loaded.forecast_mode,'REFERENCE_ONLY');assert.equal(loaded.staffing_formula_status,'NOT_CONFIGURED');
  assert.ok(loaded.summary.rows.some(r=>r.work_date===body.work_date&&r.department_id===body.department_id&&r.shortage_count===2));
  const update={...body,required_count:0,sales_forecast_ref:null,expected_updated_at:saved.updated_at};
  const updated=await saveDemand(MOCK_PERIOD_ID,branch,'different-actor',update,repo);
  assert.equal(updated.requirement.id,saved.id);assert.equal(updated.requirement.created_by,actor);assert.notEqual(updated.requirement.updated_at,saved.updated_at);
  await assert.rejects(saveDemand(MOCK_PERIOD_ID,branch,actor,update,repo),e=>e.code==='DEMAND_CHANGED');
  loaded=await readDemand(MOCK_PERIOD_ID,branch,repo);assert.equal(loaded.requirements.filter(r=>r.id===saved.id).length,1);
  const other=await readDemand(MOCK_PERIOD_ID,'other-branch',repo);assert.ok(!other.requirements.some(r=>r.id===saved.id));
});
test('two concurrent mock updates with same expected_updated_at allow only one success',async()=>{
  const local='concurrency-branch';const snapshot=await repo.load(local,MOCK_PERIOD_ID);const existing=snapshot.requirements[0];
  const body={...input(snapshot,existing.work_date),required_count:3,expected_updated_at:existing.updated_at};
  const results=await Promise.allSettled([saveDemand(MOCK_PERIOD_ID,local,actor,body,repo),saveDemand(MOCK_PERIOD_ID,local,actor,{...body,required_count:4},repo)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
});
test('invalid week, inactive/cross-branch shift and unknown department cannot be saved',async()=>{
  const snapshot=mockSummarySnapshot(branch);let writes=0;
  const fake={source:'mock',load:async()=>structuredClone(snapshot),saveRequirement:async()=>{writes++;assert.fail('invalid data write')}};
  const body=input(snapshot);
  for(const change of [{work_date:'2026-11-09'},{department_id:'00000000-0000-4000-8000-000000000999'}])await assert.rejects(saveDemand(MOCK_PERIOD_ID,branch,actor,{...body,...change},fake),e=>e.status===422);
  snapshot.shifts[0].is_active=false;await assert.rejects(saveDemand(MOCK_PERIOD_ID,branch,actor,body,fake),e=>e.status===422);
  snapshot.shifts[0].is_active=true;snapshot.shifts[0].branch_id='foreign';await assert.rejects(saveDemand(MOCK_PERIOD_ID,branch,actor,body,fake),e=>e.status===422);
  assert.equal(writes,0);
});
test('out-of-branch period never reaches a write and data failures have no mock fallback',async()=>{
  const fake={source:'supabase',load:async()=>{throw new ScheduleError(404,'PERIOD_NOT_FOUND','Missing')},saveRequirement:async()=>assert.fail('must not write')};
  await assert.rejects(saveDemand(MOCK_PERIOD_ID,branch,actor,input(mockSummarySnapshot(branch)),fake),e=>e.status===404);
});
function writeFixture(response){const calls=[];return{calls,db:{from(table){assert.equal(table,'staffing_requirements');return{
  insert(payload){calls.push(['insert',payload]);return this},update(payload){calls.push(['update',payload]);return this},eq(k,v){calls.push(['eq',k,v]);return this},select(columns){calls.push(['select',columns]);return this},maybeSingle:async()=>response,
}}}};}
test('Supabase saves one row atomically and scopes conditional update; creator is never overwritten',async()=>{
  const body=input(mockSummarySnapshot(branch));const response={data:{id:'saved',...body,created_by:actor,updated_at:'2026-11-01T00:00:00Z'},error:null};
  const create=writeFixture(response);await new SupabaseRegistrationSummaryRepository(create.db).saveRequirement(branch,MOCK_PERIOD_ID,actor,body,null);
  assert.equal(create.calls[0][0],'insert');assert.equal(create.calls[0][1].branch_id,branch);assert.equal(create.calls[0][1].created_by,actor);assert.equal(create.calls[0][1].excludes_crew_leader,true);assert.ok(!('expected_updated_at' in create.calls[0][1]));
  const update=writeFixture(response);await new SupabaseRegistrationSummaryRepository(update.db).saveRequirement(branch,MOCK_PERIOD_ID,actor,{...body,expected_updated_at:'2026-11-01T00:00:00Z'},'saved');
  assert.equal(update.calls[0][0],'update');assert.ok(!('created_by' in update.calls[0][1]));assert.ok(update.calls.some(c=>c[0]==='eq'&&c[1]==='branch_id'&&c[2]===branch));assert.ok(update.calls.some(c=>c[0]==='eq'&&c[1]==='updated_at'&&c[2]==='2026-11-01T00:00:00Z'));
});
test('Supabase schema/permission/conflict/database failures are explicit, never fake success',async()=>{
  for(const [response,code] of [[{data:null,error:null},'DEMAND_CHANGED'],[{data:null,error:{code:'23505'}},'DEMAND_CHANGED'],[{data:null,error:{code:'42501'}},'DEMAND_WRITE_NOT_ALLOWED'],
    [{data:null,error:{code:'42703',message:'secret details'}},'DEMAND_SCHEMA_NOT_READY'],[{data:null,error:{code:'PGRST204'}},'DEMAND_SCHEMA_NOT_READY'],[{data:null,error:{code:'XX000',message:'secret details'}},'DEMAND_DATABASE_ERROR']]){
    const fixture=writeFixture(response);await assert.rejects(new SupabaseRegistrationSummaryRepository(fixture.db).saveRequirement(branch,MOCK_PERIOD_ID,actor,input(mockSummarySnapshot(branch)),null),e=>e.code===code&&!e.message.includes('secret details'));
  }
});
