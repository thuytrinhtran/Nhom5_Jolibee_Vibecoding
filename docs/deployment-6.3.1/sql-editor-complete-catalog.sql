-- READ ONLY. Target Dashboard project: wlbpprpiieonjrqglicv.
-- Run each SELECT separately, No limit, download complete CSV.

-- S1: All public columns, not the former 100-row subset.
SELECT count(*) OVER() total_rows,c.relname relation_name,a.attnum,a.attname,
 format_type(a.atttypid,a.atttypmod) data_type,a.attnotnull,
 pg_get_expr(d.adbin,d.adrelid) default_expression
FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid
LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p','v','m')
 AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum;

-- S2: All public function/procedure bodies and checksums. No execution.
SELECT count(*) OVER() total_rows,p.oid::regprocedure::text signature,
 pg_get_userbyid(p.proowner) owner,p.prosecdef,p.proconfig,p.proacl,
 md5(regexp_replace(replace(p.prosrc,chr(13),''),'\s+',' ','g')) normalized_body_md5,
 pg_get_functiondef(p.oid) definition
FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
 AND p.prokind IN ('f','p') ORDER BY p.oid::regprocedure::text;

-- S3: All public indexes, including predicates and validity.
SELECT count(*) OVER() total_rows,i.indrelid::regclass::text table_name,
 i.indexrelid::regclass::text index_name,i.indisunique,i.indisvalid,i.indisready,
 pg_get_indexdef(i.indexrelid) definition
FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
WHERE c.relnamespace='public'::regnamespace ORDER BY 2,3;

-- S4: Effective EXECUTE, including inherited/default PUBLIC privileges.
SELECT count(*) OVER() total_rows,p.oid::regprocedure::text signature,
 r.rolname,has_function_privilege(r.oid,p.oid,'EXECUTE') can_execute
FROM pg_proc p CROSS JOIN pg_roles r
WHERE p.pronamespace='public'::regnamespace AND p.prokind IN ('f','p')
 AND r.rolname IN ('anon','authenticated','service_role') ORDER BY 2,3;

-- S5: History presence. If absent, do not infer deployment from filenames.
SELECT to_regclass('supabase_migrations.schema_migrations') migration_history;
-- Only if S5 returns a relation, run separately:
-- SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;

-- S6: Existing Auth/profile/employee bindings; Auth IDs only.
SELECT e.id employee_id,e.user_id,e.department_id,e.skill_level,e.status,
 u.username,u.role,u.branch_id,u.is_active,u.must_change_password,a.id auth_id
FROM public.employees e LEFT JOIN public.users u ON u.id=e.user_id
LEFT JOIN auth.users a ON a.id=u.id
WHERE e.branch_id='11111111-1111-1111-1111-111111111111' ORDER BY e.id;
