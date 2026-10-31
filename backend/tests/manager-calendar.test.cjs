const {test}=require('node:test'),assert=require('node:assert/strict');
process.env.NODE_ENV='test';
const app=require('../dist/server.js').default,{supabaseAdmin:db}=require('../dist/config/supabase.js');
test('calendar HTTP is QL-only, branch scoped, read-only and preserves real statuses/OFF',async()=>{
 const original={from:db.from,getUser:db.auth.getUser};const id='00000000-0000-4000-8000-000000000001';let role='QL',missing=false;const queries=[];
 db.auth.getUser=async()=>({data:{user:{id}},error:null});
 db.from=table=>{const filters=[];const q={table,filters};queries.push(q);
  const values={employees:[{id:'e',full_name:'Fixture',department_id:'d',branch_id:id,status:'ACTIVE',skill_level:'REGULAR',user:{role:'NV',is_active:true,branch_id:id}}],shifts:[{id:'s',name:'Morning',start_time:'08:00',end_time:'12:00',is_active:true,branch_id:null}],departments:[{id:'d',name:'Kitchen'}],registration_submissions_sourced:[{employee_id:'e',status:'VALID',submitted_at:'stamp',updated_at:'stamp',sample_batch_id:null}],shift_registrations:[{id:'r',period_id:id,employee_id:'e',work_date:'2026-11-02',shift_id:'s',status:'VALID',submitted_at:'stamp'}],schedules:[{id:'draft',schedule_group_id:'g',status:'DRAFT',version:2,created_at:'2026-10-31'},{id:'published',schedule_group_id:'g',status:'PUBLISHED',version:1,created_at:'2026-10-30'}],shift_assignments:[{id:'a',schedule_id:'published',employee_id:'e',shift_id:'s',work_date:'2026-11-02',status:'ACTIVE',department_id:'d',employee:{id:'e',full_name:'Fixture',department_id:'d'},shift:{id:'s',name:'Morning'}}]};
  return {select(){return this},eq(k,v){filters.push([k,v]);return this},or(){return this},order(){return this},range(){return this},
   single:async()=>({data:{id,username:'fixture',role,branch_id:id,is_active:true,must_change_password:false}}),
   maybeSingle:async()=>({data:missing?null:{id,branch_id:id,work_start_date:'2026-11-02',work_end_date:'2026-11-08'}}),
   then(resolve,reject){return Promise.resolve({data:values[table]||[],error:null}).then(resolve,reject)}};
 };
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}/api/schedules/periods/${id}/calendar`;
 try{
  assert.equal((await fetch(url)).status,401);
  for(const r of ['NV','GS']){role=r;assert.equal((await fetch(url,{headers:{Authorization:'Bearer fixture'}})).status,403);}role='QL';
  queries.length=0;const r=await fetch(url+'?branch_id=untrusted',{headers:{Authorization:'Bearer fixture'}});assert.equal(r.status,200);const d=(await r.json()).result;
  assert.equal(d.source,'supabase');assert.equal(d.registrations.length,1);assert.equal(d.declarations.filter(x=>x.declaration==='OFF').length,6);
  assert.deepEqual(d.schedules.map(x=>x.status),['DRAFT','PUBLISHED']);assert.equal(d.assignments[0].status,'ACTIVE');
  for(const table of ['registration_periods','employees','schedules'])assert.ok(queries.some(q=>q.table===table&&q.filters.some(([k,v])=>k==='branch_id'&&v===id)));
  const a=queries.find(q=>q.table==='shift_assignments');assert.ok(a.filters.some(([k,v])=>k==='schedule.branch_id'&&v===id));assert.ok(a.filters.some(([k,v])=>k==='schedule.period_id'&&v===id));
  missing=true;assert.equal((await fetch(url,{headers:{Authorization:'Bearer fixture'}})).status,404);
 }finally{db.from=original.from;db.auth.getUser=original.getUser;await new Promise(r=>server.close(r));}
});
