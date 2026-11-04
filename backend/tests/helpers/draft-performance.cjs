// Only called with a nativeHarness disposable client; no connection URL input.
const fs=require('node:fs'),path=require('node:path'),{performance}=require('node:perf_hooks');
const signature='public.persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text)';
function instrument(def){
 let f=def.replace('DECLARE p public.registration_periods;',`DECLARE __prof_start timestamptz:=clock_timestamp(); __prof_insert_start timestamptz; __prof_insert_ms numeric:=0; p public.registration_periods;`);
 const stamp=label=>`\n RAISE NOTICE 'DRAFT_PROFILE:${label}:%', extract(epoch FROM (clock_timestamp()-__prof_start))*1000;\n`;
 for(const [anchor,label] of [
  ['  IF p_request_id IS NOT NULL THEN','authorization_and_locks'],
  ['  current_input:=public.tv3_scheduling_input(p.id);','source_start'],
  ["  IF (current_input->'period'->>'branch_id')::uuid",'source_complete'],
  ['  FOR item IN SELECT value FROM jsonb_array_elements', 'snapshot_validation_and_schedule_insert'],
  ['  verified_result:=public.tv3_result_v2','assignment_validation_and_inserts'],
  ['  INSERT INTO public.audit_logs(actor_id','metrics_and_response_preparation'],
  ["  RETURN jsonb_build_object('reused',false",'audit_complete'],
 ]){if(!f.includes(anchor))throw Error('PROFILE_ANCHOR_MISSING_'+label);f=f.replace(anchor,stamp(label)+anchor);}
 f=f.replace('    INSERT INTO public.shift_assignments(', '    __prof_insert_start:=clock_timestamp();\n    INSERT INTO public.shift_assignments(');
 const after="VALUES(saved.id,emp.id,need.work_date,shift_row.id,emp.department_id,p.branch_id,'DRAFT','REGULAR');";
 if(!f.includes(after))throw Error('PROFILE_INSERT_ANCHOR_MISSING');
 f=f.replace(after,after+'\n __prof_insert_ms:=__prof_insert_ms+extract(epoch FROM (clock_timestamp()-__prof_insert_start))*1000;');
 f=f.replace(stamp('assignment_validation_and_inserts'),"\n RAISE NOTICE 'DRAFT_PROFILE:assignment_insert_subset:%', __prof_insert_ms;"+stamp('assignment_validation_and_inserts'));
 return f;
}
async function profileDraft({h,root,period,actor,source,result,request}){
 if(h.admin.connectionParameters.host!=='127.0.0.1')throw Error('ISOLATED_PROFILE_ONLY');
 const q=(sql,params=[])=>h.admin.query(sql,params),dir=path.join(root,'docs/deployment-6.3.1/performance');fs.mkdirSync(dir,{recursive:true});
 const report={scope:'ISOLATED_POSTGRESQL_ONLY',captured_at:new Date().toISOString(),supabase_contacted:false,budget_ms:3000,assignment_count:result.assignments.length,samples:[],limitations:['Local direct PostgreSQL transport; browser rendering, external JWT verification and Supabase gateway latency not measured.','Instrumented cumulative SQL checkpoints are diagnostic; acceptance samples use uninstrumented RPC.','Transactions rolled back per sample; no committed schedule retained.']};
 const started=performance.now();const normalized=JSON.parse(JSON.stringify({source,result}));report.payload_normalization_ms=performance.now()-started;
 const args=[period,actor,JSON.stringify(normalized.source),JSON.stringify(normalized.result),request,'b'.repeat(64)];
 report.payload_serialization_ms=performance.now()-started-report.payload_normalization_ms;
 const {canonicalInput,serverVerifiedPlan}=require('../../dist/services/draft-persistence.service.js');
 let js=performance.now();canonicalInput(source);report.canonical_input_ms=performance.now()-js;
 js=performance.now();serverVerifiedPlan(source,result.assignments);report.server_verified_plan_ms=performance.now()-js;
 const sql='SELECT persist_schedule_draft($1,$2,$3::jsonb,$4::jsonb,NULL,NULL,$5,$6) r';
 const stages={};let active;
 const notice=n=>{const m=n.message?.match(/^DRAFT_PROFILE:([^:]+):([\d.]+)/);if(m&&active)active[m[1]]=Number(m[2]);};h.admin.on('notice',notice);
 const definition=async()=>(await q('SELECT pg_get_functiondef($1::regprocedure) d',[signature])).rows[0].d;
 async function sample(phase,instrumented){
  active={};const t=performance.now();await q('BEGIN');const transaction_begin_ms=performance.now()-t;let saved,error,rpc_ms,decode_ms,rollback_ms;
  try{const rpc=performance.now();try{const response=await q(sql,args);rpc_ms=performance.now()-rpc;const d=performance.now();saved=response.rows[0].r;JSON.stringify(saved);decode_ms=performance.now()-d;}catch(e){rpc_ms=performance.now()-rpc;error={code:e.code,message:e.message};}}
  finally{const r=performance.now();await q('ROLLBACK');rollback_ms=performance.now()-r;}
  const row={phase,instrumented,transaction_begin_ms,rpc_ms,response_reserialization_ms:decode_ms??null,rollback_ms,total_ms:performance.now()-t,pass:!error,error,stages:instrumented?active:undefined};
  if(saved&&saved.result.assignments.length!==308)throw Error('PROFILE_COVERAGE_CHANGED');
  report.samples.push(row);active=null;return row;
 }
 async function explain(label){
  const t=performance.now();const plan=await q('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT public.tv3_scheduling_input($1)',[period]);
  report[label+'_source_explain']={elapsed_ms:performance.now()-t,plan:plan.rows[0]['QUERY PLAN']};
 }
 try{
  await q("SET track_functions='all'");await q('SELECT pg_stat_reset()');
  const original=await definition();await q(instrument(original));await sample('before',true);await q(original);
  await explain('before');await q('SELECT pg_stat_force_next_flush()');await q('SELECT pg_stat_clear_snapshot()');
  report.before_function_stats=(await q("SELECT funcname,calls,total_time,self_time FROM pg_stat_user_functions WHERE schemaname='public' ORDER BY total_time DESC")).rows;
  for(let i=0;i<3;i++)await sample('before',false);
  await q(fs.readFileSync(path.join(root,'backend/migrations/20261106_dev_import_source_materialization.sql'),'utf8'));
  require('node:assert/strict').equal(await definition(),original,'persist RPC definition must remain unchanged');
  report.function_contracts=(await q("SELECT p.oid::regprocedure::text signature,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.proconfig,p.proacl,md5(regexp_replace(replace(p.prosrc,chr(13),''),'\\s+',' ','g')) body_md5 FROM pg_proc p WHERE p.oid IN ('public.tv3_scheduling_input(uuid)'::regprocedure,'public.persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text)'::regprocedure,'public.dev_import_utc_image(anyelement)'::regprocedure) ORDER BY signature")).rows;
  const after=(await q('SELECT tv3_scheduling_input($1) v',[period])).rows[0].v;
  require('node:assert/strict').deepEqual(after,source,'materialization must preserve exact SQL input');
  const migratedBody=(await q("SELECT prosrc FROM pg_proc WHERE oid='public.tv3_scheduling_input(uuid)'::regprocedure")).rows[0].prosrc;
  let cte=migratedBody.slice(migratedBody.indexOf('WITH approved_batches'),migratedBody.indexOf('SELECT jsonb_build_object('));
  cte=cte.replaceAll('p.work_start_date','$3::date').replaceAll('p.work_end_date','$4::date').replaceAll('p.branch_id','$2::uuid').replaceAll('p.id','$1::uuid');
  report.materialized_rows_explain=(await q('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+cte+' SELECT count(*) FROM approved_rows',[period,source.period.branch_id,source.period.work_start_date,source.period.work_end_date])).rows[0]['QUERY PLAN'];
  await q('SELECT pg_stat_reset()');await explain('after');await q('SELECT pg_stat_force_next_flush()');await q('SELECT pg_stat_clear_snapshot()');
  report.after_function_stats=(await q("SELECT funcname,calls,total_time,self_time FROM pg_stat_user_functions WHERE schemaname='public' ORDER BY total_time DESC")).rows;
  const optimized=await definition();await q(instrument(optimized));await sample('after',true);await q(optimized);
  for(let i=0;i<10;i++)await sample('after',false);
  for(const phase of ['before','after']){const rows=report.samples.filter(r=>r.phase===phase&&!r.instrumented),times=rows.map(r=>r.rpc_ms).sort((a,b)=>a-b);report[phase]={runs:rows.length,pass:rows.filter(r=>r.pass).length,fail:rows.filter(r=>!r.pass).length,median_ms:times.length%2?times[(times.length-1)/2]:(times[times.length/2-1]+times[times.length/2])/2,p95_ms:times[Math.ceil(times.length*.95)-1],min_ms:times[0],max_ms:times.at(-1)};}
 }finally{h.admin.removeListener('notice',notice);fs.writeFileSync(path.join(dir,'draft-profile.json'),JSON.stringify(report,null,2)+'\n');}
 if(report.after.fail||report.after.p95_ms>=3000)throw Error('DRAFT_PERFORMANCE_ACCEPTANCE_FAILED');
 return report;
}
module.exports={profileDraft,instrument};
