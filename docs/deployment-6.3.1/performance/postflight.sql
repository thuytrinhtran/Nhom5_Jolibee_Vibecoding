-- READ ONLY. Only after separately approved 20261106 rollout; not run on Supabase.
SELECT p.oid::regprocedure signature,pg_get_userbyid(p.proowner) owner,
 p.prosecdef,p.proconfig,
 md5(regexp_replace(replace(p.prosrc,chr(13),''),'\s+',' ','g')) body_md5,
 pg_get_functiondef(p.oid) definition
FROM pg_proc p WHERE p.oid IN(
 to_regprocedure('public.tv3_scheduling_input(uuid)'),
 to_regprocedure('public.persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text)'),
 to_regprocedure('public.dev_import_utc_image(anyelement)')) ORDER BY 1;

SELECT r.rolname,
 has_function_privilege(r.oid,'public.dev_import_utc_image(anyelement)','EXECUTE') helper_execute,
 has_function_privilege(r.oid,'public.persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text)','EXECUTE') draft_execute
FROM pg_roles r WHERE r.rolname IN('anon','authenticated','service_role');
-- Expected helper_execute=false for all three. Existing DRAFT ACL unchanged.

SELECT c.oid::regclass relation_name,c.relrowsecurity,c.relacl
FROM pg_class c WHERE c.oid IN(to_regclass('public.dev_import_batches'),
 to_regclass('public.registration_submissions'),to_regclass('public.shift_registrations'));
