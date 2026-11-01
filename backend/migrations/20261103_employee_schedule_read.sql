-- Local only. Read API through authenticated backend, no client table policy.
BEGIN;
CREATE FUNCTION public.employee_schedule_week(p_actor_id uuid,p_week_start date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE e public.employees; u public.users; result jsonb;
BEGIN
 IF session_user NOT IN ('postgres','supabase_admin') AND coalesce(auth.role(),'')<>'service_role'
  THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO u FROM public.users WHERE id=p_actor_id;
 SELECT * INTO e FROM public.employees WHERE user_id=p_actor_id;
 IF u.id IS NULL OR u.role<>'NV' OR NOT u.is_active OR u.must_change_password IS DISTINCT FROM false
  OR e.id IS NULL OR e.status<>'ACTIVE' OR e.branch_id IS DISTINCT FROM u.branch_id
  OR NOT EXISTS(SELECT 1 FROM public.branches WHERE id=e.branch_id AND status='ACTIVE')
  THEN RAISE EXCEPTION 'EMPLOYEE_SCOPE_INVALID' USING ERRCODE='42501'; END IF;
 IF p_week_start IS NULL OR extract(isodow FROM p_week_start)<>1 THEN RAISE EXCEPTION 'INVALID_WEEK' USING ERRCODE='22023'; END IF;
 -- A different unpublished version must not hide the last published version.
 -- Conflicting legacy groups are ambiguous; never guess or combine them.
 IF EXISTS(SELECT 1 FROM public.schedules s JOIN public.registration_periods p ON p.id=s.period_id
  WHERE s.branch_id=e.branch_id AND s.status='PUBLISHED' AND p.branch_id=e.branch_id
   AND p.work_start_date<=p_week_start+6 AND p.work_end_date>=p_week_start
  GROUP BY s.period_id HAVING count(DISTINCT s.schedule_group_id)>1)
  THEN RAISE EXCEPTION 'AMBIGUOUS_PUBLISHED_SCHEDULE'; END IF;
 WITH latest AS (
  SELECT DISTINCT ON(s.period_id) s.*,p.work_start_date,p.work_end_date FROM public.schedules s
  JOIN public.registration_periods p ON p.id=s.period_id
  WHERE s.branch_id=e.branch_id AND p.branch_id=e.branch_id AND s.status='PUBLISHED' AND s.published_at IS NOT NULL
   AND p.work_start_date<=p_week_start+6 AND p.work_end_date>=p_week_start
  ORDER BY s.period_id,s.version DESC,s.published_at DESC,s.id
 ), own AS (
  SELECT a.id assignment_id,a.employee_id,a.schedule_id,a.work_date,a.shift_id,a.department_id,a.actual_branch_id,a.assignment_source,
   s.schedule_group_id,s.period_id,s.version,s.published_at,s.feedback_deadline_at,
   t.name shift_name,t.start_time,t.end_time,d.name department_name,b.name branch_name
  FROM latest s JOIN public.shift_assignments a ON a.schedule_id=s.id
  JOIN public.shifts t ON t.id=a.shift_id JOIN public.departments d ON d.id=a.department_id
  JOIN public.branches b ON b.id=a.actual_branch_id
  WHERE a.employee_id=e.id AND a.status='ACTIVE' AND a.actual_branch_id=e.branch_id
   AND a.work_date BETWEEN p_week_start AND p_week_start+6
   AND a.work_date BETWEEN s.work_start_date AND s.work_end_date
 ) SELECT jsonb_build_object('employee',jsonb_build_object('id',e.id,'full_name',e.full_name,'branch_id',e.branch_id),
  'week_start',p_week_start,'week_end',p_week_start+6,'timezone','Asia/Ho_Chi_Minh',
  'schedules',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'period_id',period_id,'version',version,'published_at',published_at) ORDER BY work_start_date,id) FROM latest),'[]'),
  'assignments',coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY work_date,start_time,assignment_id) FROM own o),'[]')) INTO result;
 -- Different overlapping periods can otherwise duplicate the same logical shift.
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(result->'assignments') a(work_date date,shift_id uuid)
  GROUP BY work_date,shift_id HAVING count(*)>1) THEN RAISE EXCEPTION 'AMBIGUOUS_PUBLISHED_ASSIGNMENTS'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(result->'assignments') a(assignment_id uuid,work_date date,start_time time,end_time time)
  CROSS JOIN jsonb_to_recordset(result->'assignments') b(assignment_id uuid,work_date date,start_time time,end_time time)
  WHERE a.assignment_id<>b.assignment_id
   AND a.work_date+a.start_time<b.work_date+b.end_time+CASE WHEN b.end_time<b.start_time THEN interval '1 day' ELSE interval '0' END
   AND b.work_date+b.start_time<a.work_date+a.end_time+CASE WHEN a.end_time<a.start_time THEN interval '1 day' ELSE interval '0' END)
  THEN RAISE EXCEPTION 'AMBIGUOUS_PUBLISHED_ASSIGNMENTS'; END IF;
 RETURN result;
END $$;
ALTER FUNCTION public.employee_schedule_week(uuid,date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.employee_schedule_week(uuid,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.employee_schedule_week(uuid,date) TO service_role;
DO $$ DECLARE grantee_name name; BEGIN
 FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p
  CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a JOIN pg_roles r ON r.oid=a.grantee
  WHERE p.oid='public.employee_schedule_week(uuid,date)'::regprocedure AND a.grantee<>p.proowner AND r.rolname<>'service_role'
 LOOP EXECUTE format('REVOKE ALL ON FUNCTION public.employee_schedule_week(uuid,date) FROM %I',grantee_name); END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
