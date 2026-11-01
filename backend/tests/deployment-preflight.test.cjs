const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),dir=path.join(root,'docs/deployment-6.1');
test('6.1 SQL scripts are read-only and do not invoke application RPCs',()=>{
 for(const file of ['01-catalog-preflight.sql','02-data-preflight.sql','03-post-migration.sql']){
  const source=fs.readFileSync(path.join(dir,file),'utf8').replace(/--[^\n]*/g,'');
  assert.match(source,/BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;/);
  assert.doesNotMatch(source,/\b(?:INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM|TRUNCATE|ALTER\s+TABLE|CREATE\s+(?:TABLE|FUNCTION)|DROP\s+|COPY\s+|CALL\s+)/i);
  assert.doesNotMatch(source,/(?:SELECT|FROM)\s+(?:public\.)?(?:persist_schedule_draft|generate_schedule_draft|tv4_transition_schedule_v2|tv5_mutate|save_employee_registration|run_registration_automation)\s*\(/i);
 }
});
test('6.1 full migration rehearsal and read-only SQL on disposable PostgreSQL',{skip:process.env.REGISTRATION_USE_NATIVE!=='true'?'Requires isolated native PostgreSQL, never a Supabase URL':false},async()=>{
 const h=await require('./helpers/native-tv3-harness.cjs').nativeHarness();
 try{
  const f=await h.fixture();
  const input=(await h.call(h.admin,f)).input;
  const plan=require('../dist/services/scheduling.engine.js').generateSchedule(input);
  await h.call(h.admin,f,{snapshot:input,result:plan,request:h.id(9000),fingerprint:'a'.repeat(64)});
  const tables=['users','employees','registration_periods','registration_submissions','shift_registrations','staffing_requirements','schedules','shift_assignments','schedule_approvals','shift_change_requests','incidents','replacement_invitations','audit_logs','registration_schedule_config','registration_automation_config'];
  const columns={};
  for(const table of tables)columns[table]=(await h.admin.query("SELECT attname FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum",['public.'+table])).rows.map(r=>r.attname);
  const quote=s=>{assert.match(s,/^[a-z_]+$/);return '"'+s+'"';};
  const capture=async()=>{const image={};for(const table of tables){const rows=(await h.admin.query(`SELECT ${columns[table].map(quote).join(',')} FROM public.${quote(table)}`)).rows;image[table]=rows.map(r=>JSON.stringify(r)).sort();}return image;};
  const before=await capture();
  const catalog=await h.admin.query(fs.readFileSync(path.join(dir,'01-catalog-preflight.sql'),'utf8'));
  const oldGuards=catalog.flatMap(r=>r.rows??[]).filter(r=>r.gate);assert.equal(oldGuards.length,3);assert.ok(oldGuards.every(r=>r.gate==='BODY_MATCH_CHECK_ACL'));
  await h.admin.query(fs.readFileSync(path.join(dir,'02-data-preflight.sql'),'utf8'));
  const order=['20261029_tv4_schedule_workflow.sql','20261101_tv3_rule_contract_v2.sql','20261102_tv4_workflow_v2.sql','20261103_employee_schedule_read.sql','20261104_tv5_shift_replacement.sql'];
  const migrations=[];
  for(const file of order){const sql=fs.readFileSync(path.join(root,'backend/migrations',file),'utf8');await h.admin.query(sql);migrations.push({file,sha256:crypto.createHash('sha256').update(sql).digest('hex'),applied_locally:true});}
  assert.deepEqual(await capture(),before,'all pre-existing columns and rows must remain unchanged during schema rollout');
  await h.admin.query(fs.readFileSync(path.join(dir,'02-data-preflight.sql'),'utf8'));
  const post=await h.admin.query(fs.readFileSync(path.join(dir,'03-post-migration.sql'),'utf8'));
  const checks=post.flatMap(r=>r.rows??[]).filter(r=>r.gate);assert.equal(checks.length,54);assert.ok(checks.every(r=>r.gate==='PASS'),JSON.stringify(checks.filter(r=>r.gate!=='PASS')));
  // A migration file cannot silently reapply over the new contract.
  await assert.rejects(h.admin.query(fs.readFileSync(path.join(root,'backend/migrations/20261101_tv3_rule_contract_v2.sql'),'utf8')),/Unknown TV3 function/);await h.admin.query('ROLLBACK');
  // Demonstrate that the transaction used by exported SQL refuses a write.
  await h.admin.query('BEGIN READ ONLY');await assert.rejects(h.admin.query("UPDATE users SET username=username"),e=>e.code==='25006');await h.admin.query('ROLLBACK');
  const functions=(await h.admin.query("SELECT p.oid::regprocedure::text signature,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.proconfig,md5(regexp_replace(replace(p.prosrc,chr(13),''),'\\s+',' ','g')) body_md5 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname ~ '^(tv[345]_|employee_schedule_week$)' OR p.proname IN ('persist_schedule_draft','generate_schedule_draft','validate_schedule_approval')) ORDER BY signature")).rows;
  const report={scope:'DISPOSABLE_LOOPBACK_POSTGRESQL_ONLY',generated_at:new Date().toISOString(),fixture:'one synthetic NV + QL, VALID registration and legacy v1 DRAFT',migrations,
   post_functions:functions,read_only_scripts:['01-catalog-preflight.sql','02-data-preflight.sql','03-post-migration.sql'].map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,file))).digest('hex')})),
   pre_existing_tables_unchanged:tables,post_acl_checks:checks.length,all_pass:true,read_only_transaction_enforced:true,
   supabase_contacted:false,dev_import_ready:false,shared_apply_authorized:false};
  fs.writeFileSync(path.join(dir,'local-rehearsal.json'),JSON.stringify(report,null,2)+'\n');
 }finally{await h.close();}
});
