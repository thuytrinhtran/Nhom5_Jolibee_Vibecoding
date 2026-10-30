-- REVIEW BEFORE APPLYING. Shared project wlbpprpiieonjrqglicv.
-- Revision: tv2-official-shared-compatible-v3. Supersedes the fresh-only v2 bundle.
-- Generated from this template and the existing M1 save RPC. Run generated 01 only.
-- Incremental: preserve existing tables, IDs, profiles, Auth and real registrations.
-- Thursday 15:00 -> Sunday 12:00 Asia/Ho_Chi_Minh, next Mon-Sun. No scheduler.
-- Catalog compatibility is checked before any change. Unknown RPC bodies are refused.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SELECT pg_advisory_xact_lock(72910453);

DO $base$
DECLARE r record; fk record; uq record;
BEGIN
 FOR r IN SELECT * FROM (VALUES
  ('branches','id','uuid'),('branches','name','varchar'),('branches','status','varchar'),
  ('users','id','uuid'),('users','username','varchar'),('users','role','varchar'),('users','branch_id','uuid'),('users','is_active','bool'),('users','must_change_password','bool'),('users','password_reset_id','uuid'),
  ('employees','id','uuid'),('employees','user_id','uuid'),('employees','branch_id','uuid'),('employees','department_id','uuid'),('employees','skill_level','varchar'),('employees','status','varchar'),
  ('departments','id','uuid'),('shifts','id','uuid'),('shifts','name','varchar'),('shifts','start_time','time'),('shifts','end_time','time'),('shifts','branch_id','uuid'),('shifts','is_active','bool'),
  ('registration_periods','id','uuid'),('registration_periods','branch_id','uuid'),('registration_periods','work_start_date','date'),('registration_periods','work_end_date','date'),('registration_periods','open_at','timestamptz'),('registration_periods','close_at','timestamptz'),('registration_periods','status','varchar'),
  ('shift_registrations','id','uuid'),('shift_registrations','period_id','uuid'),('shift_registrations','employee_id','uuid'),('shift_registrations','work_date','date'),('shift_registrations','shift_id','uuid'),('shift_registrations','status','varchar'),('shift_registrations','submitted_at','timestamptz'),('shift_registrations','updated_at','timestamptz'),
  ('audit_logs','id','uuid'),('audit_logs','actor_id','uuid'),('audit_logs','entity_type','varchar'),('audit_logs','entity_id','uuid'),('audit_logs','action','varchar'),('audit_logs','old_data','jsonb'),('audit_logs','new_data','jsonb'),('audit_logs','change_source','varchar')
 ) AS required(table_name,column_name,udt) LOOP
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=r.table_name AND c.column_name=r.column_name AND
   (c.udt_name=r.udt OR (r.udt='varchar' AND c.udt_name='text'))) THEN
   RAISE EXCEPTION 'Incompatible %.% (expected %). Stop; do not alter TV1/foundation automatically.',r.table_name,r.column_name,r.udt;
  END IF;
 END LOOP;
 FOR r IN SELECT unnest(ARRAY['branches','users','employees','departments','shifts','registration_periods','shift_registrations','audit_logs']) AS name LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=r.name AND c.relrowsecurity) THEN
   RAISE EXCEPTION 'RLS is not enabled on %. Review catalog before deployment.',r.name;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint k JOIN pg_attribute a ON a.attrelid=k.conrelid AND k.conkey=ARRAY[a.attnum]::smallint[] WHERE k.conrelid=to_regclass('public.'||r.name) AND k.contype='p' AND a.attname='id') THEN
   RAISE EXCEPTION 'Missing single-column id primary key on %.',r.name;
  END IF;
 END LOOP;
 FOR fk IN SELECT * FROM (VALUES
  ('users','id','auth.users'),('users','branch_id','public.branches'),('employees','user_id','public.users'),('employees','branch_id','public.branches'),('employees','department_id','public.departments'),
  ('shifts','branch_id','public.branches'),('registration_periods','branch_id','public.branches'),('shift_registrations','employee_id','public.employees'),('shift_registrations','period_id','public.registration_periods'),('shift_registrations','shift_id','public.shifts'),('audit_logs','actor_id','public.users')
 ) AS required_fk(table_name,column_name,reference_table) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_constraint k JOIN pg_attribute a ON a.attrelid=k.conrelid AND k.conkey=ARRAY[a.attnum]::smallint[]
   JOIN pg_attribute t ON t.attrelid=k.confrelid AND k.confkey=ARRAY[t.attnum]::smallint[]
   WHERE k.conrelid=to_regclass('public.'||fk.table_name) AND k.contype='f' AND k.convalidated AND a.attname=fk.column_name AND k.confrelid=to_regclass(fk.reference_table) AND t.attname='id') THEN
   RAISE EXCEPTION 'Required FK missing: %.% -> %.id',fk.table_name,fk.column_name,fk.reference_table;
  END IF;
 END LOOP;
 FOR uq IN SELECT * FROM (VALUES ('employees',ARRAY['user_id']::text[]),('registration_periods',ARRAY['branch_id','work_start_date']::text[]),('shift_registrations',ARRAY['period_id','employee_id','work_date','shift_id']::text[])) AS expected(table_name,columns) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_constraint k WHERE k.conrelid=to_regclass('public.'||uq.table_name) AND k.contype IN ('p','u') AND
   ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY key(attnum,pos) JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=key.attnum ORDER BY key.pos)=uq.columns) THEN
   RAISE EXCEPTION 'Required UNIQUE missing on % (%).',uq.table_name,uq.columns;
  END IF;
 END LOOP;
 -- Existing automation is not installed/changed by this file; it must remain disabled.
 IF to_regclass('public.registration_automation_config') IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM public.registration_automation_config WHERE enabled) THEN RAISE EXCEPTION 'Existing automation is enabled; team must review it separately before manual deployment.'; END IF;
 END IF;
END $base$;

-- Create TV2-owned objects only if absent. Never recreate foundation/Auth tables.
DO $new_tables$ BEGIN
 IF to_regclass('public.registration_submissions') IS NULL THEN
  CREATE TABLE public.registration_submissions (
   period_id uuid NOT NULL REFERENCES public.registration_periods(id),
   employee_id uuid NOT NULL REFERENCES public.employees(id),
   status varchar(25) NOT NULL CHECK(status IN ('DRAFT','INVALID','VALID')),
   errors jsonb NOT NULL DEFAULT '[]',submitted_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),
   PRIMARY KEY(period_id,employee_id),
   CHECK((status='VALID' AND submitted_at IS NOT NULL) OR (status<>'VALID' AND submitted_at IS NULL))
  );
 END IF;
 IF to_regclass('public.registration_schedule_config') IS NULL THEN
  CREATE TABLE public.registration_schedule_config (
   singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
   timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh' CHECK(timezone='Asia/Ho_Chi_Minh'),
   open_iso_day integer NOT NULL DEFAULT 4 CHECK(open_iso_day BETWEEN 1 AND 7),open_local_time time NOT NULL DEFAULT '15:00',
   close_iso_day integer NOT NULL DEFAULT 7 CHECK(close_iso_day BETWEEN 1 AND 7),close_local_time time NOT NULL DEFAULT '12:00',
   reminder_minutes integer NOT NULL DEFAULT 30 CHECK(reminder_minutes>0 AND reminder_minutes<=1440),
   CHECK(open_iso_day<close_iso_day OR (open_iso_day=close_iso_day AND open_local_time<close_local_time))
  );
 END IF;
END $new_tables$;
DO $tv2_shape$
DECLARE r record;
BEGIN
 FOR r IN SELECT * FROM (VALUES
  ('registration_submissions','period_id','uuid'),('registration_submissions','employee_id','uuid'),('registration_submissions','status','varchar'),('registration_submissions','errors','jsonb'),('registration_submissions','submitted_at','timestamptz'),('registration_submissions','updated_at','timestamptz'),
  ('registration_schedule_config','singleton','bool'),('registration_schedule_config','timezone','text'),('registration_schedule_config','open_iso_day','int4'),('registration_schedule_config','open_local_time','time'),('registration_schedule_config','close_iso_day','int4'),('registration_schedule_config','close_local_time','time'),('registration_schedule_config','reminder_minutes','int4')
 ) AS required(table_name,column_name,udt) LOOP
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=r.table_name AND c.column_name=r.column_name AND (c.udt_name=r.udt OR (r.udt IN ('text','varchar') AND c.udt_name IN ('text','varchar')))) THEN
   RAISE EXCEPTION 'Existing TV2 table %.% is incompatible; no automatic rebuild.',r.table_name,r.column_name;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
  AND c.relname IN ('registration_submissions','registration_schedule_config') AND pg_get_userbyid(c.relowner) IN ('anon','authenticated','service_role')) THEN
  RAISE EXCEPTION 'TV2 tables must have a trusted administrative owner; review ownership instead of changing it automatically.';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint k WHERE k.conrelid='public.registration_submissions'::regclass AND k.contype='p' AND
  ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY key(attnum,pos) JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=key.attnum ORDER BY key.pos)=ARRAY['period_id','employee_id']) THEN RAISE EXCEPTION 'Header PK must be (period_id,employee_id).'; END IF;
 FOR r IN SELECT * FROM (VALUES ('period_id','public.registration_periods'),('employee_id','public.employees')) AS expected(col,target) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_constraint k JOIN pg_attribute a ON a.attrelid=k.conrelid AND k.conkey=ARRAY[a.attnum]::smallint[] JOIN pg_attribute t ON t.attrelid=k.confrelid AND k.confkey=ARRAY[t.attnum]::smallint[] WHERE k.conrelid='public.registration_submissions'::regclass AND k.contype='f' AND k.convalidated AND a.attname=r.col AND k.confrelid=to_regclass(r.target) AND t.attname='id') THEN RAISE EXCEPTION 'Header FK missing on %.',r.col; END IF;
 END LOOP;
 -- Refuse incompatible existing header data; do not infer historical OFF/submissions.
 IF EXISTS(SELECT 1 FROM public.registration_submissions WHERE status NOT IN ('DRAFT','INVALID','VALID') OR status IS NULL OR errors IS NULL OR (status='VALID') IS DISTINCT FROM (submitted_at IS NOT NULL)) THEN RAISE EXCEPTION 'Existing header data violates TV2 contract; manual review required.'; END IF;
END $tv2_shape$;

-- Provenance for optional TV3 samples, on the TV2-owned header only.
-- NULL = genuine self-service data. Non-NULL = administrative fixture audit UUID.
DO $sample_column$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='registration_submissions' AND column_name='sample_batch_id') THEN
  ALTER TABLE public.registration_submissions ADD COLUMN sample_batch_id uuid REFERENCES public.audit_logs(id);
 ELSE
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='registration_submissions' AND column_name='sample_batch_id' AND udt_name='uuid') THEN RAISE EXCEPTION 'Existing sample_batch_id must be uuid.'; END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint k JOIN pg_attribute a ON a.attrelid=k.conrelid AND k.conkey=ARRAY[a.attnum]::smallint[] JOIN pg_attribute t ON t.attrelid=k.confrelid AND k.confkey=ARRAY[t.attnum]::smallint[] WHERE k.conrelid='public.registration_submissions'::regclass AND k.contype='f' AND k.convalidated AND a.attname='sample_batch_id' AND k.confrelid='public.audit_logs'::regclass AND t.attname='id') THEN RAISE EXCEPTION 'sample_batch_id FK to audit_logs.id is required.'; END IF;
END $sample_column$;
ALTER TABLE public.registration_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_schedule_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.registration_submissions,public.registration_schedule_config FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.registration_submissions,public.registration_schedule_config TO service_role;

DO $rpc_guard$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='save_employee_registration' AND p.oid IS DISTINCT FROM to_regprocedure('public.save_employee_registration(uuid,uuid,jsonb,boolean)')) THEN RAISE EXCEPTION 'Unknown RPC overload: review catalog; do not replace it automatically.'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.save_employee_registration(uuid,uuid,jsonb,boolean)') AND
  (pg_get_userbyid(p.proowner) NOT IN ('postgres','supabase_admin') OR p.proargnames IS DISTINCT FROM ARRAY['p_user','p_period','p_preferences','p_submit']::text[] OR
   md5(btrim(replace(p.prosrc,chr(13),''),chr(10)||chr(9)||' ')) NOT IN ('80aba9df855ce7114555e7a8662d8316','47ab5d26b865f9569ebe5b2f087d68e1'))) THEN
  RAISE EXCEPTION 'Existing RPC body differs from reviewed M1/v3, or owner/signature is unexpected. Provide pg_get_functiondef for review; no replacement applied.';
 END IF;
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
    ON CONFLICT(period_id,employee_id) DO UPDATE SET status=excluded.status,errors=excluded.errors,submitted_at=excluded.submitted_at,updated_at=excluded.updated_at,sample_batch_id=NULL;
  INSERT INTO public.audit_logs(actor_id,entity_type,entity_id,action,old_data,new_data)
    VALUES(p_user,'employee_registration',p_period,CASE WHEN p_submit THEN 'SUBMIT' ELSE 'SAVE_DRAFT' END,v_old,jsonb_build_object('employee_id',e.id,'status',v_status,'preferences',p_preferences));
  RETURN jsonb_build_object('registration_status',v_status,'errors',v_errors);
END;
$$;
REVOKE ALL ON FUNCTION public.save_employee_registration(uuid,uuid,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_employee_registration(uuid,uuid,jsonb,boolean) TO service_role;

INSERT INTO public.registration_schedule_config(singleton) VALUES(true) ON CONFLICT(singleton) DO NOTHING;
DO $timezone_guard$ BEGIN
 IF EXISTS(SELECT 1 FROM public.registration_schedule_config WHERE timezone IS DISTINCT FROM 'Asia/Ho_Chi_Minh' OR singleton IS DISTINCT FROM true) THEN
  RAISE EXCEPTION 'Unexpected existing schedule timezone/singleton. Stop for review instead of rewriting configuration.';
 END IF;
END $timezone_guard$;
UPDATE public.registration_schedule_config SET open_iso_day=4,open_local_time=time '15:00',close_iso_day=7,close_local_time=time '12:00'
WHERE singleton AND (open_iso_day,open_local_time,close_iso_day,close_local_time) IS DISTINCT FROM (4,time '15:00',7,time '12:00');

-- Discover branches through the real TV1 employee/profile relationship, no fixed IDs/count.
CREATE TEMP TABLE tv2_target_branches ON COMMIT DROP AS
SELECT b.id FROM public.branches b WHERE b.status='ACTIVE' AND EXISTS(
 SELECT 1 FROM public.employees e JOIN public.users u ON u.id=e.user_id AND u.branch_id=e.branch_id
 WHERE e.branch_id=b.id AND e.status='ACTIVE' AND e.skill_level<>'CREW_LEADER' AND u.role='NV' AND u.is_active);
LOCK TABLE public.shifts IN SHARE ROW EXCLUSIVE MODE;
DO $shift_compat$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM tv2_target_branches) THEN RAISE EXCEPTION 'No active branch with eligible existing TV1 employees.'; END IF;
 IF EXISTS(SELECT 1 FROM tv2_target_branches b JOIN public.shifts s ON s.branch_id=b.id OR s.branch_id IS NULL WHERE s.is_active AND (s.start_time,s.end_time) NOT IN ((time '08:00',time '12:00'),(time '12:00',time '17:00'),(time '17:00',time '22:00'))) THEN
  RAISE EXCEPTION 'Existing active shift hours differ from proposed TV2 hours; obtain team approval, do not add competing shifts.';
 END IF;
 IF EXISTS(SELECT 1 FROM tv2_target_branches b JOIN public.shifts s ON s.branch_id=b.id OR s.branch_id IS NULL WHERE s.is_active GROUP BY b.id,s.start_time,s.end_time HAVING count(*)>1) THEN RAISE EXCEPTION 'Ambiguous duplicate/global shift configuration. Stop without changing shifts.'; END IF;
END $shift_compat$;
INSERT INTO public.shifts(name,start_time,end_time,branch_id,is_active)
SELECT v.name,v.start_at,v.end_at,b.id,true FROM tv2_target_branches b
CROSS JOIN (VALUES ('Ca sáng',time '08:00',time '12:00'),('Ca chiều',time '12:00',time '17:00'),('Ca tối',time '17:00',time '22:00')) v(name,start_at,end_at)
WHERE NOT EXISTS(SELECT 1 FROM public.shifts s WHERE s.is_active AND (s.branch_id=b.id OR s.branch_id IS NULL) AND s.start_time=v.start_at AND s.end_time=v.end_at);

CREATE TEMP TABLE tv2_target_window ON COMMIT DROP AS
WITH w AS (SELECT c.*,date_trunc('week',clock_timestamp() AT TIME ZONE c.timezone)::date+7 AS monday FROM public.registration_schedule_config c WHERE singleton)
SELECT monday,monday+6 AS sunday,((monday-(8-open_iso_day))+open_local_time) AT TIME ZONE timezone AS opening,
 ((monday-(8-close_iso_day))+close_local_time) AT TIME ZONE timezone AS closing FROM w;
LOCK TABLE public.registration_periods IN SHARE ROW EXCLUSIVE MODE;
-- Narrow repair of the observed Friday PLANNED/empty periods, preserving their IDs.
-- Never reschedule a period that already has employee data or an unexpected deadline.
DO $period_compat$ BEGIN
 IF EXISTS(SELECT 1 FROM public.registration_periods p JOIN tv2_target_branches b ON b.id=p.branch_id CROSS JOIN tv2_target_window w
  WHERE p.work_start_date=w.monday AND (p.work_end_date<>w.sunday OR p.close_at<>w.closing OR
   (p.open_at<>w.opening AND NOT(p.status='PLANNED' AND p.open_at=w.opening+interval '1 day'
     AND NOT EXISTS(SELECT 1 FROM public.registration_submissions h WHERE h.period_id=p.id)
     AND NOT EXISTS(SELECT 1 FROM public.shift_registrations r WHERE r.period_id=p.id))))) THEN
  RAISE EXCEPTION 'Existing next-week period differs or contains registrations; review before rescheduling. No real data changed.';
 END IF;
END $period_compat$;
UPDATE public.registration_periods p SET open_at=w.opening,
 status=CASE WHEN clock_timestamp()<w.opening THEN 'PLANNED' WHEN clock_timestamp()<w.closing THEN 'OPEN' ELSE 'CLOSED' END
FROM tv2_target_branches b CROSS JOIN tv2_target_window w WHERE p.branch_id=b.id AND p.work_start_date=w.monday
 AND p.status='PLANNED' AND p.open_at=w.opening+interval '1 day';
INSERT INTO public.registration_periods(branch_id,work_start_date,work_end_date,open_at,close_at,status)
SELECT b.id,w.monday,w.sunday,w.opening,w.closing,
 CASE WHEN clock_timestamp()<w.opening THEN 'PLANNED' WHEN clock_timestamp()<w.closing THEN 'OPEN' ELSE 'CLOSED' END
FROM tv2_target_branches b CROSS JOIN tv2_target_window w ON CONFLICT(branch_id,work_start_date) DO NOTHING;
-- A previously prepared Thursday PLANNED period can become OPEN only in its actual window.
UPDATE public.registration_periods p SET status='OPEN' FROM tv2_target_branches b CROSS JOIN tv2_target_window w
WHERE p.branch_id=b.id AND p.work_start_date=w.monday AND p.status='PLANNED' AND p.open_at=w.opening AND clock_timestamp()>=p.open_at AND clock_timestamp()<p.close_at;
NOTIFY pgrst,'reload schema';
COMMIT;
