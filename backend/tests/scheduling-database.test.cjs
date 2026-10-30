const {test}=require('node:test');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
// Explicit opt-in: use a disposable, already-migrated Supabase TEST database.
// PGDATABASE accepts a libpq connection string; no credentials in process arguments.
test('PostgreSQL RPC persistence, retry, RBAC and atomic rollback',{
  skip:!process.env.SCHEDULING_TEST_DATABASE_URL ? 'Set SCHEDULING_TEST_DATABASE_URL for a migrated disposable database and install psql.' : false,
},()=>{
  execFileSync('psql',['-X','-v','ON_ERROR_STOP=1','-f',path.join(__dirname,'scheduling.database.sql')],{
    env:{...process.env,PGDATABASE:process.env.SCHEDULING_TEST_DATABASE_URL},stdio:'pipe',timeout:30000,
  });
});
