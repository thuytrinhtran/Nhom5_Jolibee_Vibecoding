-- READ ONLY. Run after approved deployment; safe to inspect before deployment.
-- This tests catalog state, not business writes. Re-run C2-C9 and D1-D7 as well.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
-- P1. Missing RPC/helper or wrong ACL = STOP; flags stay OFF.
WITH expected(signature,server_execute) AS(VALUES
 ('public.persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text)',true),
 ('public.generate_schedule_draft(uuid,uuid,jsonb,jsonb)',true),
 ('public.tv3_scheduling_input(uuid)',false),('public.tv3_balance_v2(jsonb,jsonb)',false),
 ('public.tv3_result_v2(jsonb,uuid,jsonb,jsonb)',false),('public.tv3_existing_coverage_v2(jsonb)',false),
 ('public.tv4_transition_schedule_v2(uuid,uuid,integer,text,uuid,text,timestamptz)',true),
 ('public.tv4_assert_schedule_v2(uuid)',false),('public.tv4_decide_schedule(uuid,uuid,varchar,text)',false),
 ('public.tv4_publish_schedule(uuid,uuid,timestamptz)',false),('public.employee_schedule_week(uuid,date)',true),
 ('public.tv5_read(uuid)',true),('public.tv5_candidates_for_actor(uuid,uuid)',true),
 ('public.tv5_mutate(uuid,text,uuid,jsonb)',true),('public.tv5_actor(uuid)',false),
 ('public.tv5_assignment(uuid)',false),('public.tv5_candidates(uuid)',false),('public.tv5_result_v2(jsonb,uuid,jsonb,jsonb)',false)),
 roles AS(SELECT name,r.oid FROM(VALUES('anon'),('authenticated'),('service_role')) n(name) LEFT JOIN pg_roles r ON r.rolname=n.name)
SELECT e.signature,p.oid IS NOT NULL present,pg_get_userbyid(p.proowner) owner,r.name,
 has_function_privilege(r.oid,p.oid,'EXECUTE') can_execute,
 CASE WHEN p.oid IS NULL OR r.oid IS NULL THEN 'MISSING'
 WHEN pg_get_userbyid(p.proowner)<>'postgres' THEN 'WRONG_OWNER'
 WHEN has_function_privilege(r.oid,p.oid,'EXECUTE') IS DISTINCT FROM (r.name='service_role' AND e.server_execute) THEN 'ACL_MISMATCH'
 ELSE 'PASS' END gate
FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature) CROSS JOIN roles r ORDER BY 1,5;
-- P2. Key body markers; compare full checksums with a rehearsed local snapshot.
SELECT p.oid::regprocedure signature,p.prosecdef,p.provolatile,p.proconfig,
 md5(regexp_replace(replace(p.prosrc,chr(13),''),'\s+',' ','g')) body_md5,
 position('tv3.rules.v2' IN p.prosrc)>0 v2_input_marker,
 position('NEEDS_REVISION' IN p.prosrc)>0 revision_marker
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN('tv3_scheduling_input','persist_schedule_draft','tv4_transition_schedule_v2','employee_schedule_week','tv5_mutate','tv5_result_v2');
-- P3. Trigger/partial indexes must be attached and valid, not just named.
SELECT t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) definition FROM pg_trigger t
WHERE t.tgrelid=to_regclass('public.schedule_approvals') AND NOT t.tgisinternal;
SELECT i.indexrelid::regclass index_name,i.indisvalid,i.indisunique,pg_get_indexdef(i.indexrelid) definition
FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relname IN
 ('tv5_current_employee_shift','tv5_one_successor','tv5_open_request','tv5_open_incident') ORDER BY 1;
-- P4. Compare this scoped evidence with exported D1-D3 BEFORE enabling writers.
SELECT p.id,p.open_at,p.close_at,p.status,
 (SELECT count(*) FROM public.shift_registrations r WHERE r.period_id=p.id) registration_rows,
 (SELECT count(*) FROM public.registration_submissions h WHERE h.period_id=p.id) headers,
 (SELECT sum(required_count) FROM public.staffing_requirements r WHERE r.branch_id=p.branch_id AND r.work_date BETWEEN p.work_start_date AND p.work_end_date) demand
FROM public.registration_periods p WHERE p.id='79a979cc-8347-48b5-a411-f03bd8aceb92';
COMMIT;
