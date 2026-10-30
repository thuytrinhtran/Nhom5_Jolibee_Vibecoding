-- SELECT ONLY. For TV3/group lead to confirm missing/unexposed real scheduling RPC.
SELECT n.nspname,p.oid::regprocedure,pg_get_userbyid(p.proowner) AS owner,
 has_function_privilege('service_role',p.oid,'EXECUTE') AS server_can_execute,
 p.proargnames,pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('generate_schedule_draft','scheduling_input','save_employee_registration');
-- Review definitions: effective status by timestamps, VALID header + submitted_at,
-- default exclude sample provenance, authorized branch, stale snapshot/retry protection.
-- Do NOT invoke generate_schedule_draft merely to inspect: it can persist schedules.
SELECT id,branch_id,work_start_date,work_end_date,status,stored_status,open_at,close_at
FROM public.registration_periods_effective ORDER BY branch_id,work_start_date;
SELECT period_id,status,(sample_batch_id IS NOT NULL) AS is_sample,count(*)
FROM public.registration_submissions_sourced GROUP BY 1,2,3 ORDER BY 1,2,3;
