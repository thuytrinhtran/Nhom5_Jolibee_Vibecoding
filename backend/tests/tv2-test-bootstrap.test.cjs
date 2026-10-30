const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
test('generated TEST schema and disposable employee setup execute only with explicit guards', {skip:!process.env.REGISTRATION_PGLITE_PATH}, async()=>{
 const {PGlite}=require(process.env.REGISTRATION_PGLITE_PATH);const db=new PGlite();
 const output=path.join(os.tmpdir(),`tv2-test-schema-${process.pid}.sql`);
 try{
  execFileSync(process.execPath,[path.join(__dirname,'../scripts/prepare-tv2-test-schema.cjs'),output]);
  const schema=fs.readFileSync(output,'utf8');
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;");
  await db.exec("SET app.tv2_environment='isolated-test'; SET app.tv2_project_ref='separate-test'");
  await db.exec(schema);
  const fixture=fs.readFileSync(path.join(__dirname,'../../docs/tv2-test/prepare-employee.sql'),'utf8');
  await assert.rejects(db.exec(fixture),/TEST Auth user/);await db.exec('ROLLBACK');
  await db.exec("INSERT INTO auth.users VALUES('00000000-0000-0000-0000-000000000099'); SET app.tv2_test_auth_user_id='00000000-0000-0000-0000-000000000099'");
  await db.exec(fixture);
  const employee=(await db.query("SELECT e.id,u.username,u.must_change_password FROM employees e JOIN users u ON u.id=e.user_id")).rows[0];
  assert.equal(employee.username,'tv2_test_nv');assert.equal(employee.must_change_password,false);
  await assert.rejects(db.exec(fixture),/already exist/);await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT count(*)::int n FROM employees')).rows[0].n,1);
 }finally{await db.close();if(fs.existsSync(output))fs.unlinkSync(output);}
});
