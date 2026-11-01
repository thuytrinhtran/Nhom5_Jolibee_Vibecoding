const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
process.env.NODE_ENV='test';
test('dev import is fail-closed by environment/project/batch, ordinary availability ignores marked samples',()=>{
 const policy=require('../dist/registrations/dev-import-policy.js'),{tv2Availability}=require('../dist/registrations/tv3-source.js');
 const env={NODE_ENV:'development',DEV_IMPORT_ENABLED:'true',DEV_IMPORT_PROJECT_REF:policy.DEV_IMPORT_PROJECT,DEV_IMPORT_BATCH_ID:policy.DEV_IMPORT_BATCH,SUPABASE_URL:`https://${policy.DEV_IMPORT_PROJECT}.supabase.co`};
 assert.ok(policy.devImportContext(env));for(const bad of [{NODE_ENV:'production'},{DEV_IMPORT_BATCH_ID:'wrong'},{SUPABASE_URL:'https://wrong.supabase.co'},{DEV_IMPORT_PROJECT_REF:'wrong'}])assert.throws(()=>policy.devImportContext({...env,...bad}));assert.deepEqual(policy.devImportHeaders({}),{});
 const period={id:policy.DEV_IMPORT_PERIOD,branch_id:policy.DEV_IMPORT_BRANCH,work_start_date:'2026-11-02',work_end_date:'2026-11-08'},employee={id:'e',branch_id:period.branch_id,status:'ACTIVE',skill_level:'REGULAR',is_active:true,role:'NV'},header={employee_id:'e',status:'VALID',submitted_at:'2026-11-02T00:00:00Z',updated_at:'2026-11-02T00:00:00Z',sample_batch_id:policy.DEV_IMPORT_BATCH,dev_import_allowed:true},row={id:'r',employee_id:'e',period_id:period.id,work_date:'2026-11-02',shift_id:'s',status:'VALID',submitted_at:header.submitted_at,dev_import_allowed:true};
 const old={...process.env};try{
 delete process.env.DEV_IMPORT_ENABLED;assert.equal(tv2Availability({headers:[header],rows:[row]},period,[employee],[{id:'s',is_active:true}]).registrations.length,0);
 Object.assign(process.env,env);assert.equal(tv2Availability({headers:[header],rows:[row]},period,[employee],[{id:'s',is_active:true}]).registrations.length,1);assert.equal(tv2Availability({headers:[header],rows:[{...row,dev_import_allowed:false}]},period,[employee],[{id:'s',is_active:true}]).registrations.length,0);
 }finally{for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old);}
});

test('tagged 308 import: source parity, idempotency, rollback ownership and TV4 persistence',{skip:process.env.REGISTRATION_USE_NATIVE!=='true'?'Requires disposable PostgreSQL only':false},async()=>{
 const h=await require('./helpers/native-tv3-harness.cjs').nativeHarness(),q=(sql,p=[])=>h.admin.query(sql,p),root=path.resolve(__dirname,'../..'),exec=require('../scripts/dev-import-executor.cjs');
 const seed=JSON.parse(fs.readFileSync(path.join(root,'docs/ld-integration-prepared/1793514872833/seed-plan.json'),'utf8')),base=JSON.parse(fs.readFileSync(path.join(root,'docs/ld-integration-prepared/1793514872833/baseline.json'),'utf8'));
 const previous=process.env.DEV_IMPORT_LOCAL_REHEARSAL;process.env.DEV_IMPORT_LOCAL_REHEARSAL='true';
 try{
  for(const file of ['20261029_tv4_schedule_workflow.sql','20261101_tv3_rule_contract_v2.sql','20261102_tv4_workflow_v2.sql','20261103_employee_schedule_read.sql','20261104_tv5_shift_replacement.sql','20261105_scoped_dev_import.sql'])await q(fs.readFileSync(path.join(root,'backend/migrations',file),'utf8'));
  await q("INSERT INTO branches(id,name) VALUES($1,'Isolated LD')",[exec.SCOPE.branch_id]);
  for(const d of new Set(base.requirements.map(r=>r.department_id)))await q('INSERT INTO departments(id,name) VALUES($1,$2)',[d,'Local '+d]);
  for(const u of [...base.users,...seed.auth_profiles_to_provision]){await q('INSERT INTO auth.users(id) VALUES($1)',[u.id]);await q('INSERT INTO users(id,username,role,branch_id,is_active,must_change_password) VALUES($1,$2,$3,$4,$5,$6)',[u.id,u.username,u.role,u.branch_id,u.is_active,u.must_change_password]);}
  const supervisor=base.users.find(u=>u.role==='GS'),manager=base.users.find(u=>u.role==='QL');assert.ok(supervisor&&manager);await q('UPDATE branches SET supervisor_id=$1 WHERE id=$2',[supervisor.id,exec.SCOPE.branch_id]);
  for(const e of base.employees)await q('INSERT INTO employees(id,user_id,full_name,branch_id,department_id,skill_level,status,max_weekly_hours) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[e.id,e.user_id,'Synthetic existing',e.branch_id,e.department_id,e.skill_level,e.status,e.max_weekly_hours]);
  const shiftIds=['1392b8d7-91f9-46d6-9e2c-b4f2dedbb09a','36433672-1bd3-48d3-beed-70c858fc438c','94fbcbd3-e4f5-4dca-aba8-0400d8ccb8a7'];for(let i=0;i<3;i++)await q('INSERT INTO shifts(id,name,start_time,end_time,branch_id) VALUES($1,$2,$3,$4,$5)',[shiftIds[i],'Shift '+i,['08:00','12:00','17:00'][i],['12:00','17:00','22:00'][i],exec.SCOPE.branch_id]);
  const p=base.period;await q('INSERT INTO registration_periods(id,branch_id,work_start_date,work_end_date,open_at,close_at,status) VALUES($1,$2,$3,$4,$5,$6,$7)',[p.id,p.branch_id,p.work_start_date,p.work_end_date,p.open_at,p.close_at,p.stored_status]);
  for(const x of base.headers)await q('INSERT INTO registration_submissions(period_id,employee_id,status,errors,submitted_at,updated_at,sample_batch_id) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7)',[x.period_id,x.employee_id,x.status,JSON.stringify(x.errors),x.submitted_at,x.updated_at,x.sample_batch_id]);
  for(const x of base.registrations)await q('INSERT INTO shift_registrations(id,period_id,employee_id,work_date,shift_id,status,submitted_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[x.id,x.period_id,x.employee_id,x.work_date,x.shift_id,x.status,x.submitted_at,x.updated_at]);
  for(const r of base.requirements)await q('INSERT INTO staffing_requirements(id,branch_id,department_id,shift_id,work_date,required_count,required_skill_name,sales_forecast_ref,created_by,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[r.id,r.branch_id,r.department_id,r.shift_id,r.work_date,r.required_count,r.required_skill_name,r.sales_forecast_ref,r.created_by,r.updated_at]);
  const plan=await exec.prepare(h.admin,seed,'test');assert.equal(plan.missing_profiles.length,0);assert.equal(plan.validation.assigned,308);assert.ok(plan.validation.daily.every(d=>d.distinct_employees>=60&&d.distinct_employees<=70));
  await assert.rejects(exec.apply(h.admin,plan,'wrong'),/APPROVAL_DIGEST_REQUIRED/);
  await q('UPDATE staffing_requirements SET required_count=required_count+1 WHERE id=$1',[base.requirements[0].id]);await assert.rejects(exec.apply(h.admin,plan,plan.plan_sha256),/BASELINE_CHANGED/);await q('UPDATE staffing_requirements SET required_count=required_count-1 WHERE id=$1',[base.requirements[0].id]);
  await q("CREATE FUNCTION reject_import_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='DEV_IMPORT_RECEIPT' THEN RAISE EXCEPTION 'receipt failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_import_receipt BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_import_receipt();");
  await assert.rejects(exec.apply(h.admin,plan,plan.plan_sha256),/receipt failure/);assert.equal((await q('SELECT count(*)::int n FROM shift_registrations WHERE period_id=$1',[p.id])).rows[0].n,16);assert.equal((await q('SELECT count(*)::int n FROM dev_import_batches')).rows[0].n,0);await q('DROP TRIGGER reject_import_receipt ON audit_logs');
  const applied=await exec.apply(h.admin,plan,plan.plan_sha256);assert.equal(applied.reused,false);assert.equal((await exec.apply(h.admin,plan,plan.plan_sha256)).reused,true);
  const input=async()=>(await q('SELECT tv3_scheduling_input($1) v',[p.id])).rows[0].v;
  assert.equal((await input()).registrations.length,16,'ordinary SQL context excludes tagged import');
  const context=JSON.stringify({'x-jollishift-dev-import':`test/${exec.SCOPE.project_ref}/${exec.SCOPE.batch_id}`});await q("SELECT set_config('request.headers',$1,false)",[context]);
  let source=await input();assert.equal(source.registrations.length,607);assert.ok(source.registration_provenance.some(r=>r.batch_id===exec.SCOPE.batch_id));
  const {generateSchedule}=require('../dist/services/scheduling.engine.js');const result=generateSchedule(source);assert.equal(result.assigned_count,308);
  const mode={NODE_ENV:'test',DEV_IMPORT_ENABLED:'true',DEV_IMPORT_PROJECT_REF:exec.SCOPE.project_ref,DEV_IMPORT_BATCH_ID:exec.SCOPE.batch_id,SUPABASE_URL:`https://${exec.SCOPE.project_ref}.supabase.co`},savedEnv=Object.fromEntries(Object.keys(mode).map(k=>[k,process.env[k]]));
  try{Object.assign(process.env,mode);const headers=(await q('SELECT * FROM registration_submissions_sourced WHERE period_id=$1',[p.id])).rows,rows=(await q('SELECT * FROM shift_registrations_sourced WHERE period_id=$1',[p.id])).rows;
   const accepted=require('../dist/registrations/tv3-source.js').tv2Availability({headers,rows},source.period,source.employees.map(e=>({...e,branch_id:exec.SCOPE.branch_id})),source.shifts);assert.equal(accepted.registrations.length,607);
  }finally{for(const [k,v] of Object.entries(savedEnv)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
  await q("UPDATE dev_import_batches SET manifest=manifest||'{\"plan_sha256\":\"tampered\"}'::jsonb");assert.equal((await input()).registrations.length,16,'registry changes without immutable receipt are rejected');await q('UPDATE dev_import_batches SET manifest=$1::jsonb',[JSON.stringify(applied.manifest)]);
  // Exercise real SQL persistence/workflow with tagged registrations, then
  // rollback this test-only lifecycle transaction so seed rollback can be tested.
  await q('BEGIN');const persisted=(await q('SELECT persist_schedule_draft($1,$2,$3::jsonb,$4::jsonb,NULL,NULL,$5,$6) r',[p.id,manager.id,JSON.stringify(source),JSON.stringify(result),h.id(9100),'a'.repeat(64)])).rows[0].r.result;
  for(const [i,action,actor] of [[1,'SUBMIT',manager.id],[2,'APPROVED',supervisor.id],[3,'PUBLISH',manager.id]])await q('SELECT tv4_transition_schedule_v2($1,$2,1,$3,$4,NULL,$5)',[persisted.schedule.id,actor,action,h.id(9100+i),action==='PUBLISH'?new Date(Date.now()+1800000).toISOString():null]);
  const viewer=(await q("SELECT e.user_id FROM employees e JOIN users u ON u.id=e.user_id JOIN shift_assignments a ON a.employee_id=e.id WHERE a.schedule_id=$1 AND NOT u.must_change_password LIMIT 1",[persisted.schedule.id])).rows[0].user_id;
  assert.ok((await q('SELECT employee_schedule_week($1,$2) r',[viewer,'2026-11-02'])).rows[0].r.assignments.length);
  let change;for(const a of (await q("SELECT a.id,e.user_id FROM shift_assignments a JOIN employees e ON e.id=a.employee_id JOIN users u ON u.id=e.user_id WHERE a.schedule_id=$1 AND NOT u.must_change_password ORDER BY a.id LIMIT 40",[persisted.schedule.id])).rows){
   const people=(await q('SELECT tv5_candidates_for_actor($1,$2) r',[manager.id,a.id])).rows[0].r;
   for(const candidate of people){const person=(await q('SELECT e.user_id,u.must_change_password FROM employees e JOIN users u ON u.id=e.user_id WHERE e.id=$1',[candidate.id])).rows[0];if(!person.must_change_password){change={a,candidate,person};break;}}
   if(change)break;
  }assert.ok(change,'need an eligible consenting employee for the integrated scenario');
  const act=async(actor,action,data,n)=>(await q('SELECT tv5_mutate($1,$2,$3,$4::jsonb) r',[actor,action,h.id(n),JSON.stringify(data)])).rows[0].r;
  const request=await act(change.a.user_id,'CREATE_REQUEST',{assignment_id:change.a.id,reason:'Local integrated acceptance test'},9300),reference={kind:'REQUEST',source_id:request.id};
  const invite=await act(manager.id,'INVITE',{...reference,target_employee_id:change.candidate.id,expires_at:new Date(Date.now()+1800000).toISOString()},9301);
  await act(change.person.user_id,'ACCEPT',{invitation_id:invite.id},9302);assert.equal((await act(manager.id,'APPROVE',{...reference,invitation_id:invite.id},9303)).status,'APPROVED');
  await q('ROLLBACK');
  const blocked=h.id(9200);await q("INSERT INTO schedules(id,branch_id,period_id,version,status,created_by) VALUES($1,$2,$3,1,'DRAFT',$4)",[blocked,exec.SCOPE.branch_id,p.id,manager.id]);await assert.rejects(exec.rollback(h.admin,plan,plan.plan_sha256),/DEPENDENT_SCHEDULE_EXISTS/);await q('DELETE FROM schedules WHERE id=$1',[blocked]);
  // After-image tampering immediately removes that row from both source contracts.
  const id=plan.payload.registrations[0].id;await q("UPDATE shift_registrations SET status='INVALID' WHERE id=$1",[id]);assert.equal((await input()).registrations.length,606);await assert.rejects(exec.rollback(h.admin,plan,plan.plan_sha256),/AFTER_IMAGE_CHANGED/);await q("UPDATE shift_registrations SET status='VALID' WHERE id=$1",[id]);
  // Any dependent team data must prevent rollback. No cascade/delete of that row.
  const employee=plan.payload.employees[0].id;await q("INSERT INTO employee_skills(employee_id,skill_name,proficiency_level) VALUES($1,'team-added','CONFIRMED')",[employee]);await assert.rejects(exec.rollback(h.admin,plan,plan.plan_sha256),/DEPENDENT_DATA_EXISTS/);await q('DELETE FROM employee_skills WHERE employee_id=$1',[employee]);
  await exec.rollback(h.admin,plan,plan.plan_sha256);assert.equal((await input()).registrations.length,16);assert.equal((await exec.rollback(h.admin,plan,plan.plan_sha256)).reused,true);assert.equal((await q('SELECT count(*)::int n FROM shift_registrations WHERE period_id=$1',[p.id])).rows[0].n,16);
  fs.mkdirSync(path.join(root,'docs/deployment-6.2'),{recursive:true});fs.writeFileSync(path.join(root,'docs/deployment-6.2/local-rehearsal.json'),JSON.stringify({scope:'ISOLATED_POSTGRESQL_ONLY',supabase_contacted:false,validation:plan.validation,owned_employees:plan.payload.employees.length,owned_headers:plan.payload.headers.length,owned_registrations:plan.payload.registrations.length,real_rows_preserved:16,idempotency:true,guarded_rollback:true,receipt_failure_rollback:true,workflow_and_shift_replacement:true,typescript_sql_parity:true},null,2));
  fs.writeFileSync(path.join(root,'docs/deployment-6.2/uuid-manifest.json'),JSON.stringify({scope:'REHEARSAL_IDENTIFIERS_NOT_SHARED_APPLY_AUTHORIZATION',...plan.uuid_manifest,synthetic_baseline_sha256:plan.baseline_sha256,synthetic_plan_sha256:plan.plan_sha256},null,2));
 }finally{if(previous===undefined)delete process.env.DEV_IMPORT_LOCAL_REHEARSAL;else process.env.DEV_IMPORT_LOCAL_REHEARSAL=previous;await h.close();}
});
