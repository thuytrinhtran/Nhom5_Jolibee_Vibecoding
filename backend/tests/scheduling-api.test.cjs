const {test} = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_ENV='test';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY ||= 'isolated-test-placeholder';
const app=require('../dist/server.js').default;
const {supabaseAdmin:db}=require('../dist/config/supabase.js');
const {createDraft,readDraft}=require('../dist/services/scheduling.service.js');
const id='00000000-0000-4000-8000-000000000001';
function input(){return {period:{id,branch_id:id,work_start_date:'2026-11-02',work_end_date:'2026-11-08',status:'CLOSED'},employees:[],shifts:[{id,start_time:'08:00:00',end_time:'12:00:00',is_active:true}],registrations:[],requirements:[{id,department_id:id,work_date:'2026-11-02',shift_id:id,required_count:1,required_skill_name:null}],existing:[],new_employee_count_threshold:null};}
test('HTTP scheduling RBAC, validation, branch restriction and DB errors',async()=>{
  const originals={getUser:db.auth.getUser,from:db.from,rpc:db.rpc};
  let profile={id,role:'QL',branch_id:id,is_active:true,must_change_password:false};let calls=0,fail=false;
  db.auth.getUser=async()=>({data:{user:{id}},error:null});
  db.from=table=>({select(){return this},eq(){return this},single:async()=>({data:table==='users'?profile:{name:'fixture'},error:null}),maybeSingle:async()=>({data:null,error:null})});
  db.rpc=async(_name,args)=>{calls++;assert.equal(args.p_actor_id,profile.id);if(fail)return {error:{message:'private database details'}};
    return {data:args.p_result?{result:{...args.p_result,schedule:{id,status:'DRAFT'}},reused:false}:{input:input()},error:null};};
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const url=`http://127.0.0.1:${server.address().port}/api/schedules/generate`;
  const headers={'Content-Type':'application/json',Authorization:'Bearer fixture'};
  const post=(body={period_id:id},h=headers)=>fetch(url,{method:'POST',headers:h,body:JSON.stringify(body)});
  try {
    assert.equal((await post({},{})).status,401);
    for(const role of ['NV','GS']){profile.role=role;assert.equal((await post()).status,403);}assert.equal(calls,0);
    profile.role='QL';profile.must_change_password=true;assert.equal((await post()).status,403);profile.must_change_password=false;
    assert.equal((await post({period_id:'bad'})).status,400);
    profile.branch_id=null;assert.equal((await post()).status,403);profile.branch_id=id;
    const generated=await post({period_id:id,p_actor_id:'forged',actor_id:'forged',branch_id:'other'});assert.equal(generated.status,201);const body=await generated.json();assert.equal(body.result.schedule.status,'DRAFT');assert.equal(body.result.shortages[0].missing_count,1);
    fail=true;const failure=await post();assert.equal(failure.status,503);assert.doesNotMatch(JSON.stringify(await failure.json()),/private database/);
    db.rpc=async()=>({error:{code:'42501'}});assert.equal((await post()).status,403);
  }finally{Object.assign(db,{from:originals.from,rpc:originals.rpc});db.auth.getUser=originals.getUser;await new Promise(r=>server.close(r));}
});
test('service reuses persisted draft without recomputing or saving',async()=>{
  const original=db.rpc;let calls=0;db.rpc=async()=>{calls++;return {data:{result:{schedule:{id,status:'DRAFT'}},reused:true}}};
  try{assert.equal((await createDraft(id,id)).reused,true);assert.equal(calls,1);}finally{db.rpc=original;}
});
test('save errors and stale snapshot propagate; protected versions conflict',async()=>{
  const original=db.rpc;
  try{for(const [error,expected] of [[{code:'PGRST202'},503],[{message:'insert failed'},503],[{code:'40001'},409],[{message:'SCHEDULE_EXISTS'},409],[{code:'P0002'},404],[{message:'PERIOD_NOT_CLOSED'},409],[{code:'23505'},409],[{code:'22023'},422],[{code:'55P03'},503]]){
    let calls=0;db.rpc=async()=>++calls===1?{data:{input:input()}}:{error};
    await assert.rejects(createDraft(id,id),e=>e.status===expected);
  }}finally{db.rpc=original;}
});
test('read after service reload queries database and branch, never in-memory state',async()=>{
  const original=db.from;const tables=[];
  db.from=table=>{tables.push(table);return {select(){return this},eq(key,value){if(table==='schedules'&&key==='branch_id')assert.equal(value,id);return this},order(){return this},limit(){return this},maybeSingle:async()=>({data:table==='schedules'?{id,status:'DRAFT'}:{new_data:{assigned_count:0}}}),then(resolve){resolve({data:[]});}}};
  try{
    delete require.cache[require.resolve('../dist/services/scheduling.service.js')];
    const service=require('../dist/services/scheduling.service.js');
    const result=await service.readDraft(id,id);assert.equal(result.schedule.id,id);assert.deepEqual(tables,['schedules','shift_assignments','audit_logs']);
  }finally{db.from=original;}
});
