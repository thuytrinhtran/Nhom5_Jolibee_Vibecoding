-- Run in a disposable Supabase test database AFTER the base schema and both migrations.
-- All fixture writes are rolled back. No existing rows are updated/deleted.
BEGIN;
DO $$
DECLARE
  actor uuid := gen_random_uuid(); employee_user uuid := gen_random_uuid();
  branch uuid := gen_random_uuid(); department uuid := gen_random_uuid();
  employee uuid := gen_random_uuid(); shift uuid := gen_random_uuid();
  period uuid := gen_random_uuid(); requirement uuid := gen_random_uuid();
  snapshot jsonb; generated jsonb; saved jsonb; replay jsonb; sid uuid;
BEGIN
  INSERT INTO auth.users(id) VALUES(actor),(employee_user);
  INSERT INTO public.branches(id,name) VALUES(branch,'scheduling-test-'||branch);
  INSERT INTO public.users(id,username,role,branch_id) VALUES
    (actor,'scheduling-ql-'||actor,'QL',branch),
    (employee_user,'scheduling-nv-'||employee_user,'NV',branch);
  INSERT INTO public.departments(id,name) VALUES(department,'scheduling-test-'||department);
  INSERT INTO public.employees(id,user_id,full_name,branch_id,department_id,skill_level,max_weekly_hours)
    VALUES(employee,employee_user,'Synthetic scheduling fixture',branch,department,'REGULAR',8);
  INSERT INTO public.shifts(id,name,start_time,end_time,branch_id) VALUES(shift,'Synthetic shift','08:00','12:00',branch);
  INSERT INTO public.registration_periods(id,branch_id,work_start_date,work_end_date,open_at,close_at,status)
    VALUES(period,branch,'2099-11-02','2099-11-08','2099-10-30 15:00+07','2099-11-01 12:00+07','CLOSED');
  INSERT INTO public.shift_registrations(period_id,employee_id,work_date,shift_id,status)
    VALUES(period,employee,'2099-11-02',shift,'VALID');
  INSERT INTO public.staffing_requirements(id,branch_id,department_id,shift_id,work_date,required_count,created_by)
    VALUES(requirement,branch,department,shift,'2099-11-02',1,actor);
  snapshot := public.generate_schedule_draft(period,actor)->'input';
  IF jsonb_array_length(snapshot->'employees') <> 1 THEN RAISE EXCEPTION 'snapshot incorrect'; END IF;
  generated := jsonb_build_object('assignments',jsonb_build_array(jsonb_build_object(
    'employee_id',employee,'work_date','2099-11-02','shift_id',shift,'department_id',department)));
  -- Snapshot changes abort before any schedule is saved.
  BEGIN
    PERFORM public.generate_schedule_draft(period,actor,'{}',generated);
    RAISE EXCEPTION 'stale snapshot accepted';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  -- Duplicate assignment forces rollback of BOTH schedule and assignment writes.
  BEGIN
    PERFORM public.generate_schedule_draft(period,actor,snapshot,
      jsonb_build_object('assignments',(generated->'assignments')||(generated->'assignments')));
    RAISE EXCEPTION 'duplicate assignment accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  IF EXISTS(SELECT 1 FROM public.schedules WHERE period_id=period) THEN RAISE EXCEPTION 'partial schedule committed'; END IF;
  saved := public.generate_schedule_draft(period,actor,snapshot,generated);
  sid := (saved->'result'->'schedule'->>'id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.schedules WHERE id=sid AND status='DRAFT') OR
    (SELECT count(*) FROM public.shift_assignments WHERE schedule_id=sid) <> 1 OR
    (SELECT count(*) FROM public.audit_logs WHERE entity_id=sid AND action='AUTO_GENERATE') <> 1
    THEN RAISE EXCEPTION 'persistence or audit failed'; END IF;
  replay := public.generate_schedule_draft(period,actor);
  IF replay->>'reused' <> 'true' OR replay->'result' <> saved->'result' THEN RAISE EXCEPTION 'retry not idempotent'; END IF;
  BEGIN
    PERFORM public.generate_schedule_draft(period,employee_user);
    RAISE EXCEPTION 'NV accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE public.schedules SET status='PENDING_APPROVAL' WHERE id=sid;
  BEGIN
    PERFORM public.generate_schedule_draft(period,actor);
    RAISE EXCEPTION 'protected schedule accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'SCHEDULE_EXISTS' THEN RAISE; END IF;
  END;
  IF has_function_privilege('authenticated','public.generate_schedule_draft(uuid,uuid,jsonb,jsonb)','EXECUTE') OR
     has_function_privilege('anon','public.generate_schedule_draft(uuid,uuid,jsonb,jsonb)','EXECUTE')
    THEN RAISE EXCEPTION 'RPC exposed'; END IF;
END $$;
ROLLBACK;
