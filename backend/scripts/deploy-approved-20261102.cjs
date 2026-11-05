// Operator runner: explicit single-stage execution; no seed/Auth/runtime flag writes.
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');
const {projectConnectionKind,PROJECT}=require('./project-connection.cjs');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'docs/deployment-6.3.1/execution-20261102');
const privateDir='D:/JolliShift-private/minimal-backup';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const bundlePath=path.join(root,'docs/deployment-6.3.1/deployment-bundle.json');
const bundle=read(bundlePath),expected='80010867af3ec434e5d159b598c08bb05552d0a7f74d43945fb71fb0a4893d8a';
const quote=s=>'"'+s.replaceAll('"','""')+'"';
function verify(){
 if(hash(fs.readFileSync(bundlePath))!==expected||bundle.project_ref!==PROJECT)throw Error('BUNDLE_MISMATCH');
 for(const f of bundle.files)if(hash(fs.readFileSync(path.join(root,f.file)))!==f.sha256)throw Error('FILE_CHECKSUM_MISMATCH: '+f.file);
 const backup=path.join(privateDir,'backup-ready-20261102'),receipt=read(path.join(backup,'receipt.json'));
 const archive=fs.readFileSync(path.join(backup,'jollishift-public-auth.dump'));
 if(receipt.project_ref!==PROJECT||!receipt.backup_checked||archive.length!==340433||hash(archive)!=='6a4d9511784339108ad303af140854d2a524fe366a73dacf363b8ef813b8e919')throw Error('BACKUP_MISMATCH');
}
async function fingerprint(client,t){
 const projection=t.columns.map(c=>'t.'+quote(c)).join(',');
 const r=await client.query(`SELECT count(*)::integer count,md5(coalesce(string_agg(image,E'\\n' ORDER BY image),'')) checksum FROM (SELECT row_to_json(x)::text image FROM (SELECT ${projection} FROM ${quote(t.schema)}.${quote(t.name)} t) x) a`);
 return r.rows[0];
}
async function readonly(client,fn){await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');try{await client.query("SET LOCAL timezone='UTC'");const r=await fn();await client.query('COMMIT');return r;}catch(e){await client.query('ROLLBACK');throw e;}}
async function facts(client){const results=await client.query(fs.readFileSync(path.join(root,'docs/deployment-6.3.1/post-migration-facts.sql'),'utf8'));return results.filter(r=>r.fields?.length).map(r=>r.rows);}
function save(name,data){fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,name),JSON.stringify(data,null,2)+'\n');}
async function checkData(client,baseline){return readonly(client,async()=>{const results=[];for(const t of baseline.tables){const now=await fingerprint(client,t);if(now.count!==t.count||now.checksum!==t.checksum)throw Error('EXISTING_DATA_CHANGED: '+t.schema+'.'+t.name);results.push({table:t.schema+'.'+t.name,...now});}return results;});}
async function main(){
 verify();const config=read(path.join(privateDir,'deployment-connection.json'));const kind=projectConnectionKind(config);
 const {Client}=require('D:/JolliShift-private/tv3-postgres-tools/node-client/node_modules/pg');const client=new Client(config);await client.connect();
 try{
 const identity=(await client.query("SELECT current_user,current_setting('server_version') server_version")).rows[0];
 if(identity.current_user!=='postgres'||!identity.server_version.startsWith('17.'))throw Error('SERVER_IDENTITY_MISMATCH');
 const command=process.argv[2];
 if(command==='preflight'){
  if(fs.existsSync(path.join(out,'baseline.json')))throw Error('BASELINE_ALREADY_EXISTS');
  const tables=await readonly(client,async()=>{
   const list=(await client.query("SELECT n.nspname schema,c.relname name,array_agg(a.attname::text ORDER BY a.attnum) columns FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped WHERE c.relkind='r' AND (n.nspname='public' OR n.nspname='auth' AND c.relname IN('users','identities')) GROUP BY n.nspname,c.relname ORDER BY 1,2")).rows;
   for(const t of list)Object.assign(t,await fingerprint(client,t));return list;
  });
  const f=await facts(client);if(f[1].some(x=>x.present&&x.check_name!=='M6_budget_kept'))throw Error('UNEXPECTED_MIGRATION_STATE');
  save('baseline.json',{project_ref:PROJECT,connection_kind:kind,identity,bundle_sha256:expected,approved_by:'Owner explicit approval in current conversation: seven migrations only',captured_at:new Date().toISOString(),tables});save('preflight.json',f);
  console.log(JSON.stringify({status:'PREFLIGHT_PASS',project_ref:PROJECT,connection_kind:kind,backup_verified:true,bundle_files_verified:bundle.files.length,tables_fingerprinted:tables.length,restore_tested:false}));return;
 }
 const baseline=read(path.join(out,'baseline.json'));await checkData(client,baseline);
 if(command==='final'){
  const results=await client.query(fs.readFileSync(path.join(root,'docs/deployment-6.1/03-post-migration.sql'),'utf8'));
  const sets=results.filter(r=>r.fields?.length).map(r=>r.rows);save('postflight-acl.json',sets);
  if(sets[0].length!==54||sets[0].some(r=>r.gate!=='PASS'))throw Error('FINAL_ACL_FAILURE');
  const f=await facts(client);save('postflight-facts.json',f);if(f[1].some(r=>!r.present))throw Error('FINAL_FACT_FAILURE');
  if(f[3].length!==3||f[3].some(r=>r.can_select||r.can_insert||r.can_update||r.can_delete||!r.relrowsecurity))throw Error('REGISTRY_ACL_FAILURE');
  if(sets[3].length!==4||sets[3].some(r=>!r.indisvalid||!r.indisunique))throw Error('INDEX_FAILURE');
  const data=await checkData(client,baseline);save('final.json',{status:'PASS',project_ref:PROJECT,completed_at:new Date().toISOString(),acl_checks:54,facts:f[1],existing_data_unchanged:data,import_performed:false,auth_created:false,persistence_enabled:false,restore_tested:false});console.log(JSON.stringify({status:'FINAL_PASS',acl_checks:54,tables_unchanged:data.length}));return;
 }
 const stage=Number(command);if(!Number.isInteger(stage)||stage<0||stage>6)throw Error('INVALID_STAGE');
 if(fs.existsSync(path.join(out,'stage-'+stage+'.json')))throw Error('STAGE_RECEIPT_EXISTS_NO_REPLAY');
 if(stage>0&&!read(path.join(out,'stage-'+(stage-1)+'.json')).passed)throw Error('PREVIOUS_STAGE_NOT_PASS');
 const filename=bundle.migration_order[stage],sql=fs.readFileSync(path.join(root,'backend/migrations',filename),'utf8');
 const started=Date.now();await client.query(sql);
 const f=await facts(client);save('stage-'+stage+'-facts.json',f);
 const gates=[['TV4_BASE_published_by'],['M1_source_v2'],['M2_workflow','M2_approval_trigger'],['M3_employee_read'],['M4_mutate','M4_current_index','M4_open_request_index','M4_successor_index'],['M5_registry','M5_row_source'],['M6_materialized_source','M6_budget_kept']];
 for(let s=0;s<=stage;s++)for(const gate of gates[s])if(!f[1].some(r=>r.check_name===gate&&r.present))throw Error('POSTFLIGHT_GATE_FAILED: '+gate);
 const data=await checkData(client,baseline);const receipt={stage,file:filename,passed:true,committed:true,elapsed_ms:Date.now()-started,bundle_sha256:expected,completed_at:new Date().toISOString(),data_tables_unchanged:data.length};save('stage-'+stage+'.json',receipt);console.log(JSON.stringify(receipt));
 }finally{await client.end();}
}
main().catch(e=>{console.error(JSON.stringify({status:'STOP',code:e.code??null,message:e.message}));process.exitCode=1;});

