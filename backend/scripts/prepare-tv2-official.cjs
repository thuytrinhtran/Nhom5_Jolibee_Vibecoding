// Local generation only: never connects to Supabase or executes SQL.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const digest=(s,algorithm='sha256')=>crypto.createHash(algorithm).update(s).digest('hex');
const sources=['backend/migrations/20261029_employee_registration.sql','backend/migrations/20261029_registration_off_schedule.sql'];
function saveFunction(){
 const source=fs.readFileSync(path.join(root,sources[0]),'utf8').replace(/\r\n/g,'\n');
 const start=source.indexOf('CREATE FUNCTION public.save_employee_registration(');
 const end=source.indexOf('-- Confirmed Design appendix:',start);
 if(start<0||end<0)throw Error('M1 save RPC boundaries changed; review before generating.');
 const old=source.slice(start,end).trim();
 const replacement='submitted_at=excluded.submitted_at,updated_at=excluded.updated_at,sample_batch_id=NULL;';
 const newSql=old.replace('CREATE FUNCTION public.save_employee_registration(','CREATE OR REPLACE FUNCTION public.save_employee_registration(')
  .replace('submitted_at=excluded.submitted_at,updated_at=excluded.updated_at;',replacement);
 if(!newSql.includes(replacement))throw Error('M1 header upsert changed; review sample provenance integration.');
 const body=s=>{const match=/AS \$\$([\s\S]*?)\$\$;/.exec(s);if(!match)throw Error('Missing RPC body');return match[1].trim();};
 return {sql:newSql,knownBodyMd5:[...new Set([digest(body(old),'md5'),digest(body(newSql),'md5')])]};
}
function buildOfficialBundle(output=path.join(root,'docs/tv2-release/official')){
 const rpc=saveFunction();
 const guard=`DO $rpc_guard$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='save_employee_registration' AND p.oid IS DISTINCT FROM to_regprocedure('public.save_employee_registration(uuid,uuid,jsonb,boolean)')) THEN RAISE EXCEPTION 'Unknown RPC overload: review catalog; do not replace it automatically.'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.save_employee_registration(uuid,uuid,jsonb,boolean)') AND
  (pg_get_userbyid(p.proowner) NOT IN ('postgres','supabase_admin') OR p.proargnames IS DISTINCT FROM ARRAY['p_user','p_period','p_preferences','p_submit']::text[] OR
   md5(btrim(replace(p.prosrc,chr(13),''),chr(10)||chr(9)||' ')) NOT IN (${rpc.knownBodyMd5.map(v=>`'${v}'`).join(',')}))) THEN
  RAISE EXCEPTION 'Existing RPC body differs from reviewed M1/v3, or owner/signature is unexpected. Provide pg_get_functiondef for review; no replacement applied.';
 END IF;
END $rpc_guard$;`;
 const templateFile='backend/scripts/tv2-official.sql.template';
 const template=fs.readFileSync(path.join(root,templateFile),'utf8').replace(/\r\n/g,'\n');
 const sql=template.replace('-- @SAVE_RPC_GUARD@',()=>guard).replace('-- @SAVE_RPC@',()=>rpc.sql);
 const manifest={project_ref:'wlbpprpiieonjrqglicv',revision:'tv2-official-shared-compatible-v3',status:'PREPARED_NOT_EXECUTED_CATALOG_REVIEW_AND_TEAM_APPROVAL_REQUIRED',transaction:'incremental_atomic_replay_safe',
  sources:[...sources,templateFile].map(file=>({file,sha256:digest(fs.readFileSync(path.join(root,file)))})),
  artifact:{file:'01_apply_tv2.sql',sha256:digest(sql)},known_save_rpc_body_md5:rpc.knownBodyMd5,
  schedule:{timezone:'Asia/Ho_Chi_Minh',open_iso_day:4,open_local_time:'15:00',close_iso_day:7,close_local_time:'12:00',work_week:'next_Monday_through_Sunday_at_execution'},
  data_policy:'Discover active branches; reuse compatible shifts/periods; insert only missing rows. Repair Friday PLANNED periods only when empty, keeping IDs. No Auth/employee writes.',
  sample_provenance:'registration_submissions.sample_batch_id -> audit_logs.id; NULL means self-service; genuine save clears sample provenance.',
  automation:{install:false,enable:false,cron:false,reminders:false}};
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'01_apply_tv2.sql'),sql,'utf8');
 fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 return{sql,manifest};
}
if(require.main===module){buildOfficialBundle();console.log('Prepared incremental official SQL locally. No SQL executed; catalog review and approval are still required.');}
module.exports={buildOfficialBundle,saveFunction};
