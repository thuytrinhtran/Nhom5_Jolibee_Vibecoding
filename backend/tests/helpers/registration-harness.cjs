// Test process only: Express + PostgreSQL; no Supabase network or production credentials.
const fs=require('node:fs'),path=require('node:path');
async function createHarness(){
 process.env.NODE_ENV='test';process.env.SUPABASE_URL='http://127.0.0.1:9';process.env.SUPABASE_SECRET_KEY='isolated-fixture-not-a-real-key';
 const {PGlite}=require(process.env.REGISTRATION_PGLITE_PATH);const sql=new PGlite();
 const root=path.resolve(__dirname,'../../..');
 await sql.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;");
 await sql.exec('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;');
 for(const file of ['docs/Jollishift.sql','backend/migrations/20261029_require_password_change.sql','backend/migrations/20261029_employee_registration.sql','backend/migrations/20261029_registration_off_schedule.sql'])await sql.exec(fs.readFileSync(path.join(root,file),'utf8').replace('CREATE INDEX idx_schedule_approvals_schedule ON','CREATE INDEX IF NOT EXISTS idx_schedule_approvals_schedule ON'));
 await sql.exec(fs.readFileSync(path.join(root,'backend/migrations/20261030_registration_effective_state.sql'),'utf8'));
 const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 await sql.query("INSERT INTO branches(id,name) VALUES($1,'Isolated API branch')",[id(1)]);
 await sql.query("INSERT INTO departments(id,name) VALUES($1,'Isolated API department')",[id(2)]);
 await sql.query('INSERT INTO auth.users VALUES($1)',[id(3)]);
 await sql.query("INSERT INTO users(id,username,role,branch_id) VALUES($1,'isolated_api_nv','NV',$2)",[id(3),id(1)]);
 await sql.query("INSERT INTO employees(id,user_id,full_name,branch_id,department_id,skill_level) VALUES($1,$2,'Isolated API employee',$3,$4,'REGULAR')",[id(4),id(3),id(1),id(2)]);
 await sql.query("INSERT INTO shifts(id,name,start_time,end_time,branch_id) VALUES($1,'Ca sáng','08:00','12:00',$4),($2,'Ca chiều','12:00','17:00',$4),($3,'Ca tối','17:00','22:00',$4)",[id(5),id(6),id(7),id(1)]);
 await sql.query("INSERT INTO registration_periods(id,branch_id,work_start_date,work_end_date,open_at,close_at,status) SELECT $1,$2,m,m+6,now()-interval '1 hour',now()+interval '1 hour','OPEN' FROM (SELECT date_trunc('week',now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date+7 m) x",[id(8),id(1)]);
 const config=require('../../dist/config/supabase.js'),sdk=config.supabaseAdmin;
 const identifier=s=>{if(!/^[a-z_]+$/.test(s))throw Error('Unsafe fixture identifier');return `"${s}"`;};
 class Query{
  constructor(table){this.table=table;this.fields='*';this.filters=[];this.params=[];this.sort='';this.cap='';}
  select(fields){this.fields=fields;return this;}
  filter(column,op,value){this.params.push(value);this.filters.push(`${column==='new_data->>request_id'?"new_data->>'request_id'":column==='employee.branch_id'?'(SELECT branch_id FROM employees WHERE employees.id=employee_id)':identifier(column)} ${op} $${this.params.length}`);return this;}
  eq(c,v){return this.filter(c,'=',v);}neq(c,v){return this.filter(c,'<>',v);}gte(c,v){return this.filter(c,'>=',v);}range(a,b){this.cap=` LIMIT ${b-a+1} OFFSET ${a}`;return this;}gt(c,v){return this.filter(c,'>',v);}lte(c,v){return this.filter(c,'<=',v);}
  in(c,values){const slots=values.map(v=>{this.params.push(v);return '$'+this.params.length;});this.filters.push(`${identifier(c)} IN (${slots.join(',')})`);return this;}
  or(value){value=value.replace(/^branch_id\.eq\.([\da-f-]+),branch_id\.is\.null$/,'branch_id.is.null,branch_id.eq.$1');const match=/^branch_id\.is\.null,branch_id\.eq\.([\da-f-]+)$/.exec(value);if(!match)throw Error('Unexpected fixture OR');this.params.push(match[1]);this.filters.push(`(branch_id IS NULL OR branch_id=$${this.params.length})`);return this;}
  order(c,options={}){this.sort=` ORDER BY ${identifier(c)} ${options.ascending===false?'DESC':'ASC'}`;return this;}
  limit(n){if(!Number.isInteger(n))throw Error('Unexpected fixture limit');this.cap=` LIMIT ${n}`;return this;}
  async run(single=false){
   try{
    const fields=this.fields==='*'?'*':this.fields.split(/,(?![^()]*\))/).map(c=>c.trim()).map(c=>c==='schedules(id, status, version, created_at)'?"coalesce((SELECT json_agg(s) FROM schedules s WHERE s.period_id=registration_periods.id),'[]'::json) AS schedules":c==='user:user_id(is_active, role, branch_id)'?"(SELECT json_build_object('is_active',u.is_active,'role',u.role,'branch_id',u.branch_id) FROM users u WHERE u.id=employees.user_id) AS \"user\"":c==='employee:employees!inner(branch_id)'?"(SELECT json_build_object('branch_id',e.branch_id) FROM employees e WHERE e.id=employee_id) AS employee":c==='shift:shift_id(id, name, start_time, end_time, is_active, branch_id)'?"(SELECT row_to_json(s) FROM shifts s WHERE s.id=shift_id) AS shift":c==='departments:department_id(name)'?"(SELECT json_build_object('name',d.name) FROM departments d WHERE d.id=employees.department_id) AS departments":identifier(c)).join(',');
    const rows=(await sql.query(`SELECT ${fields} FROM public.${identifier(this.table)}${this.filters.length?' WHERE '+this.filters.join(' AND '):''}${this.sort}${this.cap}`,this.params)).rows;
    for(const row of rows)for(const name of ['work_date','work_start_date','work_end_date'])if(row[name] instanceof Date)row[name]=row[name].toISOString().slice(0,10);
    return{data:single?rows[0]||null:rows,error:null};
   }catch(error){return{data:null,error:{code:error.code,message:error.message}};}
  }
  single(){return this.run(true);}maybeSingle(){return this.run(true);}then(resolve,reject){return this.run().then(resolve,reject);}
 }
 sdk.from=table=>new Query(table);
 sdk.rpc=async(name,args)=>{
  if(name==='persist_schedule_draft'){try{const r=await sql.query('SELECT persist_schedule_draft($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8) result',[args.p_period_id,args.p_actor_id,args.p_snapshot?JSON.stringify(args.p_snapshot):null,args.p_result?JSON.stringify(args.p_result):null,args.p_schedule_id??null,args.p_expected_version??null,args.p_request_id??null,args.p_fingerprint??null]);return{data:r.rows[0].result,error:null};}catch(e){return{data:null,error:{code:e.code,message:e.message}};}}
  if(name!=='save_employee_registration')throw Error('Only registration RPC is allowed in this fixture');
  try{const result=await sql.query('SELECT save_employee_registration($1,$2,$3::jsonb,$4) result',[args.p_user,args.p_period,JSON.stringify(args.p_preferences),args.p_submit]);return{data:result.rows[0].result,error:null};}
  catch(error){return{data:null,error:{code:error.code,message:error.message}};}
 };
 const authUser={id:id(3),email:'api-fixture@example.invalid'};
 const session={access_token:'isolated-api-access',refresh_token:'isolated-api-refresh',expires_at:Math.floor(Date.now()/1000)+3600};
 config.createAuthClient=()=>({auth:{signInWithPassword:async({email,password})=>email===authUser.email&&password==='Fixture-only-Password!1'?{data:{user:authUser,session},error:null}:{data:{},error:{status:401}}}});
 sdk.auth.getUser=async token=>token===session.access_token?{data:{user:authUser},error:null}:{data:{},error:{status:401}};
 const app=require('../../dist/server.js').default;
 return{app,sql,id,async close(){await sql.close();}};
}
module.exports={createHarness};
