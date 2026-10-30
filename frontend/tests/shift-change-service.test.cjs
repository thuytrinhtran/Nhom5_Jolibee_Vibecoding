const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function load(transport){
  const code=ts.transpileModule(fs.readFileSync('src/services/shift-change.service.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  class ApiError extends Error {constructor(message,status,code){super(message);Object.assign(this,{status,code});}}
  const context={exports:{},require:()=>({authorized:transport,ApiError})};vm.runInNewContext(code,context);
  return context.exports.createShiftChangeService(transport);
}
const search={request_id:'request',invitations_created:1,accepted_count:0,pending_count:1,warning:null};
test('real API paths, prefix and proposal UUID are encoded internally; automatic search omits proposal',async()=>{
  const calls=[];const api=load(async(path,options,prefix)=>{calls.push({path,options,prefix});return{status:'ok',result:path.endsWith('candidates')?{assignment_id:'a/b',request_deadline_at:'2026-11-02T06:00:00Z',candidates:[{employee_id:'person',full_name:'Tên thật'}]}:search};});
  const candidates=await api.candidates('a/b');assert.equal(candidates.candidates[0].full_name,'Tên thật');
  assert.equal(calls[0].path,'/assignments/a%2Fb/candidates');assert.equal(calls[0].options.method,undefined);
  await api.create('assignment','  Bận học  ');let body=JSON.parse(calls.at(-1).options.body);
  assert.deepEqual(body,{original_assignment_id:'assignment',reason:'Bận học'});
  await api.create('assignment','Bận','person');body=JSON.parse(calls.at(-1).options.body);assert.equal(body.proposed_employee_id,'person');
  assert.ok(calls.every(c=>c.prefix==='/shift-change-requests'));
});
test('GET reads never trigger reconciliation and refresh uses an explicit POST',async()=>{
  const calls=[];const api=load(async(path,options)=>{calls.push({path,options});return{status:'ok',result:path===''?{requests:[]}:path==='/assignments'?{assignments:[],schedule_issues:[]}:path==='/invitations'?{invitations:[]}:search};});
  await api.requests();await api.assignments();await api.invitations();await api.refresh('request');
  assert.ok(calls.slice(0,3).every(c=>c.options.method===undefined));assert.equal(calls[3].options.method,'POST');assert.equal(calls[3].options.body,'{}');
});
test('HTTP 200 expired invitation remains an unrecorded response, not acceptance',async()=>{
  let sent;const api=load(async(path,options)=>{sent={path,body:JSON.parse(options.body)};return{status:'ok',result:{...search,response_recorded:false,expired:true}};});
  const result=await api.respond('invite','ACCEPTED');assert.equal(result.response_recorded,false);assert.equal(result.expired,true);
  assert.deepEqual(sent,{path:'/invitations/invite/response',body:{response:'ACCEPTED'}});
});
test('rejection never carries a substitute and approval carries the selected employee',async()=>{
  const calls=[];const api=load(async(path,options)=>{const body=JSON.parse(options.body);calls.push(body);return{status:'ok',result:{request_id:'r',new_assignment_id:body.decision==='APPROVED'?'new':null,decision:body.decision}};});
  await api.decide('r','REJECTED','ignored',' Không phù hợp ');await api.decide('r','APPROVED','chosen');
  assert.deepEqual(calls,[{decision:'REJECTED',reason:'Không phù hợp'},{decision:'APPROVED',replacement_employee_id:'chosen'}]);
});
test('bad envelopes and candidate payloads fail clearly; transport errors do not retry mutations',async()=>{
  for(const result of [null,[],{candidates:[]},{assignment_id:'wrong',request_deadline_at:'x',candidates:[]}]){
    const api=load(async()=>({status:'ok',result}));await assert.rejects(api.candidates('assignment'),e=>e.status===502);
  }
  let calls=0;const failure=Object.assign(new Error('Dữ liệu vừa thay đổi'),{status:409,code:'CONCURRENT_CHANGE'});
  const api=load(async()=>{calls++;throw failure;});await assert.rejects(api.create('a','reason'),e=>e===failure);assert.equal(calls,1);
});
