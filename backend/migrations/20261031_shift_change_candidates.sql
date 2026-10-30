-- REVIEW ONLY. Apply manually to the isolated TEST project after TV5.
-- Read-only RPC; no table changes, seeds, scheduler or calls to business mutations.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog, public;

DO $$ BEGIN
  IF to_regprocedure('public.tv5_shift_change(text,uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'TV5 candidates preflight: missing function public.tv5_shift_change(text,uuid,jsonb)';
  END IF;
  IF to_regprocedure('public.tv5_assignment_start(date,time without time zone)') IS NULL THEN
    RAISE EXCEPTION 'TV5 candidates preflight: missing helper public.tv5_assignment_start(date,time without time zone)';
  END IF;
  IF to_regprocedure('public.tv5_schedule_state(uuid)') IS NULL THEN
    RAISE EXCEPTION 'TV5 candidates preflight: missing helper public.tv5_schedule_state(uuid)';
  END IF;
  IF to_regprocedure('public.tv5_assignment_current(uuid)') IS NULL THEN
    RAISE EXCEPTION 'TV5 candidates preflight: missing helper public.tv5_assignment_current(uuid)';
  END IF;
  IF to_regprocedure('public.tv5_candidate_eligible(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'TV5 candidates preflight: missing helper public.tv5_candidate_eligible(uuid,uuid)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='users' AND column_name='must_change_password') THEN
    RAISE EXCEPTION 'TV5 candidates preflight: missing column public.users.must_change_password (password-state migration required)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shift_change_requests' AND column_name='replacement_assignment_id') THEN
    RAISE EXCEPTION 'TV5 candidates preflight: missing column public.shift_change_requests.replacement_assignment_id (TV5 lineage required)';
  END IF;
END $$;

CREATE FUNCTION public.tv5_shift_change_candidates(p_actor_id uuid,p_assignment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actor public.users; v_emp public.employees; v_assignment public.shift_assignments;
  v_schedule public.schedules; v_shift public.shifts; v_state text; v_deadline timestamptz;
  v_candidates jsonb;
BEGIN
  SELECT * INTO v_actor FROM public.users WHERE id=p_actor_id;
  IF NOT FOUND OR v_actor.is_active IS NOT TRUE OR v_actor.must_change_password IS DISTINCT FROM false
    OR v_actor.role IS DISTINCT FROM 'NV' OR v_actor.branch_id IS NULL THEN
    RAISE EXCEPTION 'TV5:FORBIDDEN';
  END IF;
  SELECT * INTO v_emp FROM public.employees WHERE user_id=v_actor.id;
  IF NOT FOUND OR v_emp.status IS DISTINCT FROM 'ACTIVE'
    OR v_emp.branch_id IS DISTINCT FROM v_actor.branch_id THEN RAISE EXCEPTION 'TV5:FORBIDDEN'; END IF;

  -- Ownership and branch checks precede schedule diagnostics or candidate disclosure.
  SELECT a.* INTO v_assignment FROM public.shift_assignments a
    JOIN public.schedules s ON s.id=a.schedule_id
    WHERE a.id=p_assignment_id AND a.employee_id=v_emp.id
      AND s.branch_id=v_actor.branch_id AND a.actual_branch_id=v_actor.branch_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'TV5:NOT_FOUND'; END IF;
  SELECT * INTO STRICT v_schedule FROM public.schedules WHERE id=v_assignment.schedule_id;
  SELECT * INTO STRICT v_shift FROM public.shifts WHERE id=v_assignment.shift_id;
  v_state:=public.tv5_schedule_state(v_schedule.id);
  IF v_state='AMBIGUOUS_PUBLISHED_SCHEDULE' THEN RAISE EXCEPTION 'TV5:AMBIGUOUS_PUBLISHED_SCHEDULE'; END IF;
  IF v_state='STALE_PUBLISHED_SCHEDULE' THEN RAISE EXCEPTION 'TV5:STALE_PUBLISHED_SCHEDULE'; END IF;
  IF EXISTS (SELECT 1 FROM public.shift_change_requests r WHERE r.status='APPROVED'
    AND (r.original_assignment_id=v_assignment.id OR r.replacement_assignment_id=v_assignment.id)) THEN
    RAISE EXCEPTION 'TV5:ALREADY_CHANGED';
  END IF;
  IF NOT public.tv5_assignment_current(v_assignment.id) THEN RAISE EXCEPTION 'TV5:INVALID_ASSIGNMENT'; END IF;
  v_deadline:=public.tv5_assignment_start(v_assignment.work_date,v_shift.start_time)-interval '60 minutes';
  IF clock_timestamp()>=v_deadline THEN RAISE EXCEPTION 'TV5:DEADLINE_PASSED'; END IF;
  IF EXISTS (SELECT 1 FROM public.shift_change_requests r WHERE r.original_assignment_id=v_assignment.id
    AND r.status IN ('PENDING','SEARCHING')) THEN RAISE EXCEPTION 'TV5:DUPLICATE_REQUEST'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('employee_id',e.id,'full_name',e.full_name)
    ORDER BY e.full_name,e.id),'[]'::jsonb) INTO v_candidates
    FROM public.employees e WHERE e.branch_id=v_actor.branch_id
      AND public.tv5_candidate_eligible(v_assignment.id,e.id);
  IF clock_timestamp()>=v_deadline THEN RAISE EXCEPTION 'TV5:DEADLINE_PASSED'; END IF;
  RETURN jsonb_build_object('assignment_id',v_assignment.id,'request_deadline_at',v_deadline,'candidates',v_candidates);
END;
$$;
ALTER FUNCTION public.tv5_shift_change_candidates(uuid,uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tv5_shift_change_candidates(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.tv5_shift_change_candidates(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
