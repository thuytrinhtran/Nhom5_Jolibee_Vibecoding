// Explicit opt-in for the isolated mock writer journey.
process.env.TV3_DRAFT_PERSISTENCE_ENABLED='true';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const ts=require('typescript');
process.env.NODE_ENV='test';process.env.SUPABASE_URL||='https://example.supabase.co';process.env.SUPABASE_SECRET_KEY||='isolated-test-placeholder';
const app=require('../dist/server.js').default;
const {supabaseAdmin:db}=require('../dist/config/supabase.js');

// Execute the actual frontend client/grid against Express, not a copy of its API calls.
// This is HTTP integration plus frontend logic, not a real-browser DOM test.
function frontend(file,overrides={},globals={}){
 const source=fs.readFileSync(path.resolve(__dirname,'../../frontend/src',file),'utf8').replace('import.meta.env',JSON.stringify({VITE_API_URL:globals.api}));
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const context={exports:{},Intl,Date,Map,Set,Error,AbortSignal,...globals,require(id){if(id in overrides)return overrides[id];throw Error('Unexpected frontend dependency in isolated journey');}};
 vm.runInNewContext(code,context);return context.exports;
}
const plain=a=>({employee_id:a.employee_id,work_date:a.work_date,shift_id:a.shift_id,department_id:a.department_id});

test('complete TV3 journey uses real frontend client/grid and Express with isolated auth, storage and Gemini transport',async()=>{
 const envKeys=['NODE_ENV','SCHEDULING_DATA_SOURCE','SCHEDULING_MOCK_SCENARIO','TV3_AI_EXTERNAL_ENABLED','TV3_AI_PROVIDER','TV3_AI_MODEL','GEMINI_API_KEY'];
 const oldEnv=envKeys.map(k=>process.env[k]),old={from:db.from,rpc:db.rpc,getUser:db.auth.getUser,fetch:global.fetch};
 Object.assign(process.env,{NODE_ENV:'development',SCHEDULING_DATA_SOURCE:'mock',SCHEDULING_MOCK_SCENARIO:'tv3-flow',TV3_AI_EXTERNAL_ENABLED:'true',TV3_AI_PROVIDER:'gemini',TV3_AI_MODEL:'gemini-test',GEMINI_API_KEY:'isolated-journey-key'});
 const branch='00000000-0000-4000-8000-000000008901',actor='00000000-0000-4000-8000-000000008902';
 const authTables=[];let providerCalls=0,requests=0,lastSummary;
 db.auth.getUser=async()=>({data:{user:{id:actor}}});db.rpc=()=>assert.fail('No RPC allowed in mock journey');
 db.from=table=>{
  authTables.push(table);assert.ok(['users','branches','employees'].includes(table),'No business/AI database tables allowed');
  return{select(){return this},eq(){return this},single:async()=>({data:table==='users'?{id:actor,role:'QL',username:'fixture',branch_id:branch,is_active:true,must_change_password:false}:{name:'Synthetic branch'}}),maybeSingle:async()=>({data:null})};
 };
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin=`http://127.0.0.1:${server.address().port}`;
 global.fetch=async(input,options)=>{
  const url=String(input);
  if(url.startsWith(origin+'/')){requests++;return old.fetch(input,options);}
  if(url==='https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent'){
   providerCalls++;const request=JSON.parse(options.body);lastSummary=JSON.parse(request.contents[0].parts[0].text);
   const schema=request.generationConfig.responseFormat.text.schema;
   assert.equal(schema.properties.suggestions.items.properties.candidate_assignments.type,'null');
   const missing=lastSummary.coverage.reduce((n,r)=>n+Math.max(0,r.required-r.assigned),0);
   // Explicit test double derived from request data; never exposed by the product.
   const report={conclusion:!lastSummary.rules.data_complete?'INSUFFICIENT_DATA':missing?'NEEDS_ADJUSTMENT':'SUITABLE',good_points:[],concerns:missing?[`TEST DOUBLE: thiếu ${missing}`]:[],limitations:['TEST DOUBLE only'],suggestions:[{description:'TEST DOUBLE: kiểm tra độ phủ',reason:`TEST DOUBLE: thiếu ${missing}`,candidate_assignments:null}]};
   return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(report)}]}}]}));
  }
  throw Error('External network prohibited in isolated TV3 journey');
 };
 class ApiError extends Error{constructor(message,status,code){super(message);this.status=status;this.code=code;}}
 try{
  const service=frontend('services/scheduling.service.ts',{'./auth.service':{ApiError,authService:{getMe:async()=>{},getStoredToken:()=> 'fixture'}}},{api:origin+'/api',fetch:(...args)=>global.fetch(...args)}).schedulingService;
  const view=frontend('services/staffing-demand.view.ts'),grid=frontend('services/staffing-demand.grid.ts',{'./staffing-demand.view':view});
  const periods=await service.periods(),period=periods[0].id;
  let data=await service.demand(period);assert.equal(data.shifts.length,3);
  assert.deepEqual(data.shifts.map(s=>[s.start_time,s.end_time]),[['08:00:00','12:00:00'],['12:00:00','17:00:00'],['17:00:00','22:00:00']]);
  assert.equal(grid.gridCells(data).length,63);assert.ok((await service.context(period)).valid_registration_count>0);
  // All undeclared cells are explicitly zero; no automatic staffing from forecast.
  let draft={};for(const cell of grid.gridCells(data)){
   const key=view.demandRowKey(cell);if(!data.requirements.some(r=>view.demandRowKey(r)===key))draft=grid.updateCell(data,draft,key,{count:'0',forecast:''});
  }
  const written=await grid.saveGrid(data,draft,service);assert.equal(Object.keys(written.errors).length,0);
  data=await service.demand(period);assert.equal(data.requirements.length,63);
  const summary=await service.summary(period);assert.equal(summary.rows.length,63);
  const generated=await service.generate(period),first=await service.read(generated.id);
  assert.equal(first.generation_snapshot.required_count,9);assert.equal(first.assignments.length,8);
  const shortage=first.generation_snapshot.shortages[0];
  const supply=summary.rows.find(r=>r.work_date===shortage.work_date&&r.shift_id===shortage.shift_id&&r.department_id===shortage.department_id);
  assert.equal(supply.eligible_count,2);assert.equal(shortage.assigned_count,1,'eligible supply must not be confused with assigned staff');
  assert.equal((await service.aiEvaluation(first.schedule.id,1)).status,'NOT_EVALUATED');assert.equal(providerCalls,0);
  const aiShort=await service.evaluateAI(first.schedule.id,1);assert.equal(aiShort.evaluation.report.conclusion,'NEEDS_ADJUSTMENT');
  assert.equal((await service.validate(first.schedule.id,1)).can_submit,false);
  assert.equal((await service.prepareHandoff(first.schedule.id,1,'Shortage check')).payload,null);
  // Delete and add back a valid assignment through the same UI client.
  const deleted=await service.editDraft(first.schedule.id,{expected_version:1,assignments:first.assignments.slice(1).map(plain)});
  const second=await service.read(deleted.schedule.id);assert.equal(second.schedule.version,2);assert.equal(second.assignments.length,7);
  await assert.rejects(service.editDraft(second.schedule.id,{expected_version:2,assignments:[...second.assignments.map(plain),plain(second.assignments[0])]}),e=>e.code==='DUPLICATE_ASSIGNMENT');
  const added=await service.editDraft(second.schedule.id,{expected_version:2,assignments:first.assignments.map(plain)});
  const third=await service.read(added.schedule.id);assert.equal(third.schedule.version,3);assert.equal(third.assignments.length,8);
  assert.equal((await service.read(first.schedule.id)).assignments.length,8);
  assert.equal((await service.evaluateAI(third.schedule.id,3)).status,'AVAILABLE');
  const need=data.requirements.find(r=>r.id===shortage.id);
  await service.saveDemand(period,{work_date:need.work_date,shift_id:need.shift_id,department_id:need.department_id,required_count:1,required_skill_name:need.required_skill_name,sales_forecast_ref:need.sales_forecast_ref,expected_updated_at:need.updated_at});
  assert.equal((await service.aiEvaluation(third.schedule.id,3)).status,'STALE');
  assert.equal((await service.validate(third.schedule.id,3)).input_current,false);
  const regenerated=await service.generate(period,{regenerate:true,expected_version:3});
  const fourth=await service.read(regenerated.id);assert.equal(fourth.schedule.version,4);
  assert.equal((await service.validate(fourth.schedule.id,4)).can_submit,true);
  const aiComplete=await service.evaluateAI(fourth.schedule.id,4);assert.equal(aiComplete.evaluation.report.conclusion,'SUITABLE');
  const before=await service.read(fourth.schedule.id),handoff=await service.prepareHandoff(fourth.schedule.id,4,'Fixture manager reviewed');
  assert.equal(handoff.payload.version,4);assert.equal(handoff.payload.schedule_id,fourth.schedule.id);
  assert.equal(handoff.payload.assignments.length,8);assert.equal(handoff.payload.is_mock,true);
  assert.equal(handoff.delivery.sent,false);assert.equal(handoff.delivery.configured,false);
  assert.deepEqual(await service.read(fourth.schedule.id),before);
  assert.equal((await service.periods())[0].schedules[0].id,fourth.schedule.id,'reopening week returns latest persisted mock version');
  for(const e of (await service.context(period)).employees)assert.ok(!JSON.stringify(lastSummary).includes(e.id));
  assert.equal(providerCalls,3);assert.ok(requests>75);assert.ok(authTables.length>0);
 }finally{
  global.fetch=old.fetch;db.from=old.from;db.rpc=old.rpc;db.auth.getUser=old.getUser;
  envKeys.forEach((k,i)=>{if(oldEnv[i]===undefined)delete process.env[k];else process.env[k]=oldEnv[i];});
  await new Promise(r=>server.close(r));
 }
});
