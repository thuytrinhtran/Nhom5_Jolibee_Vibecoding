const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('approved cron activation bootstraps once, reuses named job and rejects conflicting job', {skip:!process.env.REGISTRATION_PGLITE_PATH},async()=>{
 const h=await require('./helpers/registration-harness.cjs').createHarness(),q=(s,p=[])=>h.sql.query(s,p);
 try{
  // PGlite does not execute pg_cron. Emulate ONLY its scheduling catalog/API for activation SQL tests.
  await h.sql.exec(`CREATE SCHEMA cron;CREATE TABLE cron.job(jobid serial PRIMARY KEY,jobname text UNIQUE,schedule text,command text,username text,database text,active boolean);
   CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE plpgsql AS $$DECLARE result bigint;BEGIN
   INSERT INTO cron.job(jobname,schedule,command,username,database,active) VALUES($1,$2,$3,current_user,current_database(),true)
   ON CONFLICT(jobname) DO UPDATE SET schedule=excluded.schedule,command=excluded.command,active=true RETURNING jobid INTO result;RETURN result;END;$$;`);
  const source=fs.readFileSync(path.join(__dirname,'../../docs/tv2-release/final/02_activate_scheduler.sql'),'utf8');
  await assert.rejects(h.sql.exec(source),/Enable Supabase Cron/);await h.sql.exec('ROLLBACK');
  const fixture=source.replace("SELECT 1 FROM pg_extension WHERE extname='pg_cron'","SELECT 1 FROM pg_namespace WHERE nspname='cron'");
  await h.sql.exec(fixture);const total=(await q('SELECT count(*)::int n FROM registration_periods')).rows[0].n;
  await h.sql.exec(fixture);assert.equal((await q('SELECT count(*)::int n FROM registration_periods')).rows[0].n,total);
  assert.equal((await q('SELECT count(*)::int n FROM cron.job')).rows[0].n,1);
  assert.equal((await q('SELECT schedule FROM cron.job')).rows[0].schedule,'7 * * * *');
  await q("UPDATE cron.job SET command='SELECT 1'");await assert.rejects(h.sql.exec(fixture),/differs/);await h.sql.exec('ROLLBACK');
 }finally{await h.close();}
});
