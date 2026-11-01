// No automatic invocation, no Auth creation, no dotenv or arbitrary SQL input.
// CLI default: inspect only. Apply/rollback require an explicit approval digest.
const fs=require('node:fs'),crypto=require('node:crypto');
const SCOPE={project_ref:'wimikwyuzhltpjciafod',batch_id:'6e1d2026-1102-4000-8000-000000000017',branch_id:'11111111-1111-1111-1111-111111111111',period_id:'79a979cc-8347-48b5-a411-f03bd8aceb92'};
const canonical=v=>JSON.stringify(normalize(v));
function normalize(v){if(Array.isArray(v))return v.map(normalize);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,normalize(v[k])]));return v;}
const hash=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex');
const uuid=key=>{const h=hash([SCOPE.batch_id,key]);return`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};
const ident=s=>{if(!/^[a-z_]+$/.test(s))throw Error('UNSAFE_IDENTIFIER');return '"'+s+'"';};
const fail=code=>{throw Error(code);};
async function rows(c,table,where='true',params=[]){return(await c.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') v FROM public.${ident(table)} t WHERE ${where}`,params)).rows[0].v;}
async function baseline(c,profiles=[]){
 const result={};
 for(const [t,w,p] of [
  ['branches','id=$1',[SCOPE.branch_id]],['users','branch_id=$1 OR id=ANY($2::uuid[])',[SCOPE.branch_id,profiles.map(p=>p.id)]],
  ['employees','branch_id=$1',[SCOPE.branch_id]],['registration_periods','id=$1',[SCOPE.period_id]],
  ['registration_submissions','period_id=$1',[SCOPE.period_id]],['shift_registrations','period_id=$1',[SCOPE.period_id]],
  ['staffing_requirements',"branch_id=$1 AND work_date BETWEEN '2026-11-02' AND '2026-11-08'",[SCOPE.branch_id]],
  ['shifts','true',[]],['employee_skills','employee_id IN(SELECT id FROM employees WHERE branch_id=$1)',[SCOPE.branch_id]],
  ['schedules','period_id=$1',[SCOPE.period_id]],['shift_assignments','actual_branch_id=$1 OR employee_id IN(SELECT id FROM employees WHERE branch_id=$1)',[SCOPE.branch_id]],
  ['warning_configs','branch_id=$1',[SCOPE.branch_id]],
 ])result[t]=await rows(c,t,w,p);
 result.auth_ids=(await c.query('SELECT id FROM auth.users WHERE id=ANY($1::uuid[]) ORDER BY id',[profiles.map(p=>p.id)])).rows.map(r=>r.id);
 return result;
}
function assertScope(plan){if(!['development','test'].includes(plan.environment)||Object.entries(SCOPE).some(([k,v])=>plan[k]!==v))fail('SCOPE_MISMATCH');}
function seal(plan){const {plan_sha256,...rest}=plan;return hash(rest);}
function authorizeConnection(c){const host=c.connectionParameters?.host;if(host===`db.${SCOPE.project_ref}.supabase.co`){if(c.connectionParameters.ssl?.rejectUnauthorized!==true)fail('VERIFIED_TLS_REQUIRED');}else if(!(process.env.NODE_ENV==='test'&&process.env.DEV_IMPORT_LOCAL_REHEARSAL==='true'&&host==='127.0.0.1'))fail('PROJECT_CONNECTION_NOT_APPROVED');}
async function transaction(c,work,readonly=false){await c.query(readonly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');try{await c.query("SET LOCAL timezone='UTC'; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'");const v=await work();await c.query('COMMIT');return v;}catch(e){await c.query('ROLLBACK');throw e;}}
function payload(seed){
 const extra=seed.optional_positive_scenario?.additional_shift_registrations;
 if(!Array.isArray(extra))fail('POSITIVE_SCENARIO_REQUIRED');
 return{profiles:seed.auth_profiles_to_provision,employees:seed.employees_to_insert,
  headers:seed.submission_headers_to_insert.map(h=>({period_id:h.period_id,employee_id:h.employee_id})),
  registrations:[...seed.shift_registrations_to_insert,...extra].map(r=>Object.fromEntries(['id','period_id','employee_id','work_date','shift_id'].map(k=>[k,r[k]])))};
}
function validatePayload(p){
 for(const group of [p.profiles,p.employees,p.headers,p.registrations])if(!Array.isArray(group))fail('INVALID_MANIFEST');
 for(const list of [p.profiles,p.employees,p.registrations])if(new Set(list.map(r=>r.id)).size!==list.length)fail('DUPLICATE_MANIFEST_ID');
 if(new Set(p.headers.map(h=>h.employee_id)).size!==p.headers.length)fail('DUPLICATE_HEADER');
 if(p.headers.some(h=>h.period_id!==SCOPE.period_id)||p.registrations.some(r=>r.period_id!==SCOPE.period_id||r.work_date<'2026-11-02'||r.work_date>'2026-11-08'||!p.headers.some(h=>h.employee_id===r.employee_id)))fail('INVALID_ROW_SCOPE');
 if(p.employees.some(e=>e.branch_id!==SCOPE.branch_id||e.status!=='ACTIVE'||!p.profiles.some(u=>u.id===e.user_id)))fail('INVALID_EMPLOYEE_SCOPE');
 if(p.profiles.some(u=>u.role!=='NV'||u.branch_id!==SCOPE.branch_id||u.is_active!==true))fail('INVALID_PROFILE_SCOPE');
}
function evaluate(input,p){
 const {generateSchedule,interval}=require('../dist/services/scheduling.engine.js');
 const employees=[...input.employees,...p.employees.map(e=>({...e,employee_code:p.profiles.find(u=>u.id===e.user_id).username,is_active:true,role:'NV',skills:[]}))];
 const registrations=[...input.registrations,...p.registrations.map(r=>({...r,status:'VALID'}))];
 if(input.registrations.length!==16||input.requirements.reduce((s,r)=>s+r.required_count,0)!==308)fail('EXPECTED_REAL_SOURCE_CHANGED');
 const keys=new Set();for(const r of registrations){const key=[r.employee_id,r.work_date,r.shift_id].join('/');if(keys.has(key))fail('DUPLICATE_REGISTRATION');keys.add(key);}
 for(let i=0;i<registrations.length;i++){const a=registrations[i],s=input.shifts.find(s=>s.id===a.shift_id);if(!s)fail('MISSING_SHIFT');const [x,y]=interval(a.work_date,s);for(let j=i+1;j<registrations.length;j++){const b=registrations[j];if(a.employee_id!==b.employee_id)continue;const [v,w]=interval(b.work_date,input.shifts.find(s=>s.id===b.shift_id));if(x<w&&v<y)fail('REGISTRATION_OVERLAP');}}
 const daily=Array.from({length:7},(_,i)=>{const work_date=`2026-11-0${i+2}`,people=new Set(registrations.filter(r=>r.work_date===work_date).map(r=>r.employee_id)).size;if(people<60||people>70)fail('DAILY_SCALE_CHANGED');return{work_date,distinct_employees:people};});
 const result=generateSchedule({...input,employees,registrations});
 if(result.assigned_count!==308||result.shortages.length||result.composition_shortages.length)fail('POSITIVE_SCENARIO_FAILED');
 return{daily,assigned:result.assigned_count,required:result.required_count,shortage:0,composition_cells:0,optimization:result.optimization,registration_count:registrations.length};
}
async function prepare(c,seed,environment='development'){
 return transaction(c,async()=>{
  if(seed.batch_id!==SCOPE.batch_id||seed.branch_id!==SCOPE.branch_id||seed.period_id!==SCOPE.period_id)fail('SEED_SCOPE_MISMATCH');
  const p=payload(seed);validatePayload(p);const b=await baseline(c,p.profiles);
  if(b.schedules.length)fail('TARGET_SCHEDULE_EXISTS');
  const period=b.registration_periods[0];if(!period||period.branch_id!==SCOPE.branch_id||period.work_start_date!=='2026-11-02'||period.work_end_date!=='2026-11-08')fail('PERIOD_SCOPE_CHANGED');
  if(p.headers.some(h=>b.registration_submissions.some(r=>r.employee_id===h.employee_id))||p.employees.some(e=>b.employees.some(r=>r.id===e.id)))fail('BASELINE_COLLISION');
  if((await c.query('SELECT 1 FROM audit_logs WHERE id=$1',[SCOPE.batch_id])).rowCount)fail('BATCH_ALREADY_EXISTS');
  if((await c.query('SELECT id FROM shift_registrations WHERE id=ANY($1::uuid[])',[p.registrations.map(r=>r.id)])).rowCount
   ||(await c.query('SELECT id FROM employees WHERE id=ANY($1::uuid[])',[p.employees.map(e=>e.id)])).rowCount)fail('GLOBAL_UUID_COLLISION');
  const input=(await c.query('SELECT tv3_scheduling_input($1) v',[SCOPE.period_id])).rows[0].v;
  const validation=evaluate(input,p),missing_profiles=p.profiles.filter(u=>!b.auth_ids.includes(u.id)||!b.users.some(v=>v.id===u.id&&v.username===u.username&&v.role===u.role&&v.branch_id===u.branch_id&&v.is_active)).map(u=>u.id);
  const plan={format:'ld-dev-import.v2',...SCOPE,environment,payload:p,baseline_sha256:hash(b),validation,missing_profiles,
   uuid_manifest:{batch:SCOPE.batch_id,receipt:uuid('receipt'),rollback:uuid('rollback'),profile_ids:p.profiles.map(u=>u.id),employee_ids:p.employees.map(e=>e.id),registration_ids:p.registrations.map(r=>r.id),header_employee_ids:p.headers.map(h=>h.employee_id)}};
  assertScope(plan);plan.plan_sha256=seal(plan);return plan;
 },true);
}
async function lock(c){await c.query('LOCK TABLE users,employees,employee_skills,shifts,registration_periods,registration_submissions,shift_registrations,staffing_requirements,schedules,shift_assignments,warning_configs,audit_logs,dev_import_batches IN SHARE ROW EXCLUSIVE MODE NOWAIT');}
async function afterImages(c,p){return{employees:await rows(c,'employees','id=ANY($1::uuid[])',[p.employees.map(e=>e.id)]),registration_submissions:await rows(c,'registration_submissions','period_id=$1 AND employee_id=ANY($2::uuid[])',[SCOPE.period_id,p.headers.map(h=>h.employee_id)]),shift_registrations:await rows(c,'shift_registrations','id=ANY($1::uuid[])',[p.registrations.map(r=>r.id)])};}
async function verifyReceipt(c,manifest){const receipt=(await c.query("SELECT new_data FROM audit_logs WHERE id=$1 AND entity_type='dev_import_batch' AND entity_id=$2 AND action='DEV_IMPORT_RECEIPT'",[manifest.receipt_id,SCOPE.batch_id])).rows[0];if(!receipt||hash(receipt.new_data.manifest)!==hash(manifest))fail('IMMUTABLE_RECEIPT_MISMATCH');}
async function apply(c,plan,approval){
 authorizeConnection(c);
 if(process.env.NODE_ENV!==plan.environment)fail('ENVIRONMENT_MISMATCH');
 assertScope(plan);validatePayload(plan.payload);if(seal(plan)!==plan.plan_sha256||approval!==plan.plan_sha256)fail('APPROVAL_DIGEST_REQUIRED');
 return transaction(c,async()=>{
  await lock(c);const p=plan.payload,existing=(await c.query('SELECT * FROM dev_import_batches WHERE batch_id=$1',[SCOPE.batch_id])).rows[0];
  if(existing){if(!existing.enabled||existing.manifest.plan_sha256!==plan.plan_sha256)fail('BATCH_CLOSED_OR_CONFLICT');await verifyReceipt(c,existing.manifest);if(hash(await afterImages(c,p))!==hash(existing.manifest.after_images))fail('AFTER_IMAGE_CHANGED');return{reused:true,manifest:existing.manifest};}
  if(hash(await baseline(c,p.profiles))!==plan.baseline_sha256)fail('BASELINE_CHANGED');
  if(plan.missing_profiles.length)fail('AUTH_PROFILE_PROVISIONING_REQUIRED_REPREPARE');
  const input=(await c.query('SELECT tv3_scheduling_input($1) v',[SCOPE.period_id])).rows[0].v;evaluate(input,p);
  await c.query("INSERT INTO audit_logs(id,actor_id,entity_type,entity_id,action,new_data,change_source) VALUES($1,NULL,'dev_import_batch',$1,'DEV_IMPORT',$2::jsonb,'SYSTEM')",[SCOPE.batch_id,JSON.stringify({scope:SCOPE,environment:plan.environment,plan_sha256:plan.plan_sha256,baseline_sha256:plan.baseline_sha256,late_import:true})]);
  for(const e of p.employees)await c.query('INSERT INTO employees(id,user_id,full_name,branch_id,department_id,skill_level,status,max_weekly_hours) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[e.id,e.user_id,e.full_name,e.branch_id,e.department_id,e.skill_level,e.status,e.max_weekly_hours]);
  for(const h of p.headers)await c.query("INSERT INTO registration_submissions(period_id,employee_id,status,errors,submitted_at,updated_at,sample_batch_id) VALUES($1,$2,'VALID','[]',transaction_timestamp(),transaction_timestamp(),$3)",[h.period_id,h.employee_id,SCOPE.batch_id]);
  for(const r of p.registrations)await c.query("INSERT INTO shift_registrations(id,period_id,employee_id,work_date,shift_id,status,submitted_at,updated_at) VALUES($1,$2,$3,$4,$5,'VALID',transaction_timestamp(),transaction_timestamp())",[r.id,r.period_id,r.employee_id,r.work_date,r.shift_id]);
  const manifest={...SCOPE,environment:plan.environment,plan_sha256:plan.plan_sha256,baseline_sha256:plan.baseline_sha256,receipt_id:plan.uuid_manifest.receipt,after_images:await afterImages(c,p),validation:plan.validation};
  await c.query('INSERT INTO dev_import_batches(batch_id,project_ref,environment,branch_id,period_id,enabled,manifest) VALUES($1,$2,$3,$4,$5,true,$6::jsonb)',[SCOPE.batch_id,SCOPE.project_ref,plan.environment,SCOPE.branch_id,SCOPE.period_id,JSON.stringify(manifest)]);
  await c.query("INSERT INTO audit_logs(id,actor_id,entity_type,entity_id,action,new_data,change_source) VALUES($1,NULL,'dev_import_batch',$2,'DEV_IMPORT_RECEIPT',$3::jsonb,'SYSTEM')",[plan.uuid_manifest.receipt,SCOPE.batch_id,JSON.stringify({manifest,after_image_sha256:hash(manifest.after_images)})]);
  await c.query("SELECT set_config('request.headers',$1,true)",[JSON.stringify({'x-jollishift-dev-import':`${plan.environment}/${SCOPE.project_ref}/${SCOPE.batch_id}`})]);
  const actual=(await c.query('SELECT tv3_scheduling_input($1) v',[SCOPE.period_id])).rows[0].v;
  const result=require('../dist/services/scheduling.engine.js').generateSchedule(actual);
  if(actual.registrations.length!==plan.validation.registration_count||result.assigned_count!==308||result.shortages.length||result.composition_shortages.length)fail('SQL_SOURCE_ROUNDTRIP_FAILED');
  return{reused:false,manifest};
 });
}
async function rollback(c,plan,approval){
 authorizeConnection(c);
 if(process.env.NODE_ENV!==plan.environment)fail('ENVIRONMENT_MISMATCH');
 assertScope(plan);if(seal(plan)!==plan.plan_sha256||approval!==plan.plan_sha256)fail('APPROVAL_DIGEST_REQUIRED');
 return transaction(c,async()=>{
  await lock(c);const stored=(await c.query('SELECT * FROM dev_import_batches WHERE batch_id=$1',[SCOPE.batch_id])).rows[0];
  if(!stored||stored.manifest.plan_sha256!==plan.plan_sha256)fail('BATCH_CONFLICT');
  await verifyReceipt(c,stored.manifest);
  if(!stored.enabled){const done=(await c.query("SELECT new_data FROM audit_logs WHERE id=$1 AND entity_id=$2 AND action='DEV_IMPORT_ROLLBACK'",[plan.uuid_manifest.rollback,SCOPE.batch_id])).rows[0];if(done?.new_data?.plan_sha256!==plan.plan_sha256)fail('BATCH_DISABLED_NOT_ROLLED_BACK');return{reused:true,rolled_back:true};}
  const images=stored.manifest.after_images;if(hash(await afterImages(c,plan.payload))!==hash(images))fail('AFTER_IMAGE_CHANGED');
  if((await c.query('SELECT 1 FROM schedules WHERE period_id=$1',[SCOPE.period_id])).rowCount)fail('DEPENDENT_SCHEDULE_EXISTS');
  const fks=(await c.query("SELECT child_ns.nspname child_schema,child.relname child_table,pa.relname parent_table,array_agg(ca.attname::text ORDER BY x.n) child_columns,array_agg(aa.attname::text ORDER BY x.n) parent_columns FROM pg_constraint k JOIN pg_class child ON child.oid=k.conrelid JOIN pg_namespace child_ns ON child_ns.oid=child.relnamespace JOIN pg_class pa ON pa.oid=k.confrelid CROSS JOIN LATERAL unnest(k.conkey,k.confkey) WITH ORDINALITY x(c,a,n) JOIN pg_attribute ca ON ca.attrelid=child.oid AND ca.attnum=x.c JOIN pg_attribute aa ON aa.attrelid=pa.oid AND aa.attnum=x.a WHERE k.contype='f' AND k.confrelid IN ('employees'::regclass,'registration_submissions'::regclass,'shift_registrations'::regclass) GROUP BY k.oid,child_ns.nspname,child.relname,pa.relname")).rows;
  for(const fk of fks){await c.query(`LOCK TABLE ${ident(fk.child_schema)}.${ident(fk.child_table)} IN SHARE ROW EXCLUSIVE MODE NOWAIT`);
   const condition=fk.child_columns.map((col,i)=>`to_jsonb(c)->>${'$'+(i+2)}=o->>${'$'+(i+2+fk.child_columns.length)}`).join(' AND ');
   const matches=(await c.query(`SELECT to_jsonb(c) v FROM ${ident(fk.child_schema)}.${ident(fk.child_table)} c WHERE EXISTS(SELECT 1 FROM jsonb_array_elements($1::jsonb) o WHERE ${condition})`,[JSON.stringify(images[fk.parent_table]),...fk.child_columns,...fk.parent_columns])).rows;
   for(const {v} of matches)if(fk.child_schema!=='public'||!(images[fk.child_table]??[]).some(own=>canonical(own)===canonical(v)))fail('DEPENDENT_DATA_EXISTS');
  }
  if((await c.query('DELETE FROM shift_registrations WHERE id=ANY($1::uuid[])',[plan.payload.registrations.map(r=>r.id)])).rowCount!==plan.payload.registrations.length)fail('ROLLBACK_ROW_COUNT_CHANGED');
  if((await c.query('DELETE FROM registration_submissions WHERE period_id=$1 AND employee_id=ANY($2::uuid[]) AND sample_batch_id=$3',[SCOPE.period_id,plan.payload.headers.map(h=>h.employee_id),SCOPE.batch_id])).rowCount!==plan.payload.headers.length)fail('ROLLBACK_ROW_COUNT_CHANGED');
  if((await c.query('DELETE FROM employees WHERE id=ANY($1::uuid[])',[plan.payload.employees.map(e=>e.id)])).rowCount!==plan.payload.employees.length)fail('ROLLBACK_ROW_COUNT_CHANGED');
  await c.query('UPDATE dev_import_batches SET enabled=false WHERE batch_id=$1',[SCOPE.batch_id]);
  await c.query("INSERT INTO audit_logs(id,actor_id,entity_type,entity_id,action,new_data,change_source) VALUES($1,NULL,'dev_import_batch',$2,'DEV_IMPORT_ROLLBACK',$3::jsonb,'SYSTEM')",[plan.uuid_manifest.rollback,SCOPE.batch_id,JSON.stringify({plan_sha256:plan.plan_sha256,after_image_sha256:hash(images)})]);
  return{rolled_back:true,reused:false};
 });
}
module.exports={prepare,apply,rollback,SCOPE,hash,seal,validatePayload};
if(require.main===module)(async()=>{
 const [mode='inspect',connectionFile,inputFile,outFile]=process.argv.slice(2);
 if(!['inspect','prepare','apply','rollback'].includes(mode))fail('INVALID_MODE');
 if(mode==='inspect'){console.log('No connection or write. Use prepare <private-connection.json> <seed-plan.json> <output.json>; explicit approved apply/rollback only.');return;}
 const path=require('node:path'),workspace=path.resolve(__dirname,'../..');
 if(!outFile||path.resolve(outFile).startsWith(workspace+path.sep)||fs.existsSync(outFile))fail('NEW_PRIVATE_OUTPUT_PATH_REQUIRED');
 if(!connectionFile||path.resolve(connectionFile).startsWith(workspace+path.sep))fail('PRIVATE_CONNECTION_FILE_REQUIRED');
 const config=JSON.parse(fs.readFileSync(connectionFile,'utf8'));
 if(config.host!==`db.${SCOPE.project_ref}.supabase.co`||config.database!=='postgres'||config.ssl?.rejectUnauthorized!==true)fail('DIRECT_PROJECT_HOST_TLS_REQUIRED');
 const modulePath=process.env.DEV_IMPORT_PG_CLIENT;if(!modulePath||!require('node:path').isAbsolute(modulePath))fail('PRIVATE_PG_CLIENT_PATH_REQUIRED');
 const {Client}=require(modulePath),c=new Client(config);await c.connect();
 try{const input=JSON.parse(fs.readFileSync(inputFile,'utf8'));const result=mode==='prepare'?await prepare(c,input,process.env.NODE_ENV):mode==='apply'?await apply(c,input,process.env.DEV_IMPORT_APPROVAL_SHA256):await rollback(c,input,process.env.DEV_IMPORT_APPROVAL_SHA256);if(!outFile)fail('PRIVATE_OUTPUT_PATH_REQUIRED');fs.writeFileSync(outFile,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({mode,output_written:true}));}finally{await c.end();}
})().catch(e=>{const code=/^[A-Z0-9_]+$/.test(e.message??'')?e.message:/^[A-Z0-9]{5}$/.test(e.code??'')?e.code:'UNEXPECTED_FAILURE';console.error('DEV_IMPORT_STOPPED: '+code);process.exitCode=1;});
