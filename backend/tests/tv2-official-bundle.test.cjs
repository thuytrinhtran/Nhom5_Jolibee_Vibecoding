const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {buildOfficialBundle,saveFunction}=require('../scripts/prepare-tv2-official.cjs');
const {officialEnvironment}=require('../scripts/tv2-official-server.cjs');
const root=path.resolve(__dirname,'../..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
test('official launcher validates shared project without editing credentials',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jollishift-official-env-')),file=path.join(dir,'config');
 try{const text='SUPABASE_URL=https://wlbpprpiieonjrqglicv.supabase.co/rest/v1/\nSUPABASE_SECRET_KEY=fake-unit-test-key';fs.writeFileSync(file,text);
  assert.equal(officialEnvironment(file).PORT,'5000');assert.equal(fs.readFileSync(file,'utf8'),text);
  fs.writeFileSync(file,text.replace('wlbpprpiieonjrqglicv','wimikwyuzhltpjciafod'));assert.throws(()=>officialEnvironment(file));
 }finally{fs.rmSync(file);fs.rmdirSync(dir);}
});
async function baseline(){
 const {PGlite}=require(process.env.REGISTRATION_PGLITE_PATH),db=new PGlite();
 await db.exec("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT 'service_role'::text$$;CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;");
 await db.exec(read('docs/Jollishift.sql').replace('CREATE INDEX idx_schedule_approvals_schedule ON','CREATE INDEX IF NOT EXISTS idx_schedule_approvals_schedule ON'));
 await db.exec(read('backend/migrations/20261029_require_password_change.sql'));
 // Arbitrary UUIDs and 14 users prove the migration does not depend on branch IDs/count 70.
 await db.exec(`INSERT INTO branches(id,name) SELECT md5('branch-'||i)::uuid,'Fixture branch '||i FROM generate_series(1,2) i;
 INSERT INTO departments(id,name) SELECT md5('department-'||i)::uuid,'Fixture department '||i FROM generate_series(1,3) i;
 INSERT INTO auth.users SELECT md5('user-'||i)::uuid FROM generate_series(1,14) i;
 INSERT INTO users(id,username,role,branch_id) SELECT md5('user-'||i)::uuid,'fixture_'||i,'NV',md5('branch-'||CASE WHEN i<=7 THEN 1 ELSE 2 END)::uuid FROM generate_series(1,14) i;
 INSERT INTO employees(id,user_id,full_name,branch_id,department_id,skill_level) SELECT md5('employee-'||i)::uuid,md5('user-'||i)::uuid,'Unit fixture',md5('branch-'||CASE WHEN i<=7 THEN 1 ELSE 2 END)::uuid,md5('department-'||(i%3+1))::uuid,'REGULAR' FROM generate_series(1,14) i;`);
 return db;
}
const unitOptions={skip:!process.env.REGISTRATION_PGLITE_PATH};
test('incremental official SQL upgrades existing M1/M2, preserves IDs, replays safely and refuses unknown RPC',unitOptions,async()=>{
 const db=await baseline(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'tv2-official-unit-'));
 try{
  const {sql,manifest}=buildOfficialBundle(dir);assert.equal(manifest.revision,'tv2-official-shared-compatible-v3');
  assert.ok(!/cron\.schedule|CREATE EXTENSION|11111111-1111/.test(sql));
  await db.exec(read('backend/migrations/20261029_employee_registration.sql'));await db.exec(read('backend/migrations/20261029_registration_off_schedule.sql'));
  await db.exec(`INSERT INTO shifts(name,start_time,end_time,branch_id) SELECT v.name,v.a,v.b,b.id FROM branches b CROSS JOIN (VALUES('Existing morning',time '08:00',time '12:00'),('Existing afternoon',time '12:00',time '17:00'),('Existing night',time '17:00',time '22:00')) v(name,a,b);
   INSERT INTO registration_periods(branch_id,work_start_date,work_end_date,open_at,close_at,status) SELECT b.id,m,m+6,((m-3)+time '15:00') AT TIME ZONE 'Asia/Ho_Chi_Minh',((m-1)+time '12:00') AT TIME ZONE 'Asia/Ho_Chi_Minh','PLANNED' FROM branches b CROSS JOIN (SELECT date_trunc('week',now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date+7 m) w;`);
  const profiles=(await db.query('SELECT to_jsonb(e) e FROM employees e ORDER BY id')).rows,shifts=(await db.query('SELECT to_jsonb(s) s FROM shifts s ORDER BY id')).rows,periodIds=(await db.query('SELECT id FROM registration_periods ORDER BY id')).rows;
  // Existing registrations must prevent silently moving a Friday deadline/window.
  await db.exec("INSERT INTO registration_submissions(period_id,employee_id,status) SELECT p.id,e.id,'DRAFT' FROM registration_periods p JOIN employees e ON e.branch_id=p.branch_id LIMIT 1");
  await assert.rejects(db.exec(sql),/contains registrations/);await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT open_iso_day FROM registration_schedule_config')).rows[0].open_iso_day,5);
  await db.exec('DELETE FROM registration_submissions'); // local unit-test sentinel only
  await db.exec(sql);await db.exec(sql);
  assert.deepEqual((await db.query('SELECT to_jsonb(e) e FROM employees e ORDER BY id')).rows,profiles);
  assert.deepEqual((await db.query('SELECT to_jsonb(s) s FROM shifts s ORDER BY id')).rows,shifts);
  assert.deepEqual((await db.query('SELECT id FROM registration_periods ORDER BY id')).rows,periodIds);
  assert.ok((await db.query("SELECT extract(isodow FROM open_at AT TIME ZONE 'Asia/Ho_Chi_Minh')=4 AS correct FROM registration_periods")).rows.every(r=>r.correct));
  assert.equal((await db.query('SELECT open_iso_day FROM registration_schedule_config')).rows[0].open_iso_day,4);
  assert.equal((await db.query('SELECT enabled FROM registration_automation_config')).rows[0].enabled,false);
  for(const role of ['anon','authenticated'])assert.equal((await db.query("SELECT has_function_privilege($1,'save_employee_registration(uuid,uuid,jsonb,boolean)','EXECUTE') allowed",[role])).rows[0].allowed,false);
  await db.exec(saveFunction().sql.replace('DECLARE e public.employees;','-- unknown group edit\nDECLARE e public.employees;'));
  await assert.rejects(db.exec(sql),/RPC body differs/);await db.exec('ROLLBACK');await db.exec(saveFunction().sql);
  await db.exec(read('docs/tv2-release/official/00_inspect_shared_schema.sql'));
  await db.exec(read('docs/tv2-release/official/02_verify.sql'));
 }finally{await db.close();for(const f of ['01_apply_tv2.sql','manifest.json'])fs.rmSync(path.join(dir,f),{force:true});fs.rmdirSync(dir);}
});
test('official SQL bootstraps only absent TV2 objects and rejects competing real shift hours',unitOptions,async()=>{
 const db=await baseline(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'tv2-official-fresh-'));
 try{const {sql}=buildOfficialBundle(dir);
  await db.exec("INSERT INTO shifts(name,start_time,end_time) VALUES('Existing other business shift','06:00','14:00')");
  await assert.rejects(db.exec(sql),/shift hours differ/);await db.exec('ROLLBACK');
  assert.equal((await db.query("SELECT to_regclass('registration_submissions') t")).rows[0].t,null);
  await db.exec('DELETE FROM shifts');await db.exec(sql);await db.exec(sql);
  assert.equal((await db.query('SELECT count(*)::int n FROM shifts')).rows[0].n,6);
  assert.equal((await db.query('SELECT count(*)::int n FROM registration_periods')).rows[0].n,2);
  assert.equal((await db.query("SELECT to_regclass('registration_automation_config') t")).rows[0].t,null);
  assert.equal((await db.query('SELECT count(*)::int n FROM employees')).rows[0].n,14);
 }finally{await db.close();for(const f of ['01_apply_tv2.sql','manifest.json'])fs.rmSync(path.join(dir,f),{force:true});fs.rmdirSync(dir);}
});
test('TV3 samples use actual IDs, remain distinct from genuine data, survive edits safely and clean up exactly',unitOptions,async()=>{
 const db=await baseline(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'tv2-official-seed-'));
 try{
  await db.exec(buildOfficialBundle(dir).sql);
  // Test-only open windows, independent of the wall clock. No live DB is connected.
  await db.exec("UPDATE registration_periods SET status='OPEN',open_at=now()-interval '1 hour',close_at=now()+interval '1 hour'");
  const protectedData=async()=>(await db.query("SELECT 'employee' kind,to_jsonb(e) value FROM employees e UNION ALL SELECT 'user',to_jsonb(u) FROM users u UNION ALL SELECT 'period',to_jsonb(p) FROM registration_periods p UNION ALL SELECT 'shift',to_jsonb(s) FROM shifts s ORDER BY kind,value")).rows;
  const before=await protectedData();
  await db.exec("INSERT INTO registration_submissions(period_id,employee_id,status,submitted_at) SELECT p.id,(SELECT e.id FROM employees e WHERE e.branch_id=p.branch_id ORDER BY e.id LIMIT 1),'VALID',now() FROM registration_periods p");
  const seed=read('docs/tv2-release/official/03_seed_registrations_for_tv3.sql'),cleanup=read('docs/tv2-release/official/04_cleanup_tv3_samples.sql');
  await db.exec(seed);assert.deepEqual(await protectedData(),before);
  assert.equal((await db.query('SELECT count(*)::int n FROM registration_submissions WHERE sample_batch_id IS NOT NULL')).rows[0].n,12);
  assert.equal((await db.query('SELECT count(*)::int n FROM shift_registrations')).rows[0].n,120);
  const sample=(await db.query('SELECT h.*,e.user_id FROM registration_submissions h JOIN employees e ON e.id=h.employee_id WHERE sample_batch_id IS NOT NULL ORDER BY h.employee_id LIMIT 1')).rows[0];
  await assert.rejects(db.exec(seed),/already has a sample batch/);await db.exec('ROLLBACK');
  await db.query("SELECT set_config('app.tv2_period_id',$1,false)",[sample.period_id]);
  await db.exec(read('backend/migrations/20261030_registration_effective_state.sql'));
  const contract=read('docs/tv2-release/tv3-contract.sql');
  let views=await db.exec(contract);assert.equal(views[2].rows.length,0);assert.equal(views[1].rows.find(r=>r.employee_id===sample.employee_id).declaration,'NOT_SUBMITTED');
  await db.exec("SET app.tv2_include_samples='true'");views=await db.exec(contract);assert.equal(views[2].rows.length,60);assert.ok(views[2].rows.every(r=>r.is_sample));
  assert.equal(views[1].rows.filter(r=>r.is_sample&&r.declaration==='OFF').length,6);
  const pref=(await db.query('SELECT work_date::text,shift_id FROM shift_registrations WHERE employee_id=$1 AND period_id=$2 LIMIT 1',[sample.employee_id,sample.period_id])).rows[0];
  await db.query('SELECT save_employee_registration($1,$2,$3::jsonb,true)',[sample.user_id,sample.period_id,JSON.stringify([pref])]);
  assert.equal((await db.query('SELECT sample_batch_id FROM registration_submissions WHERE employee_id=$1 AND period_id=$2',[sample.employee_id,sample.period_id])).rows[0].sample_batch_id,null);
  await db.query("SELECT set_config('app.tv3_sample_batch_id',$1,false)",[sample.sample_batch_id]);
  await db.exec("UPDATE registration_submissions SET errors='[\"changed\"]' WHERE sample_batch_id IS NOT NULL");
  await assert.rejects(db.exec(cleanup),/header has changed/);await db.exec('ROLLBACK');
  await db.exec("UPDATE registration_submissions SET errors='[]' WHERE sample_batch_id IS NOT NULL");
  await db.exec(cleanup);
  assert.equal((await db.query('SELECT count(*)::int n FROM registration_submissions WHERE sample_batch_id IS NOT NULL')).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int n FROM registration_submissions')).rows[0].n,3);
  assert.equal((await db.query('SELECT count(*)::int n FROM shift_registrations')).rows[0].n,1);
  assert.equal((await db.query("SELECT count(*)::int n FROM audit_logs WHERE action='TV3_SAMPLE_SEED' AND actor_id IS NULL AND change_source='SYSTEM'")).rows[0].n,1);
  assert.deepEqual(await protectedData(),before);
  await assert.rejects(db.exec(seed),/already has a sample batch/);await db.exec('ROLLBACK');
 }finally{await db.close();for(const f of ['01_apply_tv2.sql','manifest.json'])fs.rmSync(path.join(dir,f),{force:true});fs.rmdirSync(dir);}
});
