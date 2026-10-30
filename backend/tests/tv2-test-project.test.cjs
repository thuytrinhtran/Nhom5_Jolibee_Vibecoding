const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {buildTestProjectBundle,projectRef}=require('../scripts/prepare-tv2-test-project.cjs');
test('target-specific SQL bundle: order, Auth binding, FK/RLS/RPC and repeat protection in isolated PostgreSQL', {skip:!process.env.REGISTRATION_PGLITE_PATH},async t=>{
 const {PGlite}=require(process.env.REGISTRATION_PGLITE_PATH);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jollishift-tv2-project-test-'));
 const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 const original=path.join(__dirname,'../../docs/Jollishift.sql'),before=hash(original);
 const {manifest}=buildTestProjectBundle(dir),sql=name=>fs.readFileSync(path.join(dir,name),'utf8');
 const setup=async()=>{const db=new PGlite();await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz); CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;");return db;};
 const db=await setup();const uid='00000000-0000-4000-8000-000000000099',period='7f330000-0000-4000-8000-000000000002',employee='7f330000-0000-4000-8000-000000000012';
 try{
  await t.test('original schema unchanged, TEST duplicate index removed, hashes match',()=>{
   assert.equal(hash(original),before);assert.equal((sql('01_foundation.sql').match(/CREATE INDEX(?: IF NOT EXISTS)? idx_schedule_approvals_schedule/g)||[]).length,1);
   assert.equal(manifest.project_ref,projectRef);assert.ok(manifest.artifacts.every(a=>hash(path.join(dir,a.file))===a.sha256));
  });
  await t.test('fresh-only foundation refuses a nonempty public schema without touching it',async()=>{
   const other=await setup();try{await other.exec('CREATE TABLE public.existing_data(id int); INSERT INTO public.existing_data VALUES(42);');await assert.rejects(other.exec(sql('01_foundation.sql')),/public already has tables/);await other.exec('ROLLBACK');assert.equal((await other.query('SELECT id FROM existing_data')).rows[0].id,42);assert.equal((await other.query("SELECT to_regclass('public.tv2_test_installation') t")).rows[0].t,null);}finally{await other.close();}
  });
  await t.test('steps reject missing predecessors, then apply 01-04 exactly once',async()=>{
   await assert.rejects(db.exec(sql('02_auth_compatibility.sql')),/step 01/);await db.exec('ROLLBACK');
   await db.exec(sql('01_foundation.sql'));
   await assert.rejects(db.exec(sql('03_tv2_m1.sql')),/prerequisite 02/);await db.exec('ROLLBACK');
   for(const name of ['02_auth_compatibility.sql','03_tv2_m1.sql','04_tv2_m2.sql'])await db.exec(sql(name));
   assert.equal((await db.query('SELECT count(*)::int n FROM tv2_test_installation')).rows[0].n,4);
   await assert.rejects(db.exec(sql('04_tv2_m2.sql')),/already applied/);await db.exec('ROLLBACK');
  });
  await t.test('fixture requires a TEST Auth UUID and creates no partial data on failure',async()=>{
   await assert.rejects(db.exec(sql('05_test_fixture.sql')),/TEST Auth user/);await db.exec('ROLLBACK');
   await db.query("SELECT set_config('app.tv2_test_auth_user_id',$1,false)",[uid]);
   await assert.rejects(db.exec(sql('05_test_fixture.sql')),/does not exist/);await db.exec('ROLLBACK');
   assert.equal((await db.query('SELECT count(*)::int n FROM branches')).rows[0].n,0);
   // Only the in-memory test emulates an Auth user. Generated SQL never inserts auth.users.
   await db.query("INSERT INTO auth.users(id,email) VALUES($1,'fixture@example.invalid')",[uid]);
   await assert.rejects(db.exec(sql('05_test_fixture.sql')),/confirmed email/);await db.exec('ROLLBACK');
   await db.query('UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1',[uid]);
   await db.exec(sql('05_test_fixture.sql'));
   for(const [table,count] of [['branches',1],['departments',1],['users',1],['employees',1],['shifts',3],['registration_periods',1],['registration_submissions',0],['shift_registrations',0]])assert.equal((await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,count,table);
   const profile=(await db.query('SELECT e.user_id,e.branch_id=u.branch_id same_branch,u.role,u.must_change_password FROM employees e JOIN users u ON u.id=e.user_id')).rows[0];assert.equal(profile.user_id,uid);assert.equal(profile.same_branch,true);assert.equal(profile.role,'NV');assert.equal(profile.must_change_password,false);
   await assert.rejects(db.exec(sql('05_test_fixture.sql')),/already applied/);await db.exec('ROLLBACK');
   assert.equal((await db.query('SELECT count(*)::int n FROM employees')).rows[0].n,1);
  });
  await t.test('verification is read-only; fixture window, official schedule and RLS are correct',async()=>{
   const results=await db.exec(sql('06_verify.sql'));assert.equal(results[0].rows.length,5);assert.equal(results[3].rows[0].editable_now,true);
   const cfg=results[4].rows[0];assert.equal(cfg.open_iso_day,5);assert.equal(cfg.open_local_time,'15:00:00');assert.equal(cfg.close_iso_day,7);assert.equal(cfg.close_local_time,'12:00:00');assert.equal(cfg.reminder_minutes,30);assert.equal(results[5].rows[0].automation_enabled,false);
   for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await assert.rejects(db.query('SELECT * FROM registration_submissions'));await assert.rejects(db.query('SELECT run_registration_automation()'));await db.exec('RESET ROLE');}
   for(const table of ['registration_submissions','registration_schedule_config','registration_automation_config']){const r=(await db.query('SELECT has_table_privilege($1,$2,$3) r,has_table_privilege($1,$2,$4) w',['service_role','public.'+table,'SELECT','INSERT,UPDATE,DELETE,TRUNCATE'])).rows[0];assert.equal(r.r,true);assert.equal(r.w,false);}
   assert.equal((await db.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity")).rows[0].n,0);
   assert.equal((await db.query("SELECT to_regclass('public.registration_days_off') t")).rows[0].t,null);
  });
  await t.test('FKs reject nonexistent accounts and backend role saves drafts/submits through the real RPC',async()=>{
   await assert.rejects(db.query("INSERT INTO employees(user_id,full_name,branch_id,department_id,skill_level) VALUES($1,'Bad fixture',$2,$3,'REGULAR')",['00000000-0000-4000-8000-000000000098','7f330000-0000-4000-8000-000000000010','7f330000-0000-4000-8000-000000000011']),error=>error.code==='23503');
   const day=(await db.query('SELECT work_start_date::text d FROM registration_periods WHERE id=$1',[period])).rows[0].d;
   const preferences=(await db.query('SELECT id FROM shifts ORDER BY start_time')).rows.map(row=>({work_date:day,shift_id:row.id}));
   await db.exec('SET ROLE service_role');
   for(const submitted of [false,true]){const result=await db.query('SELECT save_employee_registration($1,$2,$3::jsonb,$4) r',[uid,period,JSON.stringify(preferences),submitted]);assert.equal(result.rows[0].r.registration_status,submitted?'VALID':'DRAFT');}
   await assert.rejects(db.query("INSERT INTO registration_submissions(period_id,employee_id,status) VALUES($1,$2,'DRAFT')",[period,employee]));
   await db.exec('RESET ROLE');
   assert.equal((await db.query('SELECT count(*)::int n FROM shift_registrations')).rows[0].n,3);
   assert.ok((await db.query('SELECT submitted_at FROM registration_submissions')).rows[0].submitted_at);
   assert.equal((await db.query('SELECT count(*)::int n FROM audit_logs')).rows[0].n,2);
  });
 }finally{await db.close();const resolved=path.resolve(dir),prefix=path.join(path.resolve(os.tmpdir()),'jollishift-tv2-project-test-');if(!resolved.startsWith(prefix))throw Error('Unsafe temporary cleanup path');fs.rmSync(resolved,{recursive:true,force:true});}
});
