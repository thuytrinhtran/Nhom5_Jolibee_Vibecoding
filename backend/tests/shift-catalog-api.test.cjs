// Explicit isolated writer-test opt-in; production defaults remain locked.
process.env.TV3_DRAFT_PERSISTENCE_ENABLED='true';
const {test}=require('node:test'),assert=require('node:assert/strict');
process.env.NODE_ENV='test';process.env.SUPABASE_URL||='https://example.supabase.co';process.env.SUPABASE_SECRET_KEY||='isolated-test-placeholder';
const app=require('../dist/server.js').default,{supabaseAdmin:db}=require('../dist/config/supabase.js');
test('both mock scenarios expose three real fixture shift IDs; empty Ca 3 persists new demand and draft without touching Supabase',async()=>{
 const keys=['NODE_ENV','SCHEDULING_DATA_SOURCE','SCHEDULING_MOCK_SCENARIO'],env=keys.map(k=>process.env[k]),old={from:db.from,getUser:db.auth.getUser};
 Object.assign(process.env,{NODE_ENV:'development',SCHEDULING_DATA_SOURCE:'mock'});const branch='00000000-0000-4000-8000-000000009301';
 db.auth.getUser=async()=>({data:{user:{id:branch}}});db.from=table=>{assert.ok(['users','branches','employees'].includes(table),'mock business data must never reach Supabase');return{select(){return this},eq(){return this},single:async()=>({data:table==='users'?{id:branch,username:'isolated-test',role:'QL',branch_id:branch,is_active:true,must_change_password:false}:{name:'Branch'}}),maybeSingle:async()=>({data:null})}};
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/schedules`,headers={Authorization:'Bearer fixture','Content-Type':'application/json'};
 const get=async path=>{const r=await fetch(base+path,{headers});assert.equal(r.status,200);return r.json()};
 try {
  for(const scenario of ['summary','tv3-flow']) {
   process.env.SCHEDULING_MOCK_SCENARIO=scenario;const periods=(await get('/periods')).periods,period=periods[0];
   const demand=(await get(`/periods/${period.id}/requirements`)).result,context=(await get(`/periods/${period.id}`)).result;
   assert.equal(demand.shifts.length,3);assert.equal(context.shifts.length,3);assert.equal(new Set(demand.shifts.map(s=>s.id)).size,3);assert.deepEqual(context.shifts.map(s=>s.id),demand.shifts.map(s=>s.id));
   assert.deepEqual(demand.shifts.map(s=>[s.start_time,s.end_time]),[['08:00:00','12:00:00'],['12:00:00','17:00:00'],['17:00:00','22:00:00']]);
   const dates=[];for(let day=new Date(period.work_start_date);day.toISOString().slice(0,10)<=period.work_end_date;day.setUTCDate(day.getUTCDate()+1))dates.push(day.toISOString().slice(0,10));assert.equal(dates.length*demand.shifts.length,21);
   const late=demand.shifts[2],original=JSON.stringify(demand.requirements);assert.ok(!demand.requirements.some(r=>r.shift_id===late.id));assert.ok(!demand.summary.rows.some(r=>r.shift_id===late.id&&r.registered_count>0));
   const body={work_date:'2026-11-02',shift_id:late.id,department_id:demand.departments[0].id,required_count:2,required_skill_name:null,sales_forecast_ref:null,expected_updated_at:null};
   const save=await fetch(`${base}/periods/${period.id}/requirements`,{method:'PUT',headers,body:JSON.stringify(body)});assert.equal(save.status,200);const requirement=(await save.json()).result.requirement;
   const refreshed=(await get(`/periods/${period.id}/requirements`)).result;assert.equal(JSON.stringify(refreshed.requirements.filter(r=>r.id!==requirement.id)),original);assert.equal(refreshed.requirements.find(r=>r.id===requirement.id).required_count,2);
   const generated=await fetch(base+'/generate',{method:'POST',headers,body:JSON.stringify({period_id:period.id})});assert.equal(generated.status,201);const draft=(await generated.json()).result,saved=(await get(`/${draft.schedule.id}`)).result;
   const coverage=saved.generation_snapshot.coverage.find(r=>r.shift_id===late.id);assert.equal(coverage.required_count,2);assert.equal(coverage.assigned_count,0);assert.equal(coverage.missing_count,2);
   const reread=(await get(`/${draft.schedule.id}`)).result;assert.deepEqual(reread.assignments,saved.assignments);assert.deepEqual(reread.generation_snapshot,saved.generation_snapshot);assert.equal(reread.schedule.status,'DRAFT');
  }
 } finally {db.from=old.from;db.auth.getUser=old.getUser;keys.forEach((k,i)=>{if(env[i]===undefined)delete process.env[k];else process.env[k]=env[i]});await new Promise(r=>server.close(r));}
});
