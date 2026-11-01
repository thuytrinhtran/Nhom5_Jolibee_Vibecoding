const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const enabled=['TV3_NATIVE_PG_ROOT','TV3_NATIVE_PG_BIN','TV3_NATIVE_PG_CLIENT'].every(k=>process.env[k]);
test('v2 DRAFT contract on isolated native PostgreSQL',{skip:!enabled,timeout:120000},async t=>{
 const h=await require('./helpers/native-tv3-harness.cjs').nativeHarness();
 const migration=fs.readFileSync(path.join(__dirname,'../migrations/20261101_tv3_rule_contract_v2.sql'),'utf8');
 const {generateSchedule}=require('../dist/services/scheduling.engine.js');
 try{
  await t.test('refuses to overwrite an unknown deployed function and rolls back',async()=>{
   await h.admin.query('BEGIN');await h.admin.query("CREATE OR REPLACE FUNCTION public.tv3_scheduling_input(p_period_id uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$");
   await assert.rejects(h.admin.query(migration),/Unknown TV3 function/);await h.admin.query('ROLLBACK');
  });
  await t.test('refuses unexpected EXECUTE grants instead of silently changing access',async()=>{
   await h.admin.query('BEGIN');await h.admin.query('GRANT EXECUTE ON FUNCTION public.tv3_scheduling_input(uuid) TO anon');
   await assert.rejects(h.admin.query(migration),/Unknown TV3 EXECUTE ACL/);await h.admin.query('ROLLBACK');
  });
  await h.admin.query(migration);
  await t.test('keeps RPC signatures, ACLs and private helpers',async()=>{
   for(const name of ['tv3_scheduling_input(uuid)','tv3_result_v2(jsonb,uuid,jsonb,jsonb)','tv3_balance_v2(jsonb,jsonb)','tv3_existing_coverage_v2(jsonb)'])
    for(const role of ['anon','authenticated','service_role'])assert.equal((await h.admin.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') v',[role,'public.'+name])).rows[0].v,false);
   for(const role of ['anon','authenticated'])assert.equal((await h.admin.query("SELECT has_function_privilege($1,'public.persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text)','EXECUTE') v",[role])).rows[0].v,false);
  });
  await t.test('round trip includes provenance, experience, optimizer trace, SQL-derived scores and idempotency',async()=>{
   const f=await h.fixture(),input=(await h.call(h.admin,f)).input;
   assert.equal(input.rule_version,'tv3.rules.v2');assert.equal(input.registration_provenance.length,1);assert.ok(input.employees[0].employee_code);
   const result=generateSchedule(input),request=randomUUID(),options={snapshot:input,result,request,fingerprint:'a'.repeat(64)};
   const saved=await h.call(h.admin,f,options),value=saved.result;
   assert.equal(value.rule_version,'tv3.rules.v2');assert.deepEqual(value.coverage,result.coverage);assert.deepEqual(value.employee_statistics,result.employee_statistics);
   assert.deepEqual(value.assignments,result.assignments);assert.deepEqual(value.registration_provenance,input.registration_provenance);
   assert.equal(value.optimization.after.objective,result.optimization.after.objective);
   const replay=await h.call(h.admin,f,{request,fingerprint:options.fingerprint});assert.equal(replay.reused,true);assert.deepEqual(replay.result,value);
   const audit=(await h.admin.query('SELECT new_data FROM audit_logs WHERE entity_id=$1',[value.schedule.id])).rows[0].new_data;
   assert.equal(audit.rpc_version,'tv3-v2');assert.deepEqual(audit.assignments,value.assignments);
   const target=value.schedule.id,editInput=(await h.call(h.admin,f,{target,version:1})).input;
   const edited=await h.call(h.admin,f,{snapshot:editInput,result:generateSchedule(editInput),target,version:1,request:randomUUID(),fingerprint:'b'.repeat(64)});
   assert.equal(edited.result.schedule.version,2);assert.equal(edited.result.schedule.schedule_group_id,value.schedule.schedule_group_id);
   assert.equal((await h.admin.query('SELECT status FROM shift_assignments WHERE schedule_id=$1',[target])).rows[0].status,'REPLACED');
  });
  await t.test('SQL recomputes forged coverage and rejects forged optimizer/history atomically',async()=>{
   const f=await h.fixture(),input=(await h.call(h.admin,f)).input,result=generateSchedule(input);
   const fake=structuredClone(result);fake.optimization.after.objective=999;
   await assert.rejects(h.call(h.admin,f,{snapshot:input,result:fake}),/INVALID_OPTIMIZATION_METRICS/);
   const bad=structuredClone(result);bad.assignments[0].selection_history.initial.employee_id=h.id(999);
   await assert.rejects(h.call(h.admin,f,{snapshot:input,result:bad}),/INVALID_SELECTION_HISTORY/);
   assert.equal(Number((await h.admin.query('SELECT count(*) n FROM schedules WHERE period_id=$1',[f.period])).rows[0].n),0);
   const saved=await h.call(h.admin,f,{snapshot:input,result:{...result,coverage:[],assigned_count:999,employee_statistics:[]}});
   assert.equal(saved.result.assigned_count,1);assert.equal(saved.result.coverage[0].experienced_count,1);
  });
  await t.test('NEW shortage warning ignores old threshold; sample imports remain excluded',async()=>{
   const f=await h.fixture();await h.admin.query("UPDATE employees SET skill_level='NEW' WHERE id=$1",[f.employee]);
   const input=(await h.call(h.admin,f)).input,saved=await h.call(h.admin,f,{snapshot:input,result:generateSchedule(input)});
   assert.equal(saved.result.coverage[0].warning,'EXPERIENCE_SHORTAGE');assert.equal(saved.result.coverage[0].missing_experienced_count,1);
   const batch=randomUUID();await h.admin.query("INSERT INTO audit_logs(id,entity_type,entity_id,action,change_source) VALUES($1,'registration_periods',$2,'TEST_IMPORT','SYSTEM')",[batch,f.period]);
   await h.admin.query('UPDATE registration_submissions SET sample_batch_id=$1 WHERE period_id=$2',[batch,f.period]);
   const snapshot=(await h.admin.query('SELECT tv3_scheduling_input($1) x',[f.period])).rows[0].x;
   assert.equal(snapshot.registrations.length,0);assert.equal(snapshot.registration_provenance.length,0);
  });
  await t.test('SQL existing coverage matches TS, deduplicates, rejects invalid and out-of-period rows',async()=>{
   const f=await h.fixture(),input=(await h.call(h.admin,f)).input;
   const booking=f.assignment;input.existing=[booking,{...booking},{...booking,work_date:'2000-01-01'}];
   const result=generateSchedule(input);assert.equal(result.assigned_count,0);assert.equal(result.covered_count,1);
   const schedule=(await h.admin.query("INSERT INTO schedules(branch_id,period_id,version,status,created_by) VALUES($1,$2,1,'DRAFT',$3) RETURNING id",[f.branch,f.period,f.actor])).rows[0].id;
   const sql=(await h.admin.query('SELECT tv3_result_v2($1::jsonb,$2,$3::jsonb,$4::jsonb) r',[JSON.stringify(input),schedule,'[]',JSON.stringify(result)])).rows[0].r;
   assert.deepEqual(sql.coverage,result.coverage);assert.equal(sql.existing_count,1);assert.deepEqual(sql.employee_statistics,result.employee_statistics);
   input.registrations=[];assert.equal((await h.admin.query('SELECT count(*)::int n FROM tv3_existing_coverage_v2($1::jsonb)',[JSON.stringify(input)])).rows[0].n,0);
  });
  await t.test('provenance change invalidates source snapshot before any schedule commit',async()=>{
   const f=await h.fixture(),input=(await h.call(h.admin,f)).input;
   await h.admin.query("UPDATE registration_submissions SET updated_at=updated_at+interval '1 second' WHERE period_id=$1",[f.period]);
   await assert.rejects(h.call(h.admin,f,{snapshot:input,result:generateSchedule(input)}),e=>e.code==='40001');
   assert.equal(Number((await h.admin.query('SELECT count(*) n FROM schedules WHERE period_id=$1',[f.period])).rows[0].n),0);
  });
  await t.test('SQL preserves an actual replacement chain and independently reproduces its balance gain',async()=>{
   const f=await h.fixture();
   for(const n of [800,810]){
    await h.admin.query('INSERT INTO auth.users(id) VALUES($1)',[h.id(n)]);
    await h.admin.query("INSERT INTO users(id,username,role,branch_id) VALUES($1,$2,'NV',$3)",[h.id(n),'optimizer_'+n,f.branch]);
    await h.admin.query("INSERT INTO employees(id,user_id,full_name,department_id,branch_id,skill_level) VALUES($1,$2,'Optimizer test',$3,$4,'REGULAR')",[h.id(n+1),h.id(n),f.department,f.branch]);
   }
   await h.admin.query("INSERT INTO staffing_requirements(branch_id,department_id,shift_id,work_date,required_count,created_by) VALUES($1,$2,$3,'2026-10-27',1,$4)",[f.branch,f.department,f.shift,f.actor]);
   for(const employee of [f.employee,h.id(801),h.id(811)]){
    if(employee!==f.employee)await h.admin.query("INSERT INTO registration_submissions(period_id,employee_id,status,submitted_at) VALUES($1,$2,'VALID',now())",[f.period,employee]);
    for(const day of employee===f.employee?['2026-10-27']:['2026-10-26','2026-10-27'])await h.admin.query("INSERT INTO shift_registrations(period_id,employee_id,work_date,shift_id,status,submitted_at) VALUES($1,$2,$3,$4,'VALID',now())",[f.period,employee,day,f.shift]);
   }
   const input=(await h.call(h.admin,f)).input;
   const {optimizeScheduleAssignments,buildScheduleResult}=require('../dist/services/scheduling.engine.js');
   const initial=input.requirements.map(n=>({employee_id:f.employee,work_date:n.work_date,shift_id:n.shift_id,department_id:n.department_id,requirement_id:n.id,reason:'ISOLATED_INITIAL_PLAN'}));
   const optimized=optimizeScheduleAssignments(input,initial);assert.ok(optimized.optimization.iterations>0);
   const result={...buildScheduleResult(input,optimized.assignments),optimization:optimized.optimization};
   const saved=(await h.call(h.admin,f,{snapshot:input,result})).result;
   assert.deepEqual(saved.assignments,result.assignments);assert.ok(saved.optimization.after.objective<saved.optimization.before.objective);
   assert.ok(Math.abs(saved.optimization.before.objective-result.optimization.before.objective)<1e-7);
  });
  await t.test('concurrent v2 saves fail fast and rollback leaves no partial schedule',async()=>{
   const f=await h.fixture(),input=(await h.call(h.admin,f)).input,result=generateSchedule(input),a=await h.connect(),b=await h.connect();
   await a.query('BEGIN');await h.call(a,f,{snapshot:input,result,request:randomUUID(),fingerprint:'a'.repeat(64)});
   await assert.rejects(h.call(b,f,{snapshot:input,result,request:randomUUID(),fingerprint:'b'.repeat(64)}),e=>e.code==='55P03');
   assert.equal(Number((await h.admin.query('SELECT count(*) n FROM schedules WHERE period_id=$1',[f.period])).rows[0].n),0);
   await a.query('ROLLBACK');assert.equal(Number((await h.admin.query('SELECT count(*) n FROM schedules WHERE period_id=$1',[f.period])).rows[0].n),0);
   assert.equal((await h.call(b,f,{snapshot:input,result})).result.assigned_count,1);
  });
  await t.test('70 employees and 308 assignments round-trip within the unchanged SQL work budget',async()=>{
   const f=await h.fixture(),departments=[f.department,randomUUID(),randomUUID()],shifts=[f.shift,randomUUID(),randomUUID()];
   await h.admin.query('INSERT INTO departments(id,name) VALUES($1,$2),($3,$4)',[departments[1],'Bulk service '+f.branch,departments[2],'Bulk cashier '+f.branch]);
   await h.admin.query("INSERT INTO shifts(id,name,start_time,end_time,branch_id) VALUES($1,'Afternoon','12:00','17:00',$3),($2,'Evening','17:00','22:00',$3)",[shifts[1],shifts[2],f.branch]);
   const people=Array.from({length:69},(_,i)=>({id:randomUUID(),user_id:randomUUID(),department_id:departments[i+1<28?0:i+1<52?1:2],skill_level:i%5===0?'NEW':'REGULAR'}));
   await h.admin.query('INSERT INTO auth.users(id) SELECT user_id FROM jsonb_to_recordset($1::jsonb) AS x(user_id uuid)',[JSON.stringify(people)]);
   await h.admin.query("INSERT INTO users(id,username,role,branch_id) SELECT user_id,'bulk_'||user_id::text,'NV',$2 FROM jsonb_to_recordset($1::jsonb) AS x(user_id uuid)",[JSON.stringify(people),f.branch]);
   await h.admin.query("INSERT INTO employees(id,user_id,full_name,branch_id,department_id,skill_level) SELECT id,user_id,'Bulk test employee',$2,department_id,skill_level FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,user_id uuid,department_id uuid,skill_level varchar)",[JSON.stringify(people),f.branch]);
   await h.admin.query('UPDATE employees SET max_weekly_hours=NULL WHERE branch_id=$1',[f.branch]);
   await h.admin.query("INSERT INTO registration_submissions(period_id,employee_id,status,submitted_at) SELECT $1,id,'VALID',now() FROM employees WHERE branch_id=$2 AND id<>$3",[f.period,f.branch,f.employee]);
   await h.admin.query('DELETE FROM shift_registrations WHERE period_id=$1',[f.period]);await h.admin.query('DELETE FROM staffing_requirements WHERE branch_id=$1',[f.branch]);
   await h.admin.query("INSERT INTO shift_registrations(period_id,employee_id,work_date,shift_id,status,submitted_at) SELECT $1,e.id,d::date,s.id,'VALID',now() FROM employees e JOIN shifts s ON s.branch_id=e.branch_id CROSS JOIN generate_series('2026-10-26'::timestamp,'2026-11-01'::timestamp,interval '1 day') d WHERE e.branch_id=$2",[f.period,f.branch]);
   await h.admin.query("INSERT INTO staffing_requirements(branch_id,department_id,shift_id,work_date,required_count,created_by) SELECT $1,dep.id,s.id,d::date,CASE WHEN dep.id=$2 AND s.id=$4 THEN 6 WHEN dep.id=$3 AND s.id=$4 THEN 3 ELSE 5 END,$5 FROM departments dep CROSS JOIN shifts s CROSS JOIN generate_series('2026-10-26'::timestamp,'2026-11-01'::timestamp,interval '1 day') d WHERE dep.id=ANY($6::uuid[]) AND s.branch_id=$1",[f.branch,departments[1],departments[2],f.shift,f.actor,departments]);
   const input=(await h.call(h.admin,f)).input,result=generateSchedule(input);assert.equal(result.assigned_count,308);
   const saved=(await h.call(h.admin,f,{snapshot:input,result})).result;
   assert.equal(saved.assigned_count,308);assert.deepEqual(saved.coverage,result.coverage);assert.equal(saved.composition_shortages.length,0);
   assert.deepEqual(saved.assignments,result.assignments);
  });
 }finally{await h.close();}
});
