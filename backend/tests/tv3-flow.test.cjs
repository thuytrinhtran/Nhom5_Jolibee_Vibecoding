const {test}=require('node:test');const assert=require('node:assert/strict');
process.env.NODE_ENV='test';process.env.SUPABASE_URL ||= 'https://example.supabase.co';process.env.SUPABASE_SECRET_KEY ||= 'isolated-test-placeholder';
const {tv3FlowSnapshot}=require('../dist/repositories/tv3-flow.fixture.js');
const {generateSchedule,reviewAssignments}=require('../dist/services/scheduling.engine.js');
const {createDraft,readDraft,listSchedulingPeriods,readSchedulingContext}=require('../dist/services/scheduling.service.js');
const {editMockDraft}=require('../dist/services/mock-scheduling.service.js');
const {readDemand,saveDemand}=require('../dist/services/staffing-demand.service.js');
const {registrationSummaryRepository}=require('../dist/repositories/registration-summary.repository.js');
const {UnconfiguredSchedulingAIAdvisor}=require('../dist/services/scheduling-ai-advisor.js');
const app=require('../dist/server.js').default;const {supabaseAdmin:db}=require('../dist/config/supabase.js');
const period='33333333-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000701';
async function flow(run){const old=[process.env.NODE_ENV,process.env.SCHEDULING_DATA_SOURCE,process.env.SCHEDULING_MOCK_SCENARIO];Object.assign(process.env,{NODE_ENV:'development',SCHEDULING_DATA_SOURCE:'mock',SCHEDULING_MOCK_SCENARIO:'tv3-flow'});try{return await run()}finally{for(const [i,key] of ['NODE_ENV','SCHEDULING_DATA_SOURCE','SCHEDULING_MOCK_SCENARIO'].entries()){if(old[i]===undefined)delete process.env[key];else process.env[key]=old[i];}}}
const plain=a=>({employee_id:a.employee_id,work_date:a.work_date,shift_id:a.shift_id,department_id:a.department_id});
test('requested eight-person scenario produces 8/9 with one service shortage in afternoon; cap is test-only',()=>{
 const snapshot=tv3FlowSnapshot(actor);assert.equal(snapshot.employees.length,8);assert.ok(snapshot.registrations.every(r=>r.status==='VALID'));
 const result=generateSchedule(snapshot);assert.equal(result.required_count,9);assert.equal(result.assigned_count,8);assert.equal(result.shortages.length,1);
 const shortage=result.shortages[0];assert.equal(snapshot.shifts.find(s=>s.id===shortage.shift_id).name,'Chiều');assert.equal(snapshot.departments.find(d=>d.id===shortage.department_id).name,'Phục vụ');assert.equal(shortage.missing_count,1);
 for(const employee of snapshot.employees)assert.ok(result.assignments.filter(a=>a.employee_id===employee.id).length<=1);
 const withoutCap=generateSchedule({...snapshot,test_rules:undefined});assert.equal(withoutCap.assigned_count,9);
 assert.throws(()=>reviewAssignments(snapshot,[...result.assignments.map(plain),{employee_id:snapshot.employees[6].id,work_date:'2026-11-02',shift_id:snapshot.shifts[1].id,department_id:snapshot.departments[2].id}]),e=>e.code==='DAILY_LIMIT_EXCEEDED');
});
test('manual demand changes drive mock generation and regeneration; prior versions remain immutable',()=>flow(async()=>{
 const branch='00000000-0000-4000-8000-000000000702';let data=await readDemand(period,branch);assert.equal(data.period.work_start_date,'2026-11-02');assert.equal(data.shifts.length,3);
 const need=data.requirements.find(r=>r.shift_id===data.shifts[1].id&&r.department_id===data.departments[2].id);
 const body={work_date:need.work_date,shift_id:need.shift_id,department_id:need.department_id,required_count:1,required_skill_name:need.required_skill_name,sales_forecast_ref:'Manual test',expected_updated_at:need.updated_at};
 await saveDemand(period,branch,actor,body);
 const first=await createDraft(period,actor,branch);assert.equal(first.result.required_count,8);assert.equal(first.result.assigned_count,8);assert.equal(first.result.schedule.status,'DRAFT');
 const retry=await createDraft(period,actor,branch);assert.equal(retry.reused,true);assert.equal(retry.result.schedule.id,first.result.schedule.id);
 data=await readDemand(period,branch);const latest=data.requirements.find(r=>r.id===need.id);await saveDemand(period,branch,actor,{...body,required_count:2,expected_updated_at:latest.updated_at});
 assert.equal((await readDraft(first.result.schedule.id,branch)).demand_changed,true);
 await assert.rejects(createDraft(period,actor,branch),e=>e.code==='MOCK_DRAFT_STALE');
 const second=await createDraft(period,actor,branch,{regenerate:true,expectedVersion:1});assert.equal(second.result.schedule.version,2);assert.equal(second.result.required_count,9);assert.equal(second.result.assigned_count,8);
 assert.equal((await readDraft(first.result.schedule.id,branch)).generation_snapshot.required_count,8);
 const options=await listSchedulingPeriods(branch);assert.equal(options[0].schedules.length,2);assert.equal((await readSchedulingContext(period,branch)).can_generate_mock,true);
}));
test('draft edits validate department, registration, daily cap, duplicates and overstaffing; valid edits create new versions',()=>flow(async()=>{
 const branch='00000000-0000-4000-8000-000000000703';const source=tv3FlowSnapshot(branch);const first=await createDraft(period,actor,branch);const saved=await readDraft(first.result.schedule.id,branch);const assignments=saved.assignments.map(plain);
 const adding={employee_id:source.employees[6].id,work_date:'2026-11-02',shift_id:source.shifts[1].id,department_id:source.departments[2].id};
 for(const invalid of [[...assignments,adding],[...assignments,assignments[0]],assignments.map((a,i)=>i===0?{...a,employee_id:source.employees[3].id}:a)])
   await assert.rejects(editMockDraft(saved.schedule.id,branch,actor,{expected_version:1,assignments:invalid}),e=>e.status===422);
 const changed=assignments.filter(a=>a.employee_id!==source.employees[6].id);changed.push(adding);
 const edit=await editMockDraft(saved.schedule.id,branch,actor,{expected_version:1,assignments:changed,note:'Move Minh to afternoon; keep shortage visible'});
 assert.equal(edit.schedule.version,2);assert.equal(edit.schedule.status,'DRAFT');const second=await readDraft(edit.schedule.id,branch);
 assert.equal(second.generation_snapshot.shortages[0].shift_id,source.shifts[0].id);assert.equal(second.generation_snapshot.assigned_count,8);
 assert.equal((await readDraft(saved.schedule.id,branch)).generation_snapshot.shortages[0].shift_id,source.shifts[1].id);
 await assert.rejects(editMockDraft(saved.schedule.id,branch,actor,{expected_version:1,assignments}),e=>e.code==='MOCK_VERSION_CHANGED');
 await assert.rejects(readDraft(edit.schedule.id,'foreign-branch'),e=>e.status===404);
}));
test('concurrent edits with one expected version allow one success',()=>flow(async()=>{
 const branch='00000000-0000-4000-8000-000000000704',first=await createDraft(period,actor,branch);
 const assignments=first.result.assignments.map(plain);const body={expected_version:1,assignments};
 const results=await Promise.allSettled([editMockDraft(first.result.schedule.id,branch,actor,body),editMockDraft(first.result.schedule.id,branch,actor,body)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
}));
test('AI advisor reports not configured for review, compare and suggest without fake content',async()=>{
 const advisor=new UnconfiguredSchedulingAIAdvisor();for(const method of ['review','compare','suggest']){const result=await advisor[method]({schedule_id:'test',version:3,input:tv3FlowSnapshot(actor),assignments:[]});assert.equal(result.message,'AI chưa được cấu hình');assert.equal(result.status,'NOT_CONFIGURED');assert.equal(result.version,3);assert.ok(!result.proposals&&!result.observations);}
});
test('scenario config never enables mock in production or falls back for unknown scenario',()=>{
 assert.throws(()=>registrationSummaryRepository({NODE_ENV:'production',SCHEDULING_DATA_SOURCE:'mock',SCHEDULING_MOCK_SCENARIO:'tv3-flow'}));
 assert.throws(()=>registrationSummaryRepository({NODE_ENV:'development',SCHEDULING_DATA_SOURCE:'mock',SCHEDULING_MOCK_SCENARIO:'typo'}),e=>e.code==='INVALID_MOCK_SCENARIO');
});
test('HTTP end-to-end mock flow keeps real RBAC and never reaches a Supabase business table/RPC',()=>flow(async()=>{
 const branch='00000000-0000-4000-8000-000000000705';let role='QL';const old={from:db.from,getUser:db.auth.getUser,rpc:db.rpc};
 db.auth.getUser=async()=>({data:{user:{id:actor}}});db.rpc=()=>assert.fail('must not write Supabase');
 db.from=table=>{assert.ok(['users','branches','employees'].includes(table),'mock business data must stay in memory');return{select(){return this},eq(){return this},single:async()=>({data:table==='users'?{id:actor,role,username:'fixture',branch_id:branch,is_active:true,must_change_password:false}:{name:'branch'}}),maybeSingle:async()=>({data:null})}};
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/schedules`;
 const headers={Authorization:'Bearer fixture','Content-Type':'application/json'};const request=(path,method='GET',body)=>fetch(base+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
 try{
  assert.equal((await fetch(base+'/periods')).status,401);role='NV';assert.equal((await request('/generate','POST',{period_id:period})).status,403);role='QL';
  const periods=await(await request('/periods')).json();assert.equal(periods.periods[0].work_end_date,'2026-11-08');
  const demand=(await(await request(`/periods/${period}/requirements`)).json()).result;const need=demand.requirements[0];
  const body={work_date:need.work_date,shift_id:need.shift_id,department_id:need.department_id,required_count:need.required_count,required_skill_name:need.required_skill_name,sales_forecast_ref:'Confirmed by test manager',expected_updated_at:need.updated_at};
  assert.equal((await request(`/periods/${period}/requirements`,'PUT',body)).status,200);
  const generated=await request('/generate','POST',{period_id:period});assert.equal(generated.status,201);const result=(await generated.json()).result;
  const read=(await(await request('/'+result.schedule.id)).json()).result;assert.equal(read.source,'mock');assert.equal(read.assignments.length,8);assert.equal(read.generation_snapshot.shortages[0].missing_count,1);
  const edit=await request('/'+result.schedule.id+'/draft-assignments','PATCH',{expected_version:1,assignments:read.assignments.map(plain),note:'Test checked'});assert.equal(edit.status,200);assert.equal((await edit.json()).result.schedule.version,2);
  const retried=await request('/generate','POST',{period_id:period});assert.equal(retried.status,200);
 }finally{db.from=old.from;db.rpc=old.rpc;db.auth.getUser=old.getUser;await new Promise(r=>server.close(r));}
}));

test('test launcher opts in via child-process environment without changing .env',()=>{
 const fs=require('node:fs'),vm=require('node:vm');let launched;
 const fakeRequire=Object.assign(name=>{assert.equal(name,'node:child_process');return{spawn:(executable,args,options)=>{launched={executable,args,options};return{on(){return this}}}}},{resolve:name=>{assert.equal(name,'tsx/cli');return'tsx-cli'}});
 vm.runInNewContext(fs.readFileSync('scripts/dev-tv3-test.cjs','utf8'),{require:fakeRequire,process:{execPath:'node',env:{NODE_ENV:'production',SCHEDULING_DATA_SOURCE:'supabase'}},console:{error(){}}});
 assert.equal(launched.options.env.NODE_ENV,'development');assert.equal(launched.options.env.SCHEDULING_DATA_SOURCE,'mock');assert.equal(launched.options.env.SCHEDULING_MOCK_SCENARIO,'tv3-flow');assert.equal(launched.args[1],'watch');
});
