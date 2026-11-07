-- Source snapshot is the existing SQL current_input, captured in the same audit transaction.
-- No audit backfill, schedule updates, tables or columns. Drift fails closed.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $migration$ DECLARE f text; BEGIN
 IF to_regprocedure('public.tv4_source_state_v2(uuid)') IS NOT NULL THEN RAISE EXCEPTION 'ROLLBACK_WORKFLOW_FIRST'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text)') AND pg_get_userbyid(proowner)='postgres' AND prosecdef=true AND NOT proisstrict AND NOT proleakproof AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp','lock_timeout=5s','statement_timeout=5s']::text[]) THEN RAISE EXCEPTION 'TV3_SNAPSHOT_METADATA_REVIEW_REQUIRED'; END IF;
 IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('public.persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text)') AND a.grantee<>p.proowner AND a.grantee<>(SELECT oid FROM pg_roles WHERE rolname='service_role')) OR NOT has_function_privilege('service_role',to_regprocedure('public.persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text)'),'EXECUTE') THEN RAISE EXCEPTION 'TV3_SNAPSHOT_ACL_REVIEW_REQUIRED'; END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text)'))='03bc9e50ab603b327649e49e34395678' THEN RETURN; END IF;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text)')) IS DISTINCT FROM '1ae21e5aec61bdefbd240177dd64532b' THEN RAISE EXCEPTION 'TV3_SNAPSHOT_BODY_REVIEW_REQUIRED'; END IF;
 f:=replace(pg_get_functiondef('public.persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text)'::regprocedure),chr(13),'');
 f:=replace(f,replace($before$
DECLARE p public.registration_periods; actor public.users; current_input jsonb; saved public.schedules;
  previous jsonb; persisted jsonb; output jsonb; item jsonb; n integer; need public.staffing_requirements;
  emp public.employees; shift_row public.shifts; begin_at timestamp; end_at timestamp;
  target public.schedules; replay public.audit_logs; previous_state jsonb;
  save_deadline timestamptz;
  coverage jsonb; verified_assignments jsonb := '[]'; statistics jsonb; verified_result jsonb;
BEGIN
  -- This is a backend service RPC, not an end-user RPC. p_actor_id is trusted ONLY
  -- because Express verifies the user JWT and derives it from req.user, never body.
  IF session_user NOT IN ('postgres','supabase_admin') AND COALESCE(auth.role(),'')<>'service_role'
    THEN RAISE EXCEPTION 'FORBIDDEN_CALLER' USING ERRCODE='42501'; END IF;
  SELECT * INTO actor FROM public.users WHERE id=p_actor_id;
  SELECT * INTO p FROM public.registration_periods WHERE id=p_period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERIOD_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF actor.id IS NULL OR actor.role<>'QL' OR NOT actor.is_active OR actor.must_change_password IS DISTINCT FROM false
    OR actor.branch_id IS DISTINCT FROM p.branch_id OR NOT EXISTS(SELECT 1 FROM public.branches WHERE id=p.branch_id AND status='ACTIVE')
    THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF public.registration_effective_status(p.open_at,p.close_at,statement_timestamp())<>'CLOSED'
    THEN RAISE EXCEPTION 'PERIOD_NOT_CLOSED'; END IF;
  IF (p_snapshot IS NULL) <> (p_result IS NULL) THEN RAISE EXCEPTION 'INVALID_RESULT' USING ERRCODE='22023'; END IF;

  IF p_result IS NOT NULL THEN
    -- Reject malformed/oversized input and unauthorized callers before locking.
    IF jsonb_typeof(p_result)<>'object' OR jsonb_typeof(p_result->'assignments') IS DISTINCT FROM 'array'
      THEN RAISE EXCEPTION 'INVALID_RESULT' USING ERRCODE='22023'; END IF;
    IF jsonb_array_length(p_result->'assignments')>10000 THEN RAISE EXCEPTION 'INVALID_RESULT' USING ERRCODE='22023'; END IF;
    -- Predicate/absence protection is still necessary: other TV2/TV4 writers do
    -- not share a branch advisory-lock protocol. SHARE is sufficient for sources.
    -- NOWAIT yields to existing writers, avoiding a queued global lock convoy.
    IF to_regclass('public.dev_import_batches') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.dev_import_batches IN SHARE MODE NOWAIT';
  END IF;
  LOCK TABLE public.employees,public.employee_skills,public.shifts,
      public.registration_submissions,public.shift_registrations,
      public.staffing_requirements,public.warning_configs IN SHARE MODE NOWAIT;
    -- Audit participates in the legacy sample-provenance view and replay checks.
    LOCK TABLE public.schedules,public.shift_assignments,public.audit_logs IN SHARE ROW EXCLUSIVE MODE NOWAIT;
    -- Exact rows replace global locks: cron can insert other periods, and users
    -- outside this branch can change their profiles/password state concurrently.
    SELECT * INTO p FROM public.registration_periods WHERE id=p_period_id FOR SHARE NOWAIT;
    PERFORM id FROM public.branches WHERE id=p.branch_id FOR SHARE NOWAIT;
    PERFORM u.id FROM public.users u WHERE u.id=p_actor_id OR u.id IN
      (SELECT e.user_id FROM public.employees e WHERE e.branch_id=p.branch_id)
      ORDER BY u.id FOR SHARE OF u NOWAIT;
    -- Re-read authorization and effective status AFTER acquiring all protections.
    SELECT * INTO actor FROM public.users WHERE id=p_actor_id;
    SELECT * INTO p FROM public.registration_periods WHERE id=p_period_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'PERIOD_NOT_FOUND' USING ERRCODE='P0002'; END IF;
    IF actor.id IS NULL OR actor.role<>'QL' OR NOT actor.is_active OR actor.must_change_password IS DISTINCT FROM false
      OR actor.branch_id IS DISTINCT FROM p.branch_id OR NOT EXISTS(SELECT 1 FROM public.branches WHERE id=p.branch_id AND status='ACTIVE')
      THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
    IF public.registration_effective_status(p.open_at,p.close_at,statement_timestamp())<>'CLOSED'
      THEN RAISE EXCEPTION 'PERIOD_NOT_CLOSED'; END IF;
    -- Cooperative work budget, NOT a substitute for the gateway's outer
    -- statement timeout: an individual long SQL statement/trigger is not preempted.
    save_deadline:=clock_timestamp()+interval '3 seconds';
  END IF;


  IF p_request_id IS NOT NULL THEN
    IF p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE='22023'; END IF;
    SELECT * INTO replay FROM public.audit_logs WHERE entity_type='schedules' AND new_data->>'request_id'=p_request_id::text ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      IF replay.actor_id IS DISTINCT FROM actor.id OR replay.new_data->>'request_fingerprint' IS DISTINCT FROM p_fingerprint
        THEN RAISE EXCEPTION 'REQUEST_CONFLICT' USING ERRCODE='40001'; END IF;
      SELECT * INTO saved FROM public.schedules WHERE id=replay.entity_id AND branch_id=p.branch_id AND period_id=p.id;
      IF saved.id IS NULL OR saved.status<>'DRAFT' OR EXISTS(SELECT 1 FROM public.schedules WHERE period_id=p.id AND version>saved.version)
        THEN RAISE EXCEPTION 'SCHEDULE_VERSION_CHANGED' USING ERRCODE='40001'; END IF;
      IF save_deadline IS NOT NULL AND clock_timestamp()>save_deadline THEN RAISE EXCEPTION 'DRAFT_SAVE_BUDGET_EXCEEDED' USING ERRCODE='57014'; END IF;
      RETURN jsonb_build_object('reused',true,'result',replay.new_data->'response_result');
    END IF;
  END IF;
  IF p_schedule_id IS NOT NULL THEN
    SELECT * INTO target FROM public.schedules WHERE id=p_schedule_id AND period_id=p.id AND branch_id=p.branch_id;
    IF target.id IS NULL THEN RAISE EXCEPTION 'SCHEDULE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
    IF target.status NOT IN ('DRAFT','NEEDS_REVISION') THEN RAISE EXCEPTION 'DRAFT_LOCKED' USING ERRCODE='40001'; END IF;
    IF p_expected_version IS NULL OR target.version<>p_expected_version OR EXISTS(
      SELECT 1 FROM public.schedules WHERE period_id=p.id AND (version>target.version OR schedule_group_id<>target.schedule_group_id OR (id<>target.id AND status NOT IN ('DRAFT','NEEDS_REVISION'))))
      THEN RAISE EXCEPTION 'SCHEDULE_VERSION_CHANGED' USING ERRCODE='40001'; END IF;
    IF EXISTS(SELECT 1 FROM public.shift_assignments WHERE schedule_id=target.id AND (status<>'DRAFT' OR assignment_source<>'REGULAR'))
      THEN RAISE EXCEPTION 'DRAFT_LOCKED' USING ERRCODE='40001'; END IF;
    previous_state:=to_jsonb(target)||jsonb_build_object('assignments',(SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) FROM public.shift_assignments a WHERE schedule_id=target.id));
  ELSE
  SELECT count(*) INTO n FROM public.schedules WHERE period_id=p.id;
  IF n>0 THEN
    IF p_request_id IS NOT NULL THEN RAISE EXCEPTION 'SCHEDULE_EXISTS'; END IF;
    IF n<>1 THEN RAISE EXCEPTION 'SCHEDULE_EXISTS'; END IF;
    SELECT * INTO saved FROM public.schedules WHERE period_id=p.id;
    SELECT a.new_data INTO previous FROM public.audit_logs a WHERE a.entity_id=saved.id AND a.entity_type='schedules'
      AND a.action='AUTO_GENERATE' AND a.new_data->>'rpc_version'='tv3-v2' ORDER BY a.created_at DESC,a.id DESC LIMIT 1;
    SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) INTO persisted FROM public.shift_assignments a WHERE schedule_id=saved.id;
    IF saved.status<>'DRAFT' OR saved.branch_id<>p.branch_id OR previous IS NULL
      OR previous->'persisted_assignments' IS DISTINCT FROM persisted OR previous->'saved_schedule' IS DISTINCT FROM to_jsonb(saved)
      THEN RAISE EXCEPTION 'SCHEDULE_EXISTS'; END IF;
      IF save_deadline IS NOT NULL AND clock_timestamp()>save_deadline THEN RAISE EXCEPTION 'DRAFT_SAVE_BUDGET_EXCEEDED' USING ERRCODE='57014'; END IF;
    RETURN jsonb_build_object('reused',true,'result',previous->'response_result');
  END IF;

  END IF;

  current_input:=public.tv3_scheduling_input(p.id);
  IF target.id IS NOT NULL THEN
    current_input:=jsonb_set(current_input,'{existing}',COALESCE((SELECT jsonb_agg(x.value ORDER BY x.ordinality)
      FROM jsonb_array_elements(current_input->'existing') WITH ORDINALITY x
      WHERE NOT EXISTS(SELECT 1 FROM public.shift_assignments a WHERE a.schedule_id=target.id
        AND a.id::text=x.value->>'id')),'[]'::jsonb));
  END IF;
  IF (current_input->'period'->>'branch_id')::uuid IS DISTINCT FROM actor.branch_id
    THEN RAISE EXCEPTION 'INPUT_CHANGED' USING ERRCODE='40001'; END IF;
  IF p_result IS NULL THEN RETURN jsonb_build_object('input',current_input); END IF;
  IF save_deadline IS NOT NULL AND clock_timestamp()>save_deadline THEN RAISE EXCEPTION 'DRAFT_SAVE_BUDGET_EXCEEDED' USING ERRCODE='57014'; END IF;
  IF p_snapshot IS DISTINCT FROM current_input THEN RAISE EXCEPTION 'INPUT_CHANGED' USING ERRCODE='40001'; END IF;
  IF jsonb_typeof(p_result)<>'object' OR jsonb_typeof(p_result->'assignments') IS DISTINCT FROM 'array'
    OR jsonb_array_length(current_input->'requirements')=0 THEN RAISE EXCEPTION 'INVALID_RESULT' USING ERRCODE='22023'; END IF;
  -- The engine remains in TypeScript. SQL independently protects persisted relationships.
  IF target.id IS NOT NULL THEN
    UPDATE public.shift_assignments SET status='REPLACED' WHERE schedule_id=target.id;
  END IF;
  INSERT INTO public.schedules(schedule_group_id,branch_id,period_id,version,status,created_by)
    VALUES(COALESCE(target.schedule_group_id,gen_random_uuid()),p.branch_id,p.id,COALESCE(target.version,0)+1,'DRAFT',actor.id) RETURNING * INTO saved;
  FOR item IN SELECT value FROM jsonb_array_elements(p_result->'assignments') LOOP
  IF save_deadline IS NOT NULL AND clock_timestamp()>save_deadline THEN RAISE EXCEPTION 'DRAFT_SAVE_BUDGET_EXCEEDED' USING ERRCODE='57014'; END IF;

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
      'requirement_id',need.id,'reason',CASE WHEN jsonb_typeof(item->'reason')='string' THEN left(item->>'reason',1000) ELSE 'SERVER_VALIDATED' END,
      'selection_history',CASE WHEN jsonb_typeof(item->'selection_history')='object' THEN item->'selection_history'
        ELSE jsonb_build_object('initial',jsonb_build_object('employee_id',emp.id,'reason','SERVER_VALIDATED'),'replacements','[]'::jsonb) END));
  END LOOP;
  IF save_deadline IS NOT NULL AND clock_timestamp()>save_deadline THEN RAISE EXCEPTION 'DRAFT_SAVE_BUDGET_EXCEEDED' USING ERRCODE='57014'; END IF;
  verified_result:=public.tv3_result_v2(current_input,saved.id,verified_assignments,p_result);
  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) INTO persisted FROM public.shift_assignments a WHERE schedule_id=saved.id;
  output:=verified_result||jsonb_build_object('schedule',to_jsonb(saved));
  INSERT INTO public.audit_logs(actor_id,entity_type,entity_id,action,new_data,change_source)
    VALUES(actor.id,'schedules',saved.id,'AUTO_GENERATE',verified_result||jsonb_build_object('rpc_version','tv3-v2',
      'operation',CASE WHEN target.id IS NULL THEN 'CREATE_DRAFT' ELSE 'EDIT_DRAFT' END,
      'source_snapshot',current_input,'request_id',p_request_id,'request_fingerprint',p_fingerprint,'previous_state',previous_state,'saved_schedule',to_jsonb(saved),'persisted_assignments',persisted,'response_result',output),CASE WHEN p_request_id IS NULL THEN 'SYSTEM' ELSE 'MANUAL' END);
  IF save_deadline IS NOT NULL AND clock_timestamp()>save_deadline THEN RAISE EXCEPTION 'DRAFT_SAVE_BUDGET_EXCEEDED' USING ERRCODE='57014'; END IF;
  RETURN jsonb_build_object('reused',false,'result',output);
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN
  RAISE EXCEPTION 'INVALID_ASSIGNMENT_FORMAT' USING ERRCODE='22023';
END;
$before$,chr(13),''),replace($after$
DECLARE p public.registration_periods; actor public.users; current_input jsonb; saved public.schedules;
  previous jsonb; persisted jsonb; output jsonb; item jsonb; n integer; need public.staffing_requirements;
  emp public.employees; shift_row public.shifts; begin_at timestamp; end_at timestamp;
  target public.schedules; replay public.audit_logs; previous_state jsonb;
  save_deadline timestamptz;
  coverage jsonb; verified_assignments jsonb := '[]'; statistics jsonb; verified_result jsonb;
BEGIN
  -- This is a backend service RPC, not an end-user RPC. p_actor_id is trusted ONLY
  -- because Express verifies the user JWT and derives it from req.user, never body.
  IF session_user NOT IN ('postgres','supabase_admin') AND COALESCE(auth.role(),'')<>'service_role'
    THEN RAISE EXCEPTION 'FORBIDDEN_CALLER' USING ERRCODE='42501'; END IF;
  SELECT * INTO actor FROM public.users WHERE id=p_actor_id;
  SELECT * INTO p FROM public.registration_periods WHERE id=p_period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERIOD_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF actor.id IS NULL OR actor.role<>'QL' OR NOT actor.is_active OR actor.must_change_password IS DISTINCT FROM false
    OR actor.branch_id IS DISTINCT FROM p.branch_id OR NOT EXISTS(SELECT 1 FROM public.branches WHERE id=p.branch_id AND status='ACTIVE')
    THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF public.registration_effective_status(p.open_at,p.close_at,statement_timestamp())<>'CLOSED'
    THEN RAISE EXCEPTION 'PERIOD_NOT_CLOSED'; END IF;
  IF (p_snapshot IS NULL) <> (p_result IS NULL) THEN RAISE EXCEPTION 'INVALID_RESULT' USING ERRCODE='22023'; END IF;

  IF p_result IS NOT NULL THEN
    -- Reject malformed/oversized input and unauthorized callers before locking.
    IF jsonb_typeof(p_result)<>'object' OR jsonb_typeof(p_result->'assignments') IS DISTINCT FROM 'array'
      THEN RAISE EXCEPTION 'INVALID_RESULT' USING ERRCODE='22023'; END IF;
    IF jsonb_array_length(p_result->'assignments')>10000 THEN RAISE EXCEPTION 'INVALID_RESULT' USING ERRCODE='22023'; END IF;
    -- Predicate/absence protection is still necessary: other TV2/TV4 writers do
    -- not share a branch advisory-lock protocol. SHARE is sufficient for sources.
    -- NOWAIT yields to existing writers, avoiding a queued global lock convoy.
    LOCK TABLE public.employees,public.employee_skills,public.shifts,
      public.registration_submissions,public.shift_registrations,
      public.staffing_requirements,public.warning_configs IN SHARE MODE NOWAIT;
    -- Audit participates in the legacy sample-provenance view and replay checks.
    LOCK TABLE public.schedules,public.shift_assignments,public.audit_logs IN SHARE ROW EXCLUSIVE MODE NOWAIT;
    -- Exact rows replace global locks: cron can insert other periods, and users
    -- outside this branch can change their profiles/password state concurrently.
    SELECT * INTO p FROM public.registration_periods WHERE id=p_period_id FOR SHARE NOWAIT;
    PERFORM id FROM public.branches WHERE id=p.branch_id FOR SHARE NOWAIT;
    PERFORM u.id FROM public.users u WHERE u.id=p_actor_id OR u.id IN
      (SELECT e.user_id FROM public.employees e WHERE e.branch_id=p.branch_id)
      ORDER BY u.id FOR SHARE OF u NOWAIT;
    -- Re-read authorization and effective status AFTER acquiring all protections.
    SELECT * INTO actor FROM public.users WHERE id=p_actor_id;
    SELECT * INTO p FROM public.registration_periods WHERE id=p_period_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'PERIOD_NOT_FOUND' USING ERRCODE='P0002'; END IF;
    IF actor.id IS NULL OR actor.role<>'QL' OR NOT actor.is_active OR actor.must_change_password IS DISTINCT FROM false
      OR actor.branch_id IS DISTINCT FROM p.branch_id OR NOT EXISTS(SELECT 1 FROM public.branches WHERE id=p.branch_id AND status='ACTIVE')
      THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
    IF public.registration_effective_status(p.open_at,p.close_at,statement_timestamp())<>'CLOSED'
      THEN RAISE EXCEPTION 'PERIOD_NOT_CLOSED'; END IF;
    -- Cooperative work budget, NOT a substitute for the gateway's outer
    -- statement timeout: an individual long SQL statement/trigger is not preempted.
    save_deadline:=clock_timestamp()+interval '3 seconds';
  END IF;


  IF p_request_id IS NOT NULL THEN
    IF p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_REQUEST' USING ERRCODE='22023'; END IF;
    SELECT * INTO replay FROM public.audit_logs WHERE entity_type='schedules' AND new_data->>'request_id'=p_request_id::text ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      IF replay.actor_id IS DISTINCT FROM actor.id OR replay.new_data->>'request_fingerprint' IS DISTINCT FROM p_fingerprint
        THEN RAISE EXCEPTION 'REQUEST_CONFLICT' USING ERRCODE='40001'; END IF;
      SELECT * INTO saved FROM public.schedules WHERE id=replay.entity_id AND branch_id=p.branch_id AND period_id=p.id;
      IF saved.id IS NULL OR saved.status<>'DRAFT' OR EXISTS(SELECT 1 FROM public.schedules WHERE period_id=p.id AND version>saved.version)
        THEN RAISE EXCEPTION 'SCHEDULE_VERSION_CHANGED' USING ERRCODE='40001'; END IF;
      IF save_deadline IS NOT NULL AND clock_timestamp()>save_deadline THEN RAISE EXCEPTION 'DRAFT_SAVE_BUDGET_EXCEEDED' USING ERRCODE='57014'; END IF;
      RETURN jsonb_build_object('reused',true,'result',replay.new_data->'response_result');
    END IF;
  END IF;
  IF p_schedule_id IS NOT NULL THEN
    SELECT * INTO target FROM public.schedules WHERE id=p_schedule_id AND period_id=p.id AND branch_id=p.branch_id;
    IF target.id IS NULL THEN RAISE EXCEPTION 'SCHEDULE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
    IF target.status NOT IN ('DRAFT','NEEDS_REVISION') THEN RAISE EXCEPTION 'DRAFT_LOCKED' USING ERRCODE='40001'; END IF;
    IF p_expected_version IS NULL OR target.version<>p_expected_version OR EXISTS(
      SELECT 1 FROM public.schedules WHERE period_id=p.id AND (version>target.version OR schedule_group_id<>target.schedule_group_id OR (id<>target.id AND status NOT IN ('DRAFT','NEEDS_REVISION'))))
      THEN RAISE EXCEPTION 'SCHEDULE_VERSION_CHANGED' USING ERRCODE='40001'; END IF;
    IF EXISTS(SELECT 1 FROM public.shift_assignments WHERE schedule_id=target.id AND (status<>'DRAFT' OR assignment_source<>'REGULAR'))
      THEN RAISE EXCEPTION 'DRAFT_LOCKED' USING ERRCODE='40001'; END IF;
    previous_state:=to_jsonb(target)||jsonb_build_object('assignments',(SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb) FROM public.shift_assignments a WHERE schedule_id=target.id));
  ELSE
  SELECT count(*) INTO n FROM public.schedules WHERE period_id=p.id;
  IF n>0 THEN
    IF p_request_id IS NOT NULL THEN RAISE EXCEPTION 'SCHEDULE_EXISTS'; END IF;
    IF n<>1 THEN RAISE EXCEPTION 'SCHEDULE_EXISTS'; END IF;
    SELECT * INTO saved FROM public.schedules WHERE period_id=p.id;
    SELECT a.new_data INTO previous FROM public.audit_logs a WHERE a.entity_id=saved.id AND a.entity_type='schedules'
      AND a.action='AUTO_GENERATE' AND a.new_data->>'rpc_version'='tv3-v2' ORDER BY a.created_at DESC,a.id DESC LIMIT 1;
    SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) INTO persisted FROM public.shift_assignments a WHERE schedule_id=saved.id;
    IF saved.status<>'DRAFT' OR saved.branch_id<>p.branch_id OR previous IS NULL
      OR previous->'persisted_assignments' IS DISTINCT FROM persisted OR previous->'saved_schedule' IS DISTINCT FROM to_jsonb(saved)
      THEN RAISE EXCEPTION 'SCHEDULE_EXISTS'; END IF;
      IF save_deadline IS NOT NULL AND clock_timestamp()>save_deadline THEN RAISE EXCEPTION 'DRAFT_SAVE_BUDGET_EXCEEDED' USING ERRCODE='57014'; END IF;
    RETURN jsonb_build_object('reused',true,'result',previous->'response_result');
  END IF;

  END IF;

  current_input:=public.tv3_scheduling_input(p.id);
  IF target.id IS NOT NULL THEN
    current_input:=jsonb_set(current_input,'{existing}',COALESCE((SELECT jsonb_agg(x.value ORDER BY x.ordinality)
      FROM jsonb_array_elements(current_input->'existing') WITH ORDINALITY x
      WHERE NOT EXISTS(SELECT 1 FROM public.shift_assignments a WHERE a.schedule_id=target.id
        AND a.id::text=x.value->>'id')),'[]'::jsonb));
  END IF;
  IF (current_input->'period'->>'branch_id')::uuid IS DISTINCT FROM actor.branch_id
    THEN RAISE EXCEPTION 'INPUT_CHANGED' USING ERRCODE='40001'; END IF;
  IF p_result IS NULL THEN RETURN jsonb_build_object('input',current_input); END IF;
  IF save_deadline IS NOT NULL AND clock_timestamp()>save_deadline THEN RAISE EXCEPTION 'DRAFT_SAVE_BUDGET_EXCEEDED' USING ERRCODE='57014'; END IF;
  IF p_snapshot IS DISTINCT FROM current_input THEN RAISE EXCEPTION 'INPUT_CHANGED' USING ERRCODE='40001'; END IF;
  IF jsonb_typeof(p_result)<>'object' OR jsonb_typeof(p_result->'assignments') IS DISTINCT FROM 'array'
    OR jsonb_array_length(current_input->'requirements')=0 THEN RAISE EXCEPTION 'INVALID_RESULT' USING ERRCODE='22023'; END IF;
  -- The engine remains in TypeScript. SQL independently protects persisted relationships.
  IF target.id IS NOT NULL THEN
    UPDATE public.shift_assignments SET status='REPLACED' WHERE schedule_id=target.id;
  END IF;
  INSERT INTO public.schedules(schedule_group_id,branch_id,period_id,version,status,created_by)
    VALUES(COALESCE(target.schedule_group_id,gen_random_uuid()),p.branch_id,p.id,COALESCE(target.version,0)+1,'DRAFT',actor.id) RETURNING * INTO saved;
  FOR item IN SELECT value FROM jsonb_array_elements(p_result->'assignments') LOOP
  IF save_deadline IS NOT NULL AND clock_timestamp()>save_deadline THEN RAISE EXCEPTION 'DRAFT_SAVE_BUDGET_EXCEEDED' USING ERRCODE='57014'; END IF;

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
      'requirement_id',need.id,'reason',CASE WHEN jsonb_typeof(item->'reason')='string' THEN left(item->>'reason',1000) ELSE 'SERVER_VALIDATED' END,
      'selection_history',CASE WHEN jsonb_typeof(item->'selection_history')='object' THEN item->'selection_history'
        ELSE jsonb_build_object('initial',jsonb_build_object('employee_id',emp.id,'reason','SERVER_VALIDATED'),'replacements','[]'::jsonb) END));
  END LOOP;
  IF save_deadline IS NOT NULL AND clock_timestamp()>save_deadline THEN RAISE EXCEPTION 'DRAFT_SAVE_BUDGET_EXCEEDED' USING ERRCODE='57014'; END IF;
  verified_result:=public.tv3_result_v2(current_input,saved.id,verified_assignments,p_result);
  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) INTO persisted FROM public.shift_assignments a WHERE schedule_id=saved.id;
  output:=verified_result||jsonb_build_object('schedule',to_jsonb(saved));
  INSERT INTO public.audit_logs(actor_id,entity_type,entity_id,action,new_data,change_source)
    VALUES(actor.id,'schedules',saved.id,'AUTO_GENERATE',verified_result||jsonb_build_object('rpc_version','tv3-v2',
      'operation',CASE WHEN target.id IS NULL THEN 'CREATE_DRAFT' ELSE 'EDIT_DRAFT' END,
      'request_id',p_request_id,'request_fingerprint',p_fingerprint,'previous_state',previous_state,'saved_schedule',to_jsonb(saved),'persisted_assignments',persisted,'response_result',output),CASE WHEN p_request_id IS NULL THEN 'SYSTEM' ELSE 'MANUAL' END);
  IF save_deadline IS NOT NULL AND clock_timestamp()>save_deadline THEN RAISE EXCEPTION 'DRAFT_SAVE_BUDGET_EXCEEDED' USING ERRCODE='57014'; END IF;
  RETURN jsonb_build_object('reused',false,'result',output);
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN
  RAISE EXCEPTION 'INVALID_ASSIGNMENT_FORMAT' USING ERRCODE='22023';
END;
$after$,chr(13),''));
 EXECUTE f;
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text)')) IS DISTINCT FROM '03bc9e50ab603b327649e49e34395678' THEN RAISE EXCEPTION 'TV3_SNAPSHOT_PATCH_FAILED'; END IF;
END $migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
