const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
process.env.NODE_ENV='test';
test('employee API uses token identity only, guards roles/query and handles missing deployment',async()=>{
 const {supabaseAdmin:db}=require('../dist/config/supabase.js'),app=require('../dist/server.js').default;
 const original={from:db.from,rpc:db.rpc,getUser:db.auth.getUser};let role='NV',calls=[],failure=null;
 db.auth.getUser=async()=>({data:{user:{id:'token-owner'}},error:null});
 db.from=table=>({select(){return this;},eq(){return this;},single:async()=>({data:table==='users'?{id:'token-owner',role,username:'test',is_active:true,must_change_password:false,branch_id:'b'}:{name:'Branch'},error:null}),maybeSingle:async()=>({data:{id:'employee',full_name:'Owner'},error:null})});
 db.rpc=async(name,args)=>{calls.push({name,args});return{data:{assignments:[],schedules:[]},error:failure}};
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const get=(query,auth=true)=>fetch(`http://127.0.0.1:${server.address().port}/api/employee-schedule?${query}`,{headers:auth?{Authorization:'Bearer test'}:{}});
 try{
  assert.equal((await get('week_start=2026-11-02',false)).status,401);
  for(role of ['QL','GS'])assert.equal((await get('week_start=2026-11-02')).status,403);role='NV';
  for(const q of ['week_start=2026-11-02&employee_id=other','week_start=2026-11-02&branch_id=other','week_start=2026-11-03','week_start=2026-02-30','week_start=2026-11-02&week_start=2026-11-09',''])assert.equal((await get(q)).status,400,q);
  assert.equal(calls.length,0);const response=await get('week_start=2026-11-02');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(calls[0],{name:'employee_schedule_week',args:{p_actor_id:'token-owner',p_week_start:'2026-11-02'}});
  failure={code:'42501'};assert.equal((await get('week_start=2026-11-02')).status,403);
  failure={message:'AMBIGUOUS_PUBLISHED_ASSIGNMENTS'};assert.equal((await get('week_start=2026-11-02')).status,409);
  failure={code:'PGRST202'};assert.equal((await get('week_start=2026-11-02')).status,503);
 }finally{Object.assign(db,{from:original.from,rpc:original.rpc});db.auth.getUser=original.getUser;await new Promise(r=>server.close(r));}
});

test('published employee schedule PostgreSQL: effective version, ownership, branch and immutable reads',{skip:process.env.REGISTRATION_USE_NATIVE!=='true'?'Requires disposable native PostgreSQL':false},async()=>{
 const h=await require('./helpers/registration-harness.cjs').createHarness();let server;
 try{
  await h.sql.exec(fs.readFileSync(path.join(__dirname,'../migrations/20261103_employee_schedule_read.sql'),'utf8'));
  const q=(s,p=[])=>h.sql.query(s,p),branch=h.id(1),period=h.id(8),employee=h.id(4),nv=h.id(3),gs=h.id(90),manager=h.id(91),group=h.id(100);
  await q('INSERT INTO auth.users VALUES($1),($2)',[gs,manager]);await q("INSERT INTO users(id,username,role,branch_id) VALUES($1,'gs','GS',NULL),($2,'ql','QL',$3)",[gs,manager,branch]);await q('UPDATE branches SET supervisor_id=$1 WHERE id=$2',[gs,branch]);
  await q("UPDATE registration_periods SET work_start_date='2026-11-02',work_end_date='2026-11-08'");
  const schedule=async(version,status)=>{
   const id=h.id(100+version);await q("INSERT INTO schedules(id,schedule_group_id,branch_id,period_id,version,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)",[id,group,branch,period,version,status==='PUBLISHED'?'PENDING_APPROVAL':status,manager]);
   if(status==='PUBLISHED'){
    await q("INSERT INTO schedule_approvals(schedule_id,supervisor_id,decision) VALUES($1,$2,'APPROVED')",[id,gs]);await q("UPDATE schedules SET status='APPROVED' WHERE id=$1",[id]);await q("UPDATE schedules SET status='PUBLISHED',published_at=now(),feedback_deadline_at=now()+interval '1 day' WHERE id=$1",[id]);
   }return id;
  };
  const assign=async(id,status='ACTIVE')=>q("INSERT INTO shift_assignments(schedule_id,employee_id,work_date,shift_id,department_id,actual_branch_id,status) VALUES($1,$2,'2026-11-02',$3,$4,$5,$6)",[id,employee,h.id(5),h.id(2),branch,status]);
  const read=async(actor=nv)=>(await q("SELECT employee_schedule_week($1,'2026-11-02') r",[actor])).rows[0].r;
  assert.equal((await read()).schedules.length,0);
  const first=await schedule(1,'PUBLISHED');await assign(first);
  for(const [v,status] of [[2,'DRAFT'],[3,'PENDING_APPROVAL'],[4,'NEEDS_REVISION']]){const id=await schedule(v,status);await assign(id,'DRAFT');}
  let result=await read();assert.equal(result.assignments.length,1);assert.equal(result.assignments[0].version,1);
  const newer=await schedule(5,'PUBLISHED');await assign(newer);result=await read();assert.equal(result.assignments.length,1);assert.equal(result.assignments[0].version,5);assert.ok(result.assignments[0].assignment_id);
  const otherUser=h.id(121),otherEmployee=h.id(122);
  await q('INSERT INTO auth.users VALUES($1)',[otherUser]);await q("INSERT INTO users(id,username,role,branch_id) VALUES($1,'other_nv','NV',$2)",[otherUser,branch]);
  await q("INSERT INTO employees(id,user_id,full_name,branch_id,department_id,skill_level) VALUES($1,$2,'Other employee',$3,$4,'REGULAR')",[otherEmployee,otherUser,branch,h.id(2)]);
  await q("INSERT INTO shift_assignments(schedule_id,employee_id,work_date,shift_id,department_id,actual_branch_id,status) VALUES($1,$2,'2026-11-02',$3,$4,$5,'ACTIVE')",[newer,otherEmployee,h.id(5),h.id(2),branch]);
  assert.equal((await read()).assignments.length,1,'does not expose coworker assignments');
  await q("UPDATE shift_assignments SET status='REPLACED' WHERE schedule_id=$1",[newer]);assert.equal((await read()).assignments.length,0,'does not resurrect superseded publication');
  await assert.rejects(read(manager),e=>e.code==='42501');
  await q('UPDATE employees SET user_id=$1 WHERE id=$2',[manager,employee]);await assert.rejects(read(),e=>e.code==='42501');await q('UPDATE employees SET user_id=$1 WHERE id=$2',[nv,employee]);
  await q("UPDATE employees SET status='INACTIVE' WHERE id=$1",[employee]);await assert.rejects(read(),e=>e.code==='42501');await q("UPDATE employees SET status='ACTIVE' WHERE id=$1",[employee]);
  const other=h.id(120);await q("INSERT INTO branches(id,name) VALUES($1,'Other')",[other]);await q('UPDATE users SET branch_id=$1 WHERE id=$2',[other,nv]);await assert.rejects(read(),e=>e.code==='42501');await q('UPDATE users SET branch_id=$1 WHERE id=$2',[branch,nv]);
  for(const role of ['anon','authenticated'])assert.equal((await q("SELECT has_function_privilege($1,'employee_schedule_week(uuid,date)','EXECUTE') p",[role])).rows[0].p,false);
  server=h.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const response=await fetch(`http://127.0.0.1:${server.address().port}/api/employee-schedule?week_start=2026-11-02`,{headers:{Authorization:'Bearer isolated-api-access'}});assert.equal(response.status,200);assert.equal((await response.json()).result.assignments.length,0);
  await q('UPDATE schedules SET schedule_group_id=$1 WHERE id=$2',[h.id(130),first]);await assert.rejects(read(),/AMBIGUOUS_PUBLISHED_SCHEDULE/);
 }finally{if(server)await new Promise(r=>server.close(r));await h.close();}
});
