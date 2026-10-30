-- READ ONLY. Verify approved official v3, shared project wlbpprpiieonjrqglicv.
-- Counts are observations, not hardcoded expectations about group data.
SELECT (SELECT count(*) FROM public.employees) AS existing_employees,
 (SELECT count(*) FROM public.shifts) AS existing_shifts,
 (SELECT count(*) FROM public.registration_periods) AS existing_periods,
 (SELECT count(*) FROM public.registration_submissions WHERE sample_batch_id IS NULL) AS genuine_headers,
 (SELECT count(*) FROM public.registration_submissions WHERE sample_batch_id IS NOT NULL) AS sample_headers;
SELECT * FROM public.registration_schedule_config;
SELECT p.id,p.branch_id,p.work_start_date,p.work_end_date,p.status,
 p.open_at AT TIME ZONE 'Asia/Ho_Chi_Minh' AS opening_vietnam,
 p.close_at AT TIME ZONE 'Asia/Ho_Chi_Minh' AS deadline_vietnam,
 p.status='OPEN' AND now()>=p.open_at AND now()<p.close_at AS editable_now
FROM public.registration_periods p ORDER BY p.work_start_date DESC,p.branch_id;
SELECT b.id AS branch_id,b.name,s.id AS shift_id,s.name AS shift_name,s.start_time,s.end_time,s.branch_id AS configured_branch
FROM public.branches b JOIN public.shifts s ON s.branch_id=b.id OR s.branch_id IS NULL WHERE b.status='ACTIVE' AND s.is_active ORDER BY b.id,s.start_time;
SELECT c.relname,c.relrowsecurity,
 has_table_privilege('service_role',c.oid,'SELECT') AS backend_select,
 has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE') AS direct_write_should_be_false,
 has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS anon_access_should_be_false,
 has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS browser_access_should_be_false
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('registration_submissions','registration_schedule_config');
SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,p.prosecdef,p.proconfig,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute_should_be_false,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS browser_execute_should_be_false,
 has_function_privilege('service_role',p.oid,'EXECUTE') AS backend_execute_should_be_true
FROM pg_proc p WHERE p.oid=to_regprocedure('public.save_employee_registration(uuid,uuid,jsonb,boolean)');
SELECT pg_get_constraintdef(k.oid) AS sample_provenance_fk FROM pg_constraint k
JOIN pg_attribute a ON a.attrelid=k.conrelid AND k.conkey=ARRAY[a.attnum]::smallint[]
WHERE k.conrelid='public.registration_submissions'::regclass AND k.contype='f' AND a.attname='sample_batch_id';
-- Legacy VALID shift rows without a VALID timestamped header require explicit review.
-- They are not automatically converted into submissions/OFF declarations.
SELECT count(*) AS valid_rows_without_confirmed_header FROM public.shift_registrations r
WHERE r.status='VALID' AND NOT EXISTS(SELECT 1 FROM public.registration_submissions h
 WHERE h.period_id=r.period_id AND h.employee_id=r.employee_id AND h.status='VALID' AND h.submitted_at IS NOT NULL);
-- Existing automation (if present) is inspected in 00; v3 neither installs nor enables it.
