const {test}=require('node:test'),assert=require('node:assert/strict');
process.env.NODE_ENV='test';
// Isolate the HTTP contract from an operator's local PG transport and write scope.
process.env.DEV_IMPORT_ENABLED='false';process.env.TV5_LOCAL_PG_RPC_ENABLED='false';process.env.TV3_WRITE_SCOPE_ENABLED='false';process.env.TV3_WRITE_SCOPE_MODE='legacy';process.env.SCHEDULING_DATA_SOURCE='supabase';
test('TV5 HTTP role/owner contract, opt-in and independent test-preview write guard',async()=>{
 const {supabaseAdmin:db}=require('../dist/config/supabase.js'),app=require('../dist/server.js').default;
 const old={from:db.from,rpc:db.rpc,getUser:db.auth.getUser,flag:process.env.TV5_PERSISTENCE_ENABLED,preview:process.env.TV3_TEST_PREVIEW_ENABLED};
 const id='00000000-0000-4000-8000-000000000001';let role='NV',calls=[],rpcFailure=null;
 db.auth.getUser=async()=>({data:{user:{id}},error:null});
 db.from=table=>({select(){return this;},eq(){return this;},single:async()=>({data:table==='users'?{id,username:'fixture',role,branch_id:id,is_active:true,must_change_password:false}:{name:'Branch'},error:null}),maybeSingle:async()=>({data:{id,full_name:'Fixture'},error:null})});
 db.rpc=async(name,args)=>{calls.push({name,args});return{data:name==='tv5_read'?{sources:[],invitations:[]}:name==='tv5_candidates_for_actor'?[]:{status:'PENDING'},error:rpcFailure}};
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}/api/shift-changes`;
 const post=(body,auth=true)=>fetch(url+'/actions',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer test'}:{})},body:JSON.stringify(body)});
 const get=q=>fetch(url+q,{headers:{Authorization:'Bearer test'}});
 const body={action:'CREATE_REQUEST',request_id:id,data:{assignment_id:id,reason:'Unable'}};
 try{
  delete process.env.TV5_PERSISTENCE_ENABLED;delete process.env.TV3_TEST_PREVIEW_ENABLED;
  assert.equal((await post(body,false)).status,401);assert.equal((await post(body)).status,503);assert.equal(calls.length,0);
  let res=await get('');assert.equal(res.status,200);assert.equal((await res.json()).result.enabled,false);assert.equal(res.headers.get('cache-control'),'no-store');
  assert.equal((await get('?employee_id=forged')).status,400);assert.equal((await get('/candidates?assignment_id='+id+'&branch_id='+id)).status,400);
  process.env.TV5_PERSISTENCE_ENABLED='true';process.env.TV3_TEST_PREVIEW_ENABLED='true';assert.equal((await post(body)).status,403);delete process.env.TV3_TEST_PREVIEW_ENABLED;
  for(const invalid of [{...body,employee_id:id},{...body,branch_id:id},{...body,role:'QL'},{...body,data:{...body.data,employee_id:id}},{...body,action:'__proto__'},{...body,request_id:'bad'},{...body,data:{...body.data,reason:' '}}])assert.equal((await post(invalid)).status,400);
  assert.equal((await post(body)).status,200);assert.equal(calls.at(-1).args.p_actor_id,id);assert.equal(calls.at(-1).name,'tv5_mutate');assert.deepEqual(calls.at(-1).args.p_data,body.data);
  assert.equal((await post({action:'APPROVE',request_id:id,data:{kind:'REQUEST',source_id:id,invitation_id:id}})).status,403);
  role='QL';assert.equal((await post({action:'ACCEPT',request_id:id,data:{invitation_id:id}})).status,403);
  role='QL';for(const code of ['REPLACEMENT_ALREADY_ACCEPTED','NO_EXPIRED_INVITATIONS']){rpcFailure={code:'P0001',message:code};const response=await post({action:'EXPIRE',request_id:id,data:{kind:'REQUEST',source_id:id}});assert.equal(response.status,409);assert.equal((await response.json()).code,code);}rpcFailure=null;
  role='GS';assert.equal((await get('')).status,403);
 }finally{
  db.from=old.from;db.rpc=old.rpc;db.auth.getUser=old.getUser;for(const [k,v] of Object.entries({TV5_PERSISTENCE_ENABLED:old.flag,TV3_TEST_PREVIEW_ENABLED:old.preview})){if(v===undefined)delete process.env[k];else process.env[k]=v;}await new Promise(r=>server.close(r));
 }
});
