const {test}=require('node:test'),assert=require('node:assert/strict');
process.env.NODE_ENV='test';
test('official calendar is read-only, QL/branch scoped, paginated in DB, and skips unneeded metadata',async()=>{
 const app=require('../dist/server.js').default,{supabaseAdmin:db}=require('../dist/config/supabase.js'),original={from:db.from,get:db.auth.getUser};
 const id='00000000-0000-4000-8000-000000000001';let role='QL';const queries=[];
 db.auth.getUser=async()=>({data:{user:{id}},error:null});
 db.from=table=>{const call={table,filters:[],range:null};queries.push(call);const q={select:()=>q,eq:(k,v)=>{call.filters.push([k,v]);return q;},not:()=>q,order:()=>q,range:(a,b)=>{call.range=[a,b];return q;},single:async()=>({data:{id,username:'user',role,branch_id:id,is_active:true,must_change_password:false},error:null}),maybeSingle:async()=>({data:{id,branch_id:id,work_start_date:'2026-11-02',work_end_date:'2026-11-08'},error:null}),then:resolve=>Promise.resolve({data:table==='schedules'?[{id:'published',schedule_group_id:'group',version:1,status:'PUBLISHED',published_at:'date'}]:table==='shift_assignments'?[{id:'row',employee:{id:'employee'},shift:{name:'Morning'},status:'ACTIVE'}]:[],count:37,error:null}).then(resolve)};return q;};
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}/api/schedules/periods/${id}/official-calendar`,headers={Authorization:'Bearer fixture'};
 try{
  assert.equal((await fetch(url)).status,401);role='NV';assert.equal((await fetch(url,{headers})).status,403);role='QL';
  for(const query of ['page=-1','page_size=101','employee_id=forged','work_date=2026-02-30','branch_id=forged'])assert.equal((await fetch(url+'?'+query,{headers})).status,400);
  queries.length=0;const response=await fetch(url+'?page=1&page_size=20&metadata=false',{headers});assert.equal(response.status,200);const value=(await response.json()).result;assert.equal(value.total,37);assert.equal(value.assignments.length,1);
  const assignments=queries.find(q=>q.table==='shift_assignments');assert.deepEqual(assignments.range,[20,39]);assert.ok(assignments.filters.some(([k,v])=>k==='status'&&v==='ACTIVE'));assert.ok(assignments.filters.some(([k,v])=>k==='schedule_id'&&v==='published'));
  assert.ok(queries.find(q=>q.table==='registration_periods').filters.some(([k,v])=>k==='branch_id'&&v===id));assert.ok(!queries.some(q=>['employees','departments','shifts','shift_registrations'].includes(q.table)));
 }finally{db.from=original.from;db.auth.getUser=original.get;await new Promise(r=>server.close(r));}
});
