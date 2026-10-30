const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
test('TEST seed, persistence and scoped cleanup on isolated PostgreSQL', {skip:!process.env.REGISTRATION_PGLITE_PATH}, async()=>{
 const {PGlite}=require(process.env.REGISTRATION_PGLITE_PATH);
 const db=new PGlite();
 const read=p=>fs.readFileSync(path.join(__dirname,'../..',p),'utf8');
 const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
 try{
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);');
  await db.exec(read('docs/Jollishift.sql').replace('CREATE INDEX idx_schedule_approvals_schedule ON','CREATE INDEX IF NOT EXISTS idx_schedule_approvals_schedule ON'));
  await db.exec(read('backend/migrations/20261029_employee_registration.sql'));
  await db.exec(read('backend/migrations/20261029_registration_off_schedule.sql'));
  const seed=read('docs/tv2-test/seed.sql'),cleanup=read('docs/tv2-test/cleanup.sql');
  await assert.rejects(db.exec(seed),/STOP/);await db.exec('ROLLBACK');
  await db.exec("SET app.tv2_environment='isolated-test'; SET app.tv2_project_ref='wlbpprpiieonjrqglicv'");
  await assert.rejects(db.exec(seed),/STOP/);await db.exec('ROLLBACK');
  await db.exec("SET app.tv2_project_ref='separatetest'");
  await db.query('INSERT INTO branches(id,name) VALUES($1,$2)',[uid(1),'Isolated branch']);
  await db.query('INSERT INTO departments(id,name) VALUES($1,$2)',[uid(2),'Isolated department']);
  await db.query('INSERT INTO auth.users VALUES($1)',[uid(3)]);
  await db.query("INSERT INTO users(id,username,role,branch_id) VALUES($1,'nv_jollibee','NV',$2)",[uid(3),uid(1)]);
  await db.query("INSERT INTO employees(id,user_id,full_name,branch_id,department_id,skill_level) VALUES($1,$2,'Fixture',$3,$4,'REGULAR')",[uid(4),uid(3),uid(1),uid(2)]);
  await db.exec(seed);
  let result=await db.exec(read('docs/tv2-test/verify.sql'));
  assert.equal(result[0].rows[0].editable_now,true);
  const deadline=result[0].rows[0].deadline_vietnam;
  await db.exec(seed);
  result=await db.exec(read('docs/tv2-test/verify.sql'));
  assert.equal(String(result[0].rows[0].deadline_vietnam),String(deadline));
  const period=(await db.query('SELECT * FROM registration_periods')).rows[0];
  const shift=(await db.query('SELECT id FROM shifts ORDER BY start_time')).rows[0];
  const date=(await db.query('SELECT work_start_date::text d FROM registration_periods WHERE id=$1',[period.id])).rows[0].d;
  const preferences=JSON.stringify([{work_date:date,shift_id:shift.id}]);
  for(const submit of [false,true]){
   const r=await db.query('SELECT save_employee_registration($1,$2,$3::jsonb,$4) r',[uid(3),period.id,preferences,submit]);
   assert.equal(r.rows[0].r.registration_status,submit?'VALID':'DRAFT');
  }
  // Cleanup refuses another employee's registration, then preserves all identity and audit data.
  await db.query('INSERT INTO auth.users VALUES($1)',[uid(5)]);
  await db.query("INSERT INTO users(id,username,role,branch_id) VALUES($1,'other_fixture','NV',$2)",[uid(5),uid(1)]);
  await db.query("INSERT INTO employees(id,user_id,full_name,branch_id,department_id,skill_level) VALUES($1,$2,'Other fixture',$3,$4,'REGULAR')",[uid(6),uid(5),uid(1),uid(2)]);
  await db.query("INSERT INTO registration_submissions(period_id,employee_id,status) VALUES($1,$2,'DRAFT')",[period.id,uid(6)]);
  await assert.rejects(db.exec(cleanup),/Other employees/);await db.exec('ROLLBACK');
  await db.query('DELETE FROM registration_submissions WHERE employee_id=$1',[uid(6)]);
  await db.exec(cleanup);
  await db.exec(cleanup);
  for(const table of ['tv2_test_batches','registration_periods','shift_registrations','registration_submissions','shifts'])assert.equal((await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0,table);
  assert.equal((await db.query('SELECT count(*)::int n FROM employees')).rows[0].n,2);
  assert.equal((await db.query('SELECT count(*)::int n FROM auth.users')).rows[0].n,2);
  assert.equal((await db.query('SELECT count(*)::int n FROM audit_logs')).rows[0].n,2);
 }finally{await db.close();}
});
