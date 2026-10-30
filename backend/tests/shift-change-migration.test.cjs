const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path');
const sql=fs.readFileSync(path.join(__dirname,'../migrations/20261030_shift_change_workflow.sql'),'utf8');
const scheduler=fs.readFileSync(path.join(__dirname,'../migrations/20261031_shift_change_alert_scheduler.sql'),'utf8');
function section(name){const marker='CREATE FUNCTION public.'+name;const start=sql.indexOf(marker);assert.ok(start>=0);const next=sql.indexOf('\nCREATE FUNCTION ',start+marker.length);return sql.slice(start,next<0?sql.length:next);}

test('candidate preflight rejects each missing dependency before RPC creation inside the transaction',()=>{
  const candidates=fs.readFileSync(path.join(__dirname,'../migrations/20261031_shift_change_candidates.sql'),'utf8');
  const preflight=candidates.slice(candidates.indexOf('DO $$ BEGIN'),candidates.indexOf('CREATE FUNCTION public.tv5_shift_change_candidates'));
  const checks=[...preflight.matchAll(/IF ([\s\S]*?) THEN\s+RAISE EXCEPTION '([^']+)';\s+END IF;/g)];
  assert.equal(checks.length,7);
  const functions=['public.tv5_shift_change(text,uuid,jsonb)','public.tv5_assignment_start(date,time without time zone)',
    'public.tv5_schedule_state(uuid)','public.tv5_assignment_current(uuid)','public.tv5_candidate_eligible(uuid,uuid)'];
  for(const [index,signature] of functions.entries()){
    assert.equal(checks[index][1],`to_regprocedure('${signature}') IS NULL`);
    assert.ok(checks[index][2].includes(signature));
  }
  for(const [index,table,column] of [[5,'users','must_change_password'],[6,'shift_change_requests','replacement_assignment_id']]){
    assert.match(checks[index][1],/^NOT EXISTS \(SELECT 1 FROM information_schema\.columns/);
    assert.ok(checks[index][1].includes(`table_schema='public' AND table_name='${table}' AND column_name='${column}'`));
    assert.ok(checks[index][2].includes(`public.${table}.${column}`));
  }
  assert.ok(checks.every(check=>check[2].startsWith('TV5 candidates preflight: missing ')));
  assert.ok(candidates.indexOf('BEGIN;')<candidates.indexOf('DO $$ BEGIN'));
  assert.doesNotMatch(preflight,/EXCEPTION WHEN|COMMIT|ROLLBACK|EXECUTE|PERFORM/);
  assert.match(candidates,/COMMIT;\s*$/);
});

test('candidate RPC is read-only, verifies ownership before disclosure and reuses authoritative eligibility',()=>{
  const candidates=fs.readFileSync(path.join(__dirname,'../migrations/20261031_shift_change_candidates.sql'),'utf8');
  const executable=candidates.replace(/--[^\n]*/g,'');
  assert.doesNotMatch(executable,/\b(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE|CREATE TABLE|ALTER TABLE|cron\.schedule)\b/i);
  assert.match(candidates,/STABLE SECURITY DEFINER SET search_path=pg_catalog/);
  assert.match(candidates,/v_actor\.role IS DISTINCT FROM 'NV'/);
  assert.match(candidates,/v_actor\.must_change_password IS DISTINCT FROM false/);
  assert.match(candidates,/a\.employee_id=v_emp\.id/);
  assert.match(candidates,/s\.branch_id=v_actor\.branch_id AND a\.actual_branch_id=v_actor\.branch_id/);
  assert.ok(candidates.indexOf("RAISE EXCEPTION 'TV5:NOT_FOUND'")<candidates.indexOf('v_state:=public.tv5_schedule_state'));
  assert.match(candidates,/e\.branch_id=v_actor\.branch_id\s+AND public\.tv5_candidate_eligible\(v_assignment\.id,e\.id\)/);
  assert.match(candidates,/jsonb_build_object\('employee_id',e\.id,'full_name',e\.full_name\)/);
  for(const code of ['ALREADY_CHANGED','DUPLICATE_REQUEST','DEADLINE_PASSED','STALE_PUBLISHED_SCHEDULE','AMBIGUOUS_PUBLISHED_SCHEDULE'])assert.ok(candidates.includes('TV5:'+code));
  assert.equal((candidates.match(/clock_timestamp\(\)>=v_deadline/g)||[]).length,2);
  assert.match(candidates,/REVOKE ALL ON FUNCTION public\.tv5_shift_change_candidates\(uuid,uuid\) FROM PUBLIC,anon,authenticated,service_role/);
  assert.match(candidates,/GRANT EXECUTE ON FUNCTION public\.tv5_shift_change_candidates\(uuid,uuid\) TO service_role/);
  assert.match(candidates,/COMMIT;\s*$/);
});
test('RPC row variables are distinct from SQL aliases, which retain their original names',()=>{
  const rpc=section('tv5_shift_change'),declarations=rpc.slice(rpc.indexOf('DECLARE '),rpc.indexOf('\nBEGIN'));
  for(const [name,type] of [['v_assignment','shift_assignments'],['v_schedule','schedules'],['v_shift','shifts'],['v_request','shift_change_requests']])
    assert.match(declarations,new RegExp('\\b'+name+' public\\.'+type+'\\b'));
  assert.doesNotMatch(declarations,/\b(?:a|s|sh|r) public\./);
  const reads=rpc.slice(rpc.indexOf("IF p_action='assignments'"),rpc.indexOf("  IF p_action='create' THEN\n    IF nullif"));
  for(const [table,alias] of [['shift_assignments','a'],['schedules','s'],['shifts','sh'],['shift_change_requests','r']])
    assert.match(reads,new RegExp('(?:FROM|JOIN) public\\.'+table+' '+alias+'\\b'));
  assert.doesNotMatch(reads,/\bv_(?:assignment|schedule|shift|request)\b/);
});
test('mutation branches use renamed rows in INTO, authorization, deadlines, lineage and audit',()=>{
  const rpc=section('tv5_shift_change');
  const writes=rpc.slice(rpc.indexOf("  IF p_action='create' THEN\n    IF nullif"),rpc.indexOf('\n$$;'));
  assert.doesNotMatch(writes,/\b(?:a|s|sh|r)\s*\.|\bINTO\s+(?:STRICT\s+)?(?:a|s|sh|r)\b|to_jsonb\((?:a|s|sh|r)\)/);
  for(const name of ['v_assignment','v_schedule','v_shift','v_request'])assert.match(writes,new RegExp('INTO (?:STRICT )?'+name+'\\b'));
  assert.match(writes,/to_jsonb\(v_request\)/);
  assert.match(writes,/'original_assignment_before',to_jsonb\(v_assignment\)/);
  assert.match(writes,/WHERE q\.id=v_request\.id/);
});
test('all RPC local names avoid source table aliases and foundation column names',()=>{
  const rpc=section('tv5_shift_change'),declarations=rpc.slice(rpc.indexOf('DECLARE '),rpc.indexOf('\nBEGIN'));
  const locals=[...declarations.matchAll(/\b([a-z_]\w*)\s+(?:public\.\w+|uuid|timestamptz|jsonb)\b/g)].map(m=>m[1]);
  assert.equal(locals.length,13);
  const aliases=new Set([...rpc.matchAll(/\b(?:FROM|JOIN) public\.\w+\s+(\w+)/g)].map(m=>m[1].toLowerCase())
    .filter(name=>!['where','set','on','for','order','returning'].includes(name)));
  const foundation=fs.readFileSync(path.join(__dirname,'../../docs/Jollishift.sql'),'utf8');
  const columns=new Set([...foundation.matchAll(/^\s+(\w+)\s+(?:uuid|varchar\s*\(|text\b|boolean\b|date\b|time\b|timestamptz\b|integer\b|numeric\s*\(|jsonb\b)/gm)].map(m=>m[1]));
  for(const name of locals){assert.ok(!aliases.has(name),'Alias collision: '+name);assert.ok(!columns.has(name),'Column collision: '+name);}
  assert.doesNotMatch(rpc,/#variable_conflict\s+(?:use_variable|use_column)/);
});

test('workflow adds module functions/indexes and lineage; no seed, deletion or Cron activation',()=>{
  assert.match(sql,/BEGIN;/);assert.match(sql,/COMMIT;\s*$/);
  assert.doesNotMatch(sql,/\b(?:DROP|TRUNCATE|DELETE FROM|CREATE TABLE|CREATE EXTENSION|cron\.schedule)\b/i);
  assert.match(sql,/WHERE status IN \('PENDING','SEARCHING'\)/);
  assert.match(sql,/FROM PUBLIC,anon,authenticated,service_role/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.tv5_shift_change\(text,uuid,jsonb\) TO service_role/);
  assert.equal((sql.match(/GRANT EXECUTE/g)||[]).length,1);
});
test('eligibility checks overnight overlap, weekly hours, department, branch, user and skills',()=>{
  const body=section('tv5_candidate_eligible');
  for(const pattern of [/e\.department_id=a\.department_id/,/e\.branch_id=s\.branch_id/,/u\.role='NV'/,/NOT u\.must_change_password/,
    /employee_skills/,/required_skill_name/,/end_time<.*start_time/,/interval '1 day'/,/max_weekly_hours/,/greatest\(0/,/x\.status<>'REPLACED'/,/crew_leader_days_off/])assert.match(body,pattern);
  assert.match(section('tv5_assignment_current'),/public\.tv5_schedule_state\(s\.id\)='VALID'/);
  assert.match(section('tv5_assignment_current'),/s\.status='PUBLISHED'/);
});
test('all mutations serialize eligibility inputs; approval requires acceptance and commits assignment/request/audit together',()=>{
  const rpc=section('tv5_shift_change');
  assert.match(rpc,/LOCK TABLE[\s\S]*public\.shift_assignments[\s\S]*IN SHARE ROW EXCLUSIVE MODE/);
  assert.match(rpc,/actor\.must_change_password/);assert.match(rpc,/inv\.target_employee_id<>emp\.id/);
  assert.match(rpc,/v_schedule\.branch_id<>actor\.branch_id/);assert.match(rpc,/v_request\.status NOT IN \('PENDING','SEARCHING'\)/);
  const decision=rpc.slice(rpc.indexOf("ELSIF p_action='decision' THEN"));
  assert.match(decision,/status='ACCEPTED' AND expires_at>clock_timestamp\(\)/);
  assert.match(decision,/tv5_candidate_eligible\(v_assignment\.id,target\)/);
  assert.ok(decision.indexOf("SET status='REPLACED'")<decision.indexOf('INSERT INTO public.shift_assignments'));
  assert.match(decision,/'ACTIVE',v_assignment\.assignment_source,v_assignment\.branch_support_request_id/);
  assert.match(decision,/INSERT INTO public\.audit_logs/);
  const response=rpc.slice(rpc.indexOf("ELSIF p_action='respond' THEN"),rpc.indexOf("ELSIF p_action='refresh' THEN"));
  assert.doesNotMatch(response,/UPDATE public\.shift_assignments|INSERT INTO public\.shift_assignments/);
});
test('both proposal and parallel search invite without auto-approval; decline expands and refresh checks timed alert',()=>{
  const rpc=section('tv5_shift_change'),search=section('tv5_refresh_search');
  assert.match(rpc,/proposed:=\(p_input->>'proposed_employee_id'\)::uuid/);
  assert.match(rpc,/tv5_refresh_search\(v_request\.id,actor\.id,proposed IS NULL\)/);
  assert.match(rpc,/tv5_refresh_search\(v_request\.id,actor\.id,p_input->>'response'='DECLINED'\)/);
  assert.match(search,/SELECT r\.id,e\.id,deadline FROM public\.employees e/);
  assert.doesNotMatch(search,/LIMIT 1/);
  assert.match(search,/status IN \('PENDING','ACCEPTED'\)[\s\S]*least\(expires_at,deadline\)<=clock_timestamp\(\)/);
  assert.match(search,/NO_AVAILABLE_REPLACEMENT/);assert.match(search,/PERFORM public\.tv5_alert_due\(r\.id\)/);
  assert.doesNotMatch(search,/INSERT INTO public\.notifications[\s\S]*'SHIFT_CHANGE_NO_REPLACEMENT'/);
});
test('published resolver ignores newer drafts and fails closed for competing published groups in the same week',()=>{
  const resolver=section('tv5_schedule_state'),rpc=section('tv5_shift_change');
  assert.match(resolver,/count\(DISTINCT s\.schedule_group_id\)/);
  assert.match(resolver,/s\.branch_id=chosen\.branch_id AND rp\.branch_id=chosen\.branch_id/);
  assert.match(resolver,/rp\.work_start_date=week_start AND s\.status='PUBLISHED'/);
  assert.match(resolver,/IF published_groups>1 THEN RETURN 'AMBIGUOUS_PUBLISHED_SCHEDULE'/);
  assert.match(resolver,/newer\.status='PUBLISHED' AND newer\.version>chosen\.version/);
  assert.doesNotMatch(resolver,/LIMIT 1|ORDER BY .*created_at/);
  assert.match(rpc,/RAISE EXCEPTION 'TV5:AMBIGUOUS_PUBLISHED_SCHEDULE'/);
  assert.match(rpc,/'schedule_issues'/);assert.match(rpc,/AS schedule_state/);
});
test('response and both approval assignment writes recheck current start immediately after eligibility',()=>{
  const rpc=section('tv5_shift_change');
  const response=rpc.slice(rpc.indexOf("ELSIF p_action='respond' THEN"),rpc.indexOf("ELSIF p_action='refresh' THEN"));
  assert.match(response,/IF least\(inv\.expires_at,deadline\)<=clock_timestamp\(\)/);
  assert.match(response,/tv5_candidate_eligible[\s\S]*UPDATE public\.replacement_invitations[\s\S]*WHERE id=inv\.id AND clock_timestamp\(\)<least\(inv\.expires_at,public\.tv5_assignment_start/);
  assert.match(response,/IF NOT FOUND THEN RAISE EXCEPTION 'TV5:DEADLINE_PASSED'/);
  const decision=rpc.slice(rpc.indexOf("ELSIF p_action='decision' THEN"),rpc.indexOf('UPDATE public.shift_change_requests SET status=p_input'));
  assert.equal((decision.match(/clock_timestamp\(\)<public\.tv5_assignment_start\(v_assignment\.work_date,v_shift\.start_time\)/g)||[]).length,2);
  assert.equal((decision.match(/IF NOT FOUND THEN RAISE EXCEPTION 'TV5:DEADLINE_PASSED'/g)||[]).length,2);
  assert.equal((decision.match(/target_employee_id=target AND status='ACCEPTED' AND expires_at>clock_timestamp\(\)/g)||[]).length,3);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.tv5_schedule_state\(uuid\) FROM PUBLIC,anon,authenticated,service_role/);
});
test('T-60 is exclusive for creation and assignment listing, independent of publication feedback deadline',()=>{
  const rpc=section('tv5_shift_change');
  assert.match(rpc,/clock_timestamp\(\)<public\.tv5_assignment_start\(a\.work_date,sh\.start_time\)-interval '60 minutes'/);
  assert.equal((rpc.match(/IF clock_timestamp\(\)>=deadline-interval '60 minutes'/g)||[]).length,2);
  assert.doesNotMatch(rpc,/feedback_deadline_at/);
  assert.match(rpc,/IF deadline<=clock_timestamp\(\) THEN RAISE EXCEPTION 'TV5:DEADLINE_PASSED'/);
});
test('successful replacement lineage blocks both ends of the exchange without deleting history',()=>{
  assert.match(sql,/ADD COLUMN replacement_assignment_id uuid\s+REFERENCES public\.shift_assignments\(id\)/);
  assert.match(sql,/CHECK \(status<>'APPROVED' OR replacement_assignment_id IS NOT NULL\)/);
  const current=section('tv5_assignment_current'),rpc=section('tv5_shift_change');
  assert.match(current,/done\.status='APPROVED'[\s\S]*done\.original_assignment_id=a\.id OR done\.replacement_assignment_id=a\.id/);
  assert.match(rpc,/done\.status='APPROVED'[\s\S]*done\.original_assignment_id=v_assignment\.id OR done\.replacement_assignment_id=v_assignment\.id/);
  assert.match(rpc,/TV5:ALREADY_CHANGED/);
  assert.match(rpc,/replacement_assignment_id=new_assignment/);
  assert.match(sql,/approved requests exist; review lineage in a forward migration/);
});
test('alert window excludes early, started, closed, invalid and already-accepted requests',()=>{
  const alert=section('tv5_alert_due');
  assert.match(alert,/r\.status IN \('PENDING','SEARCHING'\)/);
  assert.match(alert,/public\.tv5_assignment_current\(a\.id\)/);
  assert.match(alert,/r\.requesting_employee_id=a\.employee_id/);
  assert.match(alert,/-interval '60 minutes'<=checked_at/);
  assert.match(alert,/checked_at<public\.tv5_assignment_start\(a\.work_date,sh\.start_time\)/);
  assert.match(alert,/NOT EXISTS[\s\S]*i\.status='ACCEPTED' AND i\.expires_at>checked_at/);
  assert.match(alert,/u\.branch_id=d\.branch_id AND u\.role='QL' AND u\.is_active/);
  assert.doesNotMatch(alert,/UPDATE |DELETE |INSERT INTO public\.(shift_assignments|shift_change_requests)/);
});
test('Cron and interactive paths share milestone/recipient deduplication and serialization',()=>{
  const alert=section('tv5_alert_due');
  assert.match(alert,/pg_try_advisory_xact_lock\(72910560\)/);
  assert.match(alert,/LOCK TABLE public\.branches,[\s\S]*public\.replacement_invitations IN SHARE MODE/);
  assert.match(alert,/'tv5:t60:'\|\|d\.id::text\|\|':'\|\|extract\(epoch FROM \(d\.starts_at-interval '60 minutes'\)\)::text\|\|':'\|\|u\.id::text/);
  assert.match(alert,/ON CONFLICT\(idempotency_key\) DO NOTHING/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.tv5_alert_due\(uuid\) FROM PUBLIC,anon,authenticated,service_role/);
});
test('scheduler requires installed pg_cron and reviewed helper, rejects collisions and schedules only its own job',()=>{
  assert.match(scheduler,/current_user<>'postgres'/);
  assert.match(scheduler,/pg_available_extensions WHERE name='pg_cron'/);
  assert.match(scheduler,/pg_extension WHERE extname='pg_cron'/);
  assert.match(scheduler,/to_regprocedure\('public\.tv5_alert_due\(uuid\)'\)/);
  assert.match(scheduler,/IF EXISTS \(SELECT 1 FROM cron\.job WHERE jobname='tv5-shift-change-t60-alerts'\)/);
  assert.match(scheduler,/cron\.schedule\('tv5-shift-change-t60-alerts','\* \* \* \* \*'/);
  assert.equal((scheduler.match(/SELECT cron\.schedule/g)||[]).length,1);
  assert.match(scheduler,/public\.tv5_alert_due\(NULL\)/);
  assert.match(scheduler,/REVOKE ALL ON FUNCTION public\.tv5_run_shift_change_alerts\(\) FROM PUBLIC,anon,authenticated,service_role/);
  assert.doesNotMatch(scheduler.replace(/--[^\n]*/g,''),/\b(?:DROP|TRUNCATE|DELETE|UPDATE|CREATE EXTENSION|cron\.unschedule)\b/i);
  // Function body calls alert helper, but migration never invokes the runner immediately.
  assert.equal((scheduler.match(/SELECT public\.tv5_run_shift_change_alerts\(\);/g)||[]).length,1);
});
