-- SELECT ONLY after migration and approved activation. Never changes periods/registrations.
SELECT * FROM public.registration_schedule_config;
SELECT * FROM public.registration_period_generation_state;
SELECT id,branch_id,work_start_date,work_end_date,status,stored_status,
 open_at AT TIME ZONE 'Asia/Ho_Chi_Minh' AS open_local,
 close_at AT TIME ZONE 'Asia/Ho_Chi_Minh' AS close_local
FROM public.registration_periods_effective ORDER BY branch_id,work_start_date;
-- Expected: zero duplicate rows.
SELECT branch_id,work_start_date,count(*) FROM public.registration_periods GROUP BY 1,2 HAVING count(*)>1;
-- Expected: zero missing periods for eligible branches in the next four weeks.
WITH horizon AS(SELECT date_trunc('week',statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date+7+7*w AS monday FROM generate_series(0,3) w),
eligible AS(SELECT b.id FROM public.branches b WHERE b.status='ACTIVE' AND EXISTS(
 SELECT 1 FROM public.employees e JOIN public.users u ON u.id=e.user_id WHERE e.branch_id=b.id AND e.status='ACTIVE'
 AND e.skill_level<>'CREW_LEADER' AND u.role='NV' AND u.is_active AND u.branch_id=e.branch_id))
SELECT e.id AS branch_id,h.monday FROM eligible e CROSS JOIN horizon h
LEFT JOIN public.registration_periods p ON p.branch_id=e.id AND p.work_start_date=h.monday WHERE p.id IS NULL;
SELECT role_name,has_function_privilege(role_name,'public.save_employee_registration(uuid,uuid,jsonb,boolean)','EXECUTE') AS can_save,
has_function_privilege(role_name,'public.tv2_ensure_registration_periods()','EXECUTE') AS can_create_periods
FROM (VALUES('anon'),('authenticated'),('service_role')) roles(role_name);
SELECT column_name,udt_name,is_nullable FROM information_schema.columns
WHERE table_schema='public' AND table_name='registration_submissions' AND column_name='sample_batch_id';
SELECT period_id,count(*) AS sample_headers FROM public.registration_submissions_sourced
WHERE sample_batch_id IS NOT NULL GROUP BY period_id;
-- Review any upcoming period whose timestamps differ from the Friday policy; never overwrite silently.
SELECT id,branch_id,work_start_date,open_at,close_at FROM public.registration_periods
WHERE work_start_date>=date_trunc('week',statement_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date+7
AND (open_at<>((work_start_date-3)+time '15:00') AT TIME ZONE 'Asia/Ho_Chi_Minh'
 OR close_at<>((work_start_date-1)+time '12:00') AT TIME ZONE 'Asia/Ho_Chi_Minh');
-- Expected: exactly one active named job with the reviewed command. Requires enabled pg_cron.
SELECT jobid,jobname,schedule,command,active,username,database FROM cron.job WHERE jobname='tv2-create-registration-periods';
SELECT j.jobname,d.status,d.start_time,d.end_time,d.return_message
FROM cron.job j JOIN cron.job_run_details d USING(jobid)
WHERE j.jobname='tv2-create-registration-periods' ORDER BY d.start_time DESC LIMIT 20;
-- Expected false after bootstrap / at most two hours between successes. Investigate true.
SELECT statement_timestamp()-last_success_at>interval '2 hours' AS stale_scheduler FROM public.registration_period_generation_state;
