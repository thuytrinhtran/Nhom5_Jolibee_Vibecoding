-- SELECT-only checks in a READ ONLY transaction. Does not invoke writer RPCs.
-- Before deployment, missing future-stage facts are expected. Review the stage
-- just applied; do not require every future row to pass after the first file.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT current_setting('transaction_read_only') read_only,current_user,version();

SELECT 'TV4_BASE_published_by' check_name,EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.schedules'::regclass AND attname='published_by' AND NOT attisdropped) present
UNION ALL SELECT 'M1_source_v2',coalesce((SELECT position('tv3.rules.v2' IN prosrc)>0 FROM pg_proc WHERE oid=to_regprocedure('public.tv3_scheduling_input(uuid)')),false)
UNION ALL SELECT 'M2_workflow',to_regprocedure('public.tv4_transition_schedule_v2(uuid,uuid,integer,text,uuid,text,timestamp with time zone)') IS NOT NULL
UNION ALL SELECT 'M2_approval_trigger',EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.schedule_approvals'::regclass AND tgname='trg_validate_schedule_approval' AND tgenabled='O' AND (tgtype::integer & 28)=28)
UNION ALL SELECT 'M3_employee_read',to_regprocedure('public.employee_schedule_week(uuid,date)') IS NOT NULL
UNION ALL SELECT 'M4_mutate',to_regprocedure('public.tv5_mutate(uuid,text,uuid,jsonb)') IS NOT NULL
UNION ALL SELECT 'M4_current_index',to_regclass('public.tv5_current_employee_shift') IS NOT NULL
UNION ALL SELECT 'M4_open_request_index',to_regclass('public.tv5_open_request') IS NOT NULL
UNION ALL SELECT 'M4_successor_index',to_regclass('public.tv5_one_successor') IS NOT NULL
UNION ALL SELECT 'M5_registry',to_regclass('public.dev_import_batches') IS NOT NULL
UNION ALL SELECT 'M5_row_source',to_regclass('public.shift_registrations_sourced') IS NOT NULL
UNION ALL SELECT 'M6_materialized_source',coalesce((SELECT position('WITH approved_batches AS MATERIALIZED' IN prosrc)>0 FROM pg_proc WHERE oid=to_regprocedure('public.tv3_scheduling_input(uuid)')),false)
UNION ALL SELECT 'M6_budget_kept',coalesce((SELECT position('interval ''3 seconds''' IN prosrc)>0 FROM pg_proc WHERE oid=to_regprocedure('public.persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text)')),false);

SELECT p.oid::regprocedure signature,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.proconfig,
 md5(regexp_replace(replace(p.prosrc,chr(13),''),'\s+',' ','g')) body_md5,p.proacl
FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
 AND (p.proname ~ '^(tv[345]_|dev_import_)' OR p.proname IN('persist_schedule_draft','generate_schedule_draft','employee_schedule_week','validate_schedule_approval')) ORDER BY 1;

SELECT c.relname,r.rolname,has_table_privilege(r.oid,c.oid,'SELECT') can_select,
 has_table_privilege(r.oid,c.oid,'INSERT') can_insert,has_table_privilege(r.oid,c.oid,'UPDATE') can_update,
 has_table_privilege(r.oid,c.oid,'DELETE') can_delete,c.relrowsecurity
FROM pg_class c CROSS JOIN pg_roles r WHERE c.oid=to_regclass('public.dev_import_batches')
 AND r.rolname IN('anon','authenticated','service_role');
-- Registry: all four privileges false for each role, RLS true.

SELECT count(*) real_registration_rows FROM public.shift_registrations
WHERE period_id='79a979cc-8347-48b5-a411-f03bd8aceb92';
SELECT count(*) demand_cells,sum(required_count) positions FROM public.staffing_requirements
WHERE branch_id='11111111-1111-1111-1111-111111111111' AND work_date BETWEEN '2026-11-02' AND '2026-11-08';
COMMIT;
