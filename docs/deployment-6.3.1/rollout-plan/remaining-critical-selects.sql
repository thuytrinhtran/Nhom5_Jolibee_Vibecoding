-- SELECT ONLY. Target project: wlbpprpiieonjrqglicv. Not executed.
-- Send existing exports first. Run only groups lacking usable results.
-- No limit; export each result separately, preserve original CSV filenames.
-- Zero rows are a valid result: record query label and count, do not infer failure.

-- C3.1 / original 20: FK, CHECK, UNIQUE constraint backing
SELECT c.conrelid::regclass table_name,c.conname,c.contype,c.convalidated,
 c.confrelid::regclass referenced_table,pg_get_constraintdef(c.oid) definition
FROM pg_constraint c WHERE c.conrelid IN (to_regclass('public.users'),to_regclass('public.employees'),to_regclass('public.registration_periods'),
 to_regclass('public.shift_registrations'),to_regclass('public.staffing_requirements'),to_regclass('public.schedules'),to_regclass('public.shift_assignments'),
 to_regclass('public.schedule_approvals'),to_regclass('public.shift_change_requests'),to_regclass('public.incidents'),
 to_regclass('public.replacement_invitations'),to_regclass('public.registration_submissions'))
 OR c.confrelid IN (to_regclass('public.shift_assignments'),to_regclass('public.users'),to_regclass('public.employees'))
ORDER BY c.conrelid::regclass::text,c.conname;

-- C6 / original 24: table/Auth trigger attachment and body
SELECT c.oid::regclass table_name,t.tgname,t.tgenabled,p.oid::regprocedure function_name,
 pg_get_triggerdef(t.oid) definition,pg_get_functiondef(p.oid) function_definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
WHERE (n.nspname='public' OR (n.nspname='auth' AND c.relname='users')) AND NOT t.tgisinternal ORDER BY 1,2;

-- C7.2 / original 26: default ACL for new objects
SELECT pg_get_userbyid(d.defaclrole) owner,n.nspname,d.defaclobjtype,
 CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END grantee,a.privilege_type
FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
CROSS JOIN LATERAL aclexplode(d.defaclacl) a WHERE d.defaclnamespace=0 OR n.nspname='public';

-- C8.1 / original 27: RLS and owners
SELECT c.oid::regclass table_name,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) owner
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p') ORDER BY 1;

-- C8.2 / original 28: policies
SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname;

-- C8.3 / original 29: effective business table privileges
SELECT c.oid::regclass table_name,r.rolname,has_table_privilege(r.oid,c.oid,'SELECT') can_select,
 has_table_privilege(r.oid,c.oid,'INSERT') can_insert,has_table_privilege(r.oid,c.oid,'UPDATE') can_update,
 has_table_privilege(r.oid,c.oid,'DELETE') can_delete
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN pg_roles r
WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN('schedules','shift_assignments','shift_change_requests','replacement_invitations','incidents')
 AND r.rolname IN('anon','authenticated','service_role') ORDER BY 1,2;

-- C9 / original 30: source views/options/ACL
SELECT c.oid::regclass view_name,c.reloptions,c.relacl,pg_get_viewdef(c.oid,true) definition
FROM pg_class c WHERE c.oid IN(to_regclass('public.registration_periods_effective'),to_regclass('public.registration_submissions_sourced'));

-- C10 / original 31: event trigger attachment
SELECT e.evtname,e.evtevent,e.evtenabled,pg_get_userbyid(e.evtowner) owner,e.evttags,
 p.oid::regprocedure handler,pg_get_functiondef(p.oid) definition
FROM pg_event_trigger e JOIN pg_proc p ON p.oid=e.evtfoid ORDER BY e.evtname;
