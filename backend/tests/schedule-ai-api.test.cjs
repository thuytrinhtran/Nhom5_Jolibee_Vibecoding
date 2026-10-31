// Explicit isolated writer-test opt-in; production defaults remain locked.
process.env.TV3_DRAFT_PERSISTENCE_ENABLED='true';
const {test}=require('node:test');const assert=require('node:assert/strict');
process.env.NODE_ENV='test';process.env.SUPABASE_URL||='https://example.supabase.co';process.env.SUPABASE_SECRET_KEY||='isolated-test-placeholder';
const app=require('../dist/server.js').default,{supabaseAdmin:db}=require('../dist/config/supabase.js');const {createDraft}=require('../dist/services/scheduling.service.js');
test('AI GET/POST enforce TV1 RBAC, branch, saved version and strict body; unconfigured mode makes no AI table or external request',async()=>{
 const keys=['NODE_ENV','SCHEDULING_DATA_SOURCE','SCHEDULING_MOCK_SCENARIO','TV3_AI_EXTERNAL_ENABLED'],oldEnv=keys.map(k=>process.env[k]),old={from:db.from,getUser:db.auth.getUser};
 Object.assign(process.env,{NODE_ENV:'development',SCHEDULING_DATA_SOURCE:'mock',SCHEDULING_MOCK_SCENARIO:'tv3-flow',TV3_AI_EXTERNAL_ENABLED:'false'});
 let role='QL',branch='00000000-0000-4000-8000-000000009101';const actor='00000000-0000-4000-8000-000000009102';
 db.auth.getUser=async()=>({data:{user:{id:actor}}});db.from=table=>{assert.ok(['users','employees','branches'].includes(table),'Mock must not access AI/business tables');return{select(){return this},eq(){return this},single:async()=>({data:table==='users'?{id:actor,username:'test',role,branch_id:branch,is_active:true,must_change_password:false}:{name:'Branch'}}),maybeSingle:async()=>({data:null})}};
 const draft=await createDraft('33333333-0000-4000-8000-000000000001',actor,branch);const id=draft.result.schedule.id;
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}/api/schedules/${id}/ai-evaluation`,headers={Authorization:'Bearer fixture','Content-Type':'application/json'};
 try {
  assert.equal((await fetch(url+'?expected_version=1')).status,401);
  for(const value of ['NV','GS']){role=value;assert.equal((await fetch(url+'?expected_version=1',{headers})).status,403);assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({expected_version:1})})).status,403);}role='QL';
  const read=await fetch(url+'?expected_version=1',{headers});assert.equal(read.status,200);assert.equal((await read.json()).result.status,'NOT_CONFIGURED');
  const post=await fetch(url,{method:'POST',headers,body:JSON.stringify({expected_version:1})});assert.equal(post.status,200);assert.equal((await post.json()).result.status,'NOT_CONFIGURED');
  assert.equal((await fetch(url,{headers})).status,400);assert.equal((await fetch(url+'?expected_version=99',{headers})).status,409);
  for(const body of [{expected_version:1,branch_id:'spoof'},{expected_version:1,input:{private:'data'}},{expected_version:'1'},{}])assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(body)})).status,400);
  branch='00000000-0000-4000-8000-000000009103';assert.equal((await fetch(url+'?expected_version=1',{headers})).status,404);assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({expected_version:1})})).status,404);
 } finally {db.from=old.from;db.auth.getUser=old.getUser;keys.forEach((k,i)=>{if(oldEnv[i]===undefined)delete process.env[k];else process.env[k]=oldEnv[i]});await new Promise(r=>server.close(r));}
});
test('configured HTTP flow accepts partial-week shortage and separates missing input, transport failure and invalid Gemini results without live network',async()=>{
 const keys=['NODE_ENV','SCHEDULING_DATA_SOURCE','SCHEDULING_MOCK_SCENARIO','TV3_AI_EXTERNAL_ENABLED','TV3_AI_PROVIDER','TV3_AI_MODEL','GEMINI_API_KEY'],oldEnv=keys.map(k=>process.env[k]),old={from:db.from,getUser:db.auth.getUser,fetch:global.fetch};
 Object.assign(process.env,{NODE_ENV:'development',SCHEDULING_DATA_SOURCE:'mock',SCHEDULING_MOCK_SCENARIO:'tv3-flow',TV3_AI_EXTERNAL_ENABLED:'true',TV3_AI_PROVIDER:'gemini',TV3_AI_MODEL:'gemini-test',GEMINI_API_KEY:'isolated-test-key'});
 const branch='00000000-0000-4000-8000-000000009121',period='33333333-0000-4000-8000-000000000001';
 db.auth.getUser=async()=>({data:{user:{id:branch}}});db.from=table=>{assert.ok(['users','employees','branches'].includes(table),'mock business data may not hit Supabase');return{select(){return this},eq(){return this},single:async()=>({data:table==='users'?{id:branch,username:'isolated',role:'QL',branch_id:branch,is_active:true,must_change_password:false}:{name:'Branch'}}),maybeSingle:async()=>({data:null})}};
 const draft=await createDraft(period,branch,branch),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin=`http://127.0.0.1:${server.address().port}`,url=`${origin}/api/schedules/${draft.result.schedule.id}/ai-evaluation`;
 let providerCalls=0,sent,reply=async()=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({conclusion:'NEEDS_ADJUSTMENT',good_points:[],concerns:['Test double: thiếu 1 lượt phân công.'],suggestions:[],limitations:['Test double: chỉ xét dữ liệu đã khai báo.']})}]}}]}));
 global.fetch=async(input,options)=>{const address=String(input);if(address.startsWith('https://generativelanguage.googleapis.com/')){providerCalls++;sent=JSON.parse(JSON.parse(options.body).contents[0].parts[0].text);return reply();}if(address.startsWith(origin+'/'))return old.fetch(input,options);throw new Error('Unexpected host blocked by isolated test');};
 const post=()=>fetch(url,{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify({expected_version:1})});
 try {
  const accepted=await post();assert.equal(accepted.status,200);assert.equal((await accepted.json()).result.status,'AVAILABLE');assert.equal(providerCalls,1);assert.equal(new Set(sent.coverage.map(r=>r.work_date)).size,1);assert.equal(new Set(sent.coverage.map(r=>r.shift_code)).size,2);assert.equal(sent.coverage.reduce((n,r)=>n+r.required-r.assigned,0),1);
  for(const [respond,expected,status] of [[async()=>{throw new TypeError('private-network-detail')},'AI_PROVIDER_UNAVAILABLE',503],[async()=>new Response('private-response-not-json'),'AI_INVALID_RESPONSE',502],[async()=>new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"wrong_schema":true}'}]}}]})),'AI_INVALID_RESPONSE',502],[async()=>new Response('private-quota-detail',{status:429}),'AI_PROVIDER_UNAVAILABLE',503]]){
   reply=respond;const response=await post(),body=await response.json();assert.equal(response.status,status);assert.equal(body.code,expected);assert.ok(!JSON.stringify(body).includes('private-'));assert.ok(!JSON.stringify(body).includes('isolated-test-key'));
  }
  const calls=providerCalls,{readDemand,clearDemand}=require('../dist/services/staffing-demand.service.js'),data=await readDemand(period,branch);
  for(const r of data.requirements)await clearDemand(period,branch,{work_date:r.work_date,shift_id:r.shift_id,department_id:r.department_id,expected_updated_at:r.updated_at});
  const blocked=await post(),body=await blocked.json();assert.equal(blocked.status,200);assert.equal(body.result.status,'BLOCKED');assert.ok(body.result.rule_check.codes.includes('NO_REQUIREMENTS'));assert.equal(providerCalls,calls);
 } finally {global.fetch=old.fetch;db.from=old.from;db.auth.getUser=old.getUser;keys.forEach((k,i)=>{if(oldEnv[i]===undefined)delete process.env[k];else process.env[k]=oldEnv[i]});await new Promise(r=>server.close(r));}
});
