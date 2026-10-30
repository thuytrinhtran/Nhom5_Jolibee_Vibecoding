-- M2: centralized Design schedule. Filename retained for migration order; no separate OFF storage.
-- Apply ONCE after revised M1. Do not run over an earlier experimental M1/M2 without review.
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.registration_submissions') IS NULL OR NOT EXISTS(
 SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='registration_submissions' AND column_name='submitted_at')
 THEN RAISE EXCEPTION 'Revised M1 with submitted_at is required before M2.'; END IF;
 IF to_regprocedure('public.save_employee_registration(uuid,uuid,jsonb,boolean,jsonb)') IS NOT NULL
 THEN RAISE EXCEPTION 'Experimental 5-argument RPC detected. Stop and review a forward migration; no objects were removed.'; END IF;
END $$;
CREATE TABLE public.registration_schedule_config (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh' CHECK(timezone='Asia/Ho_Chi_Minh'),
 open_iso_day integer NOT NULL DEFAULT 5 CHECK(open_iso_day BETWEEN 1 AND 7),
 open_local_time time NOT NULL DEFAULT '15:00',
 close_iso_day integer NOT NULL DEFAULT 7 CHECK(close_iso_day BETWEEN 1 AND 7),
 close_local_time time NOT NULL DEFAULT '12:00',
 reminder_minutes integer NOT NULL DEFAULT 30 CHECK(reminder_minutes>0 AND reminder_minutes<=1440),
 CHECK(open_iso_day<close_iso_day OR (open_iso_day=close_iso_day AND open_local_time<close_local_time))
);
INSERT INTO public.registration_schedule_config(singleton) VALUES(true);
ALTER TABLE public.registration_schedule_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.registration_schedule_config FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.registration_schedule_config TO service_role;
CREATE OR REPLACE FUNCTION public.run_registration_automation() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cfg public.registration_schedule_config; local_now timestamp;
  monday date; opening timestamptz; closing timestamptz; p public.registration_periods;
  made integer:=0; reminded integer:=0; n integer;
BEGIN
  IF NOT pg_try_advisory_xact_lock(72910452) THEN RETURN jsonb_build_object('skipped','already_running'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.registration_automation_config WHERE singleton AND enabled) THEN RETURN jsonb_build_object('skipped','disabled'); END IF;
  SELECT * INTO STRICT cfg FROM public.registration_schedule_config WHERE singleton;
  local_now := clock_timestamp() AT TIME ZONE cfg.timezone;
  monday := date_trunc('week',local_now)::date+7;
  opening := ((monday-(8-cfg.open_iso_day))+cfg.open_local_time) AT TIME ZONE cfg.timezone;
  closing := ((monday-(8-cfg.close_iso_day))+cfg.close_local_time) AT TIME ZONE cfg.timezone;
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
    AND close_at>clock_timestamp() AND close_at-make_interval(mins => cfg.reminder_minutes)<=clock_timestamp() ORDER BY id FOR UPDATE LOOP
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
