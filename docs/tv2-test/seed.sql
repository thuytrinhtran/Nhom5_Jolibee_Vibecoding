-- TEST DATABASE ONLY. Settings described in README must precede this script in the same session.
BEGIN;
DO $$ BEGIN
 IF current_setting('app.tv2_environment',true) IS DISTINCT FROM 'isolated-test'
 OR coalesce(current_setting('app.tv2_project_ref',true),'') IN ('','wlbpprpiieonjrqglicv','REPLACE_WITH_ISOLATED_PROJECT_REF')
 THEN RAISE EXCEPTION 'STOP: use an explicitly identified isolated TEST database, never the shared project.'; END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.tv2_test_batches (
 id uuid PRIMARY KEY, employee_id uuid NOT NULL REFERENCES public.employees(id),
 period_id uuid NOT NULL UNIQUE REFERENCES public.registration_periods(id),
 shift_ids uuid[] NOT NULL, project_ref text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tv2_test_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tv2_test_batches FROM PUBLIC,anon,authenticated;
DO $$
DECLARE e public.employees; uid uuid;
 batch uuid := '7f220000-0000-4000-8000-000000000001';
 period uuid := '7f220000-0000-4000-8000-000000000002';
 s1 uuid := '7f220000-0000-4000-8000-000000000003';
 s2 uuid := '7f220000-0000-4000-8000-000000000004';
 s3 uuid := '7f220000-0000-4000-8000-000000000005';
 monday date := date_trunc('week',clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
BEGIN
 IF to_regclass('public.registration_submissions') IS NULL OR to_regclass('public.registration_schedule_config') IS NULL THEN RAISE EXCEPTION 'Apply revised M1 then M2 on TEST first.'; END IF;
 IF EXISTS(SELECT 1 FROM public.tv2_test_batches WHERE id=batch) THEN RAISE NOTICE 'TEST batch exists. Deadline NOT extended; verify or cleanup first.'; RETURN; END IF;
 SELECT u.id INTO uid FROM public.users u WHERE u.username=coalesce(nullif(current_setting('app.tv2_test_username',true),''),'nv_jollibee') AND u.role='NV' AND u.is_active;
 SELECT * INTO e FROM public.employees WHERE user_id=uid AND status='ACTIVE' AND skill_level<>'CREW_LEADER';
 IF NOT FOUND THEN RAISE EXCEPTION 'Existing active non-Crew-Leader test employee required.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=uid AND branch_id=e.branch_id) THEN RAISE EXCEPTION 'User/employee branch mismatch.'; END IF;
 IF EXISTS(SELECT 1 FROM public.registration_periods WHERE branch_id=e.branch_id AND (close_at>clock_timestamp() OR work_start_date=monday))
 THEN RAISE EXCEPTION 'Period conflict: no data changed. Use a separate test branch/database.'; END IF;
 IF EXISTS(SELECT 1 FROM public.registration_automation_config WHERE enabled) THEN RAISE EXCEPTION 'Disable automation explicitly in TEST database first.'; END IF;
 INSERT INTO public.shifts(id,name,start_time,end_time,branch_id,is_active) VALUES
 (s1,'TEST TV2 - Sáng','08:00','12:00',e.branch_id,true),(s2,'TEST TV2 - Chiều','12:00','17:00',e.branch_id,true),(s3,'TEST TV2 - Tối','17:00','22:00',e.branch_id,true);
 INSERT INTO public.registration_periods(id,branch_id,work_start_date,work_end_date,open_at,close_at,status)
 VALUES(period,e.branch_id,monday,monday+6,clock_timestamp()-interval '1 minute',clock_timestamp()+interval '2 hours','OPEN');
 INSERT INTO public.tv2_test_batches(id,employee_id,period_id,shift_ids,project_ref)
 VALUES(batch,e.id,period,ARRAY[s1,s2,s3],current_setting('app.tv2_project_ref'));
END $$;
COMMIT;
