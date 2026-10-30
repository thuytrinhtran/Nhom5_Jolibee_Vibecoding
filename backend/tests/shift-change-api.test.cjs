const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const express=require('express');
// Real auth middleware with a fully in-memory SDK. Config and dotenv are never loaded.
const uid='00000000-0000-4000-8000-000000000001',rid='00000000-0000-4000-8000-000000000002';
let role='NV',active=true,mustChange=false,tokenValid=true,rpcError=null;
const calls=[];
const sdk={auth:{async getUser(){return tokenValid?{data:{user:{id:uid}},error:null}:{data:{user:null},error:{status:401}};}},
  from(table){return{select(){return this},eq(){return this},async single(){return this.result()},async maybeSingle(){return this.result()},
    result(){if(table==='users')return{data:{id:uid,username:'fixture',role,branch_id:uid,is_active:active,must_change_password:mustChange},error:null};
      if(table==='branches')return{data:{name:'Fixture'},error:null};
      if(table==='employees')return{data:{id:uid,full_name:'Fixture',skill_level:'REGULAR',department_id:uid},error:null};
      throw Error('Unexpected table');}};},
  async rpc(name,args){calls.push({name,args});return rpcError?{data:null,error:{message:rpcError}}:{data:{request_id:rid,invitations_created:2},error:null};}};
function load(relative){const cache=new Map();function visit(file){file=path.resolve(file);
  if(file.endsWith(path.join('config','supabase.ts')))return{supabaseAdmin:sdk};
  if(cache.has(file))return cache.get(file).exports;
  const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));cache.set(file,m);
  const native=m.require.bind(m);m.require=name=>name.startsWith('.')?visit(path.resolve(path.dirname(file),name.replace(/\.js$/,'.ts'))):native(name);
  m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);return m.exports;
}return visit(path.join(__dirname,'../src',relative));}

test('HTTP contract uses real auth/RBAC; only atomic RPC performs writes',async()=>{
  const router=load('routes/shift-change.routes.ts').default;
  const app=express();app.use(express.json());app.use('/api/shift-change-requests',router);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}/api/shift-change-requests`;
  const headers={Authorization:'Bearer fixture','Content-Type':'application/json'};
  const send=(route,body)=>fetch(base+route,{method:'POST',headers,body:JSON.stringify(body)});
  try{
    assert.equal((await fetch(base)).status,401);assert.equal(calls.length,0);
    tokenValid=false;assert.equal((await fetch(base,{headers})).status,401);tokenValid=true;
    active=false;assert.equal((await fetch(base,{headers})).status,403);active=true;
    mustChange=true;assert.equal((await fetch(base,{headers})).status,403);mustChange=false;
    role='GS';assert.equal((await fetch(base,{headers})).status,403);role='NV';
    for(const route of ['', '/assignments','/invitations'])assert.equal((await fetch(base+route,{headers})).status,200);
    const candidatePath='/assignments/'+rid+'/candidates';
    const candidateResponse=await fetch(base+candidatePath,{headers});
    assert.equal(candidateResponse.status,200);assert.equal((await candidateResponse.json()).status,'ok');
    assert.deepEqual(calls.at(-1),{name:'tv5_shift_change_candidates',args:{p_actor_id:uid,p_assignment_id:rid}});
    assert.equal((await fetch(base+'/assignments/bad/candidates',{headers})).status,400);
    assert.equal((await fetch(base+candidatePath+'?branch_id='+uid,{headers})).status,400);
    rpcError='TV5:NOT_FOUND';assert.equal((await fetch(base+candidatePath,{headers})).status,404);
    rpcError='TV5:DEADLINE_PASSED';assert.equal((await fetch(base+candidatePath,{headers})).status,409);rpcError=null;
    role='QL';assert.equal((await fetch(base+candidatePath,{headers})).status,403);role='NV';
    assert.equal((await send('',{original_assignment_id:rid,reason:'Bận',proposed_employee_id:uid})).status,201);
    assert.equal(calls.at(-1).args.p_actor_id,uid);
    rpcError='TV5:DEADLINE_PASSED';assert.equal((await send('',{original_assignment_id:rid,reason:'Bận'})).status,409);
    rpcError='TV5:ALREADY_CHANGED';const repeat=await send('',{original_assignment_id:rid,reason:'Bận'});
    assert.equal(repeat.status,409);assert.equal((await repeat.json()).code,'ALREADY_CHANGED');rpcError=null;
    rpcError='TV5:AMBIGUOUS_PUBLISHED_SCHEDULE';const ambiguous=await send('',{original_assignment_id:rid,reason:'Bận'});
    assert.equal(ambiguous.status,409);assert.equal((await ambiguous.json()).code,'AMBIGUOUS_PUBLISHED_SCHEDULE');rpcError=null;
    assert.equal((await send('',{original_assignment_id:rid,reason:'Bận',user_id:uid})).status,400);
    assert.equal((await send('/invitations/'+rid+'/response',{response:'ACCEPTED'})).status,200);
    assert.equal(calls.at(-1).args.p_action,'respond');
    assert.equal((await send('/'+rid+'/decision',{decision:'REJECTED'})).status,403);
    rpcError='TV5:NOT_FOUND';assert.equal((await send('/invitations/'+rid+'/response',{response:'DECLINED'})).status,404);
    role='QL';rpcError=null;
    assert.equal((await send('/'+rid+'/decision',{decision:'APPROVED',replacement_employee_id:uid})).status,200);
    assert.equal(calls.at(-1).args.p_action,'decision');
    assert.equal((await send('/'+rid+'/decision',{decision:'REJECTED',reason:'Không phù hợp'})).status,200);
    assert.equal((await send('/'+rid+'/refresh',{})).status,200);
    rpcError='TV5:NOT_FOUND';assert.equal((await send('/'+rid+'/decision',{decision:'REJECTED'})).status,404);
    rpcError='TV5:INELIGIBLE_REPLACEMENT';assert.equal((await send('/'+rid+'/decision',{decision:'APPROVED',replacement_employee_id:uid})).status,409);
    rpcError='TV5:INVALID_STATE';assert.equal((await send('/'+rid+'/decision',{decision:'REJECTED'})).status,409);
    assert.equal((await fetch(base+'?branch_id='+uid,{headers})).status,400);
    assert.equal((await fetch(base,{headers})).headers.get('cache-control'),'no-store');
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});
