-- SELECT only: marked TEST batch and its saved preferences.
SELECT b.id test_batch,u.username,e.id employee_id,e.branch_id,p.id period_id,
 p.work_start_date,p.work_end_date,p.status,
 p.open_at AT TIME ZONE 'Asia/Ho_Chi_Minh' opens_vietnam,
 p.close_at AT TIME ZONE 'Asia/Ho_Chi_Minh' deadline_vietnam,
 p.status='OPEN' AND clock_timestamp()>=p.open_at AND clock_timestamp()<p.close_at editable_now,
 s.status submission_status,s.errors,s.updated_at
FROM public.tv2_test_batches b JOIN public.employees e ON e.id=b.employee_id
JOIN public.users u ON u.id=e.user_id JOIN public.registration_periods p ON p.id=b.period_id
LEFT JOIN public.registration_submissions s ON s.period_id=b.period_id AND s.employee_id=b.employee_id
WHERE b.id='7f220000-0000-4000-8000-000000000001';
SELECT r.work_date,sh.name,r.status,r.submitted_at,r.updated_at
FROM public.shift_registrations r JOIN public.shifts sh ON sh.id=r.shift_id
JOIN public.tv2_test_batches b ON b.period_id=r.period_id AND b.employee_id=r.employee_id
WHERE b.id='7f220000-0000-4000-8000-000000000001' ORDER BY r.work_date,sh.start_time;


SELECT timezone,open_iso_day,open_local_time,close_iso_day,close_local_time,reminder_minutes FROM registration_schedule_config WHERE singleton;
