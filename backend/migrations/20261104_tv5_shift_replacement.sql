-- Local only; requires TV3 rules v2 and stage 4. No seed/backfill/deletion.
BEGIN;
ALTER TABLE public.shift_change_requests ADD COLUMN proposed_replacement_employee_id uuid REFERENCES public.employees(id), ADD COLUMN decision_reason text, ADD COLUMN assignment_snapshot jsonb;
ALTER TABLE public.incidents ADD COLUMN resolved_by uuid REFERENCES public.users(id), ADD COLUMN replacement_employee_id uuid REFERENCES public.employees(id), ADD COLUMN decision_reason text, ADD COLUMN assignment_snapshot jsonb;
ALTER TABLE public.shift_assignments ADD COLUMN replaces_assignment_id uuid REFERENCES public.shift_assignments(id);
-- Allow A -> B -> A as NEW rows while retaining both historical rows. The old
-- all-status UNIQUE would reject the second A even though the first is REPLACED.
DO $$ DECLARE constraint_name name; BEGIN
 SELECT conname INTO constraint_name FROM pg_constraint WHERE conrelid='public.shift_assignments'::regclass
  AND contype='u' AND pg_get_constraintdef(oid)='UNIQUE (schedule_id, employee_id, work_date, shift_id)';
 IF constraint_name IS NULL THEN RAISE EXCEPTION 'ASSIGNMENT_UNIQUE_REVIEW_REQUIRED'; END IF;
 EXECUTE format('ALTER TABLE public.shift_assignments DROP CONSTRAINT %I',constraint_name);
END $$;
CREATE UNIQUE INDEX tv5_current_employee_shift ON public.shift_assignments(schedule_id,employee_id,work_date,shift_id) WHERE status<>'REPLACED';
CREATE UNIQUE INDEX tv5_one_successor ON public.shift_assignments(replaces_assignment_id) WHERE replaces_assignment_id IS NOT NULL;
-- Abort for conflicting legacy open rows; never clean up someone else's data.
CREATE UNIQUE INDEX tv5_open_request ON public.shift_change_requests(original_assignment_id) WHERE status IN ('PENDING','SEARCHING');
CREATE UNIQUE INDEX tv5_open_incident ON public.incidents(original_assignment_id) WHERE status IN ('REPORTED','IN_PROGRESS');

CREATE FUNCTION public.tv5_actor(p_actor uuid) RETURNS public.users
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE u public.users; BEGIN
 SELECT * INTO u FROM public.users WHERE id=p_actor;
 IF u.id IS NULL OR NOT u.is_active OR u.must_change_password IS DISTINCT FROM false OR u.role NOT IN ('NV','QL')
 OR NOT EXISTS(SELECT 1 FROM public.branches WHERE id=u.branch_id AND status='ACTIVE') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF u.role='NV' AND NOT EXISTS(SELECT 1 FROM public.employees WHERE user_id=u.id AND branch_id=u.branch_id AND status='ACTIVE')
 THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN u;
END $$;

CREATE FUNCTION public.tv5_assignment(p_id uuid) RETURNS public.shift_assignments
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a public.shift_assignments; s public.schedules; BEGIN
 SELECT * INTO a FROM public.shift_assignments WHERE id=p_id;
 SELECT * INTO s FROM public.schedules WHERE id=a.schedule_id;
 IF a.id IS NULL OR a.status<>'ACTIVE' OR s.status IS DISTINCT FROM 'PUBLISHED'
 OR a.actual_branch_id<>s.branch_id OR NOT EXISTS(SELECT 1 FROM public.registration_periods p WHERE p.id=s.period_id AND p.branch_id=s.branch_id AND a.work_date BETWEEN p.work_start_date AND p.work_end_date)
 OR EXISTS(SELECT 1 FROM public.schedules WHERE period_id=s.period_id AND status='PUBLISHED' AND (version>s.version OR schedule_group_id<>s.schedule_group_id))
 THEN RAISE EXCEPTION 'ASSIGNMENT_STALE'; END IF;
 RETURN a;
END $$;

CREATE FUNCTION public.tv5_candidates(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE a public.shift_assignments; i jsonb; candidate jsonb; result jsonb:='[]'; e record;
BEGIN
 a:=public.tv5_assignment(p_id);
 IF a.assignment_source<>'REGULAR' THEN RETURN '[]'; END IF;
 i:=public.tv3_scheduling_input((SELECT period_id FROM public.schedules WHERE id=a.schedule_id));
 i:=jsonb_set(i,'{existing}',coalesce((SELECT jsonb_agg(x) FROM jsonb_array_elements(i->'existing') x WHERE x->>'id'<>a.id::text),'[]'));
 FOR e IN SELECT em.*,u.username FROM public.employees em JOIN public.users u ON u.id=em.user_id
  WHERE em.branch_id=a.actual_branch_id AND em.department_id=a.department_id AND em.id<>a.employee_id
   AND em.status='ACTIVE' AND u.role='NV' AND u.is_active AND u.branch_id=em.branch_id
   AND NOT EXISTS(SELECT 1 FROM public.shift_assignments b WHERE b.employee_id=em.id AND b.work_date=a.work_date AND b.shift_id=a.shift_id AND b.status<>'REPLACED')
  ORDER BY u.username,em.id LOOP
  candidate:=jsonb_build_object('employee_id',e.id,'work_date',a.work_date,'shift_id',a.shift_id,'department_id',a.department_id);
  IF (e.max_weekly_hours IS NULL OR (e.max_weekly_hours>0 AND e.max_weekly_hours::text NOT IN ('NaN','Infinity','-Infinity')))
  AND EXISTS(SELECT 1 FROM public.tv3_existing_coverage_v2(jsonb_set(i,'{existing}',(i->'existing')||jsonb_build_array(candidate))) v
    WHERE (v.employee_id,v.work_date,v.shift_id,v.department_id)=(e.id,a.work_date,a.shift_id,a.department_id)) THEN
   result:=result||jsonb_build_array(jsonb_build_object('id',e.id,'full_name',e.full_name,'employee_code',e.username,'skill_level',e.skill_level));
  END IF;
 END LOOP;
 RETURN result;
END $$;

CREATE FUNCTION public.tv5_candidates_for_actor(p_actor_id uuid,p_assignment_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE u public.users; a public.shift_assignments; BEGIN
 IF session_user NOT IN ('postgres','supabase_admin') AND coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 u:=public.tv5_actor(p_actor_id);a:=public.tv5_assignment(p_assignment_id);
 IF u.branch_id<>a.actual_branch_id OR (u.role='NV' AND NOT EXISTS(SELECT 1 FROM public.employees WHERE id=a.employee_id AND user_id=u.id)) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN public.tv5_candidates(a.id);
END $$;

-- Read-only queue. Stored acceptance history is retained; effective_status also
-- accounts for expiry/closed source/stale assignment without writing on GET.
CREATE FUNCTION public.tv5_read(p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE u public.users; own_id uuid; sources jsonb; invitations jsonb; BEGIN
 IF session_user NOT IN ('postgres','supabase_admin') AND coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 u:=public.tv5_actor(p_actor_id);SELECT id INTO own_id FROM public.employees WHERE user_id=u.id;
 WITH src AS (
  SELECT 'REQUEST' kind,r.id,r.original_assignment_id,r.requesting_employee_id owner_id,r.reason,r.status,r.created_at,
   r.proposed_replacement_employee_id proposed_employee_id,r.replacement_employee_id,r.decision_reason,r.resolved_at FROM public.shift_change_requests r
  UNION ALL SELECT 'INCIDENT',r.id,r.original_assignment_id,r.reporting_employee_id,r.description,r.status,r.reported_at,
   r.declared_substitute_id,r.replacement_employee_id,r.decision_reason,r.resolved_at FROM public.incidents r
 ) SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id),'[]') INTO sources FROM (
  SELECT r.*,a.schedule_id,a.work_date,a.shift_id,a.department_id,a.status assignment_status,t.name shift_name,t.start_time,t.end_time,d.name department_name,
   em.full_name owner_name,s.version,s.status schedule_status,
   a.status='ACTIVE' AND s.status='PUBLISHED'
   AND CASE WHEN r.kind='REQUEST' THEN (SELECT assignment_snapshot FROM public.shift_change_requests WHERE id=r.id) ELSE (SELECT assignment_snapshot FROM public.incidents WHERE id=r.id) END=to_jsonb(a)
   AND NOT EXISTS(SELECT 1 FROM public.schedules n WHERE n.period_id=s.period_id AND n.status='PUBLISHED' AND (n.version>s.version OR n.schedule_group_id<>s.schedule_group_id)) actionable
  FROM src r JOIN public.shift_assignments a ON a.id=r.original_assignment_id JOIN public.schedules s ON s.id=a.schedule_id
  JOIN public.employees em ON em.id=r.owner_id JOIN public.shifts t ON t.id=a.shift_id JOIN public.departments d ON d.id=a.department_id
  WHERE a.actual_branch_id=u.branch_id AND (u.role='QL' OR r.owner_id=own_id)
 ) x;
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.sent_at DESC,x.id),'[]') INTO invitations FROM (
  SELECT v.*,CASE WHEN v.shift_change_request_id IS NOT NULL THEN 'REQUEST' ELSE 'INCIDENT' END kind,
   coalesce(v.shift_change_request_id,v.incident_id) source_id,em.full_name target_name,
   a.work_date,t.name shift_name,t.start_time,t.end_time,d.name department_name,
   CASE WHEN v.status='PENDING' AND (v.expires_at<=statement_timestamp() OR a.status<>'ACTIVE' OR s.status<>'PUBLISHED'
    OR coalesce(r.assignment_snapshot,c.assignment_snapshot) IS DISTINCT FROM to_jsonb(a)
    OR coalesce(r.status,c.status) NOT IN ('PENDING','SEARCHING','REPORTED','IN_PROGRESS')
    OR EXISTS(SELECT 1 FROM public.schedules n WHERE n.period_id=s.period_id AND n.status='PUBLISHED' AND (n.version>s.version OR n.schedule_group_id<>s.schedule_group_id)))
    THEN 'EXPIRED' ELSE v.status END effective_status
  FROM public.replacement_invitations v LEFT JOIN public.shift_change_requests r ON r.id=v.shift_change_request_id
  LEFT JOIN public.incidents c ON c.id=v.incident_id JOIN public.shift_assignments a ON a.id=coalesce(r.original_assignment_id,c.original_assignment_id)
  JOIN public.schedules s ON s.id=a.schedule_id JOIN public.shifts t ON t.id=a.shift_id JOIN public.departments d ON d.id=a.department_id
  JOIN public.employees em ON em.id=v.target_employee_id
  WHERE a.actual_branch_id=u.branch_id AND (u.role='QL' OR v.target_employee_id=own_id)
 ) x;
 RETURN jsonb_build_object('sources',sources,'invitations',invitations);
END $$;

-- Reuse TV3 metrics without changing its DRAFT-only contract: TV5 retains
-- REPLACED rows within the same published schedule, so exclude that history.
DO $$ DECLARE f text; BEGIN
 f:=pg_get_functiondef('public.tv3_result_v2(jsonb,uuid,jsonb,jsonb)'::regprocedure);
 IF position('WHERE schedule_id=p_schedule)' IN f)=0 THEN RAISE EXCEPTION 'TV3_METRICS_REVIEW_REQUIRED'; END IF;
 f:=replace(f,'public.tv3_result_v2(','public.tv5_result_v2(');
 f:=replace(f,'WHERE schedule_id=p_schedule)','WHERE schedule_id=p_schedule AND status<>''REPLACED'')');
 f:=replace(f,'WHERE a.schedule_id=p_schedule AND a.employee_id','WHERE a.schedule_id=p_schedule AND a.status<>''REPLACED'' AND a.employee_id');
 EXECUTE f;
END $$;

CREATE FUNCTION public.tv5_mutate(p_actor_id uuid,p_action text,p_request_id uuid,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp SET statement_timeout='5s' SET lock_timeout='5s' AS $$
DECLARE u public.users; a public.shift_assignments; s public.schedules; r public.shift_change_requests; c public.incidents;
 v public.replacement_invitations; own_id uuid; source_id uuid; kind text; source_status text; old_data jsonb; output jsonb;
 replay public.audit_logs; target_id uuid; new_a public.shift_assignments; current_input jsonb; current_result jsonb; verified jsonb; base jsonb; response_time timestamptz;
BEGIN
 IF session_user NOT IN ('postgres','supabase_admin') AND coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_action IS NULL OR p_action NOT IN ('CREATE_REQUEST','REPORT','INVITE','ACCEPT','DECLINE','APPROVE','REJECT','EXPIRE') OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 -- Coordinate with TV3/TV4, and all absence predicates/overlap checks.
 LOCK TABLE public.employees,public.employee_skills,public.shifts,public.registration_submissions,public.shift_registrations,public.staffing_requirements,public.warning_configs IN SHARE MODE NOWAIT;
 LOCK TABLE public.schedules,public.shift_assignments,public.audit_logs IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 LOCK TABLE public.shift_change_requests,public.incidents,public.replacement_invitations IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 LOCK TABLE public.users,public.branches,public.registration_periods IN SHARE MODE NOWAIT;
 u:=public.tv5_actor(p_actor_id);SELECT id INTO own_id FROM public.employees WHERE user_id=u.id;
 IF (p_action IN ('CREATE_REQUEST','REPORT','ACCEPT','DECLINE') AND u.role<>'NV')
 OR (p_action IN ('INVITE','APPROVE','REJECT','EXPIRE') AND u.role<>'QL') THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO replay FROM public.audit_logs WHERE entity_type='tv5_operations' AND new_data->>'request_id'=p_request_id::text ORDER BY created_at DESC LIMIT 1;
 IF FOUND THEN
  IF replay.actor_id IS DISTINCT FROM u.id OR replay.new_data->>'operation' IS DISTINCT FROM p_action OR replay.new_data->'request_data' IS DISTINCT FROM p_data THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
  IF replay.new_data->>'branch_id' IS DISTINCT FROM u.branch_id::text THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  RETURN replay.new_data->'response';
 END IF;
 IF p_action IN ('CREATE_REQUEST','REPORT') THEN
  a:=public.tv5_assignment((p_data->>'assignment_id')::uuid);SELECT * INTO s FROM public.schedules WHERE id=a.schedule_id;
  IF u.role<>'NV' OR a.employee_id IS DISTINCT FROM own_id OR a.actual_branch_id IS DISTINCT FROM u.branch_id THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF coalesce(p_data->>'reason','') !~ '[^[:space:]]' THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  IF p_action='CREATE_REQUEST' AND (s.feedback_deadline_at IS NULL OR s.feedback_deadline_at<clock_timestamp()) THEN RAISE EXCEPTION 'FEEDBACK_CLOSED'; END IF;
  IF EXISTS(SELECT 1 FROM public.shift_change_requests WHERE original_assignment_id=a.id AND status IN ('PENDING','SEARCHING'))
   OR EXISTS(SELECT 1 FROM public.incidents WHERE original_assignment_id=a.id AND status IN ('REPORTED','IN_PROGRESS')) THEN RAISE EXCEPTION 'DUPLICATE_OPEN_REQUEST'; END IF;
  target_id:=(p_data->>'proposed_employee_id')::uuid;
  IF target_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.tv5_candidates(a.id)) e WHERE e->>'id'=target_id::text) THEN RAISE EXCEPTION 'INELIGIBLE_REPLACEMENT'; END IF;
  IF p_action='CREATE_REQUEST' THEN
   INSERT INTO public.shift_change_requests(original_assignment_id,requesting_employee_id,reason,proposed_replacement_employee_id,assignment_snapshot)
    VALUES(a.id,own_id,btrim(p_data->>'reason'),target_id,to_jsonb(a)) RETURNING * INTO r;source_id:=r.id;output:=to_jsonb(r);
  ELSE
   INSERT INTO public.incidents(original_assignment_id,reporting_employee_id,description,declared_substitute_id,assignment_snapshot)
    VALUES(a.id,own_id,btrim(p_data->>'reason'),target_id,to_jsonb(a)) RETURNING * INTO c;source_id:=c.id;output:=to_jsonb(c);
  END IF;
 ELSE
  IF p_action IN ('ACCEPT','DECLINE') THEN
   SELECT * INTO v FROM public.replacement_invitations WHERE id=(p_data->>'invitation_id')::uuid FOR UPDATE;
   IF v.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
   IF u.role<>'NV' OR v.target_employee_id IS DISTINCT FROM own_id THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
   kind:=CASE WHEN v.shift_change_request_id IS NOT NULL THEN 'REQUEST' ELSE 'INCIDENT' END;source_id:=coalesce(v.shift_change_request_id,v.incident_id);
  ELSE
   IF u.role<>'QL' THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
   kind:=p_data->>'kind';source_id:=(p_data->>'source_id')::uuid;
  END IF;
  IF kind='REQUEST' THEN SELECT * INTO r FROM public.shift_change_requests WHERE id=source_id FOR UPDATE;a:=(SELECT x FROM public.shift_assignments x WHERE id=r.original_assignment_id);source_status:=r.status;old_data:=to_jsonb(r);
  ELSIF kind='INCIDENT' THEN SELECT * INTO c FROM public.incidents WHERE id=source_id FOR UPDATE;a:=(SELECT x FROM public.shift_assignments x WHERE id=c.original_assignment_id);source_status:=c.status;old_data:=to_jsonb(c);
  ELSE RAISE EXCEPTION 'INVALID_SOURCE'; END IF;
  IF a.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF a.actual_branch_id IS DISTINCT FROM u.branch_id THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF source_status NOT IN ('PENDING','SEARCHING','REPORTED','IN_PROGRESS') THEN RAISE EXCEPTION 'SOURCE_CLOSED'; END IF;
  -- Rejection/expiry can close or reconcile stale sources without changing a shift.
  IF p_action NOT IN ('REJECT','EXPIRE') THEN
   a:=public.tv5_assignment(a.id);
   IF (CASE WHEN kind='REQUEST' THEN r.assignment_snapshot ELSE c.assignment_snapshot END) IS DISTINCT FROM to_jsonb(a) THEN RAISE EXCEPTION 'ASSIGNMENT_STALE'; END IF;
  END IF;
  SELECT * INTO s FROM public.schedules WHERE id=a.schedule_id;
  IF p_action='INVITE' THEN
   target_id:=(p_data->>'target_employee_id')::uuid;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.tv5_candidates(a.id)) e WHERE e->>'id'=target_id::text) THEN RAISE EXCEPTION 'INELIGIBLE_REPLACEMENT'; END IF;
   IF (p_data->>'expires_at')::timestamptz IS NULL OR (p_data->>'expires_at')::timestamptz<=clock_timestamp() THEN RAISE EXCEPTION 'INVALID_EXPIRY'; END IF;
   IF EXISTS(SELECT 1 FROM public.replacement_invitations WHERE ((kind='REQUEST' AND shift_change_request_id=source_id) OR (kind='INCIDENT' AND incident_id=source_id)) AND target_employee_id=target_id
    AND (status='ACCEPTED' OR (status='PENDING' AND expires_at>clock_timestamp()))) THEN RAISE EXCEPTION 'DUPLICATE_INVITATION'; END IF;
   INSERT INTO public.replacement_invitations(shift_change_request_id,incident_id,target_employee_id,expires_at)
    VALUES(CASE WHEN kind='REQUEST' THEN source_id END,CASE WHEN kind='INCIDENT' THEN source_id END,target_id,(p_data->>'expires_at')::timestamptz) RETURNING * INTO v;
   IF kind='REQUEST' THEN UPDATE public.shift_change_requests SET status='SEARCHING' WHERE id=source_id;
    ELSE UPDATE public.incidents SET status='IN_PROGRESS' WHERE id=source_id;END IF;
   output:=to_jsonb(v);
  ELSIF p_action IN ('ACCEPT','DECLINE') THEN
   old_data:=to_jsonb(v);
   IF v.status<>'PENDING' THEN RAISE EXCEPTION 'INVITATION_CLOSED'; END IF;
   IF v.expires_at>clock_timestamp() AND p_action='ACCEPT' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.tv5_candidates(a.id)) e WHERE e->>'id'=own_id::text) THEN RAISE EXCEPTION 'INELIGIBLE_REPLACEMENT'; END IF;
   response_time:=clock_timestamp();
   IF v.expires_at<=response_time THEN UPDATE public.replacement_invitations SET status='EXPIRED',valid_when_confirmed=false WHERE id=v.id RETURNING * INTO v;
   ELSE
    UPDATE public.replacement_invitations SET status=CASE WHEN p_action='ACCEPT' THEN 'ACCEPTED' ELSE 'DECLINED' END,
     responded_at=response_time,valid_when_confirmed=(p_action='ACCEPT') WHERE id=v.id RETURNING * INTO v;
   END IF;output:=to_jsonb(v);
  ELSIF p_action='EXPIRE' THEN
   WITH changed AS(UPDATE public.replacement_invitations SET status='EXPIRED',valid_when_confirmed=false
    WHERE ((kind='REQUEST' AND shift_change_request_id=source_id) OR (kind='INCIDENT' AND incident_id=source_id)) AND status='PENDING' AND expires_at<=clock_timestamp() RETURNING *)
   SELECT jsonb_build_object('expired',coalesce(jsonb_agg(to_jsonb(changed)),'[]')) INTO output FROM changed;
   IF jsonb_array_length(output->'expired')>0 THEN
   INSERT INTO public.notifications(recipient_id,type,title,content,idempotency_key)
    VALUES(u.id,'REPLACEMENT_SEARCH','Kiểm tra kết quả tìm người thay','Hãy kiểm tra các lời mời đã hết hạn và xác nhận hợp lệ cho yêu cầu '||source_id::text,'tv5-expire-'||p_request_id::text);
   END IF;
  ELSIF p_action='REJECT' THEN
   IF coalesce(p_data->>'reason','') !~ '[^[:space:]]' THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
   IF kind='REQUEST' THEN UPDATE public.shift_change_requests SET status='REJECTED',approved_by=u.id,resolved_at=clock_timestamp(),decision_reason=p_data->>'reason' WHERE id=source_id RETURNING to_jsonb(shift_change_requests) INTO output;
    ELSE UPDATE public.incidents SET status='UNRESOLVED',resolved_by=u.id,resolved_at=clock_timestamp(),decision_reason=p_data->>'reason' WHERE id=source_id RETURNING to_jsonb(incidents) INTO output;END IF;
  ELSE
   SELECT * INTO v FROM public.replacement_invitations WHERE id=(p_data->>'invitation_id')::uuid;
   IF v.shift_change_request_id IS DISTINCT FROM (CASE WHEN kind='REQUEST' THEN source_id END)
    OR v.incident_id IS DISTINCT FROM (CASE WHEN kind='INCIDENT' THEN source_id END) OR v.status IS DISTINCT FROM 'ACCEPTED'
    OR v.valid_when_confirmed IS DISTINCT FROM true OR v.responded_at IS NULL OR v.responded_at>=v.expires_at THEN RAISE EXCEPTION 'CONFIRMATION_REQUIRED'; END IF;
   target_id:=v.target_employee_id;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(public.tv5_candidates(a.id)) e WHERE e->>'id'=target_id::text) THEN RAISE EXCEPTION 'INELIGIBLE_REPLACEMENT'; END IF;
   UPDATE public.shift_assignments SET status='REPLACED' WHERE id=a.id;
   INSERT INTO public.shift_assignments(schedule_id,employee_id,work_date,shift_id,department_id,actual_branch_id,status,assignment_source,replaces_assignment_id)
    VALUES(a.schedule_id,target_id,a.work_date,a.shift_id,a.department_id,a.actual_branch_id,'ACTIVE',a.assignment_source,a.id) RETURNING * INTO new_a;
   IF kind='REQUEST' THEN UPDATE public.shift_change_requests SET status='APPROVED',approved_by=u.id,replacement_employee_id=target_id,resolved_at=clock_timestamp() WHERE id=source_id RETURNING to_jsonb(shift_change_requests) INTO output;
    ELSE UPDATE public.incidents SET status='RESOLVED',resolved_by=u.id,replacement_employee_id=target_id,resolved_at=clock_timestamp() WHERE id=source_id RETURNING to_jsonb(incidents) INTO output;END IF;
   -- Keep the generation audit immutable; publish a separate current metric view.
   current_input:=public.tv3_scheduling_input(s.period_id);
   current_input:=jsonb_set(current_input,'{existing}',coalesce((SELECT jsonb_agg(x) FROM jsonb_array_elements(current_input->'existing') x WHERE NOT EXISTS(SELECT 1 FROM public.shift_assignments b WHERE b.schedule_id=s.id AND b.id::text=x->>'id')),'[]'));
   SELECT new_data INTO base FROM public.audit_logs WHERE entity_type='schedules' AND entity_id=s.id AND action='AUTO_GENERATE' ORDER BY created_at DESC,id DESC LIMIT 1;
   SELECT coalesce(jsonb_agg(jsonb_build_object('employee_id',b.employee_id,'work_date',b.work_date,'shift_id',b.shift_id,'department_id',b.department_id,
    'selection_history',CASE WHEN b.id<>new_a.id THEN coalesce((SELECT t->'selection_history' FROM jsonb_array_elements(coalesce(base->'assignments','[]')) t WHERE t->>'employee_id'=b.employee_id::text AND t->>'work_date'=b.work_date::text AND t->>'shift_id'=b.shift_id::text LIMIT 1),jsonb_build_object('initial',jsonb_build_object('employee_id',b.employee_id,'reason','SERVER_VALIDATED'),'replacements','[]'::jsonb)) ELSE jsonb_build_object('initial',jsonb_build_object('employee_id',b.employee_id,'reason','MANAGER_CONFIRMED_REPLACEMENT'),'replacements','[]'::jsonb) END,
    'reason',CASE WHEN b.id=new_a.id THEN 'MANAGER_CONFIRMED_REPLACEMENT' ELSE coalesce((SELECT t->>'reason' FROM jsonb_array_elements(coalesce(base->'assignments','[]')) t WHERE t->>'employee_id'=b.employee_id::text AND t->>'work_date'=b.work_date::text AND t->>'shift_id'=b.shift_id::text LIMIT 1),'SERVER_VALIDATED') END)),'[]') INTO verified FROM public.shift_assignments b WHERE b.schedule_id=s.id AND b.status='ACTIVE';
   current_result:=public.tv5_result_v2(current_input,s.id,verified,jsonb_build_object('plan_origin','MANAGER_REVIEWED'));
   current_result:=jsonb_set(current_result,'{employee_statistics}',coalesce((SELECT jsonb_agg(x||jsonb_build_object('shift_count',
    (SELECT count(*) FROM public.shift_assignments b WHERE b.schedule_id=s.id AND b.status='ACTIVE' AND b.employee_id::text=x->>'employee_id')))
    FROM jsonb_array_elements(current_result->'employee_statistics') x),'[]'));
   INSERT INTO public.audit_logs(actor_id,entity_type,entity_id,action,old_data,new_data,change_source)
    VALUES(u.id,'schedules',s.id,'SHIFT_REPLACED',to_jsonb(a),jsonb_build_object('assignment',to_jsonb(new_a),'source_id',source_id,'kind',kind,'current_result',current_result),'MANUAL');
   output:=output||jsonb_build_object('new_assignment',to_jsonb(new_a),'composition_shortages',current_result->'composition_shortages');
  END IF;
  IF p_action IN ('APPROVE','REJECT') THEN
   WITH closed AS(UPDATE public.replacement_invitations SET status='EXPIRED',valid_when_confirmed=false
    WHERE ((kind='REQUEST' AND shift_change_request_id=source_id) OR (kind='INCIDENT' AND incident_id=source_id)) AND status='PENDING' RETURNING *)
   SELECT output||jsonb_build_object('closed_invitations',coalesce(jsonb_agg(to_jsonb(closed)),'[]')) INTO output FROM closed;
  END IF;
 END IF;
 INSERT INTO public.audit_logs(actor_id,entity_type,entity_id,action,old_data,new_data,change_source)
 VALUES(u.id,'tv5_operations',source_id,p_action,old_data,jsonb_build_object('request_id',p_request_id,'branch_id',u.branch_id,'operation',p_action,'request_data',p_data,'response',output),'MANUAL');
 RETURN output;
END $$;

-- Pin owners and remove default/retained grants, including unexpected grantees.
DO $$ DECLARE f regprocedure; g name; public_rpc boolean; BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('tv5_actor','tv5_assignment','tv5_candidates','tv5_candidates_for_actor','tv5_read','tv5_mutate','tv5_result_v2') LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',f);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
  FOR g IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=f::oid AND r.rolname<>'postgres'
   LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f,g);END LOOP;
  SELECT proname IN ('tv5_candidates_for_actor','tv5_read','tv5_mutate') INTO public_rpc FROM pg_proc WHERE oid=f::oid;
  IF public_rpc THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f);END IF;
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
