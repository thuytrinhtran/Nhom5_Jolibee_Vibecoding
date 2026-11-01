-- LOCAL ONLY. Apply after 20261029_tv4_schedule_workflow and TV3 rule contract v2.
-- Uses NEEDS_REVISION, never invents a REJECTED state. No seed or status backfill.
BEGIN;
SET LOCAL search_path=pg_catalog,public;

-- Extend the existing allocator, preserving its ACL, CAS, audit and source locks.
-- Fail closed if its reviewed implementation has changed in either location.
DO $$ DECLARE f text; before_edit text; BEGIN
 f:=pg_get_functiondef('public.persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text)'::regprocedure);
 IF position('tv3_result_v2' IN f)=0 THEN RAISE EXCEPTION 'TV3_RULE_V2_REQUIRED'; END IF;
 IF position('target.status<>''DRAFT''' IN f)=0 OR position('version>target.version OR schedule_group_id<>target.schedule_group_id OR status<>''DRAFT''' IN f)=0
   THEN RAISE EXCEPTION 'TV3_ALLOCATOR_REVIEW_REQUIRED'; END IF;
 before_edit:=f;
 f:=replace(f,'target.status<>''DRAFT''','target.status NOT IN (''DRAFT'',''NEEDS_REVISION'')');
 f:=replace(f,'version>target.version OR schedule_group_id<>target.schedule_group_id OR status<>''DRAFT''',
   'version>target.version OR schedule_group_id<>target.schedule_group_id OR (id<>target.id AND status NOT IN (''DRAFT'',''NEEDS_REVISION''))');
 IF f=before_edit OR position('OR status<>''DRAFT''' IN f)>0 THEN RAISE EXCEPTION 'TV3_ALLOCATOR_REVIEW_REQUIRED'; END IF;
 EXECUTE f;
END $$;

-- No client-supplied validity flags. Recheck the actual rows and current VALID
-- non-sample registrations using the same SQL eligibility helper as TV3 v2.
CREATE FUNCTION public.tv4_assert_schedule_v2(p_schedule uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE s public.schedules; i jsonb; valid_count int; own_count int;
BEGIN
 SELECT * INTO STRICT s FROM public.schedules WHERE id=p_schedule;
 i:=public.tv3_scheduling_input(s.period_id);
 IF i->>'rule_version'<>'tv3.rules.v2' OR i->'period'->>'status'<>'CLOSED'
   OR jsonb_array_length(i->'requirements')=0 THEN RAISE EXCEPTION 'INVALID_RULE_INPUT'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(i->'requirements') r(shift_id uuid)
   LEFT JOIN public.shifts t ON t.id=r.shift_id WHERE t.id IS NULL OR NOT t.is_active
    OR t.start_time=t.end_time OR (t.branch_id IS NOT NULL AND t.branch_id<>s.branch_id))
   THEN RAISE EXCEPTION 'INVALID_RULE_INPUT'; END IF;
 -- Preserve TV3's existing incomplete-data policy for declared registrations.
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(i->'registrations') r(employee_id uuid,work_date date,shift_id uuid)
  JOIN public.employees e ON e.id=r.employee_id WHERE NOT EXISTS(
   SELECT 1 FROM jsonb_to_recordset(i->'requirements') n(work_date date,shift_id uuid,department_id uuid)
    WHERE (n.work_date,n.shift_id,n.department_id)=(r.work_date,r.shift_id,e.department_id)))
   THEN RAISE EXCEPTION 'INCOMPLETE_DATA'; END IF;
 IF EXISTS(SELECT 1 FROM public.shift_assignments a WHERE a.schedule_id=s.id
   AND (a.status<>'DRAFT' OR a.assignment_source<>'REGULAR' OR a.actual_branch_id<>s.branch_id))
   THEN RAISE EXCEPTION 'INVALID_ASSIGNMENTS'; END IF;
 SELECT count(*) INTO own_count FROM public.shift_assignments WHERE schedule_id=s.id;
 SELECT count(*) INTO valid_count FROM public.shift_assignments a
 JOIN public.tv3_existing_coverage_v2(i) v USING(employee_id,work_date,shift_id,department_id)
 WHERE a.schedule_id=s.id;
 IF own_count<>valid_count OR EXISTS(
   SELECT 1 FROM public.shift_assignments a JOIN public.employees e ON e.id=a.employee_id
   WHERE a.schedule_id=s.id AND e.max_weekly_hours IS NOT NULL AND
     (e.max_weekly_hours<=0 OR e.max_weekly_hours::text IN ('NaN','Infinity','-Infinity')))
   THEN RAISE EXCEPTION 'HARD_CONSTRAINT_FAILED'; END IF;
 -- A logical duplicate in a different schedule cannot contribute twice.
 IF EXISTS(SELECT 1 FROM public.shift_assignments a JOIN public.shift_assignments b
   ON (a.employee_id,a.work_date,a.shift_id)=(b.employee_id,b.work_date,b.shift_id)
   AND a.id<>b.id AND b.status<>'REPLACED' WHERE a.schedule_id=s.id)
   THEN RAISE EXCEPTION 'DUPLICATE_ASSIGNMENT'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(i->'requirements') r(work_date date,shift_id uuid,department_id uuid,required_count int)
   WHERE r.required_count<>(SELECT count(*) FROM public.tv3_existing_coverage_v2(i) v
    WHERE (v.work_date,v.shift_id,v.department_id)=(r.work_date,r.shift_id,r.department_id)))
   THEN RAISE EXCEPTION 'COVERAGE_INCOMPLETE'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.validate_schedule_approval() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE s public.schedules; BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'APPROVAL_HISTORY_IMMUTABLE'; END IF;
 SELECT * INTO s FROM public.schedules WHERE id=NEW.schedule_id FOR UPDATE;
 IF s.status IS DISTINCT FROM 'PENDING_APPROVAL' THEN RAISE EXCEPTION 'INVALID_SCHEDULE_STATUS'; END IF;
 IF EXISTS(SELECT 1 FROM public.schedules WHERE period_id=s.period_id
   AND (version>s.version OR schedule_group_id<>s.schedule_group_id)) THEN RAISE EXCEPTION 'STALE_SCHEDULE_VERSION'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.users u JOIN public.branches b ON b.supervisor_id=u.id
   WHERE b.id=s.branch_id AND b.status='ACTIVE' AND u.id=NEW.supervisor_id
    AND u.role='GS' AND u.is_active AND NOT u.must_change_password)
   THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF EXISTS(SELECT 1 FROM public.schedule_approvals WHERE schedule_id=s.id)
   THEN RAISE EXCEPTION 'ALREADY_DECIDED'; END IF;
 IF NEW.decision='NEEDS_REVISION' AND length(btrim(coalesce(NEW.reason,'')))=0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_validate_schedule_approval ON public.schedule_approvals;
CREATE TRIGGER trg_validate_schedule_approval BEFORE INSERT OR UPDATE OR DELETE ON public.schedule_approvals
 FOR EACH ROW EXECUTE FUNCTION public.validate_schedule_approval();

CREATE FUNCTION public.tv4_transition_schedule_v2(p_schedule_id uuid,p_actor_id uuid,p_expected_version int,
 p_action text,p_request_id uuid,p_reason text DEFAULT NULL,p_feedback_deadline_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp
SET lock_timeout='5s' SET statement_timeout='5s' AS $$
DECLARE s public.schedules; old_s jsonb; actor public.users; replay public.audit_logs; output jsonb; fingerprint jsonb;
BEGIN
 IF session_user NOT IN ('postgres','supabase_admin') AND coalesce(auth.role(),'')<>'service_role'
   THEN RAISE EXCEPTION 'FORBIDDEN_CALLER' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1 OR p_action IS NULL
   OR p_action NOT IN ('SUBMIT','APPROVED','NEEDS_REVISION','PUBLISH') THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 -- Same order/protection as the TV3 allocator: no absent-row/version race.
 LOCK TABLE public.employees,public.employee_skills,public.shifts,public.registration_submissions,
  public.shift_registrations,public.staffing_requirements,public.warning_configs IN SHARE MODE NOWAIT;
 LOCK TABLE public.schedules,public.shift_assignments,public.audit_logs IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 LOCK TABLE public.schedule_approvals IN SHARE ROW EXCLUSIVE MODE NOWAIT;
 SELECT * INTO s FROM public.schedules WHERE id=p_schedule_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SCHEDULE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 PERFORM id FROM public.registration_periods WHERE id=s.period_id FOR SHARE NOWAIT;
 PERFORM id FROM public.branches WHERE id=s.branch_id FOR SHARE NOWAIT;
 PERFORM id FROM public.users WHERE id=p_actor_id OR id IN(SELECT user_id FROM public.employees WHERE branch_id=s.branch_id) ORDER BY id FOR SHARE NOWAIT;
 SELECT * INTO actor FROM public.users WHERE id=p_actor_id;
 IF actor.id IS NULL OR NOT actor.is_active OR actor.must_change_password OR NOT EXISTS(
   SELECT 1 FROM public.branches WHERE id=s.branch_id AND status='ACTIVE'
    AND CASE WHEN p_action IN ('APPROVED','NEEDS_REVISION') THEN supervisor_id=actor.id AND actor.role='GS'
      ELSE actor.branch_id=s.branch_id AND actor.role='QL' END)
   THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 fingerprint:=jsonb_build_object('schedule_id',s.id,'version',p_expected_version,'action',p_action,
   'reason',nullif(btrim(p_reason),''),'feedback_deadline_at',p_feedback_deadline_at);
 SELECT * INTO replay FROM public.audit_logs WHERE entity_type='schedules'
   AND new_data->>'request_id'=p_request_id::text ORDER BY created_at DESC LIMIT 1;
 IF FOUND THEN
  IF replay.actor_id IS DISTINCT FROM actor.id OR replay.new_data->'workflow_request' IS DISTINCT FROM fingerprint
    THEN RAISE EXCEPTION 'REQUEST_CONFLICT' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('reused',true,'schedule',replay.new_data->'schedule');
 END IF;
 IF s.version<>p_expected_version OR EXISTS(SELECT 1 FROM public.schedules WHERE period_id=s.period_id
   AND (version>s.version OR schedule_group_id<>s.schedule_group_id))
   THEN RAISE EXCEPTION 'STALE_SCHEDULE_VERSION' USING ERRCODE='40001'; END IF;
 old_s:=to_jsonb(s);
 IF p_action='SUBMIT' THEN
  IF s.status<>'DRAFT' THEN RAISE EXCEPTION 'INVALID_SCHEDULE_STATUS'; END IF;
  PERFORM public.tv4_assert_schedule_v2(s.id);
  UPDATE public.schedules SET status='PENDING_APPROVAL' WHERE id=s.id RETURNING * INTO s;
 ELSIF p_action IN ('APPROVED','NEEDS_REVISION') THEN
  IF s.status<>'PENDING_APPROVAL' THEN RAISE EXCEPTION 'INVALID_SCHEDULE_STATUS'; END IF;
  IF p_action='APPROVED' THEN PERFORM public.tv4_assert_schedule_v2(s.id); END IF;
  IF p_action='NEEDS_REVISION' AND length(btrim(coalesce(p_reason,'')))=0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  INSERT INTO public.schedule_approvals(schedule_id,supervisor_id,decision,reason)
   VALUES(s.id,actor.id,p_action,nullif(btrim(p_reason),''));
  UPDATE public.schedules SET status=p_action WHERE id=s.id RETURNING * INTO s;
 ELSE
  IF s.status<>'APPROVED' THEN RAISE EXCEPTION 'INVALID_SCHEDULE_STATUS'; END IF;
  IF p_feedback_deadline_at IS NULL OR p_feedback_deadline_at<clock_timestamp() THEN RAISE EXCEPTION 'INVALID_FEEDBACK_DEADLINE'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.schedule_approvals WHERE schedule_id=s.id AND decision='APPROVED')
    THEN RAISE EXCEPTION 'APPROVAL_REQUIRED'; END IF;
  PERFORM public.tv4_assert_schedule_v2(s.id);
  UPDATE public.schedules SET status='PUBLISHED',published_at=clock_timestamp(),published_by=actor.id,
    feedback_deadline_at=p_feedback_deadline_at WHERE id=s.id RETURNING * INTO s;
  UPDATE public.shift_assignments SET status='ACTIVE' WHERE schedule_id=s.id AND status='DRAFT';
 END IF;
 INSERT INTO public.audit_logs(actor_id,entity_type,entity_id,action,old_data,new_data,change_source)
 VALUES(actor.id,'schedules',s.id,p_action,old_s,jsonb_build_object('rpc_version','tv4.v2',
   'request_id',p_request_id,'workflow_request',fingerprint,'schedule',to_jsonb(s)),'MANUAL');
 RETURN jsonb_build_object('reused',false,'schedule',to_jsonb(s));
END $$;

-- Old TV4 entry points cannot bypass the v2 version/idempotency/validation path.
REVOKE ALL ON FUNCTION public.tv4_decide_schedule(uuid,uuid,varchar,text),public.tv4_publish_schedule(uuid,uuid,timestamptz)
 FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.tv4_transition_schedule_v2(uuid,uuid,int,text,uuid,text,timestamptz) OWNER TO postgres;
ALTER FUNCTION public.tv4_assert_schedule_v2(uuid) OWNER TO postgres;
ALTER FUNCTION public.validate_schedule_approval() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tv4_transition_schedule_v2(uuid,uuid,int,text,uuid,text,timestamptz),
 public.tv4_assert_schedule_v2(uuid),public.validate_schedule_approval() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.tv4_transition_schedule_v2(uuid,uuid,int,text,uuid,text,timestamptz) TO service_role;
-- CREATE OR REPLACE retains explicit/default grants; remove unexpected grantees.
DO $$ DECLARE f regprocedure; grantee_name name; BEGIN
 FOREACH f IN ARRAY ARRAY[
  'public.tv4_transition_schedule_v2(uuid,uuid,int,text,uuid,text,timestamptz)'::regprocedure,
  'public.tv4_assert_schedule_v2(uuid)'::regprocedure,'public.validate_schedule_approval()'::regprocedure,
  'public.tv4_decide_schedule(uuid,uuid,varchar,text)'::regprocedure,
  'public.tv4_publish_schedule(uuid,uuid,timestamptz)'::regprocedure
 ] LOOP
  FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p
   CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a JOIN pg_roles r ON r.oid=a.grantee
   WHERE p.oid=f::oid AND a.grantee<>p.proowner AND NOT(r.rolname='service_role' AND p.proname='tv4_transition_schedule_v2')
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f,grantee_name); END LOOP;
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
