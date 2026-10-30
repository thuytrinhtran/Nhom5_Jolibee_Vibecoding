const {test}=require('node:test');const assert=require('node:assert/strict');
process.env.NODE_ENV='test';process.env.SUPABASE_URL ||= 'https://example.supabase.co';process.env.SUPABASE_SECRET_KEY ||= 'isolated-test-placeholder';
const app=require('../dist/server.js').default;const {supabaseAdmin:db}=require('../dist/config/supabase.js');const {MOCK_PERIOD_ID}=require('../dist/repositories/registration-summary.mock.js');
const branch='00000000-0000-4000-8000-000000000013';
test('requirements GET/PUT enforce QL and branch scope, save mock only and refresh supply comparison',async()=>{
  const old={from:db.from,getUser:db.auth.getUser,env:process.env.NODE_ENV,source:process.env.SCHEDULING_DATA_SOURCE};let role='QL';
  process.env.NODE_ENV='development';process.env.SCHEDULING_DATA_SOURCE='mock';
  db.auth.getUser=async()=>({data:{user:{id:branch}}});
  db.from=table=>{assert.ok(['users','branches','employees'].includes(table),'business data must not hit Supabase in mock mode');return{select(){return this},eq(){return this},single:async()=>({data:table==='users'?{id:branch,username:'fixture',role,branch_id:branch,is_active:true,must_change_password:false}:{name:'Branch'}}),maybeSingle:async()=>({data:null})}};
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}/api/schedules/periods/`;
  const headers={Authorization:'Bearer fixture','Content-Type':'application/json'};const url=base+MOCK_PERIOD_ID+'/requirements';const get=()=>fetch(url,{headers});const put=body=>fetch(url,{method:'PUT',headers,body:JSON.stringify(body)});
  try{
    assert.equal((await fetch(url)).status,401);
    for(const r of ['NV','GS']){role=r;assert.equal((await get()).status,403);assert.equal((await put({})).status,403);assert.equal((await fetch(url,{method:'DELETE',headers,body:'{}'})).status,403);}role='QL';
    const first=await get();assert.equal(first.status,200);const data=(await first.json()).result;assert.equal(data.branch.id,branch);assert.equal(data.is_mock,true);assert.ok(data.requirements[0].sales_forecast_ref);
    const body={work_date:'2026-11-06',shift_id:data.shifts[0].id,department_id:data.departments[0].id,required_count:4,required_skill_name:'Bếp nóng',sales_forecast_ref:'Dự báo mô phỏng mới',expected_updated_at:null};
    const saved=await put(body);assert.equal(saved.status,200);const stored=(await saved.json()).result.requirement;assert.equal(stored.created_by,branch);
    const read=(await(await get()).json()).result;assert.equal(read.requirements.find(r=>r.id===stored.id).sales_forecast_ref,body.sales_forecast_ref);assert.equal(read.summary.rows.find(r=>r.work_date===body.work_date&&r.department_id===body.department_id).shortage_count,4);
    assert.equal((await put(body)).status,409);assert.equal((await put({...body,branch_id:'foreign'})).status,400);assert.equal((await put({...body,required_count:-1})).status,400);
    assert.equal((await fetch(base+branch+'/requirements',{headers})).status,404);
    assert.equal((await fetch(base+'bad/requirements',{headers})).status,400);
    const selection={work_date:body.work_date,shift_id:body.shift_id,department_id:body.department_id,expected_updated_at:stored.updated_at};
    const clear=b=>fetch(url,{method:'DELETE',headers,body:JSON.stringify(b)});
    assert.equal((await clear({...selection,branch_id:'foreign'})).status,400);
    assert.equal((await clear({...selection,expected_updated_at:null})).status,400);
    assert.equal((await clear({...selection,expected_updated_at:'2000-01-01T00:00:00Z'})).status,409);
    assert.equal((await clear(selection)).status,200);
    assert.ok(!(await(await get()).json()).result.requirements.some(r=>r.id===stored.id));
    assert.equal((await clear(selection)).status,409);
  }finally{db.from=old.from;db.auth.getUser=old.getUser;process.env.NODE_ENV=old.env;if(old.source===undefined)delete process.env.SCHEDULING_DATA_SOURCE;else process.env.SCHEDULING_DATA_SOURCE=old.source;await new Promise(r=>server.close(r));}
});
