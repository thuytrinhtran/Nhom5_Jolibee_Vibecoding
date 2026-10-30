-- Requires 20261030_registration_effective_state.sql. status below is derived from DB time.
-- SELECT ONLY. Set app.tv2_period_id to the approved period UUID in this session.
-- TV3 must enforce manager/branch authorization in its own backend.
-- Only a VALID header with submitted_at confirms availability. Missing rows alone never imply OFF.
-- Default excludes administrative samples. For TV3 development only, in the SAME Run:
-- SET app.tv2_include_samples = 'true';
-- Requires official v3's nullable header sample_batch_id -> audit_logs.id.
SELECT p.status AS period_status,r.period_id,e.branch_id,r.work_date,r.shift_id,e.department_id,h.sample_batch_id,
 h.sample_batch_id IS NOT NULL AS is_sample,count(DISTINCT r.employee_id) AS available_employee_count
FROM shift_registrations r JOIN registration_submissions_sourced h ON h.period_id=r.period_id AND h.employee_id=r.employee_id AND h.status='VALID' AND h.submitted_at IS NOT NULL
JOIN employees e ON e.id=r.employee_id AND e.status='ACTIVE' AND e.skill_level<>'CREW_LEADER'
JOIN users u ON u.id=e.user_id AND u.is_active AND u.role='NV' AND u.branch_id=e.branch_id
JOIN registration_periods_effective p ON p.id=r.period_id AND p.branch_id=e.branch_id
JOIN shifts s ON s.id=r.shift_id AND s.is_active AND (s.branch_id IS NULL OR s.branch_id=e.branch_id)
WHERE r.status='VALID' AND r.period_id=nullif(current_setting('app.tv2_period_id',true),'')::uuid
 AND (h.sample_batch_id IS NULL OR current_setting('app.tv2_include_samples',true)='true')
GROUP BY p.status,r.period_id,e.branch_id,r.work_date,r.shift_id,e.department_id,h.sample_batch_id ORDER BY r.work_date,r.shift_id;

SELECT p.status AS period_status,p.id AS period_id,p.work_start_date,p.work_end_date,e.id AS employee_id,u.username AS employee_code,e.department_id,d.day::date AS work_date,
 coalesce(h.status,'NOT_SUBMITTED') AS submission_status,h.submitted_at,h.updated_at,h.sample_batch_id,h.sample_batch_id IS NOT NULL AS is_sample,
 CASE WHEN h.status='VALID' AND h.submitted_at IS NOT NULL THEN
   CASE WHEN EXISTS(SELECT 1 FROM shift_registrations r WHERE r.period_id=p.id AND r.employee_id=e.id AND r.work_date=d.day::date AND r.status='VALID') THEN 'SHIFT' ELSE 'OFF' END
 ELSE 'NOT_SUBMITTED' END AS declaration
FROM registration_periods_effective p JOIN employees e ON e.branch_id=p.branch_id AND e.status='ACTIVE' AND e.skill_level<>'CREW_LEADER'
JOIN users u ON u.id=e.user_id AND u.is_active AND u.role='NV' AND u.branch_id=e.branch_id
CROSS JOIN LATERAL generate_series(p.work_start_date,p.work_end_date,interval '1 day') d(day)
LEFT JOIN registration_submissions_sourced h ON h.period_id=p.id AND h.employee_id=e.id
 AND (h.sample_batch_id IS NULL OR current_setting('app.tv2_include_samples',true)='true')
WHERE p.id=nullif(current_setting('app.tv2_period_id',true),'')::uuid ORDER BY e.id,d.day;

-- Individual availability for TV3 scheduling (not only aggregate counts).
SELECT p.status AS period_status,r.employee_id,r.period_id,r.work_date,r.shift_id,e.branch_id,e.department_id,h.submitted_at,h.sample_batch_id,h.sample_batch_id IS NOT NULL AS is_sample
FROM public.shift_registrations r
JOIN public.registration_submissions_sourced h ON h.period_id=r.period_id AND h.employee_id=r.employee_id
 AND h.status='VALID' AND h.submitted_at IS NOT NULL
JOIN public.registration_periods_effective p ON p.id=r.period_id
JOIN public.employees e ON e.id=r.employee_id AND e.branch_id=p.branch_id
 AND e.status='ACTIVE' AND e.skill_level<>'CREW_LEADER'
JOIN public.users u ON u.id=e.user_id AND u.role='NV' AND u.is_active AND u.branch_id=e.branch_id
JOIN public.shifts s ON s.id=r.shift_id AND s.is_active AND (s.branch_id IS NULL OR s.branch_id=e.branch_id)
WHERE r.status='VALID' AND r.submitted_at IS NOT NULL
 AND r.work_date BETWEEN p.work_start_date AND p.work_end_date
 AND r.period_id=nullif(current_setting('app.tv2_period_id',true),'')::uuid
 AND (h.sample_batch_id IS NULL OR current_setting('app.tv2_include_samples',true)='true')
ORDER BY r.employee_id,r.work_date,s.start_time,r.shift_id;
