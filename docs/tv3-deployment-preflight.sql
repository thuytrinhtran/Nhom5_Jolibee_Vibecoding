-- SELECT ONLY. Run on the intended Supabase project as postgres in SQL Editor.
-- Does NOT execute scheduling/registration RPCs. No DDL, DML or configuration writes.
-- Focused companion to docs/inspect-integration-schema.sql, using the same catalog checks.
-- Compare results with backend/migrations/20261031_tv3_schedule_draft.sql and docs/Jollishift.sql.
-- Before deployment: the 3 TV3 functions must be ABSENT; CREATE is not repeatable.
-- After deployment: postgres owner + SECURITY DEFINER + pinned search_path;
-- both public RPCs have statement_timeout=5s (helper has no public execution).
-- Supabase gateway version/hoisting config MUST also be verified by the operator.

-- 1. Context. These timeout values belong to SQL Editor, NOT the PostgREST pool.
SELECT current_database(),current_user,version(),
       current_setting('statement_timeout') AS editor_statement_timeout,
       current_setting('lock_timeout') AS editor_lock_timeout;

-- 2. Required relations. All must exist. Source view definition is checked in #8.
WITH expected(name) AS (VALUES
 ('branches'),('users'),('employees'),('employee_skills'),('departments'),('shifts'),
 ('registration_periods'),('registration_submissions'),('registration_submissions_sourced'),
 ('shift_registrations'),('staffing_requirements'),('warning_configs'),
 ('schedules'),('shift_assignments'),('audit_logs'),('schedule_approvals'))
SELECT e.name,c.oid IS NOT NULL AS exists,c.relkind,
       pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity,c.relforcerowsecurity
FROM expected e LEFT JOIN pg_class c ON c.oid=to_regclass('public.'||e.name)
ORDER BY e.name;

-- 3. Compare exact types/nullability/defaults with %ROWTYPE, JSON casts and INSERTs.
-- In particular: schedule_group_id default UUID; version integer; assignment
-- actual_branch_id/status/source; users gate; source submitted_at/sample_batch_id.
SELECT table_name,column_name,udt_name,is_nullable,column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN
 ('branches','users','employees','employee_skills','shifts','registration_periods',
  'registration_submissions','shift_registrations','staffing_requirements',
  'warning_configs','schedules','shift_assignments','audit_logs')
ORDER BY table_name,ordinal_position;

-- 4. Must validate all expected PK/FK/UNIQUE/CHECK. Compare DEFINITIONS, not names.
-- Critical: schedules UNIQUE(group,version); assignments UNIQUE(schedule,employee,date,shift);
-- composite employee/department FK + referenced employee UNIQUE; period UNIQUE(branch,start);
-- source header UNIQUE/PK(period,employee); valid actor/branch/period/FKs.
-- CHECK must permit DRAFT, REPLACED, REGULAR, MANUAL/SYSTEM and positive versions.
SELECT t.relname AS table_name,k.conname,k.contype,k.convalidated,k.condeferrable,k.condeferred,
       pg_get_constraintdef(k.oid,true) AS definition
FROM pg_constraint k JOIN pg_class t ON t.oid=k.conrelid
JOIN pg_namespace n ON n.oid=t.relnamespace
WHERE n.nspname='public' AND t.relname IN
 ('branches','users','employees','employee_skills','shifts','registration_periods',
  'registration_submissions','shift_registrations','staffing_requirements',
  'warning_configs','schedules','shift_assignments','audit_logs','schedule_approvals')
ORDER BY t.relname,k.contype,k.conname;

-- Includes independent unique/partial indexes; indisvalid and indisready must be true.
SELECT t.relname AS table_name,i.indisvalid,i.indisready,i.indisunique,
       pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid
WHERE t.relnamespace='public'::regnamespace AND t.relname IN
 ('employees','registration_periods','registration_submissions','shift_registrations',
  'staffing_requirements','schedules','shift_assignments','audit_logs')
ORDER BY t.relname,i.indexrelid;

-- 5. Review every custom trigger for extra writes, rejection, network work or long execution.
-- Audit immutability must remain intact. Migration itself must not disable triggers.
SELECT n.nspname,t.relname,g.tgname,g.tgenabled,
       pg_get_triggerdef(g.oid,true) AS trigger_definition,
       pg_get_functiondef(g.tgfoid) AS trigger_function
FROM pg_trigger g JOIN pg_class t ON t.oid=g.tgrelid
JOIN pg_namespace n ON n.oid=t.relnamespace
WHERE NOT g.tgisinternal AND (n.nspname='public' OR (n.nspname='auth' AND t.relname='users'))
ORDER BY n.nspname,t.relname,g.tgname;

-- 6. Exact RPC inventory. Required dependency functions must exist before deployment.
-- Any existing TV3 signature/overload requires review; never overwrite blindly.
SELECT n.nspname,p.oid::regprocedure AS signature,pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef,p.provolatile,p.proconfig,p.proacl,pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE p.prokind='f' AND ((n.nspname='public' AND p.proname IN
 ('tv3_scheduling_input','persist_schedule_draft','generate_schedule_draft',
  'registration_effective_status','tv2_ensure_registration_periods','tv2_ensure_registration_periods_at'))
 OR (n.nspname='auth' AND p.proname='role'))
ORDER BY n.nspname,p.proname,p.oid;

-- Expected post-deployment EXECUTE: helper false for all three; RPCs service_role ONLY.
WITH expected(signature) AS (VALUES
 ('public.tv3_scheduling_input(uuid)'),
 ('public.generate_schedule_draft(uuid,uuid,jsonb,jsonb)'),
 ('public.persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text)'))
SELECT e.signature,to_regprocedure(e.signature) IS NOT NULL AS exists,r.rolname,
       has_schema_privilege(r.oid,'public','USAGE') AS schema_usage,
       has_function_privilege(r.oid,to_regprocedure(e.signature),'EXECUTE') AS can_execute
FROM expected e CROSS JOIN pg_roles r
WHERE r.rolname IN ('anon','authenticated','service_role')
ORDER BY e.signature,r.rolname;

-- 7. Effective table and column access, RLS policies. Service-role reads do not test JWT RLS.
SELECT r.rolname,c.relname,r.rolbypassrls,
       has_table_privilege(r.oid,c.oid,'SELECT') AS can_select,
       has_table_privilege(r.oid,c.oid,'INSERT') AS can_insert,
       has_table_privilege(r.oid,c.oid,'UPDATE') AS can_update,
       has_table_privilege(r.oid,c.oid,'DELETE') AS can_delete
FROM pg_roles r CROSS JOIN pg_class c
WHERE r.rolname IN ('anon','authenticated','service_role') AND c.relnamespace='public'::regnamespace
 AND c.relkind IN ('r','p','v') AND c.relname IN
 ('schedules','shift_assignments','audit_logs','registration_submissions_sourced')
ORDER BY c.relname,r.rolname;
SELECT table_name,column_name,grantee,privilege_type,is_grantable
FROM information_schema.column_privileges
WHERE table_schema='public' AND table_name IN ('schedules','shift_assignments','audit_logs')
ORDER BY table_name,column_name,grantee;
SELECT schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
FROM pg_policies WHERE schemaname='public'
ORDER BY tablename,policyname;

-- 8. Compare VALID header + submitted_at + sample exclusion semantics. This view
-- reads legacy sample markers from audit_logs, explaining its remaining save lock.
SELECT c.relname,c.reloptions,pg_get_viewdef(c.oid,true) AS definition
FROM pg_class c WHERE c.oid=to_regclass('public.registration_submissions_sourced') AND c.relkind='v';

-- 9. Whitelisted timeout/gateway role settings only; never dump all role settings
-- (they may contain secrets). Rows here do not prove gateway env/config overrides.
SELECT COALESCE(r.rolname,'ALL_ROLES') AS role,COALESCE(d.datname,'ALL_DATABASES') AS database,
       setting
FROM pg_db_role_setting s LEFT JOIN pg_roles r ON r.oid=s.setrole
LEFT JOIN pg_database d ON d.oid=s.setdatabase
CROSS JOIN LATERAL unnest(s.setconfig) AS config(setting)
WHERE split_part(setting,'=',1) IN
 ('statement_timeout','lock_timeout','idle_in_transaction_session_timeout',
  'pgrst.db_hoisted_tx_settings','pgrst.db_pre_request','pgrst.db_tx_end')
ORDER BY role,database,setting;
SELECT pid,usename,application_name,state,xact_start
FROM pg_stat_activity WHERE usename='authenticator' OR application_name ILIKE '%postgrest%';
-- Operator must verify gateway version supports function timeout hoisting,
-- db-hoisted-tx-settings includes statement_timeout, and BOTH RPCs hoist 5s.
-- A future approved gateway smoke test must prove cancellation+rollback+lock release.
