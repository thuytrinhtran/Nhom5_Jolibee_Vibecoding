-- REVIEW ONLY. Apply manually to the isolated TEST project after foundation/Auth migrations.
-- No seed, cron, external calls, AI, destructive DDL or changes to existing modules.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog, public;

DO $$ BEGIN
  IF to_regclass('public.shift_change_requests') IS NULL
     OR to_regclass('public.replacement_invitations') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
                    AND table_name='users' AND column_name='must_change_password') THEN
    RAISE EXCEPTION 'TV5 requires foundation and password-state migration';
  END IF;
END $$;

-- Persist lineage instead of inferring it from timestamps or employee/shift coincidence.
-- This migration has not been applied. Refuse pre-existing approved requests without lineage.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.shift_change_requests WHERE status='APPROVED') THEN
    RAISE EXCEPTION 'TV5: approved requests exist; review lineage in a forward migration';
  END IF;
END $$;
ALTER TABLE public.shift_change_requests ADD COLUMN replacement_assignment_id uuid
  REFERENCES public.shift_assignments(id);
ALTER TABLE public.shift_change_requests ADD CONSTRAINT tv5_approved_has_assignment
  CHECK (status<>'APPROVED' OR replacement_assignment_id IS NOT NULL);
CREATE UNIQUE INDEX tv5_replacement_assignment_once
  ON public.shift_change_requests(replacement_assignment_id) WHERE replacement_assignment_id IS NOT NULL;

-- Refuse ambiguous existing duplicate open requests rather than modifying old data.
CREATE UNIQUE INDEX tv5_one_open_request_per_assignment
  ON public.shift_change_requests(original_assignment_id) WHERE status IN ('PENDING','SEARCHING');
CREATE UNIQUE INDEX tv5_one_invitation_per_request_employee
  ON public.replacement_invitations(shift_change_request_id,target_employee_id)
  WHERE shift_change_request_id IS NOT NULL;

-- Fixed Vietnam business timezone, matching the existing scheduling contract.
CREATE FUNCTION public.tv5_assignment_start(p_date date, p_time time)
RETURNS timestamptz LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
  SELECT (p_date+p_time) AT TIME ZONE 'Asia/Ho_Chi_Minh'
$$;

-- Resolve only PUBLISHED versions. A newer draft never supersedes a published schedule.
-- Multiple published groups for one branch/week have no official selector in the schema.
CREATE FUNCTION public.tv5_schedule_state(p_schedule uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE chosen public.schedules; week_start date; published_groups integer;
BEGIN
  SELECT * INTO chosen FROM public.schedules WHERE id=p_schedule;
  IF NOT FOUND THEN RETURN 'INVALID_ASSIGNMENT'; END IF;
  SELECT work_start_date INTO week_start FROM public.registration_periods WHERE id=chosen.period_id;
  SELECT count(DISTINCT s.schedule_group_id) INTO published_groups
    FROM public.schedules s JOIN public.registration_periods rp ON rp.id=s.period_id
    WHERE s.branch_id=chosen.branch_id AND rp.branch_id=chosen.branch_id
      AND rp.work_start_date=week_start AND s.status='PUBLISHED';
  IF published_groups>1 THEN RETURN 'AMBIGUOUS_PUBLISHED_SCHEDULE'; END IF;
  IF chosen.status<>'PUBLISHED' THEN RETURN 'INVALID_ASSIGNMENT'; END IF;
  IF EXISTS (SELECT 1 FROM public.schedules newer WHERE newer.schedule_group_id=chosen.schedule_group_id
    AND newer.branch_id=chosen.branch_id AND newer.period_id=chosen.period_id
    AND newer.status='PUBLISHED' AND newer.version>chosen.version) THEN RETURN 'STALE_PUBLISHED_SCHEDULE'; END IF;
  RETURN 'VALID';
END;
$$;

CREATE FUNCTION public.tv5_assignment_current(p_assignment uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.shift_assignments a JOIN public.schedules s ON s.id=a.schedule_id
    JOIN public.shifts sh ON sh.id=a.shift_id JOIN public.branches b ON b.id=s.branch_id
    JOIN public.registration_periods rp ON rp.id=s.period_id
    JOIN public.employees owner_emp ON owner_emp.id=a.employee_id
    JOIN public.users owner_user ON owner_user.id=owner_emp.user_id
    WHERE a.id=p_assignment AND a.status='ACTIVE' AND s.status='PUBLISHED' AND b.status='ACTIVE'
      AND a.actual_branch_id=s.branch_id AND sh.is_active
      AND (sh.branch_id IS NULL OR sh.branch_id=s.branch_id)
      AND rp.branch_id=s.branch_id AND a.work_date BETWEEN rp.work_start_date AND rp.work_end_date
      AND owner_emp.status='ACTIVE' AND owner_user.is_active AND owner_user.role='NV'
      AND owner_emp.branch_id=s.branch_id AND owner_user.branch_id=s.branch_id
      AND owner_emp.department_id=a.department_id
      AND NOT EXISTS (SELECT 1 FROM public.shift_change_requests done WHERE done.status='APPROVED'
        AND (done.original_assignment_id=a.id OR done.replacement_assignment_id=a.id))
      AND public.tv5_schedule_state(s.id)='VALID'
  )
$$;

-- Eligibility is authoritative in SQL; no browser-supplied candidate snapshot is trusted.
CREATE FUNCTION public.tv5_candidate_eligible(p_assignment uuid,p_employee uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.shift_assignments a JOIN public.shifts sh ON sh.id=a.shift_id
    JOIN public.schedules s ON s.id=a.schedule_id
    JOIN public.employees e ON e.id=p_employee JOIN public.users u ON u.id=e.user_id
    WHERE a.id=p_assignment AND public.tv5_assignment_current(a.id)
      AND e.id<>a.employee_id AND e.status='ACTIVE' AND u.is_active AND NOT u.must_change_password
      AND u.role='NV' AND e.branch_id=s.branch_id AND u.branch_id=e.branch_id
      AND e.department_id=a.department_id
      AND ((a.assignment_source='CREW_LEADER' AND e.skill_level='CREW_LEADER')
        OR (a.assignment_source<>'CREW_LEADER' AND e.skill_level<>'CREW_LEADER'))
      AND NOT EXISTS (SELECT 1 FROM public.crew_leader_days_off d
        WHERE d.employee_id=e.id AND d.day_off=a.work_date)
      AND NOT EXISTS (
        SELECT 1 FROM public.staffing_requirements r WHERE r.branch_id=a.actual_branch_id
        AND r.department_id=a.department_id AND r.shift_id=a.shift_id AND r.work_date=a.work_date
        AND r.required_skill_name IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.employee_skills es WHERE es.employee_id=e.id AND es.skill_name=r.required_skill_name))
      -- Existing uniqueness includes REPLACED rows too: never delete history to bypass it.
      AND NOT EXISTS (SELECT 1 FROM public.shift_assignments x WHERE x.schedule_id=a.schedule_id
        AND x.employee_id=e.id AND x.work_date=a.work_date AND x.shift_id=a.shift_id)
      -- Conservative: all non-REPLACED assignments, including drafts, reserve availability.
      AND NOT EXISTS (
        SELECT 1 FROM public.shift_assignments x JOIN public.shifts xs ON xs.id=x.shift_id
        WHERE x.employee_id=e.id AND x.status<>'REPLACED'
        AND public.tv5_assignment_start(x.work_date,xs.start_time)
            < public.tv5_assignment_start(a.work_date,sh.end_time)+CASE WHEN sh.end_time<sh.start_time THEN interval '1 day' ELSE interval '0' END
        AND public.tv5_assignment_start(a.work_date,sh.start_time)
            < public.tv5_assignment_start(x.work_date,xs.end_time)+CASE WHEN xs.end_time<xs.start_time THEN interval '1 day' ELSE interval '0' END)
      -- Count actual overlapping hours in every calendar week touched by the target shift.
      AND (e.max_weekly_hours IS NULL OR NOT EXISTS (
        SELECT 1 FROM generate_series(0,CASE WHEN date_trunc('week',a.work_date::timestamp)
          <>date_trunc('week',(a.work_date+sh.end_time+CASE WHEN sh.end_time<sh.start_time THEN interval '1 day' ELSE interval '0' END)-interval '1 microsecond')
          THEN 1 ELSE 0 END) w(n)
        CROSS JOIN LATERAL (SELECT date_trunc('week',a.work_date::timestamp)+w.n*interval '7 days' AS lo) week
        WHERE (
          extract(epoch FROM (least(a.work_date+sh.end_time+CASE WHEN sh.end_time<sh.start_time THEN interval '1 day' ELSE interval '0' END,week.lo+interval '7 days')
            - greatest(a.work_date+sh.start_time,week.lo)))/3600
          + coalesce((SELECT sum(greatest(0,extract(epoch FROM (
              least(x.work_date+xs.end_time+CASE WHEN xs.end_time<xs.start_time THEN interval '1 day' ELSE interval '0' END,week.lo+interval '7 days')
              - greatest(x.work_date+xs.start_time,week.lo)))/3600))
              FROM public.shift_assignments x JOIN public.shifts xs ON xs.id=x.shift_id
              WHERE x.employee_id=e.id AND x.status<>'REPLACED'),0)
        )>e.max_weekly_hours))
  )
$$;

-- Shared T-60 warning path for Cron and interactive reconciliation. No request/schedule writes.
CREATE FUNCTION public.tv5_alert_due(p_request uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='1s' AS $$
DECLARE checked_at timestamptz; inserted_count integer;
BEGIN
  IF NOT pg_try_advisory_xact_lock(72910560) THEN RETURN 0; END IF;
  -- Same leading lock order as mutation RPC: do not race approval or an invalidated schedule.
  -- SHARE blocks concurrent source writes only during this short notification transaction.
  LOCK TABLE public.branches,public.users,public.employees,public.shifts,public.registration_periods,
    public.schedules,public.shift_assignments,public.shift_change_requests,public.replacement_invitations IN SHARE MODE;
  checked_at:=clock_timestamp();
  WITH due AS (
    SELECT r.id,s.branch_id,public.tv5_assignment_start(a.work_date,sh.start_time) AS starts_at
    FROM public.shift_change_requests r
    JOIN public.shift_assignments a ON a.id=r.original_assignment_id
    JOIN public.schedules s ON s.id=a.schedule_id JOIN public.shifts sh ON sh.id=a.shift_id
    WHERE (p_request IS NULL OR r.id=p_request) AND r.status IN ('PENDING','SEARCHING')
      AND r.requesting_employee_id=a.employee_id AND public.tv5_assignment_current(a.id)
      AND public.tv5_assignment_start(a.work_date,sh.start_time)-interval '60 minutes'<=checked_at
      AND checked_at<public.tv5_assignment_start(a.work_date,sh.start_time)
      AND NOT EXISTS (SELECT 1 FROM public.replacement_invitations i
        WHERE i.shift_change_request_id=r.id AND i.status='ACCEPTED' AND i.expires_at>checked_at)
  )
  INSERT INTO public.notifications(recipient_id,type,title,content,idempotency_key)
    SELECT u.id,'SHIFT_CHANGE_T60_ALERT','Chưa có người đồng ý nhận ca',
      'Yêu cầu '||d.id::text||' đã đến mốc 60 phút trước ca và chưa có người đồng ý.',
      'tv5:t60:'||d.id::text||':'||extract(epoch FROM (d.starts_at-interval '60 minutes'))::text||':'||u.id::text
    FROM due d JOIN public.users u ON u.branch_id=d.branch_id AND u.role='QL' AND u.is_active
    ON CONFLICT(idempotency_key) DO NOTHING;
  GET DIAGNOSTICS inserted_count=ROW_COUNT;
  RETURN inserted_count;
END;
$$;

-- Caller already holds the mutation locks. Internal only; never exposed to server/browser roles.
CREATE FUNCTION public.tv5_refresh_search(p_request uuid,p_actor uuid,p_expand boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.shift_change_requests; a public.shift_assignments; sh public.shifts;
  deadline timestamptz; added integer:=0; available integer; pending integer; warning boolean;
BEGIN
  SELECT * INTO STRICT r FROM public.shift_change_requests WHERE id=p_request;
  SELECT * INTO STRICT a FROM public.shift_assignments WHERE id=r.original_assignment_id;
  SELECT * INTO STRICT sh FROM public.shifts WHERE id=a.shift_id;
  deadline:=public.tv5_assignment_start(a.work_date,sh.start_time);
  UPDATE public.replacement_invitations SET status='EXPIRED',valid_when_confirmed=false
    WHERE shift_change_request_id=r.id AND status IN ('PENDING','ACCEPTED')
      AND least(expires_at,deadline)<=clock_timestamp();
  IF p_expand AND deadline>clock_timestamp() AND public.tv5_assignment_current(a.id) THEN
    WITH invited AS (
      INSERT INTO public.replacement_invitations(shift_change_request_id,target_employee_id,expires_at)
      SELECT r.id,e.id,deadline FROM public.employees e
      WHERE public.tv5_candidate_eligible(a.id,e.id)
        AND NOT EXISTS (SELECT 1 FROM public.replacement_invitations i WHERE i.shift_change_request_id=r.id AND i.target_employee_id=e.id)
      ORDER BY e.id RETURNING id,target_employee_id
    ), notices AS (
      INSERT INTO public.notifications(recipient_id,type,title,content,idempotency_key)
      SELECT e.user_id,'SHIFT_CHANGE_INVITATION','Lời mời nhận ca',
        'Bạn có lời mời nhận ca. Mở mục đổi ca để phản hồi trước giờ bắt đầu ca.', 'tv5:invite:'||i.id::text
      FROM invited i JOIN public.employees e ON e.id=i.target_employee_id RETURNING id
    ) SELECT count(*) INTO added FROM notices;
  END IF;
  SELECT count(*) FILTER (WHERE i.status='ACCEPTED'),count(*) FILTER (WHERE i.status='PENDING')
    INTO available,pending FROM public.replacement_invitations i
    WHERE i.shift_change_request_id=r.id AND least(i.expires_at,deadline)>clock_timestamp()
      AND public.tv5_candidate_eligible(a.id,i.target_employee_id);
  warning:=available=0 AND pending=0;
  UPDATE public.shift_change_requests SET status=CASE WHEN available>0 THEN 'PENDING' ELSE 'SEARCHING' END
    WHERE id=r.id;
  -- Availability warning remains visible in API; persisted manager alert is only sent at T-60.
  PERFORM public.tv5_alert_due(r.id);
  RETURN jsonb_build_object('request_id',r.id,'invitations_created',added,'accepted_count',available,
    'pending_count',pending,'warning',CASE WHEN warning THEN 'NO_AVAILABLE_REPLACEMENT' ELSE NULL END);
END;
$$;

-- One entry point: GET actions never mutate. Expiration/search reconciliation is explicit POST.
CREATE FUNCTION public.tv5_shift_change(p_action text,p_actor_id uuid,p_input jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='5s' AS $$
DECLARE actor public.users; emp public.employees; v_assignment public.shift_assignments; v_schedule public.schedules;
  v_shift public.shifts; v_request public.shift_change_requests; inv public.replacement_invitations;
  target uuid; proposed uuid; deadline timestamptz; result jsonb; old_row jsonb; new_assignment uuid;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('assignments','requests','invitations','create','respond','decision','refresh')
    OR p_input IS NULL OR jsonb_typeof(p_input)<>'object' THEN RAISE EXCEPTION 'TV5:INVALID_INPUT'; END IF;
  IF p_action IN ('create','respond','decision','refresh') THEN
    -- Conservative cross-module serialization: block concurrent writes to eligibility inputs.
    -- Locks are acquired BEFORE any row locks; compatible reads remain possible.
    LOCK TABLE public.branches,public.users,public.employees,public.shifts,public.employee_skills,
      public.staffing_requirements,public.crew_leader_days_off,public.registration_periods,
      public.schedules,public.shift_assignments,public.shift_change_requests,public.replacement_invitations
      IN SHARE ROW EXCLUSIVE MODE;
  END IF;
  SELECT * INTO actor FROM public.users WHERE id=p_actor_id;
  IF NOT FOUND OR NOT actor.is_active OR actor.must_change_password OR actor.role NOT IN ('NV','QL')
    OR actor.branch_id IS NULL THEN RAISE EXCEPTION 'TV5:FORBIDDEN'; END IF;
  IF actor.role='NV' THEN
    SELECT * INTO emp FROM public.employees WHERE user_id=actor.id;
    IF NOT FOUND OR emp.status<>'ACTIVE' OR emp.branch_id<>actor.branch_id THEN RAISE EXCEPTION 'TV5:FORBIDDEN'; END IF;
  END IF;
  IF (p_action IN ('assignments','invitations','create','respond') AND actor.role<>'NV')
    OR (p_action IN ('decision','refresh') AND actor.role<>'QL') THEN RAISE EXCEPTION 'TV5:FORBIDDEN'; END IF;

  IF p_action='assignments' THEN
    RETURN jsonb_build_object('assignments',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.work_date,x.id) FROM (
      SELECT a.*,jsonb_build_object('name',sh.name,'start_time',sh.start_time,'end_time',sh.end_time) AS shift,
        public.tv5_assignment_start(a.work_date,sh.start_time)-interval '60 minutes' AS request_deadline_at
        FROM public.shift_assignments a JOIN public.schedules s ON s.id=a.schedule_id
        JOIN public.shifts sh ON sh.id=a.shift_id
      WHERE a.employee_id=emp.id AND public.tv5_assignment_current(a.id)
        AND clock_timestamp()<public.tv5_assignment_start(a.work_date,sh.start_time)-interval '60 minutes'
        AND NOT EXISTS (SELECT 1 FROM public.shift_change_requests r WHERE r.original_assignment_id=a.id AND r.status IN ('PENDING','SEARCHING'))
    ) x),'[]'::jsonb), 'schedule_issues',coalesce((
      SELECT jsonb_agg(jsonb_build_object('schedule_id',q.schedule_id,'code',q.code)) FROM (
        SELECT DISTINCT a.schedule_id,public.tv5_schedule_state(a.schedule_id) AS code
        FROM public.shift_assignments a WHERE a.employee_id=emp.id AND a.status='ACTIVE'
          AND public.tv5_schedule_state(a.schedule_id) IN ('AMBIGUOUS_PUBLISHED_SCHEDULE','STALE_PUBLISHED_SCHEDULE')
      ) q),'[]'::jsonb));
  ELSIF p_action='requests' THEN
    RETURN jsonb_build_object('requests',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id) FROM (
      SELECT r.*,to_jsonb(a) AS original_assignment,public.tv5_schedule_state(a.schedule_id) AS schedule_state,
        jsonb_build_object('name',sh.name,'start_time',sh.start_time,'end_time',sh.end_time) AS shift,
        e.full_name AS requesting_employee_name,
        CASE WHEN r.status IN ('PENDING','SEARCHING') AND NOT EXISTS (
          SELECT 1 FROM public.replacement_invitations wi WHERE wi.shift_change_request_id=r.id
            AND wi.status IN ('PENDING','ACCEPTED') AND wi.expires_at>clock_timestamp()
            AND public.tv5_candidate_eligible(a.id,wi.target_employee_id)
        ) THEN 'NO_AVAILABLE_REPLACEMENT' ELSE NULL END AS warning,
        coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.id,'target_employee_id',i.target_employee_id,
          'full_name',ie.full_name,'status',i.status,'expires_at',i.expires_at,'responded_at',i.responded_at,
          'effective_status',CASE WHEN least(i.expires_at,public.tv5_assignment_start(a.work_date,sh.start_time))<=clock_timestamp()
            AND i.status IN ('PENDING','ACCEPTED') THEN 'EXPIRED' ELSE i.status END,
          'eligible_now',public.tv5_candidate_eligible(a.id,i.target_employee_id)) ORDER BY i.sent_at,i.id)
          FROM public.replacement_invitations i JOIN public.employees ie ON ie.id=i.target_employee_id
          WHERE i.shift_change_request_id=r.id),'[]'::jsonb) AS invitations
      FROM public.shift_change_requests r JOIN public.shift_assignments a ON a.id=r.original_assignment_id
      JOIN public.schedules s ON s.id=a.schedule_id JOIN public.shifts sh ON sh.id=a.shift_id
      JOIN public.employees e ON e.id=r.requesting_employee_id
      WHERE (actor.role='NV' AND r.requesting_employee_id=emp.id)
         OR (actor.role='QL' AND s.branch_id=actor.branch_id AND a.actual_branch_id=actor.branch_id)
    ) x),'[]'::jsonb));
  ELSIF p_action='invitations' THEN
    RETURN jsonb_build_object('invitations',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.sent_at DESC,x.id) FROM (
      SELECT i.*,to_jsonb(a) AS assignment,sh.name AS shift_name,sh.start_time,sh.end_time,
        CASE WHEN least(i.expires_at,public.tv5_assignment_start(a.work_date,sh.start_time))<=clock_timestamp()
          AND i.status IN ('PENDING','ACCEPTED') THEN 'EXPIRED' ELSE i.status END AS effective_status
      FROM public.replacement_invitations i JOIN public.shift_change_requests r ON r.id=i.shift_change_request_id
      JOIN public.shift_assignments a ON a.id=r.original_assignment_id JOIN public.shifts sh ON sh.id=a.shift_id
      WHERE i.target_employee_id=emp.id
    ) x),'[]'::jsonb));
  END IF;

  IF p_action='create' THEN
    IF nullif(btrim(p_input->>'reason'),'') IS NULL THEN RAISE EXCEPTION 'TV5:INVALID_INPUT'; END IF;
    SELECT * INTO v_assignment FROM public.shift_assignments WHERE id=(p_input->>'original_assignment_id')::uuid FOR UPDATE;
    IF NOT FOUND OR v_assignment.employee_id<>emp.id THEN RAISE EXCEPTION 'TV5:NOT_FOUND'; END IF;
  ELSE
    IF p_action='respond' THEN
      SELECT * INTO inv FROM public.replacement_invitations WHERE id=(p_input->>'id')::uuid FOR UPDATE;
      IF NOT FOUND OR inv.target_employee_id<>emp.id OR inv.shift_change_request_id IS NULL THEN RAISE EXCEPTION 'TV5:NOT_FOUND'; END IF;
      SELECT * INTO v_request FROM public.shift_change_requests WHERE id=inv.shift_change_request_id FOR UPDATE;
    ELSE
      SELECT * INTO v_request FROM public.shift_change_requests WHERE id=(p_input->>'id')::uuid FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'TV5:NOT_FOUND'; END IF;
    END IF;
    SELECT * INTO v_assignment FROM public.shift_assignments WHERE id=v_request.original_assignment_id FOR UPDATE;
  END IF;
  SELECT * INTO STRICT v_schedule FROM public.schedules WHERE id=v_assignment.schedule_id;
  SELECT * INTO STRICT v_shift FROM public.shifts WHERE id=v_assignment.shift_id;
  deadline:=public.tv5_assignment_start(v_assignment.work_date,v_shift.start_time);
  IF actor.role='QL' AND (v_schedule.branch_id<>actor.branch_id OR v_assignment.actual_branch_id<>actor.branch_id) THEN RAISE EXCEPTION 'TV5:NOT_FOUND'; END IF;
  IF p_action<>'create' AND v_request.status NOT IN ('PENDING','SEARCHING') THEN RAISE EXCEPTION 'TV5:INVALID_STATE'; END IF;
  old_row:=CASE WHEN p_action='create' THEN NULL ELSE to_jsonb(v_request) END;
  IF p_action IN ('create','respond','refresh') OR (p_action='decision' AND p_input->>'decision'='APPROVED') THEN
    IF public.tv5_schedule_state(v_schedule.id)='AMBIGUOUS_PUBLISHED_SCHEDULE' THEN RAISE EXCEPTION 'TV5:AMBIGUOUS_PUBLISHED_SCHEDULE'; END IF;
    IF public.tv5_schedule_state(v_schedule.id)='STALE_PUBLISHED_SCHEDULE' THEN RAISE EXCEPTION 'TV5:STALE_PUBLISHED_SCHEDULE'; END IF;
  END IF;

  IF p_action='create' THEN
    IF EXISTS (SELECT 1 FROM public.shift_change_requests done WHERE done.status='APPROVED'
      AND (done.original_assignment_id=v_assignment.id OR done.replacement_assignment_id=v_assignment.id)) THEN RAISE EXCEPTION 'TV5:ALREADY_CHANGED'; END IF;
    IF NOT public.tv5_assignment_current(v_assignment.id) THEN RAISE EXCEPTION 'TV5:INVALID_ASSIGNMENT'; END IF;
    IF clock_timestamp()>=deadline-interval '60 minutes' THEN RAISE EXCEPTION 'TV5:DEADLINE_PASSED'; END IF;
    IF EXISTS (SELECT 1 FROM public.shift_change_requests WHERE original_assignment_id=v_assignment.id AND status IN ('PENDING','SEARCHING')) THEN RAISE EXCEPTION 'TV5:DUPLICATE_REQUEST'; END IF;
    proposed:=(p_input->>'proposed_employee_id')::uuid;
    IF proposed IS NOT NULL AND NOT public.tv5_candidate_eligible(v_assignment.id,proposed) THEN RAISE EXCEPTION 'TV5:INELIGIBLE_REPLACEMENT'; END IF;
    IF clock_timestamp()>=deadline-interval '60 minutes' THEN RAISE EXCEPTION 'TV5:DEADLINE_PASSED'; END IF;
    INSERT INTO public.shift_change_requests(original_assignment_id,requesting_employee_id,reason,status)
      VALUES(v_assignment.id,emp.id,btrim(p_input->>'reason'),'SEARCHING') RETURNING * INTO v_request;
    IF proposed IS NOT NULL THEN
      INSERT INTO public.replacement_invitations(shift_change_request_id,target_employee_id,expires_at)
        VALUES(v_request.id,proposed,deadline) RETURNING * INTO inv;
      INSERT INTO public.notifications(recipient_id,type,title,content,idempotency_key)
        SELECT user_id,'SHIFT_CHANGE_INVITATION','Lời mời nhận ca','Bạn được đề xuất nhận ca; hãy xác nhận trước giờ bắt đầu ca.',
          'tv5:invite:'||inv.id::text FROM public.employees WHERE id=proposed;
    END IF;
    result:=public.tv5_refresh_search(v_request.id,actor.id,proposed IS NULL);
  ELSIF p_action='respond' THEN
    IF p_input->>'response' IS NULL OR p_input->>'response' NOT IN ('ACCEPTED','DECLINED') THEN RAISE EXCEPTION 'TV5:INVALID_INPUT'; END IF;
    IF inv.status<>'PENDING' THEN RAISE EXCEPTION 'TV5:INVALID_STATE'; END IF;
    IF least(inv.expires_at,deadline)<=clock_timestamp() THEN
      -- Commit expiry and escalation; raising here would roll them back.
      result:=public.tv5_refresh_search(v_request.id,actor.id,true)||jsonb_build_object('response_recorded',false,'expired',true);
    ELSE
      IF NOT public.tv5_assignment_current(v_assignment.id) THEN RAISE EXCEPTION 'TV5:INVALID_ASSIGNMENT'; END IF;
      IF p_input->>'response'='ACCEPTED' AND NOT public.tv5_candidate_eligible(v_assignment.id,emp.id) THEN RAISE EXCEPTION 'TV5:INELIGIBLE_REPLACEMENT'; END IF;
      -- Recheck after eligibility work, using the CURRENT (locked) shift start and stored expiry.
      UPDATE public.replacement_invitations SET status=p_input->>'response',responded_at=clock_timestamp(),
        valid_when_confirmed=CASE WHEN p_input->>'response'='ACCEPTED' THEN true ELSE NULL END
        WHERE id=inv.id AND clock_timestamp()<least(inv.expires_at,public.tv5_assignment_start(v_assignment.work_date,v_shift.start_time));
      IF NOT FOUND THEN RAISE EXCEPTION 'TV5:DEADLINE_PASSED'; END IF;
      result:=public.tv5_refresh_search(v_request.id,actor.id,p_input->>'response'='DECLINED')||jsonb_build_object('response_recorded',true);
      IF p_input->>'response'='ACCEPTED' THEN
        INSERT INTO public.notifications(recipient_id,type,title,content,idempotency_key)
        SELECT id,'SHIFT_CHANGE_ACCEPTED','Có nhân viên đồng ý nhận ca','Yêu cầu '||v_request.id::text||' đang chờ quản lý quyết định.',
          'tv5:accepted:'||inv.id::text||':'||id::text FROM public.users
          WHERE role='QL' AND is_active AND branch_id=v_schedule.branch_id ON CONFLICT(idempotency_key) DO NOTHING;
      END IF;
    END IF;
  ELSIF p_action='refresh' THEN
    result:=public.tv5_refresh_search(v_request.id,actor.id,true);
  ELSIF p_action='decision' THEN
    IF p_input->>'decision' IS NULL OR p_input->>'decision' NOT IN ('APPROVED','REJECTED') THEN RAISE EXCEPTION 'TV5:INVALID_INPUT'; END IF;
    IF p_input->>'decision'='APPROVED' THEN
      target:=(p_input->>'replacement_employee_id')::uuid;
      IF NOT public.tv5_assignment_current(v_assignment.id) THEN RAISE EXCEPTION 'TV5:INVALID_ASSIGNMENT'; END IF;
      IF deadline<=clock_timestamp() THEN RAISE EXCEPTION 'TV5:DEADLINE_PASSED'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.replacement_invitations WHERE shift_change_request_id=v_request.id
        AND target_employee_id=target AND status='ACCEPTED' AND expires_at>clock_timestamp() AND valid_when_confirmed IS TRUE)
        THEN RAISE EXCEPTION 'TV5:ACCEPTANCE_REQUIRED'; END IF;
      IF NOT public.tv5_candidate_eligible(v_assignment.id,target) THEN RAISE EXCEPTION 'TV5:INELIGIBLE_REPLACEMENT'; END IF;
      -- Repeat boundary checks immediately in the assignment writes, not just before eligibility.
      UPDATE public.shift_assignments SET status='REPLACED' WHERE id=v_assignment.id
        AND clock_timestamp()<public.tv5_assignment_start(v_assignment.work_date,v_shift.start_time)
        AND EXISTS (SELECT 1 FROM public.replacement_invitations WHERE shift_change_request_id=v_request.id
          AND target_employee_id=target AND status='ACCEPTED' AND expires_at>clock_timestamp());
      IF NOT FOUND THEN RAISE EXCEPTION 'TV5:DEADLINE_PASSED'; END IF;
      INSERT INTO public.shift_assignments(schedule_id,employee_id,work_date,shift_id,department_id,actual_branch_id,status,assignment_source,branch_support_request_id)
        SELECT v_assignment.schedule_id,target,v_assignment.work_date,v_assignment.shift_id,v_assignment.department_id,v_assignment.actual_branch_id,'ACTIVE',v_assignment.assignment_source,v_assignment.branch_support_request_id
        WHERE clock_timestamp()<public.tv5_assignment_start(v_assignment.work_date,v_shift.start_time)
          AND EXISTS (SELECT 1 FROM public.replacement_invitations WHERE shift_change_request_id=v_request.id
            AND target_employee_id=target AND status='ACCEPTED' AND expires_at>clock_timestamp())
        RETURNING id INTO new_assignment;
      IF NOT FOUND THEN RAISE EXCEPTION 'TV5:DEADLINE_PASSED'; END IF;
    END IF;
    UPDATE public.shift_change_requests SET status=p_input->>'decision',approved_by=actor.id,
      resolved_at=clock_timestamp(),replacement_employee_id=target,replacement_assignment_id=new_assignment WHERE id=v_request.id;
    UPDATE public.replacement_invitations SET status='EXPIRED'
      WHERE shift_change_request_id=v_request.id AND status='PENDING';
    INSERT INTO public.notifications(recipient_id,type,title,content,idempotency_key)
      SELECT user_id,'SHIFT_CHANGE_DECISION','Kết quả yêu cầu đổi ca','Yêu cầu '||v_request.id::text||': '||(p_input->>'decision'),
        'tv5:decision:'||v_request.id::text||':'||id::text FROM public.employees
      WHERE id=v_request.requesting_employee_id OR id=target ON CONFLICT(idempotency_key) DO NOTHING;
    result:=jsonb_build_object('request_id',v_request.id,'new_assignment_id',new_assignment,'decision',p_input->>'decision');
  END IF;
  INSERT INTO public.audit_logs(actor_id,entity_type,entity_id,action,old_data,new_data,change_source)
    SELECT actor.id,'shift_change_requests',v_request.id,'TV5_'||upper(p_action),old_row,
      jsonb_build_object('request',to_jsonb(q),'result',result,'input',p_input,
        'original_assignment_before',to_jsonb(v_assignment),'new_assignment_id',new_assignment),'MANUAL'
    FROM public.shift_change_requests q WHERE q.id=v_request.id;
  RETURN result;
EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'TV5:INVALID_INPUT';
END;
$$;

-- All privileged code owned by the trusted SQL administrator. Helpers remain internal.
ALTER FUNCTION public.tv5_assignment_start(date,time) OWNER TO postgres;
ALTER FUNCTION public.tv5_schedule_state(uuid) OWNER TO postgres;
ALTER FUNCTION public.tv5_assignment_current(uuid) OWNER TO postgres;
ALTER FUNCTION public.tv5_candidate_eligible(uuid,uuid) OWNER TO postgres;
ALTER FUNCTION public.tv5_alert_due(uuid) OWNER TO postgres;
ALTER FUNCTION public.tv5_refresh_search(uuid,uuid,boolean) OWNER TO postgres;
ALTER FUNCTION public.tv5_shift_change(text,uuid,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tv5_assignment_start(date,time) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.tv5_schedule_state(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.tv5_assignment_current(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.tv5_candidate_eligible(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.tv5_alert_due(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.tv5_refresh_search(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.tv5_shift_change(text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.tv5_shift_change(text,uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
