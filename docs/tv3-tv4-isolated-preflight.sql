-- READ ONLY. TV1 runs these SELECTs in the APPROVED ISOLATED project SQL Editor.
-- No migration, RPC execution, grants, fixture inserts or state transitions.
-- Confirm the Dashboard project ref against TV3_TEST_PROJECT_REF first.

SELECT current_database(),current_user;

SELECT signature,to_regprocedure(signature) AS deployed_function
FROM (VALUES
 ('public.persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text)'),
 ('public.generate_schedule_draft(uuid,uuid,jsonb,jsonb)'),
 ('public.tv3_scheduling_input(uuid)'),
 ('public.tv4_transition_schedule_v2(uuid,uuid,integer,text,uuid,text,timestamp with time zone)'),
 ('public.tv4_assert_schedule_v2(uuid)')
) expected(signature);

-- Review definitions as well as signatures. The TV3 input/result contract is tv3.rules.v2.
-- Later approved migrations can change the body: do not replace it based on existence alone.
SELECT p.oid::regprocedure AS signature,pg_get_userbyid(p.proowner) AS owner,
 p.prosecdef AS security_definer,p.proconfig,p.proacl,
 md5(regexp_replace(replace(p.prosrc,chr(13),''),'\s+',' ','g')) AS body_md5,
 pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN
 ('persist_schedule_draft','generate_schedule_draft','tv3_scheduling_input',
  'tv3_result_v2','tv4_transition_schedule_v2','tv4_assert_schedule_v2','validate_schedule_approval')
ORDER BY 1;

-- service_role: EXECUTE persist/transition; anon/authenticated: no write RPC EXECUTE.
-- Helpers and old TV4 entry points must not provide an alternative write path.
SELECT p.oid::regprocedure AS signature,r.rolname,
 has_function_privilege(r.oid,p.oid,'EXECUTE') AS can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN pg_roles r
WHERE n.nspname='public' AND r.rolname IN ('anon','authenticated','service_role')
 AND p.proname IN ('persist_schedule_draft','generate_schedule_draft','tv3_scheduling_input',
  'tv3_result_v2','tv4_transition_schedule_v2','tv4_assert_schedule_v2','tv4_decide_schedule','tv4_publish_schedule')
ORDER BY 1,2;

SELECT c.oid::regclass AS relation,pg_get_userbyid(c.relowner) AS owner,
 c.relrowsecurity,c.relforcerowsecurity,c.relacl
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN
 ('registration_periods','registration_periods_effective','registration_submissions_sourced',
  'schedules','shift_assignments','schedule_approvals','audit_logs');

SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies
WHERE schemaname='public' AND tablename IN ('schedules','shift_assignments','schedule_approvals','audit_logs');

SELECT t.tgrelid::regclass AS relation,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgrelid IN
 (to_regclass('public.schedules'),to_regclass('public.shift_assignments'),to_regclass('public.schedule_approvals'));

-- Reference UUIDs below are only appropriate if preserved in the isolated fixture.
-- Otherwise replace them with the approved test branch/period UUIDs, never production targets.
SELECT id,branch_id,work_start_date,work_end_date,open_at,close_at,status,stored_status
FROM public.registration_periods_effective
WHERE id='7f48f53e-d707-4a32-9f15-eb32aeb0095a'::uuid
 AND branch_id='11111111-1111-1111-1111-111111111111'::uuid;

SELECT id,branch_id,period_id,status,version,published_at
FROM public.schedules WHERE period_id='7f48f53e-d707-4a32-9f15-eb32aeb0095a'::uuid
ORDER BY version;
