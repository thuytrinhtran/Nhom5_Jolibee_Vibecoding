-- SELECT ONLY: run manually before/after approved M1 then M2.
WITH required(name) AS (VALUES ('branches'),('users'),('employees'),('departments'),('shifts'),('registration_periods'),('shift_registrations'),('registration_submissions'),('registration_schedule_config'),('registration_automation_config'),('notifications'),('audit_logs'))
SELECT r.name,to_regclass('public.'||r.name) IS NOT NULL AS exists_now,c.column_name,c.data_type,c.is_nullable,c.column_default
FROM required r LEFT JOIN information_schema.columns c ON c.table_schema='public' AND c.table_name=r.name ORDER BY r.name,c.ordinal_position;
SELECT c.relname,k.conname,k.contype,pg_get_constraintdef(k.oid) AS definition
FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('employees','registration_periods','shift_registrations','registration_submissions','registration_schedule_config','registration_automation_config') ORDER BY c.relname,k.conname;
SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('shift_registrations','registration_submissions','registration_schedule_config','registration_automation_config');
SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename IN ('shift_registrations','registration_submissions','registration_schedule_config','registration_automation_config');
SELECT table_name,grantee,privilege_type FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name IN ('registration_submissions','registration_schedule_config','registration_automation_config') ORDER BY table_name,grantee;
SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,p.prosecdef,p.proconfig,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_can_execute,has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_can_execute,has_function_privilege('service_role',p.oid,'EXECUTE') AS backend_can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('save_employee_registration','run_registration_automation');
SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname='public' AND c.relname IN ('shift_registrations','registration_submissions','registration_periods','audit_logs');
SELECT b.id AS branch_id,(SELECT count(*) FROM shifts s WHERE s.is_active AND (s.branch_id=b.id OR s.branch_id IS NULL)) AS available_shifts,
 (SELECT count(*) FROM employees e JOIN users u ON u.id=e.user_id WHERE e.branch_id=b.id AND u.branch_id=b.id AND e.status='ACTIVE' AND e.skill_level<>'CREW_LEADER' AND u.is_active AND u.role='NV' AND NOT u.must_change_password) AS eligible_employees
FROM branches b WHERE b.status='ACTIVE';
