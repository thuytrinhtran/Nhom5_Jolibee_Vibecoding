-- Review and apply manually AFTER the foundation schema. Never run automatically.
BEGIN;
-- Header distinguishes drafts from explicit submissions, including an all-OFF week.
CREATE TABLE public.registration_submissions (
  period_id uuid NOT NULL REFERENCES public.registration_periods(id),
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  status varchar(25) NOT NULL CHECK (status IN ('DRAFT','INVALID','VALID')),
  errors jsonb NOT NULL DEFAULT '[]',
  submitted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (period_id, employee_id),
  CHECK ((status='VALID' AND submitted_at IS NOT NULL) OR (status<>'VALID' AND submitted_at IS NULL))
);
ALTER TABLE public.registration_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.registration_submissions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.registration_submissions TO service_role;

CREATE FUNCTION public.save_employee_registration(p_user uuid, p_period uuid, p_preferences jsonb, p_submit boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e public.employees; p public.registration_periods; v_status text; v_errors jsonb := '[]'; v_old jsonb;
BEGIN
  -- Always lock period then employee. This also serializes concurrent saves and reminders.
  SELECT * INTO p FROM public.registration_periods WHERE id=p_period FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Đợt đăng ký không tồn tại.'; END IF;
  SELECT * INTO e FROM public.employees WHERE user_id=p_user FOR UPDATE;
  IF NOT FOUND OR e.status <> 'ACTIVE' OR e.branch_id <> p.branch_id OR e.skill_level='CREW_LEADER'
    OR NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id=p_user AND u.role='NV' AND u.is_active AND u.branch_id=e.branch_id)
    THEN RAISE EXCEPTION 'Nhân viên không đủ điều kiện đăng ký đợt này.'; END IF;
  IF p.status <> 'OPEN' OR clock_timestamp() < p.open_at OR clock_timestamp() >= p.close_at
    THEN RAISE EXCEPTION 'Đợt chưa mở hoặc đã đóng; không thể chỉnh sửa.'; END IF;
  IF p_submit IS NULL OR p_preferences IS NULL OR jsonb_typeof(p_preferences) <> 'array'
    THEN RAISE EXCEPTION 'Dữ liệu đăng ký không hợp lệ.'; END IF;
  IF jsonb_array_length(p_preferences)>500 THEN RAISE EXCEPTION 'Quá nhiều nguyện vọng.'; END IF;
  -- Lock selected shift configuration until transaction completes.
  PERFORM 1 FROM public.shifts WHERE id IN (SELECT x.shift_id FROM jsonb_to_recordset(p_preferences) AS x(shift_id uuid)) FOR SHARE;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_preferences) AS x(work_date date,shift_id uuid)
    LEFT JOIN public.shifts s ON s.id=x.shift_id
    WHERE x.work_date IS NULL OR x.shift_id IS NULL OR x.work_date NOT BETWEEN p.work_start_date AND p.work_end_date
      OR s.id IS NULL OR NOT s.is_active OR (s.branch_id IS NOT NULL AND s.branch_id<>p.branch_id))
    THEN RAISE EXCEPTION 'Ngày hoặc ca không hợp lệ cho đợt và chi nhánh.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_preferences) AS x(work_date date,shift_id uuid) GROUP BY work_date,shift_id HAVING count(*)>1)
    THEN RAISE EXCEPTION 'Trùng nguyện vọng ngày và ca.'; END IF;
  IF EXISTS (
    WITH slots AS (
      SELECT row_number() OVER () n, x.work_date+s.start_time a,
        x.work_date+s.end_time+CASE WHEN s.end_time<s.start_time THEN interval '1 day' ELSE interval '0' END b
      FROM jsonb_to_recordset(p_preferences) AS x(work_date date,shift_id uuid) JOIN public.shifts s ON s.id=x.shift_id
    ) SELECT 1 FROM slots a JOIN slots b ON a.n<b.n AND a.a<b.b AND b.a<a.b
  ) THEN RAISE EXCEPTION 'Các nguyện vọng bị trùng giờ, kể cả ca qua đêm.'; END IF;
  v_status := CASE WHEN NOT p_submit THEN 'DRAFT' ELSE 'VALID' END;
  SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]') INTO v_old FROM public.shift_registrations r WHERE period_id=p_period AND employee_id=e.id;
  IF clock_timestamp() >= p.close_at THEN RAISE EXCEPTION 'Đợt đã hết hạn trong lúc kiểm tra; không thể lưu.'; END IF;
  DELETE FROM public.shift_registrations WHERE period_id=p_period AND employee_id=e.id;
  INSERT INTO public.shift_registrations(period_id,employee_id,work_date,shift_id,status,submitted_at,updated_at)
    SELECT p_period,e.id,x.work_date,x.shift_id,v_status,CASE WHEN p_submit THEN clock_timestamp() ELSE NULL END,clock_timestamp()
    FROM jsonb_to_recordset(p_preferences) AS x(work_date date,shift_id uuid);
  INSERT INTO public.registration_submissions(period_id,employee_id,status,errors,submitted_at,updated_at) VALUES(p_period,e.id,v_status,v_errors,CASE WHEN p_submit THEN clock_timestamp() ELSE NULL END,clock_timestamp())
    ON CONFLICT(period_id,employee_id) DO UPDATE SET status=excluded.status,errors=excluded.errors,submitted_at=excluded.submitted_at,updated_at=excluded.updated_at;
  INSERT INTO public.audit_logs(actor_id,entity_type,entity_id,action,old_data,new_data)
    VALUES(p_user,'employee_registration',p_period,CASE WHEN p_submit THEN 'SUBMIT' ELSE 'SAVE_DRAFT' END,v_old,jsonb_build_object('employee_id',e.id,'status',v_status,'preferences',p_preferences));
  RETURN jsonb_build_object('registration_status',v_status,'errors',v_errors);
END;
$$;
REVOKE ALL ON FUNCTION public.save_employee_registration(uuid,uuid,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_employee_registration(uuid,uuid,jsonb,boolean) TO service_role;

-- Confirmed Design appendix: Friday 15:00 to Sunday 12:00, next Mon-Sun, Vietnam time.
-- Explicit switch: remains disabled until reviewed; notification rows are queued only.
CREATE TABLE public.registration_automation_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), enabled boolean NOT NULL DEFAULT false
);
INSERT INTO public.registration_automation_config VALUES(true,false);
ALTER TABLE public.registration_automation_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.registration_automation_config FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.registration_automation_config TO service_role;
CREATE FUNCTION public.run_registration_automation() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE local_now timestamp := clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh';
  monday date; opening timestamptz; closing timestamptz; p public.registration_periods;
  made integer:=0; reminded integer:=0; n integer;
BEGIN
  IF NOT pg_try_advisory_xact_lock(72910452) THEN RETURN jsonb_build_object('skipped','already_running'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.registration_automation_config WHERE singleton AND enabled) THEN RETURN jsonb_build_object('skipped','disabled'); END IF;
  monday := date_trunc('week',local_now)::date+7;
  opening := ((monday-3)+time '15:00') AT TIME ZONE 'Asia/Ho_Chi_Minh';
  closing := ((monday-1)+time '12:00') AT TIME ZONE 'Asia/Ho_Chi_Minh';
  IF clock_timestamp()>=opening AND clock_timestamp()<closing THEN
    INSERT INTO public.registration_periods(branch_id,work_start_date,work_end_date,open_at,close_at,status)
      SELECT id,monday,monday+6,opening,closing,'OPEN' FROM public.branches WHERE status='ACTIVE'
      ON CONFLICT(branch_id,work_start_date) DO NOTHING;
    GET DIAGNOSTICS made=ROW_COUNT;
  END IF;
  UPDATE public.registration_periods SET status='OPEN' WHERE status='PLANNED' AND open_at<=clock_timestamp() AND close_at>clock_timestamp();
  UPDATE public.registration_periods SET status='CLOSED' WHERE status IN ('PLANNED','OPEN') AND close_at<=clock_timestamp();
  -- Every minute scheduler; retry inside T-30 window, no reminders after deadline.
  FOR p IN SELECT * FROM public.registration_periods WHERE status='OPEN' AND open_at<=clock_timestamp()
    AND close_at>clock_timestamp() AND close_at-interval '30 minutes'<=clock_timestamp() ORDER BY id FOR UPDATE LOOP
    INSERT INTO public.notifications(recipient_id,type,title,content,idempotency_key)
      SELECT e.user_id,'REGISTRATION_REMINDER','Nhắc đăng ký ca làm','Bạn chưa hoàn thành đăng ký ca. Vui lòng gửi trước hạn '||p.close_at::text,
        'reg-reminder:'||p.id::text||':'||e.id::text
      FROM public.employees e JOIN public.users u ON u.id=e.user_id
      WHERE e.branch_id=p.branch_id AND e.status='ACTIVE' AND e.skill_level<>'CREW_LEADER' AND u.role='NV' AND u.is_active AND u.branch_id=p.branch_id
        AND NOT EXISTS(SELECT 1 FROM public.registration_submissions s WHERE s.period_id=p.id AND s.employee_id=e.id AND s.status='VALID' AND s.submitted_at IS NOT NULL)
      ON CONFLICT(idempotency_key) DO NOTHING;
    GET DIAGNOSTICS n=ROW_COUNT; reminded:=reminded+n;
  END LOOP;
  RETURN jsonb_build_object('created',made,'queued_reminders',reminded);
END;
$$;
REVOKE ALL ON FUNCTION public.run_registration_automation() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.run_registration_automation() TO service_role;
COMMIT;
