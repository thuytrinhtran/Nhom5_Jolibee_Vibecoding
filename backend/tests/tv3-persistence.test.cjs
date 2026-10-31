const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('TV3 migration persists engine output atomically in isolated PostgreSQL', {skip:!process.env.REGISTRATION_PGLITE_PATH},async()=>{
 const {createHarness}=require('./helpers/registration-harness.cjs');const h=await createHarness();
 try {
  await h.sql.exec(fs.readFileSync(path.join(__dirname,'../migrations/20261031_tv3_schedule_draft.sql'),'utf8'));
  const q=(s,p=[])=>h.sql.query(s,p),actor=h.id(90),period=h.id(8),employee=h.id(4),shift=h.id(5);
  await q('INSERT INTO auth.users VALUES($1)',[actor]);
  await q("INSERT INTO users(id,username,role,branch_id) VALUES($1,'manager','QL',$2)",[actor,h.id(1)]);
  await q("UPDATE registration_periods SET open_at=now()-interval '3 days',close_at=now()-interval '1 day',status='PLANNED' WHERE id=$1",[period]);
  const day=(await q('SELECT work_start_date::text d FROM registration_periods WHERE id=$1',[period])).rows[0].d;
  await q("INSERT INTO registration_submissions(period_id,employee_id,status,submitted_at) VALUES($1,$2,'VALID',now())",[period,employee]);
  await q("INSERT INTO shift_registrations(period_id,employee_id,work_date,shift_id,status,submitted_at) VALUES($1,$2,$3,$4,'VALID',now())",[period,employee,day,shift]);
  await q('INSERT INTO staffing_requirements(branch_id,department_id,shift_id,work_date,required_count,created_by) VALUES($1,$2,$3,$4,1,$5)',[h.id(1),h.id(2),shift,day,actor]);
  const call=async(snapshot=null,result=null)=>(await q('SELECT generate_schedule_draft($1,$2,$3::jsonb,$4::jsonb) r',[period,actor,snapshot===null?null:JSON.stringify(snapshot),result===null?null:JSON.stringify(result)])).rows[0].r;
  const input=(await call()).input;assert.equal(input.period.status,'CLOSED');assert.equal(input.registrations.length,1);
  await q("UPDATE registration_submissions SET status='DRAFT',submitted_at=NULL");
  assert.equal((await call()).input.registrations.length,0);
  await q("UPDATE registration_submissions SET status='VALID',submitted_at=now()");
  await q('UPDATE users SET must_change_password=true WHERE id=$1',[actor]);await assert.rejects(call(),e=>e.code==='42501');await q('UPDATE users SET must_change_password=false WHERE id=$1',[actor]);
  await q("UPDATE registration_periods SET close_at=now()+interval '1 hour'");await assert.rejects(call(),/PERIOD_NOT_CLOSED/);await q("UPDATE registration_periods SET close_at=now()-interval '1 day'");
  const {generateSchedule}=require('../dist/services/scheduling.engine.js');const result=generateSchedule(input);assert.equal(result.assignments.length,1);
  await assert.rejects(call({},result),e=>e.code==='40001');
  const invalid={...result,assignments:[result.assignments[0],result.assignments[0]]};
  for(const bad of [null,{}, {...result.assignments[0],employee_id:'not-a-uuid'}, {...result.assignments[0],work_date:'2026-99-99'}])
    await assert.rejects(call(input,{...result,assignments:[bad]}),e=>e.code==='22023');
  await assert.rejects(call(input,{...result,assignments:[{...result.assignments[0],work_date:'2000-01-01'}]}),e=>e.code==='22023');
  await assert.rejects(call(input,invalid),e=>e.code==='23505');
  assert.equal((await q('SELECT count(*)::int n FROM schedules')).rows[0].n,0);
  // Audit insertion failure must also roll back the previously inserted schedule/assignments.
  await h.sql.exec("CREATE FUNCTION fixture_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$; CREATE TRIGGER fixture_reject_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fixture_reject_audit();");
  await assert.rejects(call(input,result));assert.equal((await q('SELECT count(*)::int n FROM schedules')).rows[0].n,0);
  await h.sql.exec('DROP TRIGGER fixture_reject_audit ON audit_logs;');
  const saved=await call(input,{...result,assigned_count:999,required_count:999,coverage:[],shortages:[],employee_statistics:[],schedule:{id:'forged'}});assert.equal(saved.reused,false);assert.equal(saved.result.schedule.version,1);assert.equal(saved.result.schedule.branch_id,h.id(1));
  assert.equal(saved.result.assigned_count,1);assert.equal(saved.result.required_count,1);assert.equal(saved.result.coverage[0].assigned_count,1);
  assert.equal((await q('SELECT count(*)::int n FROM shift_assignments')).rows[0].n,1);
  assert.equal((await q("SELECT count(*)::int n FROM audit_logs WHERE action='AUTO_GENERATE'")).rows[0].n,1);
  const replay=await call();assert.equal(replay.reused,true);assert.deepEqual(replay.result,saved.result);
  process.env.SCHEDULING_DATA_SOURCE='supabase';
  const {readDraft}=require('../dist/services/scheduling.service.js');
  const read=await readDraft(saved.result.schedule.id,h.id(1));
  assert.equal(read.schedule.id,saved.result.schedule.id);assert.equal(read.assignments.length,1);assert.equal(read.generation_snapshot.assigned_count,1);
  await assert.rejects(readDraft(saved.result.schedule.id,h.id(99)),e=>e.status===404);
  await q("UPDATE shift_assignments SET status='REPLACED'");await assert.rejects(call(),/SCHEDULE_EXISTS/);await q("UPDATE shift_assignments SET status='DRAFT'");
  await assert.rejects(q('SELECT generate_schedule_draft($1,$2)',[period,h.id(3)]),e=>e.code==='42501');
  await q("UPDATE users SET branch_id=NULL WHERE id=$1",[actor]);await assert.rejects(call(),e=>e.code==='42501');await q('UPDATE users SET branch_id=$1 WHERE id=$2',[h.id(1),actor]);
  await q("UPDATE schedules SET status='PENDING_APPROVAL'");await assert.rejects(call(),/SCHEDULE_EXISTS/);
  for(const role of ['anon','authenticated'])assert.equal((await q("SELECT has_function_privilege($1,'public.generate_schedule_draft(uuid,uuid,jsonb,jsonb)','EXECUTE') v",[role])).rows[0].v,false);
  assert.equal((await q("SELECT has_function_privilege('service_role','public.generate_schedule_draft(uuid,uuid,jsonb,jsonb)','EXECUTE') v")).rows[0].v,true);
  for(const role of ['anon','authenticated','service_role'])assert.equal((await q("SELECT has_function_privilege($1,'public.tv3_scheduling_input(uuid)','EXECUTE') v",[role])).rows[0].v,false);
  await h.sql.exec('SET ROLE authenticated;');
  await assert.rejects(call(),e=>e.code==='42501');await h.sql.exec('RESET ROLE;');
 }finally{await h.close();}
});

test('SQL enforces overnight overlap and clips weekly hours only in touched weeks', {skip:!process.env.REGISTRATION_PGLITE_PATH},async()=>{
 const h=await require('./helpers/registration-harness.cjs').createHarness();
 try{
  await h.sql.exec(fs.readFileSync(path.join(__dirname,'../migrations/20261031_tv3_schedule_draft.sql'),'utf8'));
  const q=(s,p=[])=>h.sql.query(s,p),actor=h.id(90),employee=h.id(4),period=h.id(8),sid=h.id(5);
  await q('INSERT INTO auth.users VALUES($1)',[actor]);await q("INSERT INTO users(id,username,role,branch_id) VALUES($1,'manager','QL',$2)",[actor,h.id(1)]);
  await q("UPDATE registration_periods SET open_at=now()-interval '3 days',close_at=now()-interval '1 day'");
  const monday=(await q('SELECT work_start_date::text d FROM registration_periods')).rows[0].d;
  const day=n=>{const d=new Date(monday+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
  await q("INSERT INTO registration_submissions(period_id,employee_id,status,submitted_at) VALUES($1,$2,'VALID',now())",[period,employee]);
  await h.sql.exec('BEGIN;');
  for(const scenario of ['adjacent','overlap_previous_night','spill_limit','next_week_unrelated']){
   await h.sql.exec('SAVEPOINT scenario;');
   const sunday=scenario==='spill_limit',work=day(sunday?6:0);
   await q('UPDATE employees SET max_weekly_hours=$1',[sunday?4:8]);
   if(sunday)await q("UPDATE shifts SET start_time='22:00',end_time='02:00' WHERE id=$1",[sid]);
   if(scenario==='zero_duration')await q("UPDATE shifts SET end_time=start_time WHERE id=$1",[sid]);
   await q("INSERT INTO shift_registrations(period_id,employee_id,work_date,shift_id,status,submitted_at) VALUES($1,$2,$3,$4,'VALID',now())",[period,employee,work,sid]);
   await q('INSERT INTO staffing_requirements(branch_id,department_id,shift_id,work_date,required_count,created_by) VALUES($1,$2,$3,$4,1,$5)',[h.id(1),h.id(2),sid,work,actor]);
   if(scenario!=='zero_duration'){
    const shift=h.id(70),otherPeriod=h.id(71);
    const [when,start,end]=scenario==='overlap_previous_night'?[day(-1),'22:00','09:00']:scenario==='spill_limit'?[day(7),'02:00','05:00']:scenario==='next_week_unrelated'?[day(7),'08:00','20:00']:[day(0),'12:00','16:00'];
    await q('INSERT INTO shifts(id,name,start_time,end_time,branch_id) VALUES($1,$2,$3,$4,$5)',[shift,'Existing fixture',start,end,h.id(1)]);
    await q('INSERT INTO registration_periods(id,branch_id,work_start_date,work_end_date,open_at,close_at) VALUES($1,$2,$3::date,$3::date+6,now()-interval \'3 days\',now()-interval \'1 day\')',[otherPeriod,h.id(1),day(sunday||scenario==='next_week_unrelated'?7:-7)]);
    const schedule=(await q("INSERT INTO schedules(branch_id,period_id,version,created_by) VALUES($1,$2,1,$3) RETURNING id",[h.id(1),otherPeriod,actor])).rows[0].id;
    await q("INSERT INTO shift_assignments(schedule_id,employee_id,work_date,shift_id,department_id,actual_branch_id) VALUES($1,$2,$3,$4,$5,$6)",[schedule,employee,when,shift,h.id(2),h.id(1)]);
   }
   const input=(await q('SELECT generate_schedule_draft($1,$2) r',[period,actor])).rows[0].r.input;
   const payload={assignments:[{employee_id:employee,work_date:work,shift_id:sid,department_id:h.id(2)}]};
   // Savepoint around each intentionally rejected call allows the outer fixture transaction to continue.
   await h.sql.exec('SAVEPOINT attempt;');
   let error;try{await q('SELECT generate_schedule_draft($1,$2,$3::jsonb,$4::jsonb)',[period,actor,JSON.stringify(input),JSON.stringify(payload)]);}catch(e){error=e;await h.sql.exec('ROLLBACK TO SAVEPOINT attempt;');}
   if(['adjacent','next_week_unrelated'].includes(scenario))assert.equal(error,undefined,scenario);
   else {assert.equal(error?.code,'22023',scenario);assert.match(error.message,scenario==='spill_limit'?/WEEKLY_LIMIT/:scenario==='zero_duration'?/INVALID_ASSIGNMENT/:/SHIFT_OVERLAP/);}
   await h.sql.exec('ROLLBACK TO SAVEPOINT scenario;');
  }
  await h.sql.exec('ROLLBACK;');
 }finally{await h.close();}
});
test('reviewed disposable SQL scenario remains compatible with TV2 effective submissions', {skip:!process.env.REGISTRATION_PGLITE_PATH},async()=>{
 const h=await require('./helpers/registration-harness.cjs').createHarness();
 try {
  await h.sql.exec(fs.readFileSync(path.join(__dirname,'../migrations/20261031_tv3_schedule_draft.sql'),'utf8'));
  await h.sql.exec(fs.readFileSync(path.join(__dirname,'scheduling.database.sql'),'utf8'));
 }finally{await h.close();}
});
