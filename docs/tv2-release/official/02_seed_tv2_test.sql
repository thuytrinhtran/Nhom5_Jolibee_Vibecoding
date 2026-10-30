-- SUPERSEDED for the current rollout: use 03_seed_registrations_for_tv3.sql.
-- Historical v2 fixture creates its own periods and lacks v3 header sample provenance.
-- Do not run this legacy file with v3/03 or treat its rows as employee submissions.
-- OPTIONAL SYNTHETIC DATA ONLY. Prepare/review separately from 01_apply_tv2.sql.
-- Target shared project: wlbpprpiieonjrqglicv. Do not run without approval.
-- Revision: tv2-test-week-20261026-v1.
-- Requires the final TV2 schema and existing shifts from 01_apply_tv2.sql.
-- Creates 2 CLOSED periods for 26/10..01/11/2026, 5 existing eligible employees
-- per branch, 10 VALID headers and 84 shift preferences. No new Auth/profile/employee.
-- These are administrative fixtures, NOT submissions actually made by employees.
-- audit_logs records actor_id=NULL, SYSTEM, TV2_TEST_SEED and synthetic=true.
-- No changes to official periods/registrations for 02/11..08/11/2026.
-- No cron, notifications, RPC invocation, validation bypass or permission changes.
-- Apply the WHOLE file once as postgres. A conflict aborts/rolls back; never overwrite.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(72910453);

DO $guard$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['branches','users','employees','shifts','registration_periods','registration_submissions','shift_registrations','audit_logs'] LOOP
    IF to_regclass('public.'||table_name) IS NULL THEN
      RAISE EXCEPTION 'Missing table %. Apply the approved TV2 schema first; this file is not a migration.',table_name;
    END IF;
  END LOOP;
  IF to_regprocedure('public.save_employee_registration(uuid,uuid,jsonb,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Final four-argument TV2 RPC is required. Do not apply old migrations or seed partial schema.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.audit_logs WHERE action='TV2_TEST_SEED' AND new_data->>'fixture'='tv2-test-week-20261026-v1') THEN
    RAISE EXCEPTION 'This fixture was already applied; no duplicate or replacement data will be created.';
  END IF;
END $guard$;

-- Known existing branch IDs, with dedicated fixture period/audit IDs for traceability.
CREATE TEMP TABLE tv2_seed_branches (
  branch_id uuid PRIMARY KEY, period_id uuid UNIQUE NOT NULL, audit_id uuid UNIQUE NOT NULL
) ON COMMIT DROP;
INSERT INTO tv2_seed_branches VALUES
 ('11111111-1111-1111-1111-111111111111','8f220000-0000-4000-8000-000000000101','8f220000-0000-4000-8000-000000000201'),
 ('d25dd99d-b882-56ea-a272-e0a325c0592b','8f220000-0000-4000-8000-000000000102','8f220000-0000-4000-8000-000000000202');

DO $period_guard$
BEGIN
  IF EXISTS(SELECT 1 FROM tv2_seed_branches x LEFT JOIN public.branches b ON b.id=x.branch_id WHERE b.id IS NULL OR b.status<>'ACTIVE') THEN
    RAISE EXCEPTION 'Both approved existing branches must be ACTIVE. No branch will be created or modified.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.registration_periods p JOIN tv2_seed_branches b
    ON p.id=b.period_id OR (p.branch_id=b.branch_id AND p.work_start_date=date '2026-10-26')) THEN
    RAISE EXCEPTION 'A target period ID or branch/week 26/10 already exists. Stop: never reuse or overwrite real registrations.';
  END IF;
  IF EXISTS(SELECT 1 FROM public.audit_logs a JOIN tv2_seed_branches b ON a.id=b.audit_id) THEN
    RAISE EXCEPTION 'Reserved fixture audit ID already exists. No data was replaced.';
  END IF;
END $period_guard$;

-- Use actual shift IDs from the database; never create or alter shifts here.
CREATE TEMP TABLE tv2_seed_shifts ON COMMIT DROP AS
SELECT b.branch_id,s.id AS shift_id,
 CASE s.start_time WHEN time '08:00' THEN 1 WHEN time '12:00' THEN 2 ELSE 3 END AS slot
FROM tv2_seed_branches b JOIN public.shifts s ON s.branch_id=b.branch_id OR s.branch_id IS NULL
WHERE s.is_active AND (s.start_time,s.end_time) IN
 ((time '08:00',time '12:00'),(time '12:00',time '17:00'),(time '17:00',time '22:00'));
DO $shift_guard$
BEGIN
  IF EXISTS(SELECT 1 FROM tv2_seed_branches b LEFT JOIN tv2_seed_shifts s ON s.branch_id=b.branch_id
    GROUP BY b.branch_id HAVING count(s.shift_id)<>3 OR count(DISTINCT s.slot)<>3) THEN
    RAISE EXCEPTION 'Each branch needs exactly one active shift for 08-12, 12-17 and 17-22. Missing/ambiguous shifts: stop rather than invent configuration.';
  END IF;
END $shift_guard$;

-- Deterministic selection: round-robin departments, then employee UUID.
-- Only existing active NV profiles with matching branch and no password-change gate.
CREATE TEMP TABLE tv2_seed_employees ON COMMIT DROP AS
WITH candidates AS (
 SELECT e.id AS employee_id,e.branch_id,e.department_id,
  row_number() OVER(PARTITION BY e.branch_id,e.department_id ORDER BY e.id) AS department_rank
 FROM public.employees e JOIN tv2_seed_branches b ON b.branch_id=e.branch_id
 JOIN public.users u ON u.id=e.user_id AND u.branch_id=e.branch_id
 WHERE e.status='ACTIVE' AND e.skill_level<>'CREW_LEADER'
  AND u.role='NV' AND u.is_active AND NOT u.must_change_password
), numbered AS (
 SELECT *,row_number() OVER(PARTITION BY branch_id ORDER BY department_rank,department_id,employee_id)::integer AS sample_number
 FROM candidates
)
SELECT employee_id,branch_id,sample_number FROM numbered WHERE sample_number<=5;
DO $employee_guard$
BEGIN
  IF EXISTS(SELECT 1 FROM tv2_seed_branches b LEFT JOIN tv2_seed_employees e ON e.branch_id=b.branch_id
    GROUP BY b.branch_id HAVING count(e.employee_id)<>5) THEN
    RAISE EXCEPTION 'Each branch needs 5 existing eligible employees. No account or employee will be created or changed.';
  END IF;
END $employee_guard$;

-- CLOSED keeps this historical fixture from taking precedence over the current OPEN
-- official period in GET /api/registrations/current. TV3 does not require OPEN.
-- Times below are explicitly simulated historical dates, not a genuine user action.
INSERT INTO public.registration_periods(id,branch_id,work_start_date,work_end_date,open_at,close_at,status)
SELECT period_id,branch_id,date '2026-10-26',date '2026-11-01',
 timestamptz '2026-10-22 15:00:00+07',timestamptz '2026-10-25 12:00:00+07','CLOSED'
FROM tv2_seed_branches;

-- Admin fixture inserts deliberately do not call the self-service RPC as an employee.
INSERT INTO public.registration_submissions(period_id,employee_id,status,errors,submitted_at,updated_at)
SELECT b.period_id,e.employee_id,'VALID','[]'::jsonb,timestamptz '2026-10-24 10:00:00+07',clock_timestamp()
FROM tv2_seed_employees e JOIN tv2_seed_branches b ON b.branch_id=e.branch_id;

-- Each person is available 6 days, with a different unselected day (OFF after VALID).
-- Samples 1/3/5: morning/afternoon/evening respectively; 2: morning+afternoon;
-- 4: afternoon+evening. Adjacent shifts never overlap. Total 42 rows per branch.
INSERT INTO public.shift_registrations(period_id,employee_id,work_date,shift_id,status,submitted_at,updated_at)
SELECT b.period_id,e.employee_id,date '2026-10-26'+d.day_index,s.shift_id,'VALID',
 timestamptz '2026-10-24 10:00:00+07',clock_timestamp()
FROM tv2_seed_employees e JOIN tv2_seed_branches b ON b.branch_id=e.branch_id
CROSS JOIN generate_series(0,6) AS d(day_index)
JOIN tv2_seed_shifts s ON s.branch_id=e.branch_id AND
 CASE e.sample_number WHEN 1 THEN s.slot=1 WHEN 2 THEN s.slot IN (1,2)
  WHEN 3 THEN s.slot=2 WHEN 4 THEN s.slot IN (2,3) ELSE s.slot=3 END
WHERE d.day_index<>e.sample_number-1;

-- Permanent provenance, without attributing a fictional SUBMIT to a real person.
INSERT INTO public.audit_logs(id,actor_id,entity_type,entity_id,action,new_data,change_source)
SELECT b.audit_id,NULL,'registration_period',b.period_id,'TV2_TEST_SEED',
 jsonb_build_object('fixture','tv2-test-week-20261026-v1','synthetic',true,'not_employee_submission',true,
  'work_start_date','2026-10-26','work_end_date','2026-11-01',
  'employee_ids',(SELECT jsonb_agg(e.employee_id ORDER BY e.sample_number) FROM tv2_seed_employees e WHERE e.branch_id=b.branch_id),
  'submission_count',5,'shift_preference_count',42),'SYSTEM'
FROM tv2_seed_branches b;

DO $verify_counts$
BEGIN
  IF (SELECT count(*) FROM public.registration_submissions h JOIN tv2_seed_branches b ON b.period_id=h.period_id WHERE h.status='VALID' AND h.submitted_at IS NOT NULL)<>10
   OR (SELECT count(*) FROM public.shift_registrations r JOIN tv2_seed_branches b ON b.period_id=r.period_id WHERE r.status='VALID' AND r.submitted_at IS NOT NULL)<>84 THEN
    RAISE EXCEPTION 'Unexpected fixture counts. Roll back the entire batch.';
  END IF;
END $verify_counts$;

-- Result: exact periods and existing employees used. These rows are SYNTHETIC.
SELECT 'TEST - dữ liệu giả định' AS data_source,b.name AS branch,p.id AS period_id,
 p.work_start_date,p.work_end_date,p.status,
 (SELECT count(*) FROM public.registration_submissions h WHERE h.period_id=p.id) AS valid_submissions,
 (SELECT count(*) FROM public.shift_registrations r WHERE r.period_id=p.id) AS shift_preferences
FROM public.registration_periods p JOIN tv2_seed_branches x ON x.period_id=p.id
JOIN public.branches b ON b.id=p.branch_id ORDER BY b.id;
SELECT 'TEST - không phải nhân viên tự gửi' AS data_source,p.id AS period_id,e.id AS employee_id,
 u.username AS employee_code,e.full_name,h.status,h.submitted_at
FROM tv2_seed_branches b JOIN public.registration_periods p ON p.id=b.period_id
JOIN public.registration_submissions h ON h.period_id=p.id
JOIN public.employees e ON e.id=h.employee_id JOIN public.users u ON u.id=e.user_id
ORDER BY b.branch_id,e.id;
COMMIT;
