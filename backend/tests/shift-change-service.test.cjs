const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');

// Compile in memory: never load config/supabase.ts, dotenv, application or environment files.
function load(relative,config={}) {
  const cache=new Map();
  function visit(file){
    file=path.resolve(file);if(cache.has(file))return cache.get(file).exports;
    if(file.endsWith(path.join('config','supabase.ts')))return config;
    const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));cache.set(file,m);
    const native=m.require.bind(m);
    m.require=name=>name.startsWith('.')?visit(path.resolve(path.dirname(file),name.replace(/\.js$/,'.ts'))):native(name);
    m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
    return m.exports;
  }
  return visit(path.join(__dirname,'../src',relative));
}
const {ShiftChangeService}=load('services/shift-change.service.ts');
const uid='00000000-0000-4000-8000-000000000001', assignment='00000000-0000-4000-8000-000000000002',replacement='00000000-0000-4000-8000-000000000003';
const nv={id:uid,role:'NV',branch_id:uid,is_active:true,must_change_password:false,employee:{id:uid}};
const ql={...nv,role:'QL',employee:null};
function fixture(){const calls=[];return{calls,service:new ShiftChangeService({async execute(...args){calls.push(args);return{request_id:assignment,warning:null};}})};}

test('candidate lookup is employee-only, validates assignment UUID and rejects injected identity',async()=>{
  const {service,calls}=fixture();
  await service.execute('candidates',nv,assignment);
  assert.deepEqual(calls,[['candidates',uid,{id:assignment}]]);
  for(const actor of [ql,{...nv,role:'GS'},{...nv,employee:null},{...nv,branch_id:null},{...nv,must_change_password:true}])
    await assert.rejects(service.execute('candidates',actor,assignment),e=>e.status===403);
  await assert.rejects(service.execute('candidates',nv,'bad'),e=>e.status===400);
  await assert.rejects(service.execute('candidates',nv,assignment,{branch_id:replacement}),e=>e.status===400);
  assert.equal(calls.length,1);
});

test('candidate repository uses dedicated read RPC with only trusted actor and assignment',async()=>{
  const {SupabaseShiftChangeRepository}=load('repositories/shift-change.repository.ts');
  const result={assignment_id:assignment,request_deadline_at:'2026-11-02T06:00:00Z',candidates:[{employee_id:replacement,full_name:'Ứng viên'}]};
  const repo=new SupabaseShiftChangeRepository({async rpc(name,args){
    assert.equal(name,'tv5_shift_change_candidates');assert.deepEqual(args,{p_actor_id:uid,p_assignment_id:assignment});
    return{data:result,error:null};
  }});
  assert.deepEqual(await repo.execute('candidates',uid,{id:assignment}),result);
  for(const message of ['TV5:NOT_FOUND','TV5:DEADLINE_PASSED','TV5:DUPLICATE_REQUEST','TV5:INVALID_ASSIGNMENT']){
    const denied=new SupabaseShiftChangeRepository({async rpc(){return{data:null,error:{message}};}});
    await assert.rejects(denied.execute('candidates',uid,{id:assignment}),e=>e.code===message.slice(4));
  }
});

test('proposed substitute is forwarded for validation/invitation, never interpreted as acceptance',async()=>{
  const {service,calls}=fixture();await service.execute('create',nv,undefined,{original_assignment_id:assignment,reason:'  Bận học  ',proposed_employee_id:replacement});
  assert.deepEqual(calls,[['create',uid,{original_assignment_id:assignment,reason:'Bận học',proposed_employee_id:replacement}]]);
  assert.equal(calls[0][2].response,undefined);
});
test('automatic search omits proposal; database warning reaches caller unchanged',async()=>{
  const service=new ShiftChangeService({async execute(action,actor,input){assert.equal(input.proposed_employee_id,undefined);return{warning:'NO_AVAILABLE_REPLACEMENT',invitations_created:0};}});
  assert.equal((await service.execute('create',nv,undefined,{original_assignment_id:assignment,reason:'Bận'})).warning,'NO_AVAILABLE_REPLACEMENT');
});
test('unknown fields, injected identity, invalid UUID, blank reason and invalid enum are rejected before persistence',async()=>{
  const {service,calls}=fixture();
  for(const input of [null,[],{original_assignment_id:assignment,reason:' '},{original_assignment_id:'bad',reason:'x'},
    {original_assignment_id:assignment,reason:'x',employee_id:replacement},{original_assignment_id:assignment,reason:'x',proposed_employee_id:null}])
    await assert.rejects(service.execute('create',nv,undefined,input),e=>e.status===400);
  await assert.rejects(service.execute('respond',nv,assignment,{response:'APPROVED'}),e=>e.status===400);
  await assert.rejects(service.execute('respond',nv,assignment,{response:['ACCEPTED']}),e=>e.status===400);
  await assert.rejects(service.execute('decision',ql,assignment,{decision:'APPROVED'}),e=>e.status===400);
  await assert.rejects(service.execute('decision',ql,assignment,{decision:'REJECTED',replacement_employee_id:replacement}),e=>e.status===400);
  assert.equal(calls.length,0);
});
test('role, account state, branch and employee guards apply before repository access',async()=>{
  const {service,calls}=fixture();
  for(const actor of [{...nv,role:'GS'},{...nv,is_active:false},{...nv,must_change_password:true},{...nv,branch_id:null},{...nv,employee:null},ql])
    await assert.rejects(service.execute('create',actor,undefined,{original_assignment_id:assignment,reason:'x'}),e=>e.status===403);
  await assert.rejects(service.execute('decision',nv,assignment,{decision:'REJECTED'}),e=>e.status===403);
  assert.equal(calls.length,0);
});
test('acceptance/decline only call response; manager approval specifies the accepted substitute',async()=>{
  const {service,calls}=fixture();
  for(const response of ['ACCEPTED','DECLINED'])await service.execute('respond',nv,assignment,{response});
  await service.execute('decision',ql,assignment,{decision:'APPROVED',replacement_employee_id:replacement});
  await service.execute('decision',ql,assignment,{decision:'REJECTED',reason:'  Không phù hợp  '});
  assert.deepEqual(calls.map(c=>c[0]),['respond','respond','decision','decision']);
  assert.equal(calls[3][2].reason,'Không phù hợp');
  assert.equal(calls[0][2].replacement_employee_id,undefined);
});
test('repository preserves atomic RPC errors without exposing database details',async()=>{
  const {SupabaseShiftChangeRepository}=load('repositories/shift-change.repository.ts');
  for(const [message,status,code] of [['TV5:NOT_FOUND',404,'NOT_FOUND'],['TV5:FORBIDDEN',403,'FORBIDDEN'],
    ['TV5:ALREADY_CHANGED',409,'ALREADY_CHANGED'],['TV5:DEADLINE_PASSED',409,'DEADLINE_PASSED'],
    ['TV5:AMBIGUOUS_PUBLISHED_SCHEDULE',409,'AMBIGUOUS_PUBLISHED_SCHEDULE'],
    ['TV5:STALE_PUBLISHED_SCHEDULE',409,'STALE_PUBLISHED_SCHEDULE'],
    ['TV5:INELIGIBLE_REPLACEMENT',409,'INELIGIBLE_REPLACEMENT'],['TV5:ACCEPTANCE_REQUIRED',409,'ACCEPTANCE_REQUIRED'],
    ['TV5:INVALID_STATE',409,'INVALID_STATE'],['internal details',503,'SHIFT_CHANGE_UNAVAILABLE']]){
    const repo=new SupabaseShiftChangeRepository({async rpc(name,args){assert.equal(name,'tv5_shift_change');assert.equal(args.p_actor_id,uid);return{data:null,error:{message}};}});
    await assert.rejects(repo.execute('decision',uid,{}),e=>e.status===status&&e.code===code&&!e.message.includes('internal details'));
  }
  const repo=new SupabaseShiftChangeRepository({async rpc(){throw Error('private transport details')}});
  await assert.rejects(repo.execute('create',uid,{}),e=>e.status===503&&!e.message.includes('private'));
});
test('expiration is a committed business result; reads do not silently trigger refresh',async()=>{
  const calls=[];const service=new ShiftChangeService({async execute(action){calls.push(action);return{expired:true,response_recorded:false,warning:'NO_AVAILABLE_REPLACEMENT'};}});
  const result=await service.execute('respond',nv,assignment,{response:'ACCEPTED'});
  assert.equal(result.expired,true);assert.equal(result.response_recorded,false);
  await service.execute('requests',ql);
  assert.deepEqual(calls,['respond','requests']);
});
test('repository handles concurrent writes and malformed responses without retrying a mutation',async()=>{
  const {SupabaseShiftChangeRepository}=load('repositories/shift-change.repository.ts');
  let calls=0;const repo=new SupabaseShiftChangeRepository({async rpc(){calls++;return{data:null,error:{code:'23505'}};}});
  await assert.rejects(repo.execute('decision',uid,{}),e=>e.status===409&&e.code==='CONCURRENT_CHANGE');assert.equal(calls,1);
  const invalid=new SupabaseShiftChangeRepository({async rpc(){return{data:[],error:null};}});
  await assert.rejects(invalid.execute('requests',uid,{}),e=>e.code==='INVALID_DATABASE_RESPONSE');
});
