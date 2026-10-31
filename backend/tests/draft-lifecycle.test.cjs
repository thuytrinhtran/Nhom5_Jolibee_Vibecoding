const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('preview review save reread edit versions and rollback on isolated PostgreSQL',{skip:!process.env.REGISTRATION_PGLITE_PATH},async()=>{
 const h=await require('./helpers/registration-harness.cjs').createHarness();const old=process.env.TV3_DRAFT_PERSISTENCE_ENABLED;let server;
 try{
  await h.sql.exec(fs.readFileSync(path.join(__dirname,'../migrations/20261031_tv3_schedule_draft.sql'),'utf8'));
  const q=(s,p=[])=>h.sql.query(s,p),actor=h.id(90),period=h.id(8),branch=h.id(1),employee=h.id(4),shift=h.id(5),department=h.id(2);
  await q('INSERT INTO auth.users VALUES($1)',[actor]);await q("INSERT INTO users(id,username,role,branch_id) VALUES($1,'manager','QL',$2)",[actor,branch]);
  await q("UPDATE registration_periods SET open_at=now()-interval '3 days',close_at=now()-interval '1 day'");
  const day=(await q('SELECT work_start_date::text d FROM registration_periods')).rows[0].d;
  await q("INSERT INTO registration_submissions(period_id,employee_id,status,submitted_at) VALUES($1,$2,'VALID',now())",[period,employee]);
  await q("INSERT INTO shift_registrations(period_id,employee_id,work_date,shift_id,status,submitted_at) VALUES($1,$2,$3,$4,'VALID',now())",[period,employee,day,shift]);
  await q('INSERT INTO staffing_requirements(branch_id,department_id,shift_id,work_date,required_count,created_by) VALUES($1,$2,$3,$4,1,$5)',[branch,department,shift,day,actor]);
  await h.sql.exec(`CREATE TEMP TABLE draft_lock_probe(relation_name text,mode text);
    CREATE FUNCTION draft_lock_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      INSERT INTO pg_temp.draft_lock_probe SELECT c.relname,l.mode FROM pg_locks l JOIN pg_class c ON c.oid=l.relation
      WHERE l.pid=pg_backend_pid() AND l.granted AND c.relnamespace='public'::regnamespace;
      RETURN NEW; END $$;
    CREATE TRIGGER draft_lock_probe BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION draft_lock_probe();`);
  // A second eligible employee lets us persist a manual choice different from
  // the deterministic engine choice, proving save does not regenerate the plan.
  const replacement=h.id(40),replacementUser=h.id(41);
  await q('INSERT INTO auth.users VALUES($1)',[replacementUser]);await q("INSERT INTO users(id,username,role,branch_id) VALUES($1,'replacement_nv','NV',$2)",[replacementUser,branch]);
  await q("INSERT INTO employees(id,user_id,full_name,branch_id,department_id,skill_level) VALUES($1,$2,'Replacement fixture',$3,$4,'REGULAR')",[replacement,replacementUser,branch,department]);
  await q("INSERT INTO registration_submissions(period_id,employee_id,status,submitted_at) VALUES($1,$2,'VALID',now())",[period,replacement]);
  await q("INSERT INTO shift_registrations(period_id,employee_id,work_date,shift_id,status,submitted_at) VALUES($1,$2,$3,$4,'VALID',now())",[period,replacement,day,shift]);
  const {previewSchedule}=require('../dist/services/schedule-preview.service.js'),{persistPreview}=require('../dist/services/draft-persistence.service.js'),{readDraft}=require('../dist/services/scheduling.service.js');
  process.env.SCHEDULING_DATA_SOURCE='supabase';process.env.TV3_DRAFT_PERSISTENCE_ENABLED='true';
  let preview=await previewSchedule(period,branch,{});const plain=({employee_id,work_date,shift_id,department_id})=>({employee_id,work_date,shift_id,department_id});
  assert.equal(preview.result.assignments[0].employee_id,employee);
  preview=await previewSchedule(period,branch,{input_revision:preview.input_revision,assignments:[{...plain(preview.result.assignments[0]),employee_id:replacement}]});
  const body={period_id:period,input_revision:preview.input_revision,assignments:preview.result.assignments.map(plain),request_id:h.id(101)};
  assert.equal(body.assignments.length,1);
  await assert.rejects(persistPreview(period,branch,h.id(3),body),e=>e.status===403);
  await assert.rejects(persistPreview(period,h.id(999),actor,body),e=>e.status===404);
  await q("UPDATE users SET role='GS' WHERE id=$1",[actor]);await assert.rejects(persistPreview(period,branch,actor,body),e=>e.status===403);await q("UPDATE users SET role='QL' WHERE id=$1",[actor]);
  const first=await persistPreview(period,branch,actor,body);assert.equal(first.result.schedule.version,1);
  const locks=(await q('SELECT * FROM pg_temp.draft_lock_probe')).rows;
  for(const table of ['branches','users','registration_periods']){assert.ok(locks.some(l=>l.relation_name===table&&l.mode==='RowShareLock'));assert.ok(!locks.some(l=>l.relation_name===table&&['ShareLock','ShareRowExclusiveLock'].includes(l.mode)));}
  for(const table of ['employees','employee_skills','shifts','registration_submissions','shift_registrations','staffing_requirements','warning_configs'])assert.ok(locks.some(l=>l.relation_name===table&&l.mode==='ShareLock'));
  for(const table of ['schedules','shift_assignments','audit_logs'])assert.ok(locks.some(l=>l.relation_name===table&&l.mode==='ShareRowExclusiveLock'));
  await h.sql.exec('DROP TRIGGER draft_lock_probe ON audit_logs;');
  const {supabaseAdmin:db}=require('../dist/config/supabase.js');db.auth.getUser=async token=>({data:{user:{id:token==='manager'?actor:h.id(3)}}});
  server=h.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const url=`http://127.0.0.1:${server.address().port}/api/schedules`;
  const http=(route,method,payload,token='manager')=>fetch(url+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(payload)});
  assert.equal((await http('/drafts','POST',body,null)).status,401);assert.equal((await http('/drafts','POST',body,'employee')).status,403);
  const httpRetry=await http('/drafts','POST',body);assert.equal(httpRetry.status,200);assert.equal((await httpRetry.json()).result.schedule.id,first.result.schedule.id);
  const retry=await persistPreview(period,branch,actor,body);assert.equal(retry.reused,true);assert.equal(retry.result.schedule.id,first.result.schedule.id);
  await assert.rejects(persistPreview(period,branch,actor,{...body,assignments:[]}),e=>e.code==='REQUEST_CONFLICT');
  const saved=await readDraft(first.result.schedule.id,branch);assert.equal(saved.assignments.length,1);assert.equal(saved.assignments[0].employee_id,replacement);assert.equal(saved.generation_snapshot.assigned_count,1);
  const target={schedule_id:saved.schedule.id,expected_version:1};preview=await previewSchedule(period,branch,{...target,use_saved_assignments:true});assert.equal(preview.result.assignments.length,1);
  const edited={period_id:period,input_revision:preview.input_revision,assignments:[],expected_version:1,request_id:h.id(102)};
  const sqlSnapshot=(await q('SELECT persist_schedule_draft($1,$2,NULL,NULL,$3,1) r',[period,actor,saved.schedule.id])).rows[0].r.input;
  await q('UPDATE staffing_requirements SET required_count=2');
  await assert.rejects(q('SELECT persist_schedule_draft($1,$2,$3::jsonb,$4::jsonb,$5,1,$6,$7)',[period,actor,JSON.stringify(sqlSnapshot),JSON.stringify({assignments:[]}),saved.schedule.id,h.id(110),'a'.repeat(64)]),e=>e.code==='40001');
  assert.equal((await readDraft(saved.schedule.id,branch)).assignments[0].status,'DRAFT');
  await q('UPDATE staffing_requirements SET required_count=1');
  // A failed audit rolls back replacement of old assignments AND the new version.
  await h.sql.exec("CREATE FUNCTION reject_draft_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated-audit-failure'; END $$; CREATE TRIGGER reject_draft_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_draft_audit();");
  await assert.rejects(persistPreview(period,branch,actor,edited,saved.schedule.id));
  assert.equal((await q('SELECT count(*)::int n FROM schedules')).rows[0].n,1);assert.equal((await readDraft(saved.schedule.id,branch)).assignments[0].status,'DRAFT');
  await h.sql.exec('DROP TRIGGER reject_draft_audit ON audit_logs;');
  // Budget expiration after an audit trigger must roll back the entire edit too.
  await h.sql.exec("CREATE FUNCTION slow_draft_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(3.05); RETURN NEW; END $$; CREATE TRIGGER slow_draft_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION slow_draft_audit();");
  await assert.rejects(persistPreview(period,branch,actor,edited,saved.schedule.id),e=>e.status===503&&e.code==='SCHEDULING_BUSY');
  assert.equal((await q('SELECT count(*)::int n FROM schedules')).rows[0].n,1);assert.equal((await readDraft(saved.schedule.id,branch)).assignments[0].status,'DRAFT');
  await h.sql.exec('DROP TRIGGER slow_draft_audit ON audit_logs;');
  const second=await persistPreview(period,branch,actor,edited,saved.schedule.id);assert.equal(second.result.schedule.version,2);assert.equal(second.result.schedule.schedule_group_id,saved.schedule.schedule_group_id);assert.notEqual(second.result.schedule.id,saved.schedule.id);
  const httpEditRetry=await http(`/${saved.schedule.id}/draft-assignments`,'PATCH',edited);assert.equal(httpEditRetry.status,200);assert.equal((await httpEditRetry.json()).result.schedule.id,second.result.schedule.id);
  const replay=await persistPreview(period,branch,actor,edited,saved.schedule.id);assert.equal(replay.result.schedule.id,second.result.schedule.id);
  assert.equal((await readDraft(second.result.schedule.id,branch)).assignments.length,0);assert.equal((await readDraft(saved.schedule.id,branch)).assignments[0].status,'REPLACED');
  assert.equal((await q("SELECT count(*)::int n FROM audit_logs WHERE entity_type='schedules'")).rows[0].n,2);
  const audit=(await q("SELECT new_data FROM audit_logs WHERE new_data->>'request_id'=$1",[edited.request_id])).rows[0].new_data;assert.equal(audit.previous_state.id,saved.schedule.id);
  await assert.rejects(persistPreview(period,branch,actor,{...edited,request_id:h.id(103)},saved.schedule.id),e=>e.status===409);
  let latest=second.result.schedule;preview=await previewSchedule(period,branch,{schedule_id:latest.id,expected_version:2,use_saved_assignments:true});
  const concurrent={period_id:period,input_revision:preview.input_revision,assignments:[],expected_version:2};
  const competing=await Promise.allSettled([persistPreview(period,branch,actor,{...concurrent,request_id:h.id(106)},latest.id),persistPreview(period,branch,actor,{...concurrent,request_id:h.id(107)},latest.id)]);
  assert.equal(competing.filter(r=>r.status==='fulfilled').length,1);assert.equal(competing.find(r=>r.status==='rejected').reason.status,409);
  latest=competing.find(r=>r.status==='fulfilled').value.result.schedule;assert.equal(latest.version,3);
  preview=await previewSchedule(period,branch,{schedule_id:latest.id,expected_version:3,use_saved_assignments:true});
  await q('UPDATE staffing_requirements SET required_count=2');
  await assert.rejects(persistPreview(period,branch,actor,{...edited,input_revision:preview.input_revision,expected_version:3,request_id:h.id(104)},latest.id),e=>e.code==='PREVIEW_STALE');
  await q("UPDATE schedules SET status='PENDING_APPROVAL' WHERE id=$1",[latest.id]);
  await assert.rejects(previewSchedule(period,branch,{schedule_id:latest.id,expected_version:3,use_saved_assignments:true}),e=>e.code==='DRAFT_LOCKED');
  await assert.rejects(q('SELECT persist_schedule_draft($1,$2,NULL,NULL,$3,3)',[period,actor,latest.id]),/DRAFT_LOCKED/);
  assert.equal((await http(`/${latest.id}/draft-assignments`,'PATCH',{...edited,expected_version:3,request_id:h.id(112)})).status,409);
  await assert.rejects(readDraft(latest.id,h.id(999)),e=>e.status===404);
  for(const role of ['anon','authenticated'])assert.equal((await q("SELECT has_function_privilege($1,'public.persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text)','EXECUTE') v",[role])).rows[0].v,false);
 }finally{if(server)await new Promise(r=>server.close(r));if(old===undefined)delete process.env.TV3_DRAFT_PERSISTENCE_ENABLED;else process.env.TV3_DRAFT_PERSISTENCE_ENABLED=old;await h.close();}
});
