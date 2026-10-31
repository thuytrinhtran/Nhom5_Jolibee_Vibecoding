// Explicit isolated writer-test opt-in; production defaults remain locked.
process.env.TV3_DRAFT_PERSISTENCE_ENABLED='true';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
process.env.NODE_ENV='test';process.env.SUPABASE_URL||='https://example.supabase.co';process.env.SUPABASE_SECRET_KEY||='isolated-test-placeholder';
const {readDemand,saveDemand,clearDemand}=require('../dist/services/staffing-demand.service.js');
const {MockRegistrationSummaryRepository,MOCK_PERIOD_ID}=require('../dist/repositories/registration-summary.mock.js');
const {SupabaseRegistrationSummaryRepository}=require('../dist/repositories/registration-summary.supabase.js');
const {generateSchedule}=require('../dist/services/scheduling.engine.js');
const {createDraft,readDraft}=require('../dist/services/scheduling.service.js');
function load(path,overrides={}){const code=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx={exports:{},Intl,Date,Map,Set,Error,require:id=>overrides[id]??require(id)};vm.runInNewContext(code,ctx);return ctx.exports;}
const view=load('../frontend/src/services/staffing-demand.view.ts'),grid=load('../frontend/src/services/staffing-demand.grid.ts',{'./staffing-demand.view':view});
const actor='00000000-0000-4000-8000-000000008001';
test('weekly grid -> mock save -> reload -> actual draft generation uses edited demand, zero and unknown correctly',async()=>{
 const old=[process.env.NODE_ENV,process.env.SCHEDULING_DATA_SOURCE,process.env.SCHEDULING_MOCK_SCENARIO];Object.assign(process.env,{NODE_ENV:'development',SCHEDULING_DATA_SOURCE:'mock',SCHEDULING_MOCK_SCENARIO:'tv3-flow'});
 try {
  const branch='00000000-0000-4000-8000-000000008002',data=await readDemand(MOCK_PERIOD_ID,branch);assert.equal(grid.gridCells(data).length,63);
  const baseline=await createDraft(MOCK_PERIOD_ID,actor,branch);assert.equal(baseline.result.required_count,9);assert.equal(baseline.result.assigned_count,8);assert.equal(baseline.result.shortages[0].missing_count,1);
  const need=data.requirements.find(r=>r.shift_id===data.shifts[1].id&&r.department_id===data.departments[2].id);
  const zero={work_date:'2026-11-03',shift_id:data.shifts[2].id,department_id:data.departments[0].id};
  const result=await grid.saveGrid(data,{[view.demandRowKey(need)]:{count:'1',forecast:need.sales_forecast_ref},[view.demandRowKey(zero)]:{count:'0',forecast:''}}, {saveDemand:(period,body)=>saveDemand(period,branch,actor,body),clearDemand:(period,body)=>clearDemand(period,branch,body)});
  assert.equal(result.saved,2);assert.equal(Object.keys(result.errors).length,0);
  const reloaded=await readDemand(MOCK_PERIOD_ID,branch);assert.equal(reloaded.requirements.find(r=>r.id===need.id).required_count,1);assert.equal(reloaded.requirements.find(r=>view.demandRowKey(r)===view.demandRowKey(zero)).required_count,0);
  assert.equal((await readDraft(baseline.result.schedule.id,branch)).demand_changed,true);
  const draft=await createDraft(MOCK_PERIOD_ID,actor,branch,{regenerate:true,expectedVersion:1});assert.equal(draft.result.required_count,8);assert.equal(draft.result.assigned_count,8);assert.equal(draft.result.shortages.length,0);assert.equal(draft.result.schedule.status,'DRAFT');
  const savedZero=reloaded.requirements.find(r=>view.demandRowKey(r)===view.demandRowKey(zero));
  await clearDemand(MOCK_PERIOD_ID,branch,{...zero,expected_updated_at:savedZero.updated_at});
  const unknown=await readDemand(MOCK_PERIOD_ID,branch);assert.ok(!unknown.requirements.some(r=>r.id===savedZero.id));assert.equal(grid.storedValue(unknown,view.demandRowKey(zero)).count,'');
 } finally {for(const [i,k]of ['NODE_ENV','SCHEDULING_DATA_SOURCE','SCHEDULING_MOCK_SCENARIO'].entries()){if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i];}}
});
test('clearing demand respects branch, revision, concurrency and forecast metadata; adapters share absence contract',async()=>{
 const repo=new MockRegistrationSummaryRepository('tv3-flow'),branch='00000000-0000-4000-8000-000000008003',data=await repo.load(branch,MOCK_PERIOD_ID),r=data.requirements[0];
 const body={work_date:r.work_date,shift_id:r.shift_id,department_id:r.department_id,expected_updated_at:r.updated_at};
 await assert.rejects(clearDemand(MOCK_PERIOD_ID,'other-branch',{...body,expected_updated_at:'2000-01-01T00:00:00Z'},repo),e=>e.status===409);
 const attempts=await Promise.allSettled([clearDemand(MOCK_PERIOD_ID,branch,body,repo),clearDemand(MOCK_PERIOD_ID,branch,body,repo)]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
 const loaded=await repo.load(branch,MOCK_PERIOD_ID);assert.ok(!loaded.requirements.some(row=>row.id===r.id));assert.equal((await repo.load('other-branch',MOCK_PERIOD_ID)).requirements.length,data.requirements.length);
 assert.ok(generateSchedule(loaded).required_count<data.requirements.reduce((n,r)=>n+r.required_count,0));
 const calls=[];const adapter=new SupabaseRegistrationSummaryRepository({from(table){calls.push(['from',table]);return{delete(){calls.push(['delete']);return this},eq(k,v){calls.push(['eq',k,v]);return this},select(){return this},maybeSingle:async()=>({data:{id:r.id}})}}});
 await adapter.clearRequirement(branch,MOCK_PERIOD_ID,r.id,r.updated_at);assert.ok(calls.some(c=>c[1]==='branch_id'&&c[2]===branch));assert.ok(calls.some(c=>c[1]==='updated_at'&&c[2]===r.updated_at));
 const unavailable=new SupabaseRegistrationSummaryRepository({from(){return{delete(){return this},eq(){return this},select(){return this},maybeSingle:async()=>({error:{code:'42501'}})}}});
 await assert.rejects(unavailable.clearRequirement(branch,MOCK_PERIOD_ID,r.id,r.updated_at),e=>e.code==='DEMAND_WRITE_NOT_ALLOWED');
});
