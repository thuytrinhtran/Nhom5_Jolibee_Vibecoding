-- SELECT ONLY: run as postgres before approving migration/activation.
SELECT current_database(),current_user,version();
SELECT name,default_version,installed_version FROM pg_available_extensions WHERE name='pg_cron';
SELECT extname,extversion FROM pg_extension WHERE extname='pg_cron';
SELECT current_setting('cron.database_name',true) AS cron_database,
 current_setting('cron.timezone',true) AS cron_timezone;
SELECT p.oid::regprocedure,pg_get_userbyid(p.proowner) AS owner,p.proargnames,
 md5(btrim(replace(p.prosrc,chr(13),''),chr(10)||chr(9)||' ')) AS body_md5,pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('save_employee_registration','tv2_ensure_registration_periods','tv2_ensure_registration_periods_at');
SELECT c.relname,c.relrowsecurity,k.conname,pg_get_constraintdef(k.oid)
FROM pg_class c LEFT JOIN pg_constraint k ON k.conrelid=c.oid
WHERE c.oid IN ('public.registration_periods'::regclass,'public.registration_submissions'::regclass);
SELECT * FROM public.registration_schedule_config;
SELECT * FROM public.registration_automation_config;
SELECT id,branch_id,work_start_date,work_end_date,open_at,close_at,status
FROM public.registration_periods ORDER BY branch_id,work_start_date;
-- If pg_cron is installed, separately SELECT jobid,jobname,schedule,command,active,username,database FROM cron.job;
-- REST/OpenAPI cannot prove pg_cron installation or permissions. Do not infer from service-role access.
