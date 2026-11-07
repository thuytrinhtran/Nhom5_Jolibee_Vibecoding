const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{performance}=require('node:perf_hooks');
test('representative RPC performance and shortage workflow through local PostgREST',{
 skip:process.env.REGISTRATION_USE_NATIVE!=='true'||!process.env.TV3_NATIVE_POSTGREST?'Requires disposable PostgreSQL and local PostgREST':false,
},async t=>{
 const h=await require('./helpers/registration-harness.cjs').createHarness();
 try{
  for(const name of ['20261029_tv4_schedule_workflow.sql','20261031_tv3_schedule_draft.sql','20261101_tv3_rule_contract_v2.sql','20261102_tv4_workflow_v2.sql','20261103_employee_schedule_read.sql','20261106_tv3_persist_source_snapshot.sql','20261106_tv4_submit_staffing_shortage.sql'])await h.sql.exec(fs.readFileSync(path.join(__dirname,'../migrations',name),'utf8'));
  if(process.env.JOLLI_E2E_FORWARD==='true')await h.sql.exec(fs.readFileSync(path.join(__dirname,'../migrations/20261107_tv4_source_relevance.sql'),'utf8'));
  const q=(s,p=[])=>h.sql.query(s,p),branch=h.id(1),period=h.id(8),ql=h.id(90),gs=h.id(91),departments=[h.id(2),h.id(30),h.id(31)],shifts=[h.id(5),h.id(6),h.id(7)];
  await q("SET timezone='UTC'");
  await q('INSERT INTO auth.users VALUES($1),($2)',[ql,gs]);await q("INSERT INTO users(id,username,role,branch_id) VALUES($1,'perf_ql','QL',$3),($2,'perf_gs','GS',NULL)",[ql,gs,branch]);await q('UPDATE branches SET supervisor_id=$1 WHERE id=$2',[gs,branch]);
  await q("INSERT INTO departments(id,name) VALUES($1,'Perf service'),($2,'Perf cashier')",departments.slice(1));
  await q("UPDATE registration_periods SET open_at=now()-interval '3 days',close_at=now()-interval '1 day'");
  const day=(await q('SELECT work_start_date::text d FROM registration_periods WHERE id=$1',[period])).rows[0].d;
  const date=n=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
  const people=Array.from({length:60},(_,i)=>({id:i===0?h.id(4):h.id(2000+i),user_id:i===0?h.id(3):h.id(1000+i),department_id:departments[Math.floor(i/20)],username:'perf_nv_'+i}));
  const others=JSON.stringify(people.slice(1));
  await q('INSERT INTO auth.users SELECT user_id FROM jsonb_to_recordset($1::jsonb) p(user_id uuid)',[others]);
  await q("INSERT INTO users(id,username,role,branch_id,is_active,must_change_password) SELECT user_id,username,'NV',$2,true,false FROM jsonb_to_recordset($1::jsonb) p(user_id uuid,username text)",[others,branch]);
  await q("INSERT INTO employees(id,user_id,full_name,branch_id,department_id,skill_level,max_weekly_hours) SELECT id,user_id,'Synthetic performance employee',$2,department_id,'REGULAR',40 FROM jsonb_to_recordset($1::jsonb) p(id uuid,user_id uuid,department_id uuid)",[others,branch]);
  await q("UPDATE employees SET skill_level='REGULAR',max_weekly_hours=40 WHERE id=$1",[h.id(4)]);
  const cells=[],registrations=[],cursor=[0,0,0];let index=0;
  for(let d=0;d<7;d++)for(let dept=0;dept<3;dept++)for(let shift=0;shift<3;shift++){
   const required=[2,3,3][shift],n=index++;const cell={id:h.id(3000+n),work_date:date(d),department_id:departments[dept],shift_id:shifts[shift],required_count:required,short:n<30};cells.push(cell);
   for(let slot=0;slot<required-(cell.short?1:0);slot++){const e=people[dept*20+(cursor[dept]++%20)];registrations.push({employee_id:e.id,work_date:cell.work_date,shift_id:cell.shift_id});}
  }
  assert.equal(registrations.length,138);
  for(const cell of cells.filter(c=>!c.short)){for(const e of people.filter(e=>e.department_id===cell.department_id)){
   if(registrations.length===199)break;
   if(!registrations.some(r=>r.employee_id===e.id&&r.work_date===cell.work_date&&r.shift_id===cell.shift_id))registrations.push({employee_id:e.id,work_date:cell.work_date,shift_id:cell.shift_id});
  }if(registrations.length===199)break;}
  await q("INSERT INTO registration_submissions(period_id,employee_id,status,submitted_at) SELECT $1,id,'VALID',now() FROM jsonb_to_recordset($2::jsonb) p(id uuid)",[period,JSON.stringify(people)]);
  await q("INSERT INTO shift_registrations(period_id,employee_id,work_date,shift_id,status,submitted_at) SELECT $1,employee_id,work_date,shift_id,'VALID',now() FROM jsonb_to_recordset($2::jsonb) r(employee_id uuid,work_date date,shift_id uuid)",[period,JSON.stringify(registrations)]);
  await q('INSERT INTO staffing_requirements(id,branch_id,department_id,work_date,shift_id,required_count,created_by) SELECT id,$1,department_id,work_date,shift_id,required_count,$3 FROM jsonb_to_recordset($2::jsonb) r(id uuid,department_id uuid,work_date date,shift_id uuid,required_count int)',[branch,JSON.stringify(cells),ql]);
  const future=h.id(4000),futureSchedule=h.id(4001);
  await q("INSERT INTO registration_periods(id,branch_id,work_start_date,work_end_date,open_at,close_at,status) VALUES($1,$2,$3,$4,now()-interval '3 days',now()-interval '1 day','CLOSED')",[future,branch,date(7),date(13)]);
  await q("INSERT INTO schedules(id,branch_id,period_id,version,status,created_by) VALUES($1,$2,$3,1,'DRAFT',$4)",[futureSchedule,branch,future,ql]);
  await q("INSERT INTO shift_assignments(schedule_id,employee_id,work_date,shift_id,department_id,actual_branch_id,status,assignment_source) SELECT $1,id,$2,$3,department_id,$4,'DRAFT','REGULAR' FROM jsonb_to_recordset($5::jsonb) p(id uuid,department_id uuid)",[futureSchedule,date(7),shifts[0],branch,JSON.stringify(people.slice(0,44))]);
  const input=(await q('SELECT persist_schedule_draft($1,$2) r',[period,ql])).rows[0].r.input;
  const plan=require('../dist/services/scheduling.engine.js').generateSchedule(input);assert.equal(plan.required_count,168);assert.equal(plan.assigned_count,138);
  const report={environment:'DISPOSABLE_LOOPBACK_ONLY',shared_supabase_contacted:false,shape:{employees:60,registrations:199,cells:63,required:168,assigned:138,missing:30,other_existing:44},sql_ms:{},http_ms:{}};
  let request=10000;
  const measure=async(key,action)=>{const samples=[];for(let i=0;i<3;i++){await q('BEGIN');try{const start=performance.now();await action();samples.push(Math.round((performance.now()-start)*100)/100);}finally{await q('ROLLBACK');}}report.sql_ms[key]=samples;assert.ok(Math.max(...samples)<(key==='PERSIST'?3000:5000),`${key} exceeded RPC budget: ${samples}`);};
  await measure('PERSIST',()=>q('SELECT persist_schedule_draft($1,$2,$3::jsonb,$4::jsonb,NULL,NULL,$5,$6)',[period,ql,JSON.stringify(input),JSON.stringify(plan),h.id(++request),'a'.repeat(64)]));
  const gateway=await h.gateway();
  const rpc=async(name,args)=>{const start=performance.now();const r=await fetch(gateway+'/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});const data=await r.json();const ms=Math.round((performance.now()-start)*100)/100;assert.equal(r.status,200,JSON.stringify(data));return {data,ms};};
  const loaded=await rpc('persist_schedule_draft',{p_period_id:period,p_actor_id:ql});const gatewayPlan=require('../dist/services/scheduling.engine.js').generateSchedule(loaded.data.input);
  const saved=await rpc('persist_schedule_draft',{p_period_id:period,p_actor_id:ql,p_snapshot:loaded.data.input,p_result:gatewayPlan,p_request_id:h.id(++request),p_fingerprint:'b'.repeat(64)});report.http_ms.PERSIST=saved.ms;
  const schedule=saved.data.result.schedule;
  const bytes=(await q("SELECT octet_length(new_data::text) audit_json_bytes,octet_length((new_data->'source_snapshot')::text) snapshot_json_bytes FROM audit_logs WHERE entity_id=$1 AND action='AUTO_GENERATE'",[schedule.id])).rows[0];report.bytes=bytes;
  const before=await rpc('employee_schedule_week',{p_actor_id:h.id(3),p_week_start:day});assert.equal(before.data.assignments.length,0);
  const deadline=new Date(Date.now()+86400000).toISOString();
  for(const action of ['SUBMIT','APPROVED','PUBLISH']){
   const actor=action==='APPROVED'?gs:ql;
   await measure(action,()=>q('SELECT tv4_transition_schedule_v2($1,$2,1,$3,$4,NULL,$5)',[schedule.id,actor,action,h.id(++request),action==='PUBLISH'?deadline:null]));
   const args={p_schedule_id:schedule.id,p_actor_id:actor,p_expected_version:1,p_action:action,p_request_id:h.id(++request),p_feedback_deadline_at:action==='PUBLISH'?deadline:null};
   const result=await rpc('tv4_transition_schedule_v2',args);report.http_ms[action]=result.ms;assert.ok(result.ms<5000);assert.equal((await rpc('tv4_transition_schedule_v2',args)).data.reused,true);
  }
  const visible=await rpc('employee_schedule_week',{p_actor_id:h.id(3),p_week_start:day});assert.ok(visible.data.assignments.length>0);
  assert.equal((await q('SELECT count(*)::int n FROM shift_assignments WHERE schedule_id=$1',[schedule.id])).rows[0].n,138);
  assert.equal((await q('SELECT count(*)::int n FROM shift_assignments WHERE schedule_id=$1 AND status=\'ACTIVE\'',[schedule.id])).rows[0].n,138);
  report.result='PASS';report.transport='native SQL plus local PostgREST, not cloud latency';
  if(process.env.JOLLISHIFT_WORKFLOW_PERF_REPORT)fs.writeFileSync(process.env.JOLLISHIFT_WORKFLOW_PERF_REPORT,JSON.stringify(report,null,2)+'\n');
  t.diagnostic(JSON.stringify(report));
 }finally{await h.close();}
});
