-- READ ONLY. Run/export each numbered SELECT group separately in SQL Editor.
-- Do NOT call a writer RPC to discover whether it exists.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
-- C1. Identity and required base tables. Missing = STOP; never replay foundation.
SELECT current_database(),current_user,version(),current_setting('transaction_read_only') read_only,statement_timestamp() captured_at;
SELECT t.name,to_regclass('public.'||t.name) relation_name
FROM unnest(ARRAY['users','branches','employees','employee_skills','shifts','registration_periods',
 'registration_submissions','registration_submissions_sourced','registration_periods_effective',
 'shift_registrations','staffing_requirements','schedules','shift_assignments','schedule_approvals',
 'shift_change_requests','replacement_invitations','incidents','audit_logs','notifications',
 'registration_schedule_config','registration_automation_config','warning_configs']) t(name);
-- C2. Complete column metadata, not the former 100-row export.
SELECT count(*) OVER() total_rows,c.relname table_name,a.attnum ordinal_position,a.attname column_name,
 format_type(a.atttypid,a.atttypmod) data_type,a.attnotnull,
 pg_get_expr(d.adbin,d.adrelid) default_expression
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
WHERE n.nspname='public' AND c.relname IN ('users','employees','registration_submissions','schedules',
 'shift_assignments','schedule_approvals','shift_change_requests','replacement_invitations','incidents')
 AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum;
-- C3. FK (including inbound), CHECK/UNIQUE; no CASCADE is authorized.
SELECT c.conrelid::regclass table_name,c.conname,c.contype,c.convalidated,
 c.confrelid::regclass referenced_table,pg_get_constraintdef(c.oid) definition
FROM pg_constraint c WHERE c.conrelid IN (to_regclass('public.users'),to_regclass('public.employees'),to_regclass('public.registration_periods'),
 to_regclass('public.shift_registrations'),to_regclass('public.staffing_requirements'),to_regclass('public.schedules'),to_regclass('public.shift_assignments'),
 to_regclass('public.schedule_approvals'),to_regclass('public.shift_change_requests'),to_regclass('public.incidents'),
 to_regclass('public.replacement_invitations'),to_regclass('public.registration_submissions'))
 OR c.confrelid IN (to_regclass('public.shift_assignments'),to_regclass('public.users'),to_regclass('public.employees'))
ORDER BY c.conrelid::regclass::text,c.conname;
SELECT i.indrelid::regclass table_name,i.indexrelid::regclass index_name,i.indisunique,i.indisvalid,i.indisready,
 pg_get_indexdef(i.indexrelid) definition FROM pg_index i
WHERE i.indrelid IN(to_regclass('public.shift_assignments'),to_regclass('public.shift_change_requests'),
 to_regclass('public.incidents'),to_regclass('public.replacement_invitations')) ORDER BY 1,2;
-- C4. All application/TV2/TV3/TV4/TV5 signatures, bodies, owners and settings.
SELECT p.oid::regprocedure signature,pg_get_function_identity_arguments(p.oid) arguments,
 pg_get_userbyid(p.proowner) owner,p.prosecdef,p.provolatile,p.proconfig,
 md5(regexp_replace(replace(p.prosrc,chr(13),''),'\s+',' ','g')) normalized_body_md5,
 pg_get_functiondef(p.oid) definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.prokind='f' AND (p.proname ~ '^(tv[2345]_|employee_schedule_week$)'
 OR p.proname IN ('persist_schedule_draft','generate_schedule_draft','save_employee_registration',
 'registration_effective_status','run_registration_automation','validate_schedule_approval','validate_schedule_publish',
 'prevent_direct_published_schedule','prevent_audit_log_changes','guard_password_change_state','jollishift_business_access'))
ORDER BY p.proname,p.oid::regprocedure::text;
-- C5. Exact guard used by 20261101. MISMATCH/MISSING = STOP, no forced overwrite.
WITH expected(signature,checksum) AS(VALUES
 ('public.tv3_scheduling_input(uuid)','cd4e4b5440ae3f1a38567d7dd0acf8b9'),
 ('public.persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text)','f3dfa0c40d77478ab317079fc68405e6'),
 ('public.generate_schedule_draft(uuid,uuid,jsonb,jsonb)','477fbe0785dcdbd85cd7cdf1dc600509'))
SELECT e.*,p.oid IS NOT NULL present,pg_get_userbyid(p.proowner) owner,
 md5(regexp_replace(replace(p.prosrc,chr(13),''),'\s+',' ','g')) actual_checksum,
 CASE WHEN p.oid IS NULL THEN 'MISSING' WHEN pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef
  AND md5(regexp_replace(replace(p.prosrc,chr(13),''),'\s+',' ','g'))=e.checksum THEN 'BODY_MATCH_CHECK_ACL' ELSE 'MISMATCH' END gate
FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature);
-- C6. Trigger attachment matters: an existing body alone is insufficient.
SELECT c.oid::regclass table_name,t.tgname,t.tgenabled,p.oid::regprocedure function_name,
 pg_get_triggerdef(t.oid) definition,pg_get_functiondef(p.oid) function_definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
WHERE (n.nspname='public' OR (n.nspname='auth' AND c.relname='users')) AND NOT t.tgisinternal ORDER BY 1,2;
-- C7. Current explicit/default EXECUTE; PUBLIC is grantee 0.
SELECT p.oid::regprocedure signature,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END grantee,
 a.privilege_type,a.is_grantable FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
WHERE n.nspname='public' AND (p.proname ~ '^(tv[2345]_|employee_schedule_week$)' OR p.proname IN ('persist_schedule_draft','generate_schedule_draft','save_employee_registration','registration_effective_status')) ORDER BY 1,2;
SELECT pg_get_userbyid(d.defaclrole) owner,n.nspname,d.defaclobjtype,
 CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END grantee,a.privilege_type
FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE d.defaclnamespace=0 OR n.nspname='public';
-- C8. RLS and effective browser/server table privileges.
SELECT c.oid::regclass table_name,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) owner
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p') ORDER BY 1;
SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname;
SELECT c.oid::regclass table_name,r.rolname,has_table_privilege(r.oid,c.oid,'SELECT') can_select,
 has_table_privilege(r.oid,c.oid,'INSERT') can_insert,has_table_privilege(r.oid,c.oid,'UPDATE') can_update,
 has_table_privilege(r.oid,c.oid,'DELETE') can_delete
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN pg_roles r
WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN('schedules','shift_assignments','shift_change_requests','replacement_invitations','incidents')
 AND r.rolname IN('anon','authenticated','service_role') ORDER BY 1,2;
-- C9. Actual provenance views; inspect bodies, do not remove sample labels.
SELECT c.oid::regclass view_name,c.reloptions,c.relacl,pg_get_viewdef(c.oid,true) definition
FROM pg_class c WHERE c.oid IN(to_regclass('public.registration_periods_effective'),to_regclass('public.registration_submissions_sourced'));
-- C10. DDL hooks are not ordinary table triggers; inspect before changing schema.
SELECT e.evtname,e.evtevent,e.evtenabled,pg_get_userbyid(e.evtowner) owner,e.evttags,
 p.oid::regprocedure handler,pg_get_functiondef(p.oid) definition
FROM pg_event_trigger e JOIN pg_proc p ON p.oid=e.evtfoid ORDER BY e.evtname;
COMMIT;
