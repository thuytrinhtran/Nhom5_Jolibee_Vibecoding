const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');

test('disposable PostgreSQL: staffing warning migration preserves CAS, snapshots, hard checks, ACL and submit/approve/publish RPC', {skip:!process.env.REGISTRATION_PGLITE_PATH,timeout:60000},async()=>{
 // This harness always constructs a fresh in-memory DB; it never uses a Supabase URL.
 const h=await require('./helpers/registration-harness.cjs').createHarness();
 const q=(sql,args=[])=>h.sql.query(sql,args),id=h.id;
 try{
  for(const file of ['20261029_tv4_schedule_workflow.sql','20261031_tv3_schedule_draft.sql','20261101_tv3_rule_contract_v2.sql','20261102_tv4_workflow_v2.sql','20261107_tv3_tv4_staffing_warnings.sql'])await h.sql.exec(fs.readFileSync(path.join(__dirname,'../migrations',file),'utf8'));
  const branch=id(1),period=id(8),department=id(2),shift=id(5),manager=id(90),supervisor=id(91);
  await q('INSERT INTO auth.users VALUES($1),($2)',[manager,supervisor]);
  await q("INSERT INTO users(id,username,role,branch_id) VALUES($1,'staffing_manager','QL',$3),($2,'staffing_supervisor','GS',NULL)",[manager,supervisor,branch]);
  await q('UPDATE branches SET supervisor_id=$1 WHERE id=$2',[supervisor,branch]);
  await q("UPDATE registration_periods SET status='CLOSED',open_at=now()-interval '3 days',close_at=now()-interval '1 day'");
  const day=(await q('SELECT work_start_date::text d FROM registration_periods')).rows[0].d;
  for(const n of [1,2]){
   const user=id(100+n),employee=id(200+n);await q('INSERT INTO auth.users VALUES($1)',[user]);
   await q("INSERT INTO users(id,username,role,branch_id) VALUES($1,$2,'NV',$3)",[user,'staffing_nv_'+n,branch]);
   await q("INSERT INTO employees(id,user_id,full_name,branch_id,department_id,skill_level,max_weekly_hours) VALUES($1,$2,$3,$4,$5,'NEW',40)",[employee,user,'Synthetic staff '+n,branch,department]);
  }
  await q("UPDATE employees SET skill_level='NEW',max_weekly_hours=40");
  const people=(await q('SELECT id FROM employees ORDER BY id')).rows.map(e=>e.id);
  for(const employee of people){
   await q("INSERT INTO registration_submissions(period_id,employee_id,status,submitted_at) VALUES($1,$2,'VALID',now())",[period,employee]);
   await q("INSERT INTO shift_registrations(period_id,employee_id,work_date,shift_id,status,submitted_at) VALUES($1,$2,$3,$4,'VALID',now())",[period,employee,day,shift]);
  }
  await q('INSERT INTO staffing_requirements(branch_id,department_id,shift_id,work_date,required_count,created_by) VALUES($1,$2,$3,$4,1,$5)',[branch,department,shift,day,manager]);
  const {reviewAssignments}=require('../dist/services/scheduling.engine.js');let sequence=400;
  const persist=async(input,result)=>{const r=await q('SELECT persist_schedule_draft($1,$2,$3::jsonb,$4::jsonb) result',[period,manager,input?JSON.stringify(input):null,result?JSON.stringify(result):null]);return r.rows[0].result;};
  const transition=async(schedule,actor,action,version,request=id(++sequence))=>(await q('SELECT tv4_transition_schedule_v2($1,$2,$3,$4,$5,NULL,now()+interval \'1 day\') result',[schedule,actor,version,action,request])).rows[0].result;
  for(const [required,assigned] of [[3,1],[2,2],[1,3]]){
   await q('BEGIN');
   try{
    await q('UPDATE staffing_requirements SET required_count=$1',[required]);
    const input=(await persist()).input;
    const assignments=people.slice(0,assigned).map(employee_id=>({employee_id,work_date:day,shift_id:shift,department_id:department}));
    const result=reviewAssignments(input,assignments);
    const stale=structuredClone(input);stale.requirements[0].required_count=99;
    // A rejected transaction must roll back to a savepoint before continuing.
    await q('SAVEPOINT bad_snapshot');await assert.rejects(persist(stale,result),/INPUT_CHANGED/);await q('ROLLBACK TO bad_snapshot');
    await q('SAVEPOINT duplicate');await assert.rejects(persist(input,{...result,assignments:[result.assignments[0],result.assignments[0]]}),/DUPLICATE_ASSIGNMENT/);await q('ROLLBACK TO duplicate');
    await q('SAVEPOINT wrong_department');await assert.rejects(persist(input,{...result,assignments:[{...result.assignments[0],department_id:id(999)}]}),/INVALID_ASSIGNMENT/);await q('ROLLBACK TO wrong_department');
    const saved=await persist(input,result),schedule=saved.result.schedule;
    assert.equal(saved.result.coverage[0].assigned_count,assigned);assert.equal(saved.result.coverage[0].missing_count,Math.max(0,required-assigned));assert.equal(saved.result.coverage[0].excess_count,Math.max(0,assigned-required));assert.ok(saved.result.coverage[0].warnings.includes('EXPERIENCE_SHORTAGE'));if(assigned>required)assert.ok(saved.result.coverage[0].warnings.includes('STAFFING_EXCESS'));
    await q('SAVEPOINT bad_version');await assert.rejects(transition(schedule.id,manager,'SUBMIT',99),/STALE_SCHEDULE_VERSION/);await q('ROLLBACK TO bad_version');
    await q('SAVEPOINT bad_role');await assert.rejects(transition(schedule.id,supervisor,'SUBMIT',schedule.version),/FORBIDDEN/);await q('ROLLBACK TO bad_role');
    await q('SAVEPOINT invalid_registration');await q('DELETE FROM shift_registrations WHERE employee_id=$1',[people[0]]);await assert.rejects(transition(schedule.id,manager,'SUBMIT',schedule.version),/HARD_CONSTRAINT_FAILED/);await q('ROLLBACK TO invalid_registration');
    const request=id(++sequence);assert.equal((await transition(schedule.id,manager,'SUBMIT',schedule.version,request)).schedule.status,'PENDING_APPROVAL');
    assert.equal((await transition(schedule.id,manager,'SUBMIT',schedule.version,request)).reused,true);
    const snapshot=(await q("SELECT new_data FROM audit_logs WHERE entity_id=$1 AND action='AUTO_GENERATE'",[schedule.id])).rows[0].new_data;
    assert.equal(snapshot.coverage[0].assigned_count,assigned);
    assert.equal((await transition(schedule.id,supervisor,'APPROVED',schedule.version)).schedule.status,'APPROVED');
    assert.equal((await transition(schedule.id,manager,'PUBLISH',schedule.version)).schedule.status,'PUBLISHED');
    assert.deepEqual((await q("SELECT new_data FROM audit_logs WHERE entity_id=$1 AND action='AUTO_GENERATE'",[schedule.id])).rows[0].new_data,snapshot,'workflow preserves the immutable generation snapshot');
    assert.equal(Number((await q("SELECT count(*) n FROM shift_assignments WHERE schedule_id=$1 AND status='ACTIVE'",[schedule.id])).rows[0].n),assigned);
   }finally{await q('ROLLBACK');}
  }
  // No new grant to clients, and no bypass around the private assertion helper.
  for(const role of ['anon','authenticated'])assert.equal((await q("SELECT has_function_privilege($1,'public.tv4_transition_schedule_v2(uuid,uuid,int,text,uuid,text,timestamptz)','EXECUTE') allowed",[role])).rows[0].allowed,false);
  assert.equal((await q("SELECT has_function_privilege('service_role','public.tv4_assert_schedule_v2(uuid)','EXECUTE') allowed")).rows[0].allowed,false);
  assert.equal((await q('SELECT count(*)::int n FROM schedules')).rows[0].n,0);
 }finally{await h.close();}
});
