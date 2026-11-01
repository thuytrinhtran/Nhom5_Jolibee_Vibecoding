-- READ ONLY. Run catalog query first. Registry queries require 20261105 applied.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT current_database(),current_user,statement_timestamp(),current_setting('transaction_read_only');
SELECT to_regclass('public.dev_import_batches') registry,
 to_regclass('public.shift_registrations_sourced') row_source,
 to_regprocedure('public.dev_import_header_allowed(uuid,uuid,uuid)') header_gate,
 to_regprocedure('public.dev_import_registration_allowed(uuid)') row_gate;
SELECT p.oid::regprocedure signature,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.proconfig,
 md5(regexp_replace(replace(p.prosrc,chr(13),''),'\s+',' ','g')) body_checksum,
 CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END grantee,a.privilege_type
FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
WHERE p.pronamespace='public'::regnamespace AND p.proname IN('dev_import_context_matches','dev_import_header_allowed','dev_import_registration_allowed','tv3_scheduling_input') ORDER BY 1,6;
SELECT b.batch_id,b.project_ref,b.environment,b.branch_id,b.period_id,b.enabled,
 b.manifest->>'plan_sha256' plan_checksum,b.manifest->>'baseline_sha256' baseline_checksum,
 jsonb_array_length(b.manifest->'after_images'->'employees') owned_employees,
 jsonb_array_length(b.manifest->'after_images'->'registration_submissions') owned_headers,
 jsonb_array_length(b.manifest->'after_images'->'shift_registrations') owned_registrations,
 EXISTS(SELECT 1 FROM public.audit_logs a WHERE a.id=(b.manifest->>'receipt_id')::uuid AND a.action='DEV_IMPORT_RECEIPT' AND a.new_data->'manifest'=b.manifest) immutable_receipt_matches
FROM public.dev_import_batches b;
SELECT r.rolname,has_table_privilege(r.oid,'public.dev_import_batches','SELECT') can_select,
 has_table_privilege(r.oid,'public.dev_import_batches','INSERT') can_insert,
 has_table_privilege(r.oid,'public.dev_import_batches','UPDATE') can_update,
 has_table_privilege(r.oid,'public.dev_import_batches','DELETE') can_delete
FROM pg_roles r WHERE rolname IN('anon','authenticated','service_role');
-- WITHOUT header: ordinary SQL excludes tagged samples, even after approved seed.
SELECT count(*) accepted_headers FROM public.registration_submissions_sourced
WHERE period_id='79a979cc-8347-48b5-a411-f03bd8aceb92' AND dev_import_allowed;
COMMIT;
