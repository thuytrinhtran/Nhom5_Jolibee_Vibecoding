const {test}=require('node:test');const assert=require('node:assert/strict');
process.env.NODE_ENV='test';process.env.SUPABASE_URL ||= 'https://example.supabase.co';process.env.SUPABASE_SECRET_KEY ||= 'isolated-test-placeholder';
const {createDraft,readDraft,readSchedulingContext}=require('../dist/services/scheduling.service.js');
const {editMockDraft}=require('../dist/services/mock-scheduling.service.js');
const {readDemand,saveDemand}=require('../dist/services/staffing-demand.service.js');
const {validateSchedule,prepareApprovalHandoff,UnconfiguredScheduleApprovalGateway}=require('../dist/services/schedule-review.service.js');
const {reviewAssignments}=require('../dist/services/scheduling.engine.js');
const {tv3FlowSnapshot}=require('../dist/repositories/tv3-flow.fixture.js');
const app=require('../dist/server.js').default;const {supabaseAdmin:db}=require('../dist/config/supabase.js');
const period='33333333-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000801';
async function mode(scenario,run){const keys=['NODE_ENV','SCHEDULING_DATA_SOURCE','SCHEDULING_MOCK_SCENARIO'],old=keys.map(k=>process.env[k]);Object.assign(process.env,{NODE_ENV:'development',SCHEDULING_DATA_SOURCE:'mock'});if(scenario)process.env.SCHEDULING_MOCK_SCENARIO=scenario;else delete process.env.SCHEDULING_MOCK_SCENARIO;try{return await run()}finally{keys.forEach((key,i)=>{if(old[i]===undefined)delete process.env[key];else process.env[key]=old[i]})}}
const plain=a=>({employee_id:a.employee_id,work_date:a.work_date,shift_id:a.shift_id,department_id:a.department_id});
test('plain mock flag creates and edits from current saved demand without special scenario',()=>mode(undefined,async()=>{
 const branch='00000000-0000-4000-8000-000000000802';const data=await readDemand(period,branch);const current=data.requirements[0];
 await saveDemand(period,branch,actor,{work_date:current.work_date,shift_id:current.shift_id,department_id:current.department_id,required_count:1,required_skill_name:current.required_skill_name,sales_forecast_ref:'Existing manager input',expected_updated_at:current.updated_at});
 const draft=await createDraft(period,actor,branch);assert.equal(draft.source,'mock');assert.equal(draft.result.coverage.find(r=>r.id===current.id).required_count,1);
 assert.equal((await readSchedulingContext(period,branch)).can_generate_mock,true);
 const edited=await editMockDraft(draft.result.schedule.id,branch,actor,{expected_version:1,assignments:draft.result.assignments.map(plain)});assert.equal(edited.schedule.version,2);assert.equal((await readDraft(edited.schedule.id,branch)).source,'mock');
}));
test('mock records do not cross scenario boundary even for same branch/period',async()=>{
 const branch='00000000-0000-4000-8000-000000000803';let summaryId;
 await mode('summary',async()=>{summaryId=(await createDraft(period,actor,branch)).result.schedule.id;});
 await mode('tv3-flow',async()=>{await assert.rejects(readDraft(summaryId,branch),e=>e.status===404);const flow=await createDraft(period,actor,branch);assert.equal(flow.result.required_count,9);assert.equal(flow.result.schedule.version,1);});
 await mode('summary',async()=>{assert.equal((await readDraft(summaryId,branch)).schedule.version,1);});
});
test('validation/handoff block shortage, stale inputs and old versions; preparation never changes DRAFT status',()=>mode('tv3-flow',async()=>{
 const branch='00000000-0000-4000-8000-000000000804';const first=await createDraft(period,actor,branch),id=first.result.schedule.id;
 let check=await validateSchedule(id,branch,1);assert.equal(check.hard_constraints,'PASS');assert.equal(check.coverage_complete,false);assert.equal(check.can_submit,false);
 const blocked=await prepareApprovalHandoff(id,branch,actor,{expected_version:1});assert.equal(blocked.payload,null);assert.equal(blocked.delivery.sent,false);assert.equal(blocked.current_status,'DRAFT');
 const data=await readDemand(period,branch);const need=data.requirements.find(r=>r.shift_id===data.shifts[1].id&&r.department_id===data.departments[2].id);
 await saveDemand(period,branch,actor,{work_date:need.work_date,shift_id:need.shift_id,department_id:need.department_id,required_count:1,required_skill_name:need.required_skill_name,sales_forecast_ref:need.sales_forecast_ref,expected_updated_at:need.updated_at});
 check=await validateSchedule(id,branch,1);assert.equal(check.input_current,false);assert.equal(check.can_submit,false);
 const second=await createDraft(period,actor,branch,{regenerate:true,expectedVersion:1});
 await assert.rejects(validateSchedule(id,branch,1),e=>e.status===409);
 const ready=await prepareApprovalHandoff(second.result.schedule.id,branch,actor,{expected_version:2,note:'Manager reviewed'});
 assert.equal(ready.validation.can_submit,true);assert.equal(ready.payload.contract_version,'tv3-tv4.v1');assert.equal(ready.payload.current_status,'DRAFT');assert.equal(ready.payload.requested_status,'PENDING_APPROVAL');
 assert.equal(ready.payload.is_mock,true);assert.equal(ready.payload.branch_id,branch);assert.equal(ready.payload.prepared_by,actor);assert.equal(ready.payload.assignments.length,8);assert.ok(ready.payload.created_at);assert.ok(ready.payload.validation.input_revision);
 assert.equal(ready.delivery.configured,false);assert.equal(ready.delivery.sent,false);assert.equal((await readDraft(second.result.schedule.id,branch)).schedule.status,'DRAFT');
 await assert.rejects(new UnconfiguredScheduleApprovalGateway().submit(ready.payload),e=>e.code==='TV4_NOT_CONFIGURED');
 await assert.rejects(prepareApprovalHandoff(second.result.schedule.id,'foreign',actor,{expected_version:2}),e=>e.status===404);
 await assert.rejects(prepareApprovalHandoff(second.result.schedule.id,branch,actor,{expected_version:2,status:'APPROVED'}),e=>e.status===400);
}));
test('missing declared demand in summary fixture is not considered ready for TV4',()=>mode('summary',async()=>{
 const branch='00000000-0000-4000-8000-000000000805';const draft=await createDraft(period,actor,branch);const check=await validateSchedule(draft.result.schedule.id,branch,1);
 assert.equal(check.data_complete,false);assert.equal(check.can_submit,false);assert.ok(check.issues.some(issue=>issue.code==='INCOMPLETE_DATA'));
}));
test('Rule Engine returns specific skill/department/registration/overlap codes',()=>{
 const data=tv3FlowSnapshot(actor);const first=data.requirements[0];const base={employee_id:data.employees[0].id,work_date:first.work_date,shift_id:first.shift_id,department_id:first.department_id};
 assert.throws(()=>reviewAssignments(data,[{...base,employee_id:data.employees[3].id}]),e=>e.code==='DEPARTMENT_MISMATCH');
 const missingSkill=structuredClone(data);missingSkill.employees[0].skills=[];assert.throws(()=>reviewAssignments(missingSkill,[base]),e=>e.code==='SKILL_MISMATCH');
 const missingRegistration=structuredClone(data);missingRegistration.registrations=missingRegistration.registrations.filter(r=>r.employee_id!==base.employee_id);assert.throws(()=>reviewAssignments(missingRegistration,[base]),e=>e.code==='REGISTRATION_REQUIRED');
 const overlap=structuredClone(data);overlap.existing=[base];assert.throws(()=>reviewAssignments(overlap,[base]),e=>e.code==='SHIFT_OVERLAP');
});
test('HTTP review and handoff remain QL-scoped and never invoke TV4 or Supabase writes',()=>mode('tv3-flow',async()=>{
 const branch='00000000-0000-4000-8000-000000000806';const old={from:db.from,getUser:db.auth.getUser,rpc:db.rpc};let role='QL';
 db.auth.getUser=async()=>({data:{user:{id:actor}}});db.rpc=()=>assert.fail('no database writes');db.from=table=>{assert.ok(['users','branches','employees'].includes(table));return{select(){return this},eq(){return this},single:async()=>({data:table==='users'?{id:actor,username:'fixture',role,branch_id:branch,is_active:true,must_change_password:false}:{name:'branch'}}),maybeSingle:async()=>({data:null})}};
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}/api/schedules`;
 const headers={Authorization:'Bearer test','Content-Type':'application/json'};const post=(path,body)=>fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)});
 try{const draft=(await(await post('/generate',{period_id:period})).json()).result.schedule;
  for(const roleValue of ['NV','GS']){role=roleValue;assert.equal((await post(`/${draft.id}/validate`,{expected_version:1})).status,403);assert.equal((await post(`/${draft.id}/approval-handoff`,{expected_version:1})).status,403);}role='QL';
  assert.equal((await fetch(base+`/${draft.id}/validate`,{method:'POST'})).status,401);
  assert.equal((await post(`/${draft.id}/validate`,{})).status,400);
  const handoff=await post(`/${draft.id}/approval-handoff`,{expected_version:1});assert.equal(handoff.status,200);const prepared=(await handoff.json()).result;assert.equal(prepared.validation.can_submit,false);assert.equal(prepared.delivery.sent,false);assert.equal(prepared.current_status,'DRAFT');
 }finally{db.from=old.from;db.auth.getUser=old.getUser;db.rpc=old.rpc;await new Promise(resolve=>server.close(resolve));}
}));
