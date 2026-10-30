const {test}=require('node:test');
const assert=require('node:assert/strict');
process.env.NODE_ENV='test';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY ||= 'isolated-test-placeholder';
const app=require('../dist/server.js').default;
const {supabaseAdmin:db}=require('../dist/config/supabase.js');
const id='00000000-0000-4000-8000-000000000001';
test('manager period APIs are registered, branch-scoped, validated and read-only',async()=>{
  const original={getUser:db.auth.getUser,from:db.from};
  let role='QL',missing=false,fail=false;const queries=[];
  db.auth.getUser=async()=>({data:{user:{id}}});
  db.from=table=>{
    const filters=[];const query={table,filters};queries.push(query);
    const data=()=> table==='registration_periods' ? [{id,branch_id:id,work_start_date:'2026-11-02',work_end_date:'2026-11-08',status:'PLANNED',open_at:'2026-10-01T00:00:00Z',close_at:'2026-10-02T00:00:00Z',schedules:[]}]
      :table==='employees'?[{id,full_name:'Test Employee',department_id:id,branch_id:id,status:'ACTIVE',skill_level:'REGULAR',user:{is_active:true,role:'NV',branch_id:id}}]:table==='shift_registrations'?[1,2,3].map(n=>({id:String(n),period_id:id,employee_id:id,work_date:'2026-11-02',shift_id:String(n),status:'VALID',submitted_at:'stamp'})):table==='shifts'?[1,2,3].map(n=>({id:String(n),branch_id:id,is_active:true})):table==='registration_submissions_sourced'?[{employee_id:id,status:'VALID',submitted_at:'stamp',updated_at:'stamp',sample_batch_id:null}]:[];
    return {select(columns){query.columns=columns;return this},eq(k,v){filters.push([k,v]);return this},neq(){return this},gte(){return this},lte(){return this},or(value){query.or=value;return this},order(){return this},range(){return this},
      single:async()=>({data:table==='users'?{id,username:'fixture',role,branch_id:id,is_active:true,must_change_password:false}:{name:'Test Branch'}}),
      maybeSingle:async()=>({data:missing?null:data()[0],error:fail?{message:'private failure'}:null}),
      then(resolve){resolve({data:data(),count:table==='shift_registrations'?3:null,error:fail?{message:'private failure'}:null});}};
  };
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}/api/schedules`;
  const get=path=>fetch(base+path,{headers:{Authorization:'Bearer fixture'}});
  try{
    assert.equal((await fetch(base+'/periods')).status,401);
    for(const value of ['NV','GS']){role=value;assert.equal((await get('/periods')).status,403);assert.equal((await get('/periods/'+id)).status,403);}
    role='QL';queries.length=0;
    const periods=await get('/periods?branch_id=untrusted');assert.equal(periods.status,200);assert.equal((await periods.json()).periods[0].id,id);
    assert.ok(queries.find(q=>q.table==='registration_periods').filters.some(([k,v])=>k==='branch_id'&&v===id));
    assert.equal((await get('/periods/bad')).status,400);
    const detail=await get('/periods/'+id);assert.equal(detail.status,200);
    const body=(await detail.json()).result;assert.equal(body.valid_registration_count,3);assert.equal(body.employees[0].full_name,'Test Employee');
    for(const table of ['employees','staffing_requirements']) assert.ok(queries.find(q=>q.table===table).filters.some(([k,v])=>k==='branch_id'&&v===id));
    assert.ok(queries.find(q=>q.table==='shift_registrations').filters.some(([k,v])=>k==='status'&&v==='VALID'));
    assert.ok(!queries.some(q=>q.columns?.includes('phone')||q.columns?.includes('email')));
    missing=true;assert.equal((await get('/periods/'+id)).status,404);missing=false;fail=true;
    const error=await get('/periods');assert.equal(error.status,503);assert.doesNotMatch(JSON.stringify(await error.json()),/private failure/);
  }finally{db.auth.getUser=original.getUser;db.from=original.from;await new Promise(r=>server.close(r));}
});
