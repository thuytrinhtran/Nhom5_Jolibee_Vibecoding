// SELECT-only import verifier. Does not apply or roll back data.
const fs=require('node:fs'),path=require('node:path');
const {Client}=require('D:/JolliShift-private/tv3-postgres-tools/node-client/node_modules/pg');
const executor=require('./dev-import-executor.cjs');
const {projectConnectionKind}=require('./project-connection.cjs');
const privateDir='D:/JolliShift-private/minimal-backup';
const plan=JSON.parse(fs.readFileSync(path.join(privateDir,'fresh-A-plan-20261103.json')));
const approved='b9dcd9fbb121b39816458ae6ef82d28c84c5b93fb12c4e82dd5830a029850979';
const dir=path.resolve(__dirname,'../../docs/deployment-6.3.1/import-A-execution-20261103');
const q=s=>'"'+s.replaceAll('"','""')+'"';
const ensure=(ok,message)=>{if(!ok)throw Error(message);};
function save(name,data){fs.mkdirSync(dir,{recursive:true});if(name==='after.json'&&fs.existsSync(path.join(dir,name)))name='after-recheck-'+Date.now()+'.json';fs.writeFileSync(path.join(dir,name),JSON.stringify(data,null,2)+'\n',{flag:'wx'});}
async function images(c,table,where,params){return(await c.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') v FROM public.${q(table)} t WHERE ${where}`,params)).rows[0].v;}
async function fingerprints(c){
 const tables=(await c.query("SELECT n.nspname schema,c.relname name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND (n.nspname='public' OR n.nspname='auth' AND c.relname IN('users','identities')) ORDER BY 1,2")).rows;
 for(const t of tables)t.row_hashes=(await c.query(`SELECT md5(to_jsonb(t)::text) h FROM ${q(t.schema)}.${q(t.name)} t ORDER BY 1`)).rows.map(r=>r.h);
 return tables;
}
async function main(){
 ensure(executor.seal(plan)===approved&&plan.plan_sha256===approved,'PLAN_MISMATCH');
 ensure(plan.payload.profiles.length===0&&plan.payload.employees.length===0&&plan.payload.headers.length===51&&plan.payload.registrations.length===640,'PAYLOAD_MISMATCH');
 const config=JSON.parse(fs.readFileSync(path.join(privateDir,'deployment-connection.json')));projectConnectionKind(config);
 const c=new Client(config);await c.connect();
 try{
 const mode=process.argv[2];
 if(mode==='before'){
  const fresh=await executor.prepare(c,JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../docs/demo-datasets/1793634151022/existing-employees-seed.json'))),'development');
  ensure(fresh.plan_sha256===approved&&fresh.baseline_sha256===plan.baseline_sha256,'FRESH_BASELINE_MISMATCH');
 }
 await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await c.query("SET LOCAL timezone='UTC'");
 const tables=await fingerprints(c);
 if(mode==='before'){
  save('before.json',{captured_at:new Date().toISOString(),project_ref:plan.project_ref,plan_sha256:approved,baseline_sha256:plan.baseline_sha256,tables});
  await c.query('COMMIT');
  console.log(JSON.stringify({stage:'BEFORE_PASS',tables:tables.length,digest:approved}));return;
 }
 ensure(mode==='after','INVALID_MODE');
 const before=JSON.parse(fs.readFileSync(path.join(dir,'before.json')));
 const expectedDeltas={'public.registration_submissions':51,'public.shift_registrations':640,'public.audit_logs':2,'public.dev_import_batches':1};
 for(const t of before.tables){const current=tables.find(x=>x.schema===t.schema&&x.name===t.name);ensure(current,'TABLE_MISSING');const remaining=[...current.row_hashes];for(const h of t.row_hashes){const i=remaining.indexOf(h);ensure(i>=0,'ORIGINAL_DATA_CHANGED_'+t.schema+'_'+t.name);remaining.splice(i,1);}ensure(remaining.length===(expectedDeltas[t.schema+'.'+t.name]??0),'UNEXPECTED_ROW_DELTA_'+t.schema+'_'+t.name);}
 const stored=(await c.query('SELECT * FROM public.dev_import_batches WHERE batch_id=$1',[plan.batch_id])).rows[0];
 ensure(stored&&stored.enabled&&stored.manifest.plan_sha256===approved,'REGISTRY_MISMATCH');
 const manifest=stored.manifest;
 const receipt=(await c.query("SELECT new_data FROM public.audit_logs WHERE id=$1 AND entity_type='dev_import_batch' AND entity_id=$2 AND action='DEV_IMPORT_RECEIPT'",[manifest.receipt_id,plan.batch_id])).rows[0];
 ensure(receipt&&executor.hash(receipt.new_data.manifest)===executor.hash(manifest),'RECEIPT_MISMATCH');
 const actual={employees:await images(c,'employees','id=ANY($1::uuid[])',[[]]),registration_submissions:await images(c,'registration_submissions','period_id=$1 AND employee_id=ANY($2::uuid[])',[plan.period_id,plan.payload.headers.map(h=>h.employee_id)]),shift_registrations:await images(c,'shift_registrations','id=ANY($1::uuid[])',[plan.payload.registrations.map(r=>r.id)])};
 ensure(executor.hash(actual)===executor.hash(manifest.after_images)&&receipt.new_data.after_image_sha256===executor.hash(actual),'AFTER_IMAGE_MISMATCH');
 ensure(actual.registration_submissions.length===51&&actual.shift_registrations.length===640,'OWNED_COUNTS_MISMATCH');
 ensure(actual.registration_submissions.every(h=>h.sample_batch_id===plan.batch_id&&h.status==='VALID'),'HEADER_PROVENANCE_INVALID');
 for(const r of actual.shift_registrations){const p=plan.payload.registrations.find(p=>p.id===r.id);ensure(p&&r.status==='VALID'&&['period_id','employee_id','work_date','shift_id'].every(k=>p[k]===r[k]),'ROW_PAYLOAD_MISMATCH');}
 const real=(await c.query('SELECT to_jsonb(t) row FROM public.shift_registrations t WHERE period_id=$1 AND NOT(id=ANY($2::uuid[])) ORDER BY id',[plan.period_id,plan.payload.registrations.map(r=>r.id)])).rows.map(r=>r.row);
 const realHash=require('node:crypto').createHash('sha256').update(JSON.stringify(real)).digest('hex');
 ensure(realHash==='421243c8c29a18866485093a2adbceb9b7837ac5b2f29a80ae789d3cbea82ea0','REAL_ROWS_MISMATCH');
 const counts=(await c.query("SELECT (SELECT count(*)::int FROM employees WHERE branch_id=$1) employees,(SELECT count(*)::int FROM registration_submissions WHERE period_id=$2) headers,(SELECT count(*)::int FROM shift_registrations WHERE period_id=$2) registrations,(SELECT count(*)::int FROM staffing_requirements WHERE branch_id=$1 AND work_date BETWEEN '2026-11-02' AND '2026-11-08') demand_cells,(SELECT sum(required_count)::int FROM staffing_requirements WHERE branch_id=$1 AND work_date BETWEEN '2026-11-02' AND '2026-11-08') demand_positions,(SELECT count(*)::int FROM schedules WHERE period_id=$2) schedules",[plan.branch_id,plan.period_id])).rows[0];
 ensure(counts.employees===60&&counts.headers===53&&counts.registrations===656&&counts.demand_cells===63&&counts.demand_positions===308&&counts.schedules===0,'FINAL_COUNTS_MISMATCH');
 const ordinary=(await c.query('SELECT tv3_scheduling_input($1) v',[plan.period_id])).rows[0].v.registrations.length;ensure(ordinary===16,'DEFAULT_SOURCE_CHANGED');
 await c.query("SELECT set_config('request.headers',$1,true)",[JSON.stringify({'x-jollishift-dev-import':`${plan.environment}/${plan.project_ref}/${plan.batch_id}`})]);
 const scoped=(await c.query('SELECT tv3_scheduling_input($1) v',[plan.period_id])).rows[0].v.registrations.length;ensure(scoped===656,'SCOPED_SOURCE_MISMATCH');
 const fks=(await c.query("SELECT child_ns.nspname child_schema,child.relname child_table,pa.relname parent_table,array_agg(ca.attname::text ORDER BY x.n) child_columns,array_agg(aa.attname::text ORDER BY x.n) parent_columns FROM pg_constraint k JOIN pg_class child ON child.oid=k.conrelid JOIN pg_namespace child_ns ON child_ns.oid=child.relnamespace JOIN pg_class pa ON pa.oid=k.confrelid CROSS JOIN LATERAL unnest(k.conkey,k.confkey) WITH ORDINALITY x(c,a,n) JOIN pg_attribute ca ON ca.attrelid=child.oid AND ca.attnum=x.c JOIN pg_attribute aa ON aa.attrelid=pa.oid AND aa.attnum=x.a WHERE k.contype='f' AND k.confrelid IN ('employees'::regclass,'registration_submissions'::regclass,'shift_registrations'::regclass) GROUP BY k.oid,child_ns.nspname,child.relname,pa.relname")).rows;
 for(const fk of fks){const condition=fk.child_columns.map((col,i)=>`to_jsonb(c)->>$${i+2}=o->>$${i+2+fk.child_columns.length}`).join(' AND ');const matches=(await c.query(`SELECT to_jsonb(c) v FROM ${q(fk.child_schema)}.${q(fk.child_table)} c WHERE EXISTS(SELECT 1 FROM jsonb_array_elements($1::jsonb) o WHERE ${condition})`,[JSON.stringify(actual[fk.parent_table]),...fk.child_columns,...fk.parent_columns])).rows;for(const {v} of matches)ensure(fk.child_schema==='public'&&(actual[fk.child_table]??[]).some(own=>executor.hash(own)===executor.hash(v)),'ROLLBACK_DEPENDENT_DATA_EXISTS');}
 await c.query('COMMIT');
 const report={status:'PASS',checked_at:new Date().toISOString(),project_ref:plan.project_ref,batch_id:plan.batch_id,plan_sha256:approved,counts,original_tables_preserved:tables.length,real_rows_preserved:16,real_rows_sha256:realHash,owned_headers:51,owned_registrations:640,ordinary_source_rows:ordinary,scoped_source_rows:scoped,receipt_verified:true,after_images_verified:true,after_image_sha256:executor.hash(actual),rollback:{eligible_at_check:true,foreign_keys_checked:fks.length,schedules:0,executed:false,will_recheck_under_locks:true},new_auth:0,new_employees:0,schedule_created:false,persistence_enabled:false};save('after.json',report);console.log(JSON.stringify(report));
 }finally{await c.end();}
}
main().catch(e=>{console.error(JSON.stringify({status:'STOP',code:e.code??null,message:/^[A-Z0-9_]+$/.test(e.message??'')?e.message:'VERIFICATION_FAILED_NO_SECRETS_LOGGED'}));process.exitCode=1;});
