-- TEST DATABASE ONLY: settings required in same session. No Auth/user/employee/audit deletion.
BEGIN;
DO $$ BEGIN
 IF current_setting('app.tv2_environment',true) IS DISTINCT FROM 'isolated-test'
 OR coalesce(current_setting('app.tv2_project_ref',true),'') IN ('','wlbpprpiieonjrqglicv','REPLACE_WITH_ISOLATED_PROJECT_REF')
 THEN RAISE EXCEPTION 'STOP: use an explicitly identified isolated TEST database, never the shared project.'; END IF;
END $$;

DO $$
DECLARE b public.tv2_test_batches;
BEGIN
 SELECT * INTO b FROM public.tv2_test_batches WHERE id='7f220000-0000-4000-8000-000000000001' FOR UPDATE;
 IF NOT FOUND THEN RAISE NOTICE 'No TV2 TEST batch exists.'; RETURN; END IF;
 IF b.project_ref IS DISTINCT FROM current_setting('app.tv2_project_ref') THEN RAISE EXCEPTION 'Project identity mismatch.'; END IF;
 PERFORM 1 FROM public.registration_periods WHERE id=b.period_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.schedules WHERE period_id=b.period_id) THEN RAISE EXCEPTION 'Period used by scheduling; cleanup refused.'; END IF;
 IF EXISTS(SELECT 1 FROM public.shift_registrations WHERE period_id=b.period_id AND employee_id<>b.employee_id)
 OR EXISTS(SELECT 1 FROM public.registration_submissions WHERE period_id=b.period_id AND employee_id<>b.employee_id)
 THEN RAISE EXCEPTION 'Other employees used this period; cleanup refused.'; END IF;
 IF (SELECT count(*) FROM public.shifts WHERE id=ANY(b.shift_ids) AND name LIKE 'TEST TV2 - %')<>cardinality(b.shift_ids) THEN RAISE EXCEPTION 'TEST shift identity mismatch.'; END IF;
 DELETE FROM public.shift_registrations WHERE period_id=b.period_id AND employee_id=b.employee_id;
 DELETE FROM public.registration_submissions WHERE period_id=b.period_id AND employee_id=b.employee_id;
 DELETE FROM public.tv2_test_batches WHERE id=b.id;
 DELETE FROM public.registration_periods WHERE id=b.period_id;
 DELETE FROM public.shifts WHERE id=ANY(b.shift_ids) AND name LIKE 'TEST TV2 - %';
 -- Foreign keys reject and rollback if another module references TEST shifts.
 -- Immutable audit records and empty marker table intentionally remain.
END $$;
COMMIT;
