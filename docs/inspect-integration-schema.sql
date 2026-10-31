-- READ ONLY: SELECT catalog metadata only. No application function is executed.
-- Run each numbered SELECT separately in Supabase SQL Editor to inspect its result.
-- Definitions can contain internal implementation details: review before sharing.

-- 1. Inventory, owner and RLS flags (compare with docs/Jollishift.sql).
SELECT n.nspname AS schema_name, c.relname AS table_name,
       pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
ORDER BY c.relname;

-- 2. Columns, nullability, types and defaults.
SELECT table_name, ordinal_position, column_name, data_type, udt_name,
       is_nullable, column_default, character_maximum_length
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;

-- 3. PK, FK (including composite/cross-schema), UNIQUE, CHECK, EXCLUDE.
-- validated=false requires investigation; deferrable/deferred affect transactions.
SELECT n.nspname AS schema_name, t.relname AS table_name,
       c.conname, c.contype, c.convalidated, c.condeferrable, c.condeferred,
       rn.nspname AS referenced_schema, rt.relname AS referenced_table,
       pg_get_constraintdef(c.oid, true) AS definition
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
LEFT JOIN pg_class rt ON rt.oid = c.confrelid
LEFT JOIN pg_namespace rn ON rn.oid = rt.relnamespace
WHERE n.nspname = 'public' AND c.contype IN ('p','f','u','c','x')
ORDER BY t.relname, c.contype, c.conname;

-- 4. Unique/partial indexes and index health: constraints alone omit these.
SELECT t.relname AS table_name, idx.relname AS index_name,
       i.indisunique, i.indisprimary, i.indisvalid, i.indisready,
       pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index i
JOIN pg_class t ON t.oid = i.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_class idx ON idx.oid = i.indexrelid
WHERE n.nspname = 'public'
ORDER BY t.relname, idx.relname;

-- 5. Custom triggers, including auth.users profile triggers.
-- tgenabled: O=origin, D=disabled, R=replica, A=always.
SELECT n.nspname AS schema_name, t.relname AS table_name, g.tgname,
       g.tgenabled, pg_get_triggerdef(g.oid, true) AS definition,
       pn.nspname AS function_schema, p.proname AS function_name
FROM pg_trigger g
JOIN pg_class t ON t.oid = g.tgrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_proc p ON p.oid = g.tgfoid
JOIN pg_namespace pn ON pn.oid = p.pronamespace
WHERE NOT g.tgisinternal
  AND (n.nspname = 'public' OR (n.nspname = 'auth' AND t.relname = 'users'))
ORDER BY n.nspname, t.relname, g.tgname;

-- 6. Definitions of public functions, including trigger/RLS helpers and RPCs.
-- Do not invoke these functions to test permissions; RPCs can write data.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS security_definer,
       p.proconfig AS function_settings, pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind IN ('f','p')
ORDER BY p.proname, arguments;

-- 7. RLS policies: restrictive policies do not grant access by themselves.
SELECT schemaname, tablename, policyname, permissive, roles, cmd,
       qual AS using_expression, with_check
FROM pg_policies WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 8. Explicit table ACLs, including PUBLIC; NULL relacl uses default ACL semantics.
SELECT c.relname AS table_name,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
       pg_get_userbyid(a.grantor) AS grantor, a.privilege_type, a.is_grantable
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r',c.relowner))) a
WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
ORDER BY c.relname, grantee, a.privilege_type;

-- 9. Effective privileges for API roles (includes role inheritance/PUBLIC).
-- Privilege=true does NOT imply a matching RLS policy, nor a successful write.
SELECT r.rolname, c.relname AS table_name, r.rolbypassrls, r.rolsuper,
       has_schema_privilege(r.oid,n.oid,'USAGE') AS schema_usage,
       has_table_privilege(r.oid,c.oid,'SELECT') AS can_select,
       has_table_privilege(r.oid,c.oid,'INSERT') AS can_insert,
       has_table_privilege(r.oid,c.oid,'UPDATE') AS can_update,
       has_table_privilege(r.oid,c.oid,'DELETE') AS can_delete
FROM pg_roles r CROSS JOIN pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE r.rolname IN ('anon','authenticated','service_role')
  AND n.nspname = 'public' AND c.relkind IN ('r','p')
ORDER BY r.rolname,c.relname;

-- 10. Column-level grants may permit operations despite table-level revocation.
SELECT table_name, column_name, grantee, privilege_type, is_grantable
FROM information_schema.column_privileges
WHERE table_schema = 'public'
ORDER BY table_name,column_name,grantee,privilege_type;

-- 11. Schema ACL and function EXECUTE ACL (PUBLIC included).
SELECT n.nspname, CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
       a.privilege_type, a.is_grantable
FROM pg_namespace n
CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a
WHERE n.nspname = 'public'
ORDER BY grantee,a.privilege_type;

SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS arguments,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
       a.privilege_type, a.is_grantable
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
WHERE n.nspname = 'public' AND p.prokind IN ('f','p')
ORDER BY p.proname,arguments,grantee;

-- 12. Defaults affect FUTURE objects; these do not describe current table grants.
SELECT pg_get_userbyid(d.defaclrole) AS owner, n.nspname AS schema_name,
       d.defaclobjtype,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
       a.privilege_type,a.is_grantable
FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
CROSS JOIN LATERAL aclexplode(d.defaclacl) a
WHERE d.defaclnamespace = 0 OR n.nspname = 'public'
ORDER BY owner,schema_name,d.defaclobjtype,grantee;
