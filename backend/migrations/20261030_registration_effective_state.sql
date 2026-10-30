-- PREPARED ONLY: review before applying to official Supabase. No status/data backfill.
-- Replaces manual 05_repair_friday_registration.sql. Do not run legacy Thursday bundle.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(72910453);

-- Pure rule shared by save RPC and TV3 view. No client-supplied clock is used by saves.
CREATE OR REPLACE FUNCTION public.registration_effective_status(p_open timestamptz,p_close timestamptz,p_now timestamptz)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT CASE WHEN p_open>=p_close THEN 'CLOSED' WHEN p_now<p_open THEN 'PLANNED'
 WHEN p_now<p_close THEN 'OPEN' ELSE 'CLOSED' END
$$;
REVOKE ALL ON FUNCTION public.registration_effective_status(timestamptz,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.registration_effective_status(timestamptz,timestamptz,timestamptz) TO service_role;

ALTER TABLE public.registration_submissions ADD COLUMN IF NOT EXISTS sample_batch_id uuid REFERENCES public.audit_logs(id);
DO $shape$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='registration_submissions'
 AND column_name='sample_batch_id' AND udt_name='uuid' AND is_nullable='YES') THEN RAISE EXCEPTION 'Unexpected provenance column'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint k JOIN pg_attribute a ON a.attrelid=k.conrelid AND k.conkey=ARRAY[a.attnum]::smallint[]
 JOIN pg_attribute b ON b.attrelid=k.confrelid AND k.confkey=ARRAY[b.attnum]::smallint[]
 WHERE k.conrelid='public.registration_submissions'::regclass AND k.contype='f' AND k.convalidated
 AND a.attname='sample_batch_id' AND k.confrelid='public.audit_logs'::regclass AND b.attname='id')
 THEN RAISE EXCEPTION 'Provenance FK missing; review schema'; END IF;
END $shape$;

-- Refuse to overwrite unreviewed deployed code/overloads. Read pg_get_functiondef first if rejected.
DO $rpc_guard$ BEGIN
 IF to_regprocedure('public.save_employee_registration(uuid,uuid,jsonb,boolean)') IS NULL
 OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='save_employee_registration' AND
 (p.oid <> to_regprocedure('public.save_employee_registration(uuid,uuid,jsonb,boolean)')
 OR pg_get_userbyid(p.proowner) NOT IN ('postgres','supabase_admin')
 OR p.proargnames IS DISTINCT FROM ARRAY['p_user','p_period','p_preferences','p_submit']::text[]
 OR md5(btrim(replace(p.prosrc,chr(13),''),chr(10)||chr(9)||' ')) NOT IN ('80aba9df855ce7114555e7a8662d8316','47ab5d26b865f9569ebe5b2f087d68e1','e546d1efcb4be5a70f5ff81ffdea4004')))
 THEN RAISE EXCEPTION 'Unknown save RPC; stop for review'; END IF;
END $rpc_guard$;
CREATE OR REPLACE FUNCTION public.save_employee_registration(p_user uuid, p_period uuid, p_preferences jsonb, p_submit boolean)
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
  IF public.registration_effective_status(p.open_at,p.close_at,clock_timestamp()) <> 'OPEN'
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
    ON CONFLICT(period_id,employee_id) DO UPDATE SET status=excluded.status,errors=excluded.errors,submitted_at=excluded.submitted_at,updated_at=excluded.updated_at,sample_batch_id=NULL;
  INSERT INTO public.audit_logs(actor_id,entity_type,entity_id,action,old_data,new_data)
    VALUES(p_user,'employee_registration',p_period,CASE WHEN p_submit THEN 'SUBMIT' ELSE 'SAVE_DRAFT' END,v_old,jsonb_build_object('employee_id',e.id,'status',v_status,'preferences',p_preferences));
  RETURN jsonb_build_object('registration_status',v_status,'errors',v_errors);
END;
$$;
REVOKE ALL ON FUNCTION public.save_employee_registration(uuid,uuid,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_employee_registration(uuid,uuid,jsonb,boolean) TO service_role;

-- Only the server role can read this view; TV3 must still filter by authorized branch.
CREATE OR REPLACE VIEW public.registration_periods_effective WITH (security_invoker=true) AS
 SELECT p.id,p.branch_id,p.work_start_date,p.work_end_date,p.open_at,p.close_at,p.created_at,
 p.status AS stored_status,public.registration_effective_status(p.open_at,p.close_at,statement_timestamp()) AS status
 FROM public.registration_periods p;
REVOKE ALL ON public.registration_periods_effective FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.registration_periods_effective TO service_role;

-- Preserve legacy fixtures without updating historical headers. Only the exact audited v2
-- fixture, unchanged header timestamp and original employee list qualify as a legacy sample.
CREATE OR REPLACE VIEW public.registration_submissions_sourced WITH (security_invoker=true) AS
 SELECT h.period_id,h.employee_id,h.status,h.errors,h.submitted_at,h.updated_at,
 coalesce(h.sample_batch_id,legacy.id) AS sample_batch_id,h.sample_batch_id AS stored_sample_batch_id
 FROM public.registration_submissions h
 LEFT JOIN LATERAL (SELECT a.id FROM public.audit_logs a
 WHERE a.entity_id=h.period_id AND a.action='TV2_TEST_SEED' AND a.change_source='SYSTEM' AND a.actor_id IS NULL
 AND a.new_data->>'fixture'='tv2-test-week-20261026-v1' AND a.new_data->>'synthetic'='true'
 AND a.new_data->'employee_ids' @> jsonb_build_array(h.employee_id)
 AND h.status='VALID' AND h.errors='[]'::jsonb
 AND h.submitted_at=timestamptz '2026-10-24 10:00+07' AND h.updated_at<=a.created_at
 ORDER BY a.created_at LIMIT 1) legacy ON h.sample_batch_id IS NULL;
REVOKE ALL ON public.registration_submissions_sourced FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.registration_submissions_sourced TO service_role;

-- Friday policy for FUTURE period creation only. Existing period timestamps/data stay untouched.
DO $config$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.registration_schedule_config WHERE singleton AND timezone='Asia/Ho_Chi_Minh')
 THEN RAISE EXCEPTION 'Missing Vietnam schedule config'; END IF;
END $config$;
UPDATE public.registration_schedule_config SET open_iso_day=5,open_local_time=time '15:00',close_iso_day=7,close_local_time=time '12:00'
WHERE singleton AND (open_iso_day,open_local_time,close_iso_day,close_local_time) IS DISTINCT FROM (5,time '15:00',7,time '12:00');
-- Period creation only. No reminders, notifications or changes to existing periods.
DO $unique$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint k WHERE k.conrelid='public.registration_periods'::regclass
 AND k.contype='u' AND ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY t(num,pos)
 JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=t.num ORDER BY pos)=ARRAY['branch_id','work_start_date']::text[])
 THEN RAISE EXCEPTION 'Missing unique branch/week constraint'; END IF;
END $unique$;
CREATE TABLE IF NOT EXISTS public.registration_period_generation_state (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 last_success_at timestamptz NOT NULL, created_count integer NOT NULL CHECK(created_count>=0)
);
ALTER TABLE public.registration_period_generation_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.registration_period_generation_state FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.registration_period_generation_state TO service_role;

-- Privileged helper supports isolated clock tests. Browser/server JWT cannot supply a clock.
CREATE OR REPLACE FUNCTION public.tv2_ensure_registration_periods_at(p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE monday date; made integer;
BEGIN
 IF p_now IS NULL THEN RAISE EXCEPTION 'Clock is required'; END IF;
 IF NOT pg_try_advisory_xact_lock(72910454) THEN RETURN jsonb_build_object('skipped','already_running'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.registration_schedule_config WHERE singleton AND timezone='Asia/Ho_Chi_Minh'
 AND open_iso_day=5 AND open_local_time=time '15:00' AND close_iso_day=7 AND close_local_time=time '12:00')
 THEN RAISE EXCEPTION 'Friday registration policy is not configured'; END IF;
 monday:=date_trunc('week',p_now AT TIME ZONE 'Asia/Ho_Chi_Minh')::date+7;
 INSERT INTO public.registration_periods(branch_id,work_start_date,work_end_date,open_at,close_at,status)
 SELECT b.id,monday+7*w,monday+7*w+6,
 ((monday+7*w-3)+time '15:00') AT TIME ZONE 'Asia/Ho_Chi_Minh',
 ((monday+7*w-1)+time '12:00') AT TIME ZONE 'Asia/Ho_Chi_Minh','PLANNED'
 FROM public.branches b CROSS JOIN generate_series(0,3) w
 WHERE b.status='ACTIVE' AND EXISTS(
 SELECT 1 FROM public.employees e JOIN public.users u ON u.id=e.user_id
 WHERE e.branch_id=b.id AND e.status='ACTIVE' AND e.skill_level<>'CREW_LEADER'
 AND u.role='NV' AND u.is_active AND u.branch_id=e.branch_id)
 ORDER BY b.id,w ON CONFLICT(branch_id,work_start_date) DO NOTHING;
 GET DIAGNOSTICS made=ROW_COUNT;
 INSERT INTO public.registration_period_generation_state(singleton,last_success_at,created_count)
 VALUES(true,p_now,made) ON CONFLICT(singleton) DO UPDATE
 SET last_success_at=excluded.last_success_at,created_count=excluded.created_count;
 RETURN jsonb_build_object('created',made,'first_work_monday',monday,'weeks_ahead',4);
END;
$$;
REVOKE ALL ON FUNCTION public.tv2_ensure_registration_periods_at(timestamptz) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.tv2_ensure_registration_periods()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.tv2_ensure_registration_periods_at(clock_timestamp());
$$;
REVOKE ALL ON FUNCTION public.tv2_ensure_registration_periods() FROM PUBLIC,anon,authenticated,service_role;
-- Cron executes as the approving postgres owner, not through an internet endpoint.

NOTIFY pgrst,'reload schema';
COMMIT;
