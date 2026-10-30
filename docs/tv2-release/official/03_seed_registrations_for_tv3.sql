-- OPTIONAL, APPROVAL REQUIRED. Shared project wlbpprpiieonjrqglicv.
-- Administrative sample availability, NOT actual employee submissions.
-- Requires approved official v3. Never creates accounts, employees, shifts or periods.
-- Uses 2 real periods/branches and 6 existing eligible employees per branch (12 total).
-- Reuses actual FK IDs. Existing headers/preferences are never overwritten.
-- Default week: next Monday. To choose another EXISTING week, prepend in same Run:
-- SET app.tv3_seed_work_start='2026-11-02';
-- Review selected periods/employees and approve this batch before running it.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SELECT pg_advisory_xact_lock(72910453);
DO $guard$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='registration_submissions' AND column_name='sample_batch_id' AND udt_name='uuid') THEN
  RAISE EXCEPTION 'Official v3 sample provenance is required; do not seed unlabeled employee data.';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.save_employee_registration(uuid,uuid,jsonb,boolean)')
  AND p.prosecdef AND position('sample_batch_id=NULL' IN p.prosrc)>0) THEN
  RAISE EXCEPTION 'The reviewed v3 self-service RPC must clear sample provenance on real saves. Do not seed a partial deployment.';
 END IF;
END $guard$;

CREATE TEMP TABLE tv3_sample_scope ON COMMIT DROP AS
SELECT p.* FROM public.registration_periods p JOIN public.branches b ON b.id=p.branch_id AND b.status='ACTIVE'
WHERE p.work_start_date=coalesce(nullif(current_setting('app.tv3_seed_work_start',true),'')::date,
 date_trunc('week',clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date+7)
ORDER BY b.id LIMIT 2;
DO $period_guard$ BEGIN
 IF (SELECT count(*) FROM tv3_sample_scope)<>2 THEN RAISE EXCEPTION 'Need two existing active-branch periods for the requested week. No periods will be invented.'; END IF;
 PERFORM 1 FROM public.registration_periods p JOIN tv3_sample_scope s ON s.id=p.id ORDER BY p.id FOR UPDATE OF p;
END $period_guard$;
-- Same period-first ordering as self-service RPC, then serialize fixture writes.
LOCK TABLE public.registration_submissions,public.shift_registrations IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE tv3_sample_batch ON COMMIT DROP AS
SELECT gen_random_uuid() AS id,'tv3-samples-v3-'||min(work_start_date)::text AS tag,clock_timestamp() AS created_at FROM tv3_sample_scope;
DO $batch_guard$ BEGIN
 IF EXISTS(SELECT 1 FROM public.audit_logs a JOIN tv3_sample_batch b ON a.new_data->>'batch_tag'=b.tag WHERE a.action='TV3_SAMPLE_SEED') THEN
  RAISE EXCEPTION 'This week already has a sample batch (including cleaned batches). No duplicates/replacement will be created.';
 END IF;
END $batch_guard$;

CREATE TEMP TABLE tv3_sample_shifts ON COMMIT DROP AS
SELECT p.id AS period_id,s.id AS shift_id,
 CASE s.start_time WHEN time '08:00' THEN 1 WHEN time '12:00' THEN 2 ELSE 3 END AS slot
FROM tv3_sample_scope p JOIN public.shifts s ON s.branch_id=p.branch_id OR s.branch_id IS NULL
WHERE s.is_active AND (s.start_time,s.end_time) IN ((time '08:00',time '12:00'),(time '12:00',time '17:00'),(time '17:00',time '22:00'));
DO $shift_guard$ BEGIN
 IF EXISTS(SELECT 1 FROM tv3_sample_scope p LEFT JOIN tv3_sample_shifts s ON s.period_id=p.id GROUP BY p.id HAVING count(s.shift_id)<>3 OR count(DISTINCT s.slot)<>3) THEN
  RAISE EXCEPTION 'Each chosen period needs exactly three compatible actual active shifts. Stop on missing/ambiguous configuration.';
 END IF;
END $shift_guard$;

CREATE TEMP TABLE tv3_sample_people ON COMMIT DROP AS
WITH candidates AS (
 SELECT p.id AS period_id,e.id AS employee_id,e.department_id,
  row_number() OVER(PARTITION BY p.id,e.department_id ORDER BY e.id) AS department_rank
 FROM tv3_sample_scope p JOIN public.employees e ON e.branch_id=p.branch_id
 JOIN public.users u ON u.id=e.user_id AND u.branch_id=e.branch_id
 WHERE e.status='ACTIVE' AND e.skill_level<>'CREW_LEADER' AND u.role='NV' AND u.is_active AND NOT u.must_change_password
  AND NOT EXISTS(SELECT 1 FROM public.registration_submissions h WHERE h.period_id=p.id AND h.employee_id=e.id)
  AND NOT EXISTS(SELECT 1 FROM public.shift_registrations r WHERE r.period_id=p.id AND r.employee_id=e.id)
), numbered AS (
 SELECT *,row_number() OVER(PARTITION BY period_id ORDER BY department_rank,department_id,employee_id)::integer AS sample_number FROM candidates
)
SELECT period_id,employee_id,sample_number FROM numbered WHERE sample_number<=6;
DO $people_guard$ BEGIN
 IF EXISTS(SELECT 1 FROM tv3_sample_scope p LEFT JOIN tv3_sample_people e ON e.period_id=p.id GROUP BY p.id HAVING count(e.employee_id)<>6) THEN
  RAISE EXCEPTION 'Need 6 eligible employees WITHOUT existing registration data per branch. No existing submission will be replaced.';
 END IF;
END $people_guard$;

CREATE TEMP TABLE tv3_sample_headers ON COMMIT DROP AS
SELECT e.period_id,e.employee_id,'VALID'::varchar(25) AS status,'[]'::jsonb AS errors,
 p.open_at+(p.close_at-p.open_at)/2 AS submitted_at,b.created_at AS updated_at,b.id AS sample_batch_id
FROM tv3_sample_people e JOIN tv3_sample_scope p ON p.id=e.period_id CROSS JOIN tv3_sample_batch b;
CREATE TEMP TABLE tv3_sample_rows ON COMMIT DROP AS
SELECT gen_random_uuid() AS id,e.period_id,e.employee_id,p.work_start_date+d.day_index AS work_date,
 s.shift_id,'VALID'::varchar(25) AS status,h.submitted_at,h.updated_at
FROM tv3_sample_people e JOIN tv3_sample_scope p ON p.id=e.period_id
JOIN tv3_sample_headers h ON h.period_id=e.period_id AND h.employee_id=e.employee_id
CROSS JOIN generate_series(0,6) d(day_index)
JOIN tv3_sample_shifts s ON s.period_id=e.period_id AND
 CASE e.sample_number WHEN 1 THEN s.slot=1 WHEN 2 THEN s.slot IN (1,2) WHEN 3 THEN s.slot=2
  WHEN 4 THEN s.slot IN (2,3) WHEN 5 THEN s.slot=3 ELSE true END
WHERE d.day_index<>e.sample_number-1;

-- Save immutable provenance/fingerprints BEFORE inserting headers referencing it.
-- Sample submitted_at is a simulated in-window timestamp, not a TV1 login event.
INSERT INTO public.audit_logs(id,actor_id,entity_type,entity_id,action,new_data,change_source)
SELECT b.id,NULL,'tv2_sample_batch',b.id,'TV3_SAMPLE_SEED',
 jsonb_build_object('batch_tag',b.tag,'is_sample',true,'not_employee_submission',true,
  'headers',(SELECT jsonb_agg(to_jsonb(h) ORDER BY h.period_id,h.employee_id) FROM tv3_sample_headers h),
  'registrations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM tv3_sample_rows r)),'SYSTEM'
FROM tv3_sample_batch b;
INSERT INTO public.registration_submissions(period_id,employee_id,status,errors,submitted_at,updated_at,sample_batch_id)
SELECT period_id,employee_id,status,errors,submitted_at,updated_at,sample_batch_id FROM tv3_sample_headers;
INSERT INTO public.shift_registrations(id,period_id,employee_id,work_date,shift_id,status,submitted_at,updated_at)
SELECT id,period_id,employee_id,work_date,shift_id,status,submitted_at,updated_at FROM tv3_sample_rows;

DO $counts$ BEGIN
 IF (SELECT count(*) FROM tv3_sample_headers)<>12 OR (SELECT count(*) FROM tv3_sample_rows)<>120 THEN
  RAISE EXCEPTION 'Unexpected sample counts; entire batch rolled back.';
 END IF;
END $counts$;
SELECT 'SAMPLE - not employee submissions' AS source,b.id AS sample_batch_id,b.tag,
 (SELECT count(*) FROM tv3_sample_headers) AS sample_employees,(SELECT count(*) FROM tv3_sample_rows) AS sample_preferences
FROM tv3_sample_batch b;
SELECT p.id AS actual_period_id,p.branch_id,p.work_start_date,p.work_end_date,e.employee_id,u.username AS employee_code,
 h.status,h.submitted_at,h.sample_batch_id
FROM tv3_sample_scope p JOIN tv3_sample_people e ON e.period_id=p.id
JOIN public.employees emp ON emp.id=e.employee_id JOIN public.users u ON u.id=emp.user_id
JOIN tv3_sample_headers h ON h.period_id=e.period_id AND h.employee_id=e.employee_id ORDER BY p.branch_id,e.sample_number;
COMMIT;
