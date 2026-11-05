const {test}=require('node:test'),assert=require('node:assert/strict');
process.env.NODE_ENV='test';process.env.SUPABASE_URL||='https://example.supabase.co';process.env.SUPABASE_SECRET_KEY||='isolated-test-placeholder';
const {evaluatePreview}=require('../dist/services/preview-ai.service.js'),{previewSchedule}=require('../dist/services/schedule-preview.service.js');
const {ScheduleError}=require('../dist/services/scheduling.engine.js');
const {supabaseAdmin:db}=require('../dist/config/supabase.js');
const period='00000000-0000-4000-8000-000000000001',branch='00000000-0000-4000-8000-000000000002',employee='private-employee-uuid';
function fixture(){return {source:'supabase',branch:{id:branch,name:'PRIVATE BRANCH'},period:{id:period,branch_id:branch,work_start_date:'2026-10-26',work_end_date:'2026-11-01',status:'CLOSED'},
 employees:[{id:employee,full_name:'PRIVATE EMPLOYEE NAME',phone:'PRIVATE PHONE',email:'private@example.invalid',branch_id:branch,department_id:'private-department-uuid',skill_level:'REGULAR',status:'ACTIVE',is_active:true,role:'NV',skills:['PRIVATE SKILL'],max_weekly_hours:40}],
 shifts:[{id:'private-shift-uuid',name:'PRIVATE SHIFT',start_time:'08:00:00',end_time:'12:00:00',is_active:true,branch_id:branch}],departments:[{id:'private-department-uuid',name:'PRIVATE DEPARTMENT'}],
 registrations:[{id:'r',period_id:period,employee_id:employee,work_date:'2026-10-26',shift_id:'private-shift-uuid',status:'VALID'}],requirements:[{id:'n',department_id:'private-department-uuid',work_date:'2026-10-26',shift_id:'private-shift-uuid',required_count:1,required_skill_name:null}],existing:[],new_employee_count_threshold:null};}
const report=()=>({conclusion:'INSUFFICIENT_DATA',good_points:['Coverage is reported.'],concerns:['Check declared demand only.'],limitations:['Missing declared cells.'],suggestions:[{description:'Review staffing distribution.',reason:'Use registered availability and hours.',candidate_assignments:null}]});
async function setup(){const snapshot=fixture();let loads=0;const repository={source:'supabase',load:async(b,p)=>{assert.equal(b,branch);if(p!==period)throw new ScheduleError(404,'PERIOD_NOT_FOUND','Wrong period');loads++;return structuredClone(snapshot)},listPeriods:async()=>[]};
 const preview=await previewSchedule(period,branch,{},repository);return{snapshot,repository,preview,body:{period_id:period,input_revision:preview.input_revision,assignments:preview.result.assignments.map(({employee_id,work_date,shift_id,department_id})=>({employee_id,work_date,shift_id,department_id}))},loads:()=>loads};}
test('preview AI uses shared summary/report contract, no identifiers/provider write and no storage',async()=>{
 const s=await setup(),original={from:db.from,rpc:db.rpc};let summary;
 db.from=()=>assert.fail('No evaluation table reads/writes');db.rpc=()=>assert.fail('No persistence RPC');
 try{const result=await evaluatePreview(period,branch,'actor',s.body,{repository:s.repository,advisor:{configured:true,model:'test-double',evaluate:async value=>{summary=value;return report()}}});
 assert.equal(result.scope,'preview');assert.equal(result.persisted,false);assert.equal(result.status,'AVAILABLE');assert.equal(result.evaluation.schedule_id,undefined);assert.equal(result.evaluation.version,undefined);assert.equal(result.evaluation.input_revision,result.plan_revision);assert.equal(s.loads(),3);
 const payload=JSON.stringify(summary);for(const secret of [employee,branch,period,'PRIVATE EMPLOYEE NAME','PRIVATE PHONE','private@example.invalid','PRIVATE BRANCH','PRIVATE SKILL','private-department-uuid','private-shift-uuid'])assert.ok(!payload.includes(secret),secret);
 assert.equal(summary.scope,'preview');assert.equal(summary.version,0);assert.equal(summary.coverage[0].assigned,1);assert.equal(summary.employees[0].total_weekly_hours,4);assert.equal(summary.employees[0].max_weekly_hours,40);
 assert.equal(result.evaluation.report.suggestions[0].candidate_assignments,null);
 }finally{db.from=original.from;db.rpc=original.rpc;}
});
test('invalid assignments, foreign fields, source drift and OPEN period are rejected before AI',async()=>{
 const s=await setup(),advisor={configured:true,model:'test',evaluate:()=>assert.fail('Invalid plan must not reach AI')};
 const evaluate=body=>evaluatePreview(period,branch,'actor',body,{repository:s.repository,advisor});
 await assert.rejects(evaluate({...s.body,branch_id:'other'}),e=>e.status===400);
 await assert.rejects(evaluate({...s.body,assignments:[...s.body.assignments,...s.body.assignments]}),e=>e.code==='DUPLICATE_ASSIGNMENT');
 s.snapshot.registrations=[];const unregistered=await previewSchedule(period,branch,{},s.repository);
 await assert.rejects(evaluate({...s.body,input_revision:unregistered.input_revision}),e=>e.code==='REGISTRATION_REQUIRED');
 s.snapshot.registrations=fixture().registrations;
 s.snapshot.requirements[0].required_count=2;await assert.rejects(evaluate(s.body),e=>e.code==='PREVIEW_STALE');
 s.snapshot.period.status='OPEN';await assert.rejects(evaluate(s.body),e=>e.code==='PERIOD_NOT_CLOSED');
});
test('provider response cannot assert suitability on missing data or propose assignment changes',async()=>{
 const s=await setup();s.snapshot.requirements[0].required_count=2;const updated=await previewSchedule(period,branch,{},s.repository);s.body.input_revision=updated.input_revision;
 for(const bad of [{...report(),conclusion:'SUITABLE'},{...report(),suggestions:[{description:'Change',reason:'Test',candidate_assignments:[]}]}])await assert.rejects(evaluatePreview(period,branch,'actor',s.body,{repository:s.repository,advisor:{configured:true,model:'test',evaluate:async()=>bad}}),e=>['AI_CONTRADICTS_RULES','AI_INVALID_RESPONSE'].includes(e.code));
});
test('in-flight source changes invalidate AI result without persisting it',async()=>{
 const s=await setup();await assert.rejects(evaluatePreview(period,branch,'actor',s.body,{repository:s.repository,advisor:{configured:true,model:'test',evaluate:async()=>{s.snapshot.requirements[0].required_count=2;return report()}}}),e=>e.code==='PREVIEW_STALE');
});
test('unconfigured provider never calls external API; simultaneous evaluations are rejected and lock is released',async()=>{
 const s=await setup();const off=await evaluatePreview(period,branch,'actor',s.body,{repository:s.repository,advisor:{configured:false,model:null,evaluate:()=>assert.fail('No provider')}});assert.equal(off.status,'NOT_CONFIGURED');
 let finish,entered;const started=new Promise(r=>entered=r);const advisor={configured:true,model:'test',evaluate:()=>{entered();return new Promise(r=>finish=r)}};
 const first=evaluatePreview(period,branch,'actor',s.body,{repository:s.repository,advisor});await started;
 await assert.rejects(evaluatePreview(period,branch,'actor',s.body,{repository:s.repository,advisor}),e=>e.code==='AI_REVIEW_IN_PROGRESS');finish(report());assert.equal((await first).status,'AVAILABLE');
 const retry=await evaluatePreview(period,branch,'actor',s.body,{repository:s.repository,advisor:{...advisor,evaluate:async()=>report()}});assert.equal(retry.status,'AVAILABLE');
});
test('HTTP preview AI requires QL/branch and bypasses neither auth nor write policy',async()=>{
 const s=await setup(),app=require('../dist/server.js').default,repositories=require('../dist/repositories/registration-summary.repository.js'),providers=require('../dist/services/schedule-ai.gemini.js');
 const original={from:db.from,rpc:db.rpc,getUser:db.auth.getUser,repository:repositories.registrationSummaryRepository,provider:providers.schedulingAIAdvisor,flag:process.env.TV3_DRAFT_PERSISTENCE_ENABLED};let role='QL',assignedBranch=branch;
 process.env.TV3_DRAFT_PERSISTENCE_ENABLED='false';db.auth.getUser=async()=>({data:{user:{id:'actor'}}});db.rpc=()=>assert.fail('No write RPC');
 db.from=table=>{assert.ok(['users','branches','employees'].includes(table),'No AI report storage');return{select(){return this},eq(){return this},single:async()=>({data:table==='users'?{id:'actor',role,branch_id:assignedBranch,is_active:true,must_change_password:false}:{name:'Branch'}}),maybeSingle:async()=>({data:null})}};
 repositories.registrationSummaryRepository=()=>s.repository;providers.schedulingAIAdvisor=()=>({configured:true,model:'test-double',evaluate:async()=>report()});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}/api/schedules/preview/ai-evaluation`;
 const post=(body=s.body,auth=true)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer fixture'}:{})},body:JSON.stringify(body)});
 try{assert.equal((await post({},false)).status,401);for(const r of ['NV','GS']){role=r;assert.equal((await post()).status,403)}role='QL';assignedBranch=null;assert.equal((await post()).status,403);assignedBranch=branch;
 assert.equal((await post({...s.body,period_id:'bad'})).status,400);assert.equal((await post({...s.body,period_id:'00000000-0000-4000-8000-000000000999'})).status,404);
 const config=await fetch(url,{headers:{Authorization:'Bearer fixture'}});assert.equal((await config.json()).result.configured,true);
 const response=await post();assert.equal(response.status,200);assert.equal((await response.json()).result.persisted,false);assert.equal(process.env.TV3_DRAFT_PERSISTENCE_ENABLED,'false');
 for(const [providerStatus,expectedStatus,expectedCode] of [[429,429,'AI_RATE_LIMITED'],[503,503,'AI_PROVIDER_UNAVAILABLE'],[403,503,'AI_CONFIGURATION_ERROR'],[200,502,'AI_INVALID_RESPONSE']]){
  const events=[],runtime={now:()=>0,wait:async()=>{},random:()=>0,log:e=>events.push(e)};let calls=0;
  providers.schedulingAIAdvisor=()=>new providers.GeminiSchedulingAIAdvisor('private-key',`gemini-error-${providerStatus}`,async()=>{calls++;return new Response('private-provider-body',{status:providerStatus,headers:{'Retry-After':'120'}})},runtime);
  const failed=await post(),payload=await failed.json();assert.equal(failed.status,expectedStatus);assert.equal(payload.code,expectedCode);assert.ok(!JSON.stringify(payload).includes('private-'));assert.equal(events[0].http_status,providerStatus);
  if(providerStatus===429){
    assert.equal(failed.headers.get('Retry-After'),'120');assert.equal(payload.retry_after_seconds,120);
    const configuration=await fetch(url,{headers:{Authorization:'Bearer fixture'}});assert.equal((await configuration.json()).result.retry_after_seconds,120);
    assert.equal((await post()).status,429);assert.equal(calls,1);
  }
 }
 providers.schedulingAIAdvisor=()=>new providers.GeminiSchedulingAIAdvisor('private-key','gemini-timeout',async()=>{throw new DOMException('private-timeout','TimeoutError')},{now:()=>0,wait:async()=>{},random:()=>0,log(){}});
 const timed=await post();assert.equal(timed.status,504);assert.equal((await timed.json()).code,'AI_TIMEOUT');
 }finally{db.from=original.from;db.rpc=original.rpc;db.auth.getUser=original.getUser;repositories.registrationSummaryRepository=original.repository;providers.schedulingAIAdvisor=original.provider;if(original.flag===undefined)delete process.env.TV3_DRAFT_PERSISTENCE_ENABLED;else process.env.TV3_DRAFT_PERSISTENCE_ENABLED=original.flag;await new Promise(r=>server.close(r));}
});

test('invalid provider response and transport failure leave no stored report and allow explicit retry',async()=>{
 const s=await setup();let calls=0;
 const advisor={configured:true,model:'failure-test',evaluate:async()=>{calls++;throw new ScheduleError(503,'AI_PROVIDER_UNAVAILABLE','Controlled failure')}};
 await assert.rejects(evaluatePreview(period,branch,'actor',s.body,{repository:s.repository,advisor}),e=>e.code==='AI_PROVIDER_UNAVAILABLE');
 await assert.rejects(evaluatePreview(period,branch,'actor',s.body,{repository:s.repository,advisor:{...advisor,evaluate:async()=>({unexpected:'payload'})}}),e=>e.code==='AI_INVALID_RESPONSE');
 const result=await evaluatePreview(period,branch,'actor',s.body,{repository:s.repository,advisor:{...advisor,evaluate:async()=>report()}});assert.equal(result.status,'AVAILABLE');assert.equal(calls,1);
});

test('preview cache reuses unchanged plan per actor and invalidates changed assignments or source',async()=>{
 const s=await setup();let calls=0;const advisor={configured:true,model:'cache-test',evaluate:async()=>{calls++;return report()}};
 const run=(actor,body=s.body)=>evaluatePreview(period,branch,actor,body,{repository:s.repository,advisor});
 await run('cache-actor');await run('cache-actor');assert.equal(calls,1);
 await run('different-actor');assert.equal(calls,2);
 await run('cache-actor',{...s.body,assignments:[]});assert.equal(calls,3);
 s.snapshot.requirements[0].required_count=2;
 await assert.rejects(run('cache-actor'),e=>e.code==='PREVIEW_STALE');assert.equal(calls,3);
});
