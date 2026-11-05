-- SELECT only. Expected results apply after the single documented test case.
BEGIN READ ONLY;
-- Original assignment retained; its ACTIVE successor belongs to the replacement.
SELECT a.id,a.status,u.username,a.work_date,t.name shift_name,a.replaces_assignment_id
FROM public.shift_assignments a
JOIN public.employees e ON e.id=a.employee_id
JOIN public.users u ON u.id=e.user_id
JOIN public.shifts t ON t.id=a.shift_id
WHERE a.id='d00ed6e0-06b2-43e7-9c33-82dce15b3401'
   OR a.replaces_assignment_id='d00ed6e0-06b2-43e7-9c33-82dce15b3401'
ORDER BY a.replaces_assignment_id NULLS FIRST;

SELECT r.id,r.status,r.approved_by,r.resolved_at,u.username replacement_username,
 v.status invitation_status,v.valid_when_confirmed,v.responded_at,v.expires_at
FROM public.shift_change_requests r
LEFT JOIN public.employees e ON e.id=r.replacement_employee_id
LEFT JOIN public.users u ON u.id=e.user_id
LEFT JOIN public.replacement_invitations v ON v.shift_change_request_id=r.id
WHERE r.original_assignment_id='d00ed6e0-06b2-43e7-9c33-82dce15b3401';

-- Each count is read through the employee's official, own-identity RPC.
SELECT u.username,
 jsonb_array_length(public.employee_schedule_week(u.id,'2026-11-02')->'assignments') own_visible_shifts
FROM public.users u WHERE u.username IN('nv_jollibee','nv_jollibee_02');

-- Coverage is unchanged: 308 ACTIVE assignments if no other edits were made.
SELECT s.id,s.status,count(*) FILTER(WHERE a.status='ACTIVE') active_assignments,
 count(*) FILTER(WHERE a.status='REPLACED') historical_replacements
FROM public.schedules s JOIN public.shift_assignments a ON a.schedule_id=s.id
WHERE s.period_id='79a979cc-8347-48b5-a411-f03bd8aceb92'
 AND s.branch_id='11111111-1111-1111-1111-111111111111'
GROUP BY s.id,s.status;
COMMIT;
