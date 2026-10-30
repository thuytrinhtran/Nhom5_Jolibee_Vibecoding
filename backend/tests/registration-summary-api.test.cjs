const {test}=require('node:test');const assert=require('node:assert/strict');
process.env.NODE_ENV='test';process.env.SUPABASE_URL ||= 'https://example.supabase.co';process.env.SUPABASE_SECRET_KEY ||= 'isolated-test-placeholder';
const app=require('../dist/server.js').default;const {supabaseAdmin:db}=require('../dist/config/supabase.js');
const {MOCK_PERIOD_ID}=require('../dist/repositories/registration-summary.mock.js');
const branch='00000000-0000-4000-8000-000000000001';
test('summary HTTP RBAC, branch scope, filters, mock label and no database writes',async()=>{
  const original={from:db.from,getUser:db.auth.getUser,rpc:db.rpc,mode:process.env.SCHEDULING_DATA_SOURCE,env:process.env.NODE_ENV};
  let role='QL';process.env.NODE_ENV='development';process.env.SCHEDULING_DATA_SOURCE='mock';let queries=0;
  db.auth.getUser=async()=>({data:{user:{id:branch}}});
  db.from=table=>{queries++;assert.ok(['users','branches','employees'].includes(table),'mock business data must never read/write Supabase');return{select(){return this},eq(){return this},
    single:async()=>({data:table==='users'?{id:branch,username:'fixture',role,branch_id:branch,is_active:true,must_change_password:false}:{name:'Branch'}}),maybeSingle:async()=>({data:null})};};
  db.rpc=()=>assert.fail('mock must not call persistence RPC');
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}/api/schedules`;
  const get=path=>fetch(base+path,{headers:{Authorization:'Bearer fixture'}});
  const path=`/periods/${MOCK_PERIOD_ID}/registrations-summary`;
  try{
    assert.equal((await fetch(base+path)).status,401);
    for(const value of ['NV','GS']){role=value;assert.equal((await get(path)).status,403);}role='QL';
    const response=await get(path+'?branch_id=foreign');assert.equal(response.status,200);const result=(await response.json()).result;
    assert.equal(result.source,'mock');assert.equal(result.is_mock,true);assert.equal(result.branch.id,branch);assert.ok(result.rows.every(r=>r.branch_id===branch));
    assert.equal(response.headers.get('cache-control'),'no-store');
    const kitchen=result.rows.find(r=>r.department_name==='Bếp');
    const filtered=await get(path+`?work_date=2026-11-02&department_id=${kitchen.department_id}&shift_id=${kitchen.shift_id}`);
    assert.equal((await filtered.json()).result.rows.length,1);
    assert.equal((await get(path+'?work_date=2026-02-30')).status,400);assert.equal((await get(path+'?department_id=bad')).status,400);
    assert.equal((await get('/periods/'+branch+'/registrations-summary')).status,404);
    assert.equal((await get('/periods')).status,200);assert.equal((await get('/periods/'+MOCK_PERIOD_ID)).status,200);
    const create=await fetch(base+'/generate',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify({period_id:MOCK_PERIOD_ID})});
    assert.equal(create.status,201);const draft=await create.json();assert.equal(draft.source,'mock');assert.equal(draft.result.schedule.status,'DRAFT');assert.ok(queries>0,'real authentication is retained');
    process.env.NODE_ENV='production';assert.equal((await get(path)).status,503);
  }finally{db.from=original.from;db.auth.getUser=original.getUser;db.rpc=original.rpc;process.env.NODE_ENV=original.env;if(original.mode===undefined)delete process.env.SCHEDULING_DATA_SOURCE;else process.env.SCHEDULING_DATA_SOURCE=original.mode;await new Promise(r=>server.close(r));}
});
