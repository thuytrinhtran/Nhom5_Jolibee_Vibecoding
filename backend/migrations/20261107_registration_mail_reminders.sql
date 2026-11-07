-- Prepared release migration. Apply only with the production owner's approval.
-- Queue reminders only: no period creation, timestamp/status changes or cron jobs.
BEGIN;
CREATE OR REPLACE FUNCTION public.enqueue_registration_mail_reminders() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE cfg public.registration_schedule_config; instant timestamptz := clock_timestamp(); monday date; queued integer;
BEGIN
  IF NOT pg_try_advisory_xact_lock(72910456) THEN RETURN jsonb_build_object('skipped','already_running'); END IF;
  SELECT * INTO STRICT cfg FROM public.registration_schedule_config WHERE singleton;
  IF cfg.timezone<>'Asia/Ho_Chi_Minh' OR cfg.close_iso_day<>7 OR cfg.close_local_time<>time '12:00'
     OR cfg.reminder_minutes NOT BETWEEN 1 AND 1440 THEN RAISE EXCEPTION 'REGISTRATION_MAIL_POLICY_INVALID'; END IF;
  monday := date_trunc('week',instant AT TIME ZONE cfg.timezone)::date+7;
  INSERT INTO public.notifications(recipient_id,type,title,content,idempotency_key)
  SELECT e.user_id,'REGISTRATION_REMINDER','Nhắc đăng ký ca làm',
    'Bạn chưa hoàn thành đăng ký ca. Vui lòng gửi trước hạn '||p.close_at::text,
    'reg-reminder:'||p.id::text||':'||e.id::text
  FROM public.registration_periods p
  JOIN public.branches b ON b.id=p.branch_id AND b.status='ACTIVE'
  JOIN public.employees e ON e.branch_id=p.branch_id AND e.status='ACTIVE'
    AND e.skill_level IN ('NEW','REGULAR','CREW_TRAINING')
  JOIN public.users u ON u.id=e.user_id AND u.role='NV' AND u.is_active AND u.branch_id=e.branch_id
  WHERE p.work_start_date=monday AND p.work_end_date=monday+6
    AND p.open_at<=instant AND instant<p.close_at
    AND instant>=p.close_at-make_interval(mins=>cfg.reminder_minutes)
    AND extract(isodow FROM p.close_at AT TIME ZONE cfg.timezone)=7
    AND (p.close_at AT TIME ZONE cfg.timezone)::time=time '12:00'
    AND NOT EXISTS(SELECT 1 FROM public.registration_submissions s
      WHERE s.period_id=p.id AND s.employee_id=e.id AND s.status='VALID' AND s.submitted_at IS NOT NULL)
  ON CONFLICT(idempotency_key) DO NOTHING;
  GET DIAGNOSTICS queued=ROW_COUNT;
  RETURN jsonb_build_object('queued_reminders',queued);
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_registration_mail_reminders() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_registration_mail_reminders() TO service_role;
COMMIT;
