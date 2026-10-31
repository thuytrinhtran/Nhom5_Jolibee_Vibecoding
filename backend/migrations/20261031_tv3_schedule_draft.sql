-- REVIEW BEFORE APPLY. Adds two functions/EXECUTE ACLs only; no data backfill.
-- Requires foundation, Auth gate and 20261030_registration_effective_state.sql.
-- CREATE (not OR REPLACE) deliberately refuses to overwrite an existing RPC.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF current_user<>'postgres' THEN RAISE EXCEPTION 'Apply as trusted postgres owner'; END IF;
END $$;

CREATE FUNCTION public.tv3_scheduling_input(p_period_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE p public.registration_periods; v jsonb;
BEGIN
  SELECT * INTO STRICT p FROM public.registration_periods WHERE id=p_period_id;
  SELECT jsonb_build_object(
    'period',jsonb_build_object('id',p.id,'branch_id',p.branch_id,'work_start_date',p.work_start_date,
      'work_end_date',p.work_end_date,'status',public.registration_effective_status(p.open_at,p.close_at,statement_timestamp())),
    'employees',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'department_id',e.department_id,
      'skill_level',e.skill_level,'status',e.status,'is_active',u.is_active AND u.branch_id=e.branch_id,
      'role',u.role,'max_weekly_hours',e.max_weekly_hours,
      'skills',COALESCE((SELECT jsonb_agg(k.skill_name ORDER BY k.skill_name,k.id) FROM public.employee_skills k WHERE k.employee_id=e.id),'[]'::jsonb)) ORDER BY e.id)
      FROM public.employees e JOIN public.users u ON u.id=e.user_id WHERE e.branch_id=p.branch_id),'[]'::jsonb),
    'shifts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'start_time',s.start_time,'end_time',s.end_time,'is_active',s.is_active,'branch_id',s.branch_id) ORDER BY s.id)
      FROM public.shifts s WHERE s.branch_id IS NULL OR s.branch_id=p.branch_id OR EXISTS(
        SELECT 1 FROM public.shift_assignments a JOIN public.employees e ON e.id=a.employee_id
        WHERE a.shift_id=s.id AND e.branch_id=p.branch_id AND a.status<>'REPLACED'
          AND a.work_date BETWEEN p.work_start_date-1 AND p.work_end_date+7)),'[]'::jsonb),
    'registrations',COALESCE((SELECT jsonb_agg(jsonb_build_object('employee_id',r.employee_id,'work_date',r.work_date,'shift_id',r.shift_id,'status',r.status) ORDER BY r.employee_id,r.work_date,r.shift_id)
      FROM public.shift_registrations r
      JOIN public.registration_submissions_sourced h ON h.period_id=r.period_id AND h.employee_id=r.employee_id
      JOIN public.employees e ON e.id=r.employee_id JOIN public.users u ON u.id=e.user_id JOIN public.shifts s ON s.id=r.shift_id
      WHERE r.period_id=p.id AND r.status='VALID' AND r.submitted_at IS NOT NULL AND h.status='VALID' AND h.submitted_at IS NOT NULL AND h.sample_batch_id IS NULL
        AND e.branch_id=p.branch_id AND e.status='ACTIVE' AND e.skill_level<>'CREW_LEADER' AND u.role='NV' AND u.is_active AND u.branch_id=e.branch_id
        AND s.is_active AND (s.branch_id IS NULL OR s.branch_id=p.branch_id) AND r.work_date BETWEEN p.work_start_date AND p.work_end_date),'[]'::jsonb),
    'requirements',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'department_id',r.department_id,'work_date',r.work_date,'shift_id',r.shift_id,'required_count',r.required_count,'required_skill_name',r.required_skill_name) ORDER BY r.id)
      FROM public.staffing_requirements r WHERE r.branch_id=p.branch_id AND r.work_date BETWEEN p.work_start_date AND p.work_end_date),'[]'::jsonb),
    'existing',COALESCE((SELECT jsonb_agg(jsonb_build_object('employee_id',a.employee_id,'work_date',a.work_date,'shift_id',a.shift_id,'department_id',a.department_id) ORDER BY a.id)
      FROM public.shift_assignments a JOIN public.employees e ON e.id=a.employee_id WHERE e.branch_id=p.branch_id AND a.status<>'REPLACED'
        AND a.work_date BETWEEN p.work_start_date-1 AND p.work_end_date+7),'[]'::jsonb),
    'new_employee_count_threshold',(SELECT w.new_employee_count_threshold FROM public.warning_configs w WHERE w.branch_id=p.branch_id)
  ) INTO v;
  RETURN v;
END;
$$;

CREATE FUNCTION public.generate_schedule_draft(p_period_id uuid,p_actor_id uuid,p_snapshot jsonb DEFAULT NULL,p_result jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET lock_timeout = '5s' AS $$
DECLARE p public.registration_periods; actor public.users; current_input jsonb; saved public.schedules;
  previous jsonb; persisted jsonb; output jsonb; item jsonb; n integer; need public.staffing_requirements;
  emp public.employees; shift_row public.shifts; begin_at timestamp; end_at timestamp;
  coverage jsonb; verified_assignments jsonb := '[]'; statistics jsonb; verified_result jsonb;
BEGIN
  -- This is a backend service RPC, not an end-user RPC. p_actor_id is trusted ONLY
  -- because Express verifies the user JWT and derives it from req.user, never body.
  IF session_user NOT IN ('postgres','supabase_admin') AND COALESCE(auth.role(),'')<>'service_role'
    THEN RAISE EXCEPTION 'FORBIDDEN_CALLER' USING ERRCODE='42501'; END IF;
  -- Take global write-conflicting locks ONLY for the short save transaction.
  -- STABLE input helper gives the read/compute phase a consistent SQL snapshot.
  IF p_result IS NOT NULL THEN
  LOCK TABLE public.branches,public.users,public.employees,public.employee_skills,public.shifts,
    public.registration_periods,public.registration_submissions,public.shift_registrations,
    public.staffing_requirements,public.warning_configs,public.schedules,public.shift_assignments,
    public.audit_logs IN SHARE ROW EXCLUSIVE MODE;
  END IF;
  SELECT * INTO actor FROM public.users WHERE id=p_actor_id;
  SELECT * INTO p FROM public.registration_periods WHERE id=p_period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERIOD_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF actor.id IS NULL OR actor.role<>'QL' OR NOT actor.is_active OR actor.must_change_password IS DISTINCT FROM false
    OR actor.branch_id IS DISTINCT FROM p.branch_id OR NOT EXISTS(SELECT 1 FROM public.branches WHERE id=p.branch_id AND status='ACTIVE')
    THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF public.registration_effective_status(p.open_at,p.close_at,statement_timestamp())<>'CLOSED'
    THEN RAISE EXCEPTION 'PERIOD_NOT_CLOSED'; END IF;
  IF (p_snapshot IS NULL) <> (p_result IS NULL) THEN RAISE EXCEPTION 'INVALID_RESULT' USING ERRCODE='22023'; END IF;

  SELECT count(*) INTO n FROM public.schedules WHERE period_id=p.id;
  IF n>0 THEN
    IF n<>1 THEN RAISE EXCEPTION 'SCHEDULE_EXISTS'; END IF;
    SELECT * INTO saved FROM public.schedules WHERE period_id=p.id;
    SELECT a.new_data INTO previous FROM public.audit_logs a WHERE a.entity_id=saved.id AND a.entity_type='schedules'
      AND a.action='AUTO_GENERATE' AND a.new_data->>'rpc_version'='tv3-v1' ORDER BY a.created_at DESC,a.id DESC LIMIT 1;
    SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) INTO persisted FROM public.shift_assignments a WHERE schedule_id=saved.id;
    IF saved.status<>'DRAFT' OR saved.branch_id<>p.branch_id OR previous IS NULL
      OR previous->'persisted_assignments' IS DISTINCT FROM persisted OR previous->'saved_schedule' IS DISTINCT FROM to_jsonb(saved)
      THEN RAISE EXCEPTION 'SCHEDULE_EXISTS'; END IF;
    RETURN jsonb_build_object('reused',true,'result',previous->'response_result');
  END IF;

  current_input:=public.tv3_scheduling_input(p.id);
  IF (current_input->'period'->>'branch_id')::uuid IS DISTINCT FROM actor.branch_id
    THEN RAISE EXCEPTION 'INPUT_CHANGED' USING ERRCODE='40001'; END IF;
  IF p_result IS NULL THEN RETURN jsonb_build_object('input',current_input); END IF;
  IF p_snapshot IS DISTINCT FROM current_input THEN RAISE EXCEPTION 'INPUT_CHANGED' USING ERRCODE='40001'; END IF;
  IF jsonb_typeof(p_result)<>'object' OR jsonb_typeof(p_result->'assignments') IS DISTINCT FROM 'array'
    OR jsonb_array_length(current_input->'requirements')=0 THEN RAISE EXCEPTION 'INVALID_RESULT' USING ERRCODE='22023'; END IF;
  -- The engine remains in TypeScript. SQL independently protects persisted relationships.
  INSERT INTO public.schedules(branch_id,period_id,version,status,created_by)
    VALUES(p.branch_id,p.id,1,'DRAFT',actor.id) RETURNING * INTO saved;
  FOR item IN SELECT value FROM jsonb_array_elements(p_result->'assignments') LOOP
    IF jsonb_typeof(item)<>'object' OR NOT(item ?& ARRAY['employee_id','shift_id','department_id','work_date'])
      OR jsonb_typeof(item->'employee_id')<>'string' OR jsonb_typeof(item->'shift_id')<>'string'
      OR jsonb_typeof(item->'department_id')<>'string' OR jsonb_typeof(item->'work_date')<>'string'
      OR (item->>'work_date') !~ '^\d{4}-\d{2}-\d{2}$'
      THEN RAISE EXCEPTION 'INVALID_ASSIGNMENT' USING ERRCODE='22023'; END IF;
    SELECT * INTO emp FROM public.employees WHERE id=(item->>'employee_id')::uuid;
    SELECT * INTO shift_row FROM public.shifts WHERE id=(item->>'shift_id')::uuid;
    SELECT * INTO need FROM public.staffing_requirements WHERE branch_id=p.branch_id
      AND work_date=(item->>'work_date')::date AND shift_id=shift_row.id AND department_id=(item->>'department_id')::uuid;
    IF emp.id IS NULL OR emp.branch_id<>p.branch_id OR emp.status<>'ACTIVE' OR emp.skill_level='CREW_LEADER'
      OR emp.department_id IS DISTINCT FROM (item->>'department_id')::uuid OR need.id IS NULL
      OR need.work_date NOT BETWEEN p.work_start_date AND p.work_end_date OR NOT shift_row.is_active OR shift_row.start_time=shift_row.end_time
      OR (emp.max_weekly_hours IS NOT NULL AND (emp.max_weekly_hours<=0 OR emp.max_weekly_hours::text IN ('NaN','Infinity','-Infinity')))
      OR (shift_row.branch_id IS NOT NULL AND shift_row.branch_id<>p.branch_id)
      OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=emp.user_id AND role='NV' AND is_active AND branch_id=p.branch_id)
      OR (need.required_skill_name IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.employee_skills WHERE employee_id=emp.id AND skill_name=need.required_skill_name))
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(current_input->'registrations') r WHERE r->>'employee_id'=emp.id::text AND r->>'shift_id'=shift_row.id::text AND r->>'work_date'=need.work_date::text)
      THEN RAISE EXCEPTION 'INVALID_ASSIGNMENT' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM public.shift_assignments WHERE schedule_id=saved.id AND employee_id=emp.id AND work_date=need.work_date AND shift_id=shift_row.id)
      THEN RAISE EXCEPTION 'DUPLICATE_ASSIGNMENT' USING ERRCODE='23505'; END IF;
    INSERT INTO public.shift_assignments(schedule_id,employee_id,work_date,shift_id,department_id,actual_branch_id,status,assignment_source)
      VALUES(saved.id,emp.id,need.work_date,shift_row.id,emp.department_id,p.branch_id,'DRAFT','REGULAR');
    IF (SELECT count(*) FROM public.shift_assignments WHERE schedule_id=saved.id AND work_date=need.work_date AND shift_id=shift_row.id AND department_id=need.department_id)>need.required_count
      THEN RAISE EXCEPTION 'DEMAND_EXCEEDED' USING ERRCODE='22023'; END IF;
    begin_at:=need.work_date+shift_row.start_time;
    end_at:=need.work_date+shift_row.end_time+CASE WHEN shift_row.end_time<shift_row.start_time THEN interval '1 day' ELSE interval '0' END;
    IF EXISTS(SELECT 1 FROM public.shift_assignments a JOIN public.shifts s ON s.id=a.shift_id
      WHERE a.employee_id=emp.id AND a.status<>'REPLACED' AND NOT(a.schedule_id=saved.id AND a.work_date=need.work_date AND a.shift_id=shift_row.id)
      AND a.work_date+s.start_time<end_at AND begin_at<a.work_date+s.end_time+CASE WHEN s.end_time<s.start_time THEN interval '1 day' ELSE interval '0' END)
      THEN RAISE EXCEPTION 'SHIFT_OVERLAP' USING ERRCODE='22023'; END IF;
    IF emp.max_weekly_hours IS NOT NULL AND EXISTS(
      SELECT 1 FROM generate_series(p.work_start_date::timestamp,(p.work_end_date+1)::timestamp,interval '7 days') w
      WHERE begin_at<w+interval '7 days' AND w<end_at AND
        (SELECT COALESCE(sum(EXTRACT(epoch FROM greatest(interval '0',least(a.work_date+s.end_time+CASE WHEN s.end_time<s.start_time THEN interval '1 day' ELSE interval '0' END,w+interval '7 days')-greatest(a.work_date+s.start_time,w)))),0)/3600
        FROM public.shift_assignments a JOIN public.shifts s ON s.id=a.shift_id WHERE a.employee_id=emp.id AND a.status<>'REPLACED')>emp.max_weekly_hours)
      THEN RAISE EXCEPTION 'WEEKLY_LIMIT_EXCEEDED' USING ERRCODE='22023'; END IF;
    verified_assignments:=verified_assignments||jsonb_build_array(jsonb_build_object('employee_id',emp.id,'work_date',need.work_date,'shift_id',shift_row.id,'department_id',emp.department_id,
      'requirement_id',need.id,'reason',CASE WHEN jsonb_typeof(item->'reason')='string' THEN left(item->>'reason',1000) ELSE 'SERVER_VALIDATED' END));
  END LOOP;
  -- Provider/backend metrics are advisory input, never authoritative persisted data.
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'work_date',x->>'shift_id',x->>'department_id'),'[]'::jsonb) INTO coverage FROM (
    SELECT r||jsonb_build_object('assigned_count',count(a.id),'missing_count',(r->>'required_count')::integer-count(a.id),
      'warning',CASE WHEN (current_input->>'new_employee_count_threshold')::integer IS NOT NULL
        AND count(a.id) FILTER(WHERE e.skill_level='NEW') >= (current_input->>'new_employee_count_threshold')::integer
        AND count(a.id) FILTER(WHERE e.skill_level='CREW_TRAINING')=0 THEN 'MANY_NEW_WITHOUT_CREW_TRAINING' END) x
    FROM jsonb_array_elements(current_input->'requirements') r
    LEFT JOIN public.shift_assignments a ON a.schedule_id=saved.id AND a.work_date=(r->>'work_date')::date AND a.shift_id=(r->>'shift_id')::uuid AND a.department_id=(r->>'department_id')::uuid
    LEFT JOIN public.employees e ON e.id=a.employee_id GROUP BY r
  ) c;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('employee_id',e.id,
    'shift_count',(SELECT count(*) FROM public.shift_assignments a WHERE a.schedule_id=saved.id AND a.employee_id=e.id),
    'total_weekly_hours',(SELECT COALESCE(sum(EXTRACT(epoch FROM greatest(interval '0',least(a.work_date+s.end_time+CASE WHEN s.end_time<s.start_time THEN interval '1 day' ELSE interval '0' END,(p.work_end_date+1)::timestamp)-greatest(a.work_date+s.start_time,p.work_start_date::timestamp)))),0)/3600
      FROM public.shift_assignments a JOIN public.shifts s ON s.id=a.shift_id WHERE a.employee_id=e.id AND a.status<>'REPLACED')) ORDER BY e.id),'[]'::jsonb)
    INTO statistics FROM public.employees e JOIN public.users u ON u.id=e.user_id
    WHERE e.branch_id=p.branch_id AND e.status='ACTIVE' AND e.skill_level IN ('NEW','REGULAR','CREW_TRAINING') AND u.role='NV' AND u.is_active AND u.branch_id=e.branch_id;
  verified_result:=jsonb_build_object('assignments',verified_assignments,'coverage',coverage,
    'shortages',COALESCE((SELECT jsonb_agg(c) FROM jsonb_array_elements(coverage) c WHERE (c->>'missing_count')::integer>0),'[]'::jsonb),
    'assigned_count',jsonb_array_length(verified_assignments),'required_count',(SELECT sum((c->>'required_count')::integer) FROM jsonb_array_elements(coverage) c),
    'new_employee_count_threshold',current_input->'new_employee_count_threshold','employee_statistics',statistics,
    'notes',jsonb_build_array('Crew Leader do quản lý thiết lập riêng; không tính vào nhu cầu thường.','Thuật toán tham lam; không bảo đảm tối ưu toàn cục. Chỉ số được đối chiếu từ phân công đã lưu.'));
  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) INTO persisted FROM public.shift_assignments a WHERE schedule_id=saved.id;
  output:=verified_result||jsonb_build_object('schedule',to_jsonb(saved));
  INSERT INTO public.audit_logs(actor_id,entity_type,entity_id,action,new_data,change_source)
    VALUES(actor.id,'schedules',saved.id,'AUTO_GENERATE',verified_result||jsonb_build_object('rpc_version','tv3-v1',
      'saved_schedule',to_jsonb(saved),'persisted_assignments',persisted,'response_result',output),'SYSTEM');
  RETURN jsonb_build_object('reused',false,'result',output);
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN
  RAISE EXCEPTION 'INVALID_ASSIGNMENT_FORMAT' USING ERRCODE='22023';
END;
$$;
REVOKE ALL ON FUNCTION public.tv3_scheduling_input(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.generate_schedule_draft(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.generate_schedule_draft(uuid,uuid,jsonb,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
