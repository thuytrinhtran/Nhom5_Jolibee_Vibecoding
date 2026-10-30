const {test}=require('node:test'),assert=require('node:assert/strict');
process.env.NODE_ENV='test';
const app=require('../dist/server.js').default,{supabaseAdmin:db}=require('../dist/config/supabase.js');
test('manager report scopes loaded period, excludes samples, rejects NV and unassigned GS',async()=>{
 const original={from:db.from,getUser:db.auth.getUser};
 const id='00000000-0000-4000-8000-000000000001',branch='branch-A';let role='QL',periodBranch=branch,assigned=false;
 db.auth.getUser=async()=>({data:{user:{id}},error:null});
 db.from=table=>{const filters=[];const q={select(){return this},eq(k,v){filters.push([k,v]);return this},neq(){return this},single:async()=>result(),maybeSingle:async()=>result(),then(resolve,reject){return Promise.resolve(result()).then(resolve,reject)}};
 function result(){
  if(table==='users')return{data:{id,role,branch_id:branch,is_active:true,must_change_password:false},error:null};
  if(table==='branches')return{data:filters.some(([k])=>k==='supervisor_id')?(assigned?{id:periodBranch}:null):{name:'Fixture'},error:null};
  if(table==='employees')return{data:{id:'employee'},error:null};
  if(table==='registration_periods')return{data:{id,branch_id:periodBranch,status:'PLANNED',open_at:new Date(Date.now()-1000).toISOString(),close_at:new Date(Date.now()+60000).toISOString(),work_start_date:'2026-11-02',work_end_date:'2026-11-08'},error:null};
  assert.ok(filters.some(([k,v])=>k==='period_id'&&v===id));
  if(table==='registration_submissions_sourced')return{data:[{employee_id:'real',sample_batch_id:null},{employee_id:'sample',sample_batch_id:'batch'}],error:null};
  if(table==='registration_submissions'){assert.ok(filters.some(([k,v])=>k==='employees.branch_id'&&v===periodBranch));return{data:[{employee_id:'real',status:'VALID',submitted_at:'now',sample_batch_id:null},{employee_id:'sample',status:'VALID',submitted_at:'now',sample_batch_id:'batch'}],error:null};}
  if(table==='shift_registrations')return{data:['real','sample'].map(employee_id=>({employee_id,work_date:'2026-11-02',submitted_at:'now',shifts:{branch_id:periodBranch}})),error:null};
  throw Error('Unexpected query');
 }return q;};
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const get=(suffix='')=>fetch(`http://127.0.0.1:${server.address().port}/api/registration-reports/${id}${suffix}`,{headers:{Authorization:'Bearer fixture'}});
 try{
  let r=await get();assert.equal(r.status,200);let d=await r.json();assert.equal(d.period.status,'OPEN');assert.equal(d.registrations.length,1);
  d=await(await get('?include_samples=true')).json();assert.equal(d.registrations.length,2);
  periodBranch='branch-B';assert.equal((await get()).status,403);
  role='NV';assert.equal((await get()).status,403);
  role='GS';assert.equal((await get()).status,403);assigned=true;assert.equal((await get()).status,200);
 }finally{db.from=original.from;db.auth.getUser=original.getUser;await new Promise(r=>server.close(r));}
});
