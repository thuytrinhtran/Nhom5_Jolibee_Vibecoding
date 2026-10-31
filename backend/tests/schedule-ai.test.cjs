// Explicit isolated writer-test opt-in; production defaults remain locked.
process.env.TV3_DRAFT_PERSISTENCE_ENABLED='true';
const {test}=require('node:test');const assert=require('node:assert/strict');
process.env.NODE_ENV='test';process.env.SUPABASE_URL||='https://example.supabase.co';process.env.SUPABASE_SECRET_KEY||='isolated-test-placeholder';
const {evaluateSchedule,readAIEvaluation}=require('../dist/services/schedule-ai.service.js');
const {buildAISummary}=require('../dist/services/schedule-ai.summary.js');const {parseAIReport}=require('../dist/services/schedule-ai.report.js');
const {schedulingAIAdvisor,GeminiSchedulingAIAdvisor}=require('../dist/services/schedule-ai.gemini.js');
const {inspectSchedule}=require('../dist/services/schedule-review.service.js');const {createDraft,readDraft}=require('../dist/services/scheduling.service.js');
const {readDemand,saveDemand}=require('../dist/services/staffing-demand.service.js');const {editMockDraft}=require('../dist/services/mock-scheduling.service.js');
const {MockScheduleAIRepository,SupabaseScheduleAIRepository}=require('../dist/repositories/schedule-ai.repository.js');
const period='33333333-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000009001';
const plain=a=>({employee_id:a.employee_id,work_date:a.work_date,shift_id:a.shift_id,department_id:a.department_id});
async function mode(run){const keys=['NODE_ENV','SCHEDULING_DATA_SOURCE','SCHEDULING_MOCK_SCENARIO','TV3_AI_EXTERNAL_ENABLED'],old=keys.map(k=>process.env[k]);Object.assign(process.env,{NODE_ENV:'development',SCHEDULING_DATA_SOURCE:'mock',SCHEDULING_MOCK_SCENARIO:'tv3-flow',TV3_AI_EXTERNAL_ENABLED:'false'});try{return await run()}finally{keys.forEach((k,i)=>{if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i]})}}
const report=(conclusion='NEEDS_ADJUSTMENT',suggestions=[])=>({conclusion,good_points:['Test double: các phân công tuân thủ đăng ký.'],concerns:[],limitations:['Test double: chưa có ưu tiên nguyện vọng.'],suggestions});
const advisor=fn=>({configured:true,model:'test-double',evaluate:fn});
async function make(branch){return(await createDraft(period,actor,branch)).result.schedule.id;}
async function balance(branch){const data=await readDemand(period,branch),r=data.requirements.find(r=>r.shift_id===data.shifts[1].id&&r.department_id===data.departments[2].id);await saveDemand(period,branch,actor,{work_date:r.work_date,shift_id:r.shift_id,department_id:r.department_id,required_count:1,required_skill_name:r.required_skill_name,sales_forecast_ref:r.sales_forecast_ref,expected_updated_at:r.updated_at});}

test('AI disabled even with key unless provider, model AND explicit external opt-in are configured',()=>mode(async()=>{
 for(const env of [{GEMINI_API_KEY:'isolated-test-key'},{TV3_AI_EXTERNAL_ENABLED:'true',GEMINI_API_KEY:'isolated-test-key'},{TV3_AI_EXTERNAL_ENABLED:'true',TV3_AI_PROVIDER:'gemini',TV3_AI_MODEL:'gemini-test'},{TV3_AI_EXTERNAL_ENABLED:'false',TV3_AI_PROVIDER:'gemini',TV3_AI_MODEL:'gemini-test',GEMINI_API_KEY:'isolated-test-key'}])assert.equal(schedulingAIAdvisor(env).configured,false);
 assert.equal(schedulingAIAdvisor({TV3_AI_EXTERNAL_ENABLED:'true',TV3_AI_PROVIDER:'gemini',TV3_AI_MODEL:'gemini-test',GEMINI_API_KEY:'isolated-test-key'}).configured,true);
 const branch='00000000-0000-4000-8000-000000009002',id=await make(branch);const result=await evaluateSchedule(id,branch,{expected_version:1},{repository:{latest:()=>assert.fail('unconfigured AI must not access AI tables')}});assert.equal(result.status,'NOT_CONFIGURED');assert.equal(result.evaluation,null);
 assert.equal((await readDraft(id,branch)).schedule.status,'DRAFT');
}));
test('shortage review sends only minimal pseudonymous structured summary; persists and reads evaluation without editing draft',()=>mode(async()=>{
 const branch='00000000-0000-4000-8000-000000009003',id=await make(branch);let sent;
 const before=await readDraft(id,branch),fake=advisor(async summary=>{sent=summary;return report()});
 const result=await evaluateSchedule(id,branch,{expected_version:1},{advisor:fake});assert.equal(result.status,'AVAILABLE');assert.equal(result.evaluation.report.conclusion,'NEEDS_ADJUSTMENT');
 assert.equal(sent.coverage.reduce((n,r)=>n+r.required-r.assigned,0),1);assert.ok(sent.employees.every(e=>/^E\d+$/.test(e.code)));assert.ok(sent.employees.every(e=>Number.isFinite(e.total_weekly_hours)));assert.ok(sent.missing_criteria.some(v=>v.includes('NEW')));
 assert.equal(new Set(sent.coverage.map(r=>r.work_date)).size,1);assert.equal(new Set(sent.coverage.map(r=>r.shift_code)).size,2);assert.ok(sent.coverage.length<63,'no full-week demand prerequisite');
 const serialized=JSON.stringify(sent);for(const name of ['NV01 An','NV08 Phúc','Phúc',actor,branch,id,'sales_forecast_ref','created_by','full_name','branch_id','employee_id'])assert.ok(!serialized.includes(name),name);
 assert.ok(sent.employees.every(e=>new Set(e.registered.map(r=>`${r.work_date}/${r.shift_code}`)).size===e.registered.length));
 const stored=await readAIEvaluation(id,branch,1,{advisor:fake});assert.equal(stored.status,'AVAILABLE');assert.equal(stored.evaluation.input_revision,result.evaluation.input_revision);assert.deepEqual((await readDraft(id,branch)).assignments,before.assignments);
 const scoped=await inspectSchedule(id,branch,1),foreign={id:'55555555-0000-4000-8000-000000000888',name:'Other branch shift',branch_id:'foreign-branch',start_time:'22:00:00',end_time:'23:00:00',is_active:true};scoped.rule_snapshot.shifts.push(foreign);scoped.rule_snapshot.registrations.push({id:'foreign',period_id:period,employee_id:scoped.rule_snapshot.employees[0].id,work_date:'2026-11-02',shift_id:foreign.id,status:'VALID'});const own=buildAISummary(scoped).summary;assert.ok(!own.shifts.some(s=>s.end==='23:00:00'));assert.ok(!own.employees.flatMap(e=>e.registered).some(r=>r.shift_code==='S004'));
}));
test('fully staffed schedule accepts suitable report, missing demand requires insufficient-data conclusion',()=>mode(async()=>{
 const branch='00000000-0000-4000-8000-000000009004';await balance(branch);const id=await make(branch),fake=advisor(async()=>report('SUITABLE'));
 assert.equal((await evaluateSchedule(id,branch,{expected_version:1},{advisor:fake})).evaluation.report.conclusion,'SUITABLE');
 const state=await inspectSchedule(id,branch,1);state.validation.data_complete=false;
 const deps={inspect:async()=>state,advisor:advisor(async()=>report('INSUFFICIENT_DATA')),repository:new MockScheduleAIRepository()};
 assert.equal((await evaluateSchedule(id,branch,{expected_version:1},deps)).evaluation.report.conclusion,'INSUFFICIENT_DATA');
 await assert.rejects(evaluateSchedule(id,branch,{expected_version:1},{...deps,advisor:fake}),e=>e.code==='AI_CONTRADICTS_RULES');
}));
test('mandatory Rule Engine failure/missing employee data blocks AI; composition warnings cannot become suitable',()=>mode(async()=>{
 const branch='00000000-0000-4000-8000-000000009005',id=await make(branch),state=await inspectSchedule(id,branch,1);let calls=0;const fake=advisor(async()=>{calls++;return report('SUITABLE')});
 for(const hard of ['FAIL','UNKNOWN']){const invalid=structuredClone(state);invalid.validation.hard_constraints=hard;invalid.validation.issues=[{code:hard==='FAIL'?'SKILL_MISMATCH':'INCOMPLETE_EMPLOYEE_DATA',message:'Test double'}];assert.equal((await evaluateSchedule(id,branch,{expected_version:1},{advisor:fake,inspect:async()=>invalid})).status,'BLOCKED');}assert.equal(calls,0);
 const warned=structuredClone(state);warned.validation.coverage_complete=true;warned.validation.coverage[0].warning='MANY_NEW_WITHOUT_CREW_TRAINING';
 await assert.rejects(evaluateSchedule(id,branch,{expected_version:1},{advisor:fake,inspect:async()=>warned}),e=>e.code==='AI_CONTRADICTS_RULES');
 const actual=structuredClone(state);actual.rule_snapshot.employees.filter(e=>e.department_id===actual.rule_snapshot.departments[0].id).forEach(e=>e.skill_level='NEW');actual.rule_snapshot.new_employee_count_threshold=1;
 const summary=buildAISummary(actual).summary;assert.ok(summary.coverage.some(r=>r.warning==='MANY_NEW_WITHOUT_CREW_TRAINING'));assert.ok(summary.coverage.some(r=>r.levels.NEW>=1));
}));
test('AI proposal violating skills, department, overlap/duplicates or daily cap is REJECTED; valid proposal remains unapplied',()=>mode(async()=>{
 const branch='00000000-0000-4000-8000-000000009006',id=await make(branch),state=await inspectSchedule(id,branch,1),prepared=buildAISummary(state),assignments=prepared.summary.employees.flatMap(e=>e.assignments);
 const kitchen=assignments.find(a=>a.department_code==='D001'),cashier=assignments.find(a=>a.department_code==='D002');
 const fake=advisor(async()=>report('NEEDS_ADJUSTMENT',[
  {description:'Test double: sai bộ phận',reason:'Kiểm tra luật',candidate_assignments:assignments.map(a=>a===kitchen?{...a,employee_code:cashier.employee_code}:a)},
  {description:'Test double: trùng',reason:'Kiểm tra luật',candidate_assignments:[...assignments,assignments[0]]},
  {description:'Test double: phương án hợp lệ',reason:'Không áp dụng',candidate_assignments:assignments},
  {description:'Test double: hai ca/ngày',reason:'Kiểm tra cap thử nghiệm',candidate_assignments:[...assignments,{employee_code:'E007',work_date:'2026-11-02',shift_code:'S002',department_code:'D003'}]},
  {description:'Test double: mã không tồn tại',reason:'Không được tự tạo nhân viên',candidate_assignments:assignments.map((a,i)=>i===0?{...a,employee_code:'E999'}:a)},
 ]));const result=await evaluateSchedule(id,branch,{expected_version:1},{advisor:fake}),suggestions=result.evaluation.report.suggestions;
 assert.equal(suggestions[0].rule_check.status,'REJECTED');assert.equal(suggestions[0].rule_check.code,'DEPARTMENT_MISMATCH');assert.equal(suggestions[1].rule_check.code,'DUPLICATE_ASSIGNMENT');assert.equal(suggestions[2].rule_check.status,'PASS');assert.equal(suggestions[3].rule_check.code,'DAILY_LIMIT_EXCEEDED');assert.equal(suggestions[4].rule_check.code,'UNKNOWN_ALIAS');
 const saved=await readDraft(id,branch);assert.equal(saved.schedule.version,1);assert.equal(saved.schedule.status,'DRAFT');assert.equal(saved.assignments.length,8);
 const skill=structuredClone(state),extra={...skill.rule_snapshot.employees[0],id:'55555555-0000-4000-8000-000000000099',full_name:'Private Person',skills:[]};skill.rule_snapshot.employees.push(extra);skill.rule_snapshot.registrations.push({id:'extra',period_id:period,employee_id:extra.id,work_date:'2026-11-02',shift_id:skill.rule_snapshot.shifts[0].id,status:'VALID'});
 const more=buildAISummary(skill),extraCode=more.aliases.find(a=>a.employee_id===extra.id).code;
 const bad=advisor(async()=>report('NEEDS_ADJUSTMENT',[{description:'Test double',reason:'Sai kỹ năng',candidate_assignments:assignments.map(a=>a===kitchen?{...a,employee_code:extraCode}:a)}]));
 const rejected=await evaluateSchedule(id,branch,{expected_version:1},{advisor:bad,inspect:async()=>skill});assert.equal(rejected.evaluation.report.suggestions[0].rule_check.code,'SKILL_MISMATCH');
}));
test('invalid AI JSON/fields/conclusions are failures, not fabricated success; raw errors never leak',()=>mode(async()=>{
 const branch='00000000-0000-4000-8000-000000009007',id=await make(branch);
 for(const raw of ['not JSON',{}, {...report(),good_points:'bad'},{...report(),conclusion:'APPROVED'},{...report(),secret:'unexpected'},{...report(),suggestions:[{description:'x',reason:'x',candidate_assignments:[{employee_code:'uuid',work_date:'2026-11-02',shift_code:'S001',department_code:'D001'}]}]}])assert.throws(()=>parseAIReport(raw),e=>e.code==='AI_INVALID_RESPONSE');
 await assert.rejects(evaluateSchedule(id,branch,{expected_version:1},{advisor:advisor(async()=>({invalid:'raw-private-error'}))}),e=>e.code==='AI_INVALID_RESPONSE'&&!e.message.includes('raw-private-error'));
 assert.equal((await readAIEvaluation(id,branch,1,{advisor:advisor(async()=>report())})).status,'FAILED');
}));
test('saved evaluation becomes STALE after demand edit; new version and changes during provider latency invalidate old response',()=>mode(async()=>{
 const branch='00000000-0000-4000-8000-000000009008',id=await make(branch),fake=advisor(async()=>report());
 await evaluateSchedule(id,branch,{expected_version:1},{advisor:fake});await balance(branch);assert.equal((await readAIEvaluation(id,branch,1,{advisor:fake})).status,'STALE');
 const next=await createDraft(period,actor,branch,{regenerate:true,expectedVersion:1});await assert.rejects(evaluateSchedule(id,branch,{expected_version:1},{advisor:fake}),e=>e.code==='SCHEDULE_VERSION_CHANGED');
 const delayed=advisor(async()=>{await editMockDraft(next.result.schedule.id,branch,actor,{expected_version:2,assignments:next.result.assignments.map(plain)});return report('SUITABLE')});
 await assert.rejects(evaluateSchedule(next.result.schedule.id,branch,{expected_version:2},{advisor:delayed}),e=>e.status===409);
 assert.equal(await new MockScheduleAIRepository().latest(next.result.schedule.id),null);
}));
test('same-version data mutation while AI runs is rejected; duplicate concurrent requests call provider once',()=>mode(async()=>{
 const branch='00000000-0000-4000-8000-000000009009',id=await make(branch);let release,entered;const gate=new Promise(r=>release=r),ready=new Promise(r=>entered=r);let calls=0;
 const fake=advisor(async()=>{calls++;entered();await gate;return report()});const first=evaluateSchedule(id,branch,{expected_version:1},{advisor:fake});await ready;
 await assert.rejects(evaluateSchedule(id,branch,{expected_version:1},{advisor:fake}),e=>e.code==='AI_REVIEW_IN_PROGRESS');await balance(branch);release();await assert.rejects(first,e=>e.code==='AI_REVIEW_STALE');assert.equal(calls,1);
}));
test('Gemini adapter performs real HTTP protocol through injected transport, handles schema and safe failures without live network',async()=>{
 let captured;const transport=async(url,options)=>{captured={url,options};return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(report())}]}}]}))};
 const adapter=new GeminiSchedulingAIAdvisor('isolated-test-key','gemini-test',transport);const result=await adapter.evaluate({employees:[],coverage:[],contract_version:'tv3-ai.v1'});assert.equal(result.conclusion,'NEEDS_ADJUSTMENT');assert.ok(captured.url.endsWith('/gemini-test:generateContent'));assert.ok(!captured.url.includes('isolated-test-key'));assert.equal(captured.options.headers['x-goog-api-key'],'isolated-test-key');assert.equal(captured.options.redirect,'error');const body=JSON.parse(captured.options.body);assert.equal(body.generationConfig.responseFormat.text.mimeType,'APPLICATION_JSON');assert.ok(body.generationConfig.responseFormat.text.schema.required.includes('conclusion'));assert.equal(body.tools,undefined);
 for(const [reply,code,status] of [[new Response('private-provider-error',{status:429}),'AI_PROVIDER_UNAVAILABLE',503],[new Response('bad json'),'AI_INVALID_RESPONSE',502],[new Response(JSON.stringify({candidates:[{finishReason:'MAX_TOKENS'}]})),'AI_INVALID_RESPONSE',502]])await assert.rejects(new GeminiSchedulingAIAdvisor('isolated-test-key','gemini-test',async()=>reply).evaluate({}),e=>!e.message.includes('private-provider-error')&&e.code===code&&e.status===status);
});
test('Gemini outbound subset keeps supported constraints while strict parser rejects oversized/extra fields',()=>{
 const {AI_REPORT_SCHEMA,GEMINI_AI_REPORT_SCHEMA}=require('../dist/services/schedule-ai.report.js');
 assert.ok(JSON.stringify(AI_REPORT_SCHEMA).includes('maxLength'));
 assert.ok(!JSON.stringify(GEMINI_AI_REPORT_SCHEMA).includes('maxLength'));
 assert.equal(GEMINI_AI_REPORT_SCHEMA.additionalProperties,false);
 assert.equal(GEMINI_AI_REPORT_SCHEMA.properties.good_points.maxItems,10);
 assert.deepEqual(GEMINI_AI_REPORT_SCHEMA.properties.suggestions.items.properties.candidate_assignments,{type:'null'});
 assert.ok(!JSON.stringify(GEMINI_AI_REPORT_SCHEMA).includes('anyOf'));
 assert.ok(!JSON.stringify(GEMINI_AI_REPORT_SCHEMA).includes('500'));
 for(const raw of [{...report(),good_points:['x'.repeat(1201)]},{...report(),concerns:Array(11).fill('x')},{...report(),suggestions:Array(6).fill({description:'x',reason:'x',candidate_assignments:null})},{...report(),extra:true}])assert.throws(()=>parseAIReport(raw),e=>e.code==='AI_INVALID_RESPONSE');
});

test('provider HTTP failures are classified safely without retries or leaking raw bodies',async()=>{
 for(const [status,detail] of [[400,'JSON schema'],[401,'Xác thực'],[403,'quyền'],[404,'models.list'],[429,'hạn mức'],[500,'tạm thời']]){
  let calls=0;
  await assert.rejects(new GeminiSchedulingAIAdvisor('isolated-test-key','gemini-unavailable',async()=>{calls++;return new Response('private-provider-details',{status})}).evaluate({}),e=>e.code==='AI_PROVIDER_UNAVAILABLE'&&e.message.includes(`HTTP ${status}`)&&e.message.includes(detail)&&!e.message.includes('private-'));
  assert.equal(calls,1);
 }
 await assert.rejects(new GeminiSchedulingAIAdvisor('isolated-test-key','gemini-test',async()=>{throw new DOMException('private','TimeoutError')}).evaluate({}),e=>e.message.includes('30 giây'));
});

test('safe diagnostics classify provider evidence and never echo raw message, details or credentials',async()=>{
 const cases=[
  ['INVALID_ARGUMENT','Schema produces a constraint with too many states for serving','SCHEMA_TOO_COMPLEX'],
  ['INVALID_ARGUMENT','Schema has too much branching for serving','SCHEMA_TOO_COMPLEX'],
  ['INVALID_ARGUMENT','Unknown name responseFormat: Cannot find field','UNSUPPORTED_REQUEST_FIELD'],
  ['INVALID_ARGUMENT','Model is not supported for this API version','MODEL_API_INCOMPATIBLE'],
  ['INVALID_ARGUMENT','Other invalid request','INVALID_ARGUMENT_UNCLASSIFIED'],
  ['OTHER','Schema has too many states','UNKNOWN'],
 ];
 for(const [status,message,label] of cases){let calls=0;
  await assert.rejects(new GeminiSchedulingAIAdvisor('isolated-test-key','gemini-test',async()=>{calls++;return new Response(JSON.stringify({error:{status,message:message+' private-person isolated-test-key',details:[{secret:'private-detail'}]}}),{status:400})}).evaluate({}),e=>e.message.includes(`[${label}]`)&&!e.message.includes('private-')&&!e.message.includes('isolated-test-key'));
  assert.equal(calls,1);
 }
 for(const body of ['not JSON',JSON.stringify({error:{message:'x'.repeat(17000),status:'INVALID_ARGUMENT'}}),JSON.stringify({error:{status:'INVALID_ARGUMENT'}})])await assert.rejects(new GeminiSchedulingAIAdvisor('isolated-test-key','gemini-test',async()=>new Response(body,{status:400})).evaluate({}),e=>e.message.includes('[UNKNOWN]'));
});

test('Gemini evaluation accepts text advice but rejects unexpected assignment proposals and invalid report fields',async()=>{
 const send=raw=>async()=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(raw)}]}}]}));
 const textReport=report('NEEDS_ADJUSTMENT',[{description:'Test advice',reason:'Test reason',candidate_assignments:null}]);
 assert.deepEqual(await new GeminiSchedulingAIAdvisor('isolated-test-key','gemini-test',send(textReport)).evaluate({}),textReport);
 for(const raw of [{...textReport,suggestions:[{description:'x',reason:'x',candidate_assignments:[]}]},{...textReport,extra:true}])await assert.rejects(new GeminiSchedulingAIAdvisor('isolated-test-key','gemini-test',send(raw)).evaluate({}),e=>e.code==='AI_INVALID_RESPONSE');
});

test('network failures, request timeouts and interrupted response streams are provider failures, not invalid AI JSON',async()=>{
 for(const transport of [async()=>{throw new TypeError('private-network-details')},async()=>{throw new DOMException('private-timeout-details','TimeoutError')},async()=>new Response(new ReadableStream({start(controller){controller.error(new TypeError('private-stream-details'));}}))]){
  await assert.rejects(new GeminiSchedulingAIAdvisor('isolated-test-key','gemini-test',transport).evaluate({}),e=>e.code==='AI_PROVIDER_UNAVAILABLE'&&e.status===503&&!e.message.includes('private-'));
 }
});
test('DRAFT with no assigned staff still reaches AI when declared demand and mandatory data can be checked',()=>mode(async()=>{
 const branch='00000000-0000-4000-8000-000000009011',id=await make(branch),empty=await editMockDraft(id,branch,actor,{expected_version:1,assignments:[]});
 const state=await inspectSchedule(empty.schedule.id,branch,2);assert.equal(state.validation.hard_constraints,'PASS');assert.equal(state.validation.coverage_complete,false);assert.equal(state.validation.can_submit,false);
 let sent;const result=await evaluateSchedule(empty.schedule.id,branch,{expected_version:2},{advisor:advisor(async s=>{sent=s;return{...report(),concerns:['Test double: chưa xếp đủ 9 lượt phân công.']}})});
 assert.equal(result.status,'AVAILABLE');assert.ok(sent.coverage.every(r=>r.assigned===0));assert.equal(sent.coverage.reduce((n,r)=>n+r.required,0),9);assert.equal(result.evaluation.report.conclusion,'NEEDS_ADJUSTMENT');
}));
test('actual summary fixture missing demand is allowed an insufficient-data review and exposes missing criteria',()=>mode(async()=>{
 process.env.SCHEDULING_MOCK_SCENARIO='summary';const branch='00000000-0000-4000-8000-000000009012',id=await make(branch),state=await inspectSchedule(id,branch,1);
 assert.equal(state.validation.hard_constraints,'PASS');assert.equal(state.validation.data_complete,false);assert.equal(state.validation.scope,'DECLARED_REQUIREMENTS_AND_VALID_REGISTRATIONS');
 let sent;const result=await evaluateSchedule(id,branch,{expected_version:1},{advisor:advisor(async s=>{sent=s;return{...report('INSUFFICIENT_DATA'),limitations:['Test double: thiếu nhu cầu cho một số đăng ký ngày 04/11.']}})});
 assert.equal(result.status,'AVAILABLE');assert.equal(sent.rules.data_complete,false);assert.ok(sent.missing_criteria.some(s=>s.includes('Thiếu nhu cầu')));assert.equal(result.evaluation.report.conclusion,'INSUFFICIENT_DATA');assert.ok(result.evaluation.report.limitations[0].includes('04/11'));
}));
test('Supabase AI adapter uses existing table, has no schema operations or fallback and surfaces denied storage',async()=>{
 const calls=[],db={from(table){calls.push(table);return{select(){return this},eq(k,v){calls.push([k,v]);return this},order(){return this},limit(){return this},maybeSingle:async()=>({data:null}),insert(payload){calls.push(payload);return this},single:async()=>({error:{code:'42501'}})}}};
 const repository=new SupabaseScheduleAIRepository(db);assert.equal(await repository.latest('schedule'),null);assert.deepEqual(calls[1],['schedule_id','schedule']);await assert.rejects(repository.save('schedule',{status:'FAILED',evaluation:null,error_message:'safe',model_name:'test'}),e=>e.code==='AI_STORAGE_UNAVAILABLE');assert.ok(calls.includes('ai_schedule_evaluations'));
});
test('non-DRAFT, unavailable storage and invalid stored JSON are fail-closed; no provider request or fake success',()=>mode(async()=>{
 const branch='00000000-0000-4000-8000-000000009010',id=await make(branch),state=await inspectSchedule(id,branch,1);let called=false;const fake=advisor(async()=>{called=true;return report()});
 const approved=structuredClone(state);approved.saved.schedule.status='APPROVED';await assert.rejects(evaluateSchedule(id,branch,{expected_version:1},{advisor:fake,inspect:async()=>approved}),e=>e.code==='AI_DRAFT_REQUIRED');
 const {ScheduleError}=require('../dist/services/scheduling.engine.js');await assert.rejects(evaluateSchedule(id,branch,{expected_version:1},{advisor:fake,repository:{latest:async()=>{throw new ScheduleError(503,'AI_STORAGE_UNAVAILABLE','safe')}}}),e=>e.code==='AI_STORAGE_UNAVAILABLE');assert.equal(called,false);
 const invalid=await readAIEvaluation(id,branch,1,{advisor:fake,repository:{latest:async()=>({status:'SUCCESS',evaluation:{contract_version:'legacy',secret:'must not be returned'}})}});assert.equal(invalid.status,'FAILED');assert.equal(invalid.evaluation,null);
}));
