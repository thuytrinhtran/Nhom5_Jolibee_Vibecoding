// Creates its own disposable loopback-only cluster. Never accepts a database URL
// or reads .env; it cannot target the shared Supabase database.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const {spawnSync,spawn}=require('node:child_process');
const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});
async function nativeHarness(){
 const root=process.env.TV3_NATIVE_PG_ROOT,bin=process.env.TV3_NATIVE_PG_BIN;
 if(!root||!bin||!path.isAbsolute(root)||!path.isAbsolute(bin))throw Error('Absolute private tool paths required');
 const {Client}=require(process.env.TV3_NATIVE_PG_CLIENT);fs.mkdirSync(root,{recursive:true});const dir=fs.mkdtempSync(path.join(root,'run-'));
 const data=path.join(dir,'data'),port=await freePort(),clients=new Set(),children=[];
 const exe=name=>path.join(bin,name+(process.platform==='win32'?'.exe':''));
 const command=(name,args)=>{const r=spawnSync(exe(name),args,{windowsHide:true,encoding:'utf8',timeout:30000});if(r.status!==0)throw Error(`${name} failed: ${r.error?.message||r.stderr?.slice(-600)}`);};
 command('initdb',['-D',data,'-U','postgres','--auth=trust','--no-locale','-E','UTF8']);
 command('pg_ctl',['start','-D',data,'-l',path.join(dir,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','-t','20']);
 const connect=async()=>{const c=new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres',connectionTimeoutMillis:3000,application_name:'jollishift-isolated-tv3'});await c.connect();clients.add(c);return c;};
 const admin=await connect();
 const close=async()=>{for(const child of children){child.kill();await new Promise(r=>{if(child.exitCode!==null)return r();child.once('exit',r);});}await Promise.allSettled([...clients].map(c=>c.end()));command('pg_ctl',['stop','-D',data,'-m','fast','-w','-t','15']);};
 try{
  await admin.query("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;");
  await admin.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;');
  const repo=path.resolve(__dirname,'../../..');
  for(const file of ['docs/Jollishift.sql','backend/migrations/20261029_require_password_change.sql','backend/migrations/20261029_employee_registration.sql','backend/migrations/20261029_registration_off_schedule.sql','backend/migrations/20261030_registration_effective_state.sql','backend/migrations/20261031_tv3_schedule_draft.sql']){
   await admin.query(fs.readFileSync(path.join(repo,file),'utf8').replace('CREATE INDEX idx_schedule_approvals_schedule ON','CREATE INDEX IF NOT EXISTS idx_schedule_approvals_schedule ON'));
  }
 }catch(e){await close();throw e;}
 let sequence=0;
 const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 async function fixture(){const n=++sequence*100,branch=id(n+1),actor=id(n+2),nv=id(n+3),employee=id(n+4),department=id(n+5),shift=id(n+6),period=id(n+7);
  await admin.query('INSERT INTO auth.users VALUES($1),($2)',[actor,nv]);await admin.query('INSERT INTO branches(id,name) VALUES($1,$2)',[branch,'Native fixture '+n]);
  await admin.query("INSERT INTO users(id,username,role,branch_id) VALUES($1,$2,'QL',$5),($3,$4,'NV',$5)",[actor,'ql_'+n,nv,'nv_'+n,branch]);
  await admin.query('INSERT INTO departments(id,name) VALUES($1,$2)',[department,'Native department '+n]);
  await admin.query("INSERT INTO employees(id,user_id,full_name,branch_id,department_id,skill_level,max_weekly_hours) VALUES($1,$2,'Synthetic native fixture',$3,$4,'REGULAR',40)",[employee,nv,branch,department]);
  await admin.query("INSERT INTO shifts(id,name,start_time,end_time,branch_id) VALUES($1,'Morning','08:00','12:00',$2)",[shift,branch]);
  await admin.query("INSERT INTO registration_periods(id,branch_id,work_start_date,work_end_date,open_at,close_at,status) VALUES($1,$2,'2026-10-26','2026-11-01',now()-interval '3 days',now()-interval '1 day','CLOSED')",[period,branch]);
  await admin.query("INSERT INTO registration_submissions(period_id,employee_id,status,submitted_at) VALUES($1,$2,'VALID',now())",[period,employee]);
  await admin.query("INSERT INTO shift_registrations(period_id,employee_id,work_date,shift_id,status,submitted_at) VALUES($1,$2,'2026-10-26',$3,'VALID',now())",[period,employee,shift]);
  await admin.query("INSERT INTO staffing_requirements(branch_id,department_id,shift_id,work_date,required_count,created_by) VALUES($1,$2,$3,'2026-10-26',1,$4)",[branch,department,shift,actor]);
  return {branch,actor,employee,period,shift,department,assignment:{employee_id:employee,work_date:'2026-10-26',shift_id:shift,department_id:department}};
 }
 async function call(client,f,options={}){
  return (await client.query('SELECT persist_schedule_draft($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8) r',[f.period,f.actor,options.snapshot?JSON.stringify(options.snapshot):null,options.result?JSON.stringify(options.result):null,options.target??null,options.version??null,options.request??null,options.fingerprint??null])).rows[0].r;
 }
 async function gateway(){
  const portHttp=await freePort(),log=fs.openSync(path.join(dir,'postgrest.log'),'a');
  const child=spawn(process.env.TV3_NATIVE_POSTGREST,[],{windowsHide:true,stdio:['ignore',log,log],env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,PGRST_DB_URI:`postgresql://postgres@127.0.0.1:${port}/postgres`,PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'service_role',PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:String(portHttp),PGRST_DB_POOL:'3',PGRST_DB_HOISTED_TX_SETTINGS:'statement_timeout,lock_timeout,default_transaction_isolation'}});children.push(child);fs.closeSync(log);
  const base=`http://127.0.0.1:${portHttp}`;
  for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error('Local PostgREST exited; inspect private tool log');try{const r=await fetch(base+'/');if(r.ok)return base;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Local PostgREST did not become ready');
 }
 return {admin,connect,close,fixture,call,id,gateway,dir};
}
module.exports={nativeHarness};
