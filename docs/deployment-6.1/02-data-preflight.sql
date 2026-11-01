-- READ ONLY. Run only after C1 confirms all referenced base relations exist.
-- Counts/IDs only: no passwords, tokens, emails, phone numbers or Auth metadata.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
-- D1. Target period/demand. Expected old baseline was 63 cells/308 positions;
-- these are expectations to recheck, not authorization to replace changed data.
SELECT id,branch_id,work_start_date,work_end_date,open_at,close_at,status stored_status,
 CASE WHEN statement_timestamp()<open_at THEN 'PLANNED' WHEN statement_timestamp()<close_at THEN 'OPEN' ELSE 'CLOSED' END effective_status
FROM public.registration_periods WHERE id='79a979cc-8347-48b5-a411-f03bd8aceb92';
SELECT count(*) cells,coalesce(sum(required_count),0) positions,
 md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' ORDER BY id),'')) demand_evidence_md5
FROM public.staffing_requirements r WHERE branch_id='11111111-1111-1111-1111-111111111111'
 AND work_date BETWEEN date '2026-11-02' AND date '2026-11-08';
SELECT id,schedule_group_id,version,status,created_at,published_at FROM public.schedules
WHERE period_id='79a979cc-8347-48b5-a411-f03bd8aceb92' ORDER BY version,id;
-- D2. Existing account bindings and GS/QL scope; never change a reset flag.
SELECT e.skill_level,count(*) employees,count(*) FILTER(WHERE e.status='ACTIVE' AND u.role='NV' AND u.is_active AND u.branch_id=e.branch_id) active_nv,
 count(*) FILTER(WHERE au.id IS NULL OR u.id IS NULL) missing_auth_profile,
 count(*) FILTER(WHERE u.must_change_password) password_change_required
FROM public.employees e LEFT JOIN public.users u ON u.id=e.user_id LEFT JOIN auth.users au ON au.id=u.id
WHERE e.branch_id='11111111-1111-1111-1111-111111111111' GROUP BY e.skill_level ORDER BY 1;
SELECT b.id,b.status,b.supervisor_id,u.role supervisor_role,u.is_active supervisor_active,u.must_change_password
FROM public.branches b LEFT JOIN public.users u ON u.id=b.supervisor_id WHERE b.id='11111111-1111-1111-1111-111111111111';
SELECT role,count(*) profiles,count(*) FILTER(WHERE is_active) active,count(*) FILTER(WHERE must_change_password) password_change_required
FROM public.users WHERE branch_id='11111111-1111-1111-1111-111111111111' GROUP BY role;
-- D3. Keep sample/real provenance distinct. This view includes legacy sourcing.
SELECT h.status,h.sample_batch_id,count(*) headers,count(*) FILTER(WHERE h.submitted_at>p.close_at) recorded_after_close
FROM public.registration_submissions_sourced h JOIN public.registration_periods p ON p.id=h.period_id
WHERE h.period_id='79a979cc-8347-48b5-a411-f03bd8aceb92' GROUP BY h.status,h.sample_batch_id;
SELECT r.work_date,count(*) registration_rows,count(DISTINCT r.employee_id) distinct_employees,
 count(DISTINCT r.employee_id) FILTER(WHERE h.sample_batch_id IS NULL) real_employees,
 count(*) FILTER(WHERE h.sample_batch_id IS NOT NULL) sample_rows_excluded_from_ordinary_flow
FROM public.shift_registrations r JOIN public.registration_submissions_sourced h USING(period_id,employee_id)
JOIN public.employees e ON e.id=r.employee_id JOIN public.users u ON u.id=e.user_id
WHERE r.period_id='79a979cc-8347-48b5-a411-f03bd8aceb92' AND r.status='VALID' AND h.status='VALID'
 AND r.submitted_at IS NOT NULL AND h.submitted_at IS NOT NULL AND e.status='ACTIVE' AND u.is_active AND u.role='NV'
 AND e.skill_level IN('NEW','REGULAR','CREW_TRAINING') AND e.branch_id=u.branch_id
GROUP BY r.work_date ORDER BY 1;
-- D4. TV5 indexes are GLOBAL. Any result blocks index creation; no auto cleanup.
SELECT original_assignment_id,count(*) open_requests FROM public.shift_change_requests
WHERE status IN('PENDING','SEARCHING') GROUP BY original_assignment_id HAVING count(*)>1;
SELECT original_assignment_id,count(*) open_incidents FROM public.incidents
WHERE status IN('REPORTED','IN_PROGRESS') GROUP BY original_assignment_id HAVING count(*)>1;
SELECT r.original_assignment_id,r.id request_id,c.id incident_id FROM public.shift_change_requests r
JOIN public.incidents c USING(original_assignment_id)
WHERE r.status IN('PENDING','SEARCHING') AND c.status IN('REPORTED','IN_PROGRESS');
SELECT 'requests' entity,count(*) legacy_open_without_snapshot FROM public.shift_change_requests r
WHERE status IN('PENDING','SEARCHING') AND to_jsonb(r)->>'assignment_snapshot' IS NULL
UNION ALL SELECT 'incidents',count(*) FROM public.incidents r
WHERE status IN('REPORTED','IN_PROGRESS') AND to_jsonb(r)->>'assignment_snapshot' IS NULL;
-- D5. Schema rollback to old UNIQUE becomes impossible once this returns rows.
SELECT schedule_id,employee_id,work_date,shift_id,count(*) historical_rows
FROM public.shift_assignments GROUP BY schedule_id,employee_id,work_date,shift_id HAVING count(*)>1;
SELECT schedule_id,employee_id,work_date,shift_id,count(*) current_duplicates
FROM public.shift_assignments WHERE status<>'REPLACED' GROUP BY schedule_id,employee_id,work_date,shift_id HAVING count(*)>1;
-- D6. Existing FK/audit/publication inconsistencies need owner review, not deletion.
SELECT a.schedule_id,count(*) approvals FROM public.schedule_approvals a GROUP BY a.schedule_id HAVING count(*)>1;
SELECT period_id,count(DISTINCT schedule_group_id) groups FROM public.schedules
WHERE status='PUBLISHED' GROUP BY period_id HAVING count(DISTINCT schedule_group_id)>1;
SELECT s.id,s.status,count(a.id) incompatible_assignments FROM public.schedules s JOIN public.shift_assignments a ON a.schedule_id=s.id
WHERE (s.status='PUBLISHED' AND a.status='DRAFT') OR (s.status IN('DRAFT','PENDING_APPROVAL','APPROVED') AND a.status='ACTIVE')
GROUP BY s.id,s.status;
SELECT id,entity_id,action FROM public.audit_logs WHERE id='6e1d2026-1102-4000-8000-000000000017';
-- D7. Scheduler configuration is evidence only; do not run cron/RPCs here.
SELECT * FROM public.registration_schedule_config;
SELECT * FROM public.registration_automation_config;
COMMIT;
