-- Source CURRENT and shortage-tolerant SUBMIT, APPROVED and PUBLISH.
-- Prerequisite: 20261106_tv3_persist_source_snapshot.sql. No application data changes.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $migration$ BEGIN
 IF (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text)')) IS DISTINCT FROM '1ae21e5aec61bdefbd240177dd64532b' THEN RAISE EXCEPTION 'TV3_SOURCE_SNAPSHOT_REQUIRED'; END IF;
 IF ((SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.tv3_normalize_source_snapshot_v2(jsonb)'))='85eebb7860165415be93fab9aed9c67b' AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.tv3_normalize_source_snapshot_v2(jsonb)') AND pg_get_userbyid(proowner)='postgres' AND prosecdef=false AND NOT proisstrict AND NOT proleakproof AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp','TimeZone=UTC']::text[]) AND NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('public.tv3_normalize_source_snapshot_v2(jsonb)') AND a.privilege_type='EXECUTE' AND a.grantee<>p.proowner)) AND
 ((SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.tv4_source_state_v2(uuid)'))='0f6dfafe9caf2dc68045f31dc0033b25' AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.tv4_source_state_v2(uuid)') AND pg_get_userbyid(proowner)='postgres' AND prosecdef=false AND NOT proisstrict AND NOT proleakproof AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp','TimeZone=UTC']::text[]) AND NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('public.tv4_source_state_v2(uuid)') AND a.privilege_type='EXECUTE' AND a.grantee<>p.proowner)) AND
 ((SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.tv4_schedule_source_state(uuid,uuid,integer)'))='b9bcc7c20fae7994c38764f265d2519e' AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.tv4_schedule_source_state(uuid,uuid,integer)') AND pg_get_userbyid(proowner)='postgres' AND prosecdef=true AND NOT proisstrict AND NOT proleakproof AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp']::text[]) AND NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('public.tv4_schedule_source_state(uuid,uuid,integer)') AND a.privilege_type='EXECUTE' AND a.grantee<>p.proowner AND a.grantee<>(SELECT oid FROM pg_roles WHERE rolname='service_role')) AND has_function_privilege('service_role',to_regprocedure('public.tv4_schedule_source_state(uuid,uuid,integer)'),'EXECUTE')) AND
 ((SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.tv4_assert_schedule_checks_v2(uuid,boolean)'))='d30407e0a6b28b4b9713301a7eb79dda' AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.tv4_assert_schedule_checks_v2(uuid,boolean)') AND pg_get_userbyid(proowner)='postgres' AND prosecdef=false AND NOT proisstrict AND NOT proleakproof AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp']::text[]) AND NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('public.tv4_assert_schedule_checks_v2(uuid,boolean)') AND a.privilege_type='EXECUTE' AND a.grantee<>p.proowner)) AND
 ((SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.tv4_assert_schedule_v2(uuid)'))='fd4d9a0e1e6a0ac08f2a7cc7598e1e7a' AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.tv4_assert_schedule_v2(uuid)') AND pg_get_userbyid(proowner)='postgres' AND prosecdef=false AND NOT proisstrict AND NOT proleakproof AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp']::text[]) AND NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('public.tv4_assert_schedule_v2(uuid)') AND a.privilege_type='EXECUTE' AND a.grantee<>p.proowner)) AND
 ((SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.tv4_transition_schedule_v2(uuid,uuid,integer,text,uuid,text,timestamptz)'))='8fe7a96d03ee0a82ec5d6795e0d7928f' AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.tv4_transition_schedule_v2(uuid,uuid,integer,text,uuid,text,timestamptz)') AND pg_get_userbyid(proowner)='postgres' AND prosecdef=true AND NOT proisstrict AND NOT proleakproof AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp','lock_timeout=5s','statement_timeout=5s']::text[]) AND NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('public.tv4_transition_schedule_v2(uuid,uuid,integer,text,uuid,text,timestamptz)') AND a.privilege_type='EXECUTE' AND a.grantee<>p.proowner AND a.grantee<>(SELECT oid FROM pg_roles WHERE rolname='service_role')) AND has_function_privilege('service_role',to_regprocedure('public.tv4_transition_schedule_v2(uuid,uuid,integer,text,uuid,text,timestamptz)'),'EXECUTE')) THEN RETURN; END IF;
 IF NOT ((SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.tv4_assert_schedule_v2(uuid)'))='4ce3a60b6adc985b5719e5b94945601e' AND (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.tv4_transition_schedule_v2(uuid,uuid,integer,text,uuid,text,timestamptz)'))='000635a70f86f59c95ca12742dc5ce5f' AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.tv4_assert_schedule_v2(uuid)') AND pg_get_userbyid(proowner)='postgres' AND prosecdef=false AND NOT proisstrict AND NOT proleakproof AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp']::text[]) AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.tv4_transition_schedule_v2(uuid,uuid,integer,text,uuid,text,timestamptz)') AND pg_get_userbyid(proowner)='postgres' AND prosecdef=true AND NOT proisstrict AND NOT proleakproof AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp','lock_timeout=5s','statement_timeout=5s']::text[]) AND NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('public.tv4_assert_schedule_v2(uuid)') AND a.privilege_type='EXECUTE' AND a.grantee<>p.proowner) AND NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('public.tv4_transition_schedule_v2(uuid,uuid,integer,text,uuid,text,timestamptz)') AND a.privilege_type='EXECUTE' AND a.grantee<>p.proowner AND a.grantee<>(SELECT oid FROM pg_roles WHERE rolname='service_role')) AND has_function_privilege('service_role',to_regprocedure('public.tv4_transition_schedule_v2(uuid,uuid,integer,text,uuid,text,timestamptz)'),'EXECUTE') AND to_regprocedure('public.tv3_normalize_source_snapshot_v2(jsonb)') IS NULL AND to_regprocedure('public.tv4_source_state_v2(uuid)') IS NULL AND to_regprocedure('public.tv4_schedule_source_state(uuid,uuid,integer)') IS NULL AND to_regprocedure('public.tv4_assert_schedule_checks_v2(uuid,boolean)') IS NULL) THEN RAISE EXCEPTION 'TV4_SOURCE_MIGRATION_REVIEW_REQUIRED'; END IF;
 EXECUTE $ddl$CREATE FUNCTION public.tv3_normalize_source_snapshot_v2(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp SET timezone='UTC' AS $$
DECLARE result jsonb; section text; keys text[]; rows jsonb; item jsonb; projected jsonb; field text;
BEGIN
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR p_input->>'rule_version' IS DISTINCT FROM 'tv3.rules.v2'
  OR jsonb_typeof(p_input->'period') IS DISTINCT FROM 'object'
  OR NOT (p_input ?& ARRAY['registration_provenance','holiday_dates','new_employee_count_threshold'])
  OR NOT ((p_input->'period') ?& ARRAY['id','branch_id','work_start_date','work_end_date','status'])
  THEN RAISE EXCEPTION 'INVALID_SOURCE_SNAPSHOT'; END IF;
 result:=jsonb_build_object('rule_version',p_input->'rule_version','period',jsonb_build_object(
  'id',p_input->'period'->'id','branch_id',p_input->'period'->'branch_id',
  'work_start_date',p_input->'period'->'work_start_date','work_end_date',p_input->'period'->'work_end_date','status',p_input->'period'->'status'),
  'new_employee_count_threshold',p_input->'new_employee_count_threshold','test_rules',p_input->'test_rules');
 FOREACH section IN ARRAY ARRAY['employees','shifts','registrations','requirements','existing','registration_provenance'] LOOP
  IF jsonb_typeof(p_input->section) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_SOURCE_SNAPSHOT'; END IF;
  keys:=CASE section
   WHEN 'employees' THEN ARRAY['id','employee_code','department_id','skill_level','status','is_active','role','max_weekly_hours','skills']
   WHEN 'shifts' THEN ARRAY['id','start_time','end_time','is_active','branch_id']
   WHEN 'registrations' THEN ARRAY['employee_id','work_date','shift_id','status']
   WHEN 'requirements' THEN ARRAY['id','department_id','work_date','shift_id','required_count','required_skill_name']
   WHEN 'existing' THEN ARRAY['employee_id','work_date','shift_id','department_id']
   ELSE ARRAY['employee_id','batch_id','submitted_at','updated_at'] END;
  rows:='[]'::jsonb;
  FOR item IN SELECT value FROM jsonb_array_elements(p_input->section) LOOP
   IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR NOT(item ?& keys) THEN RAISE EXCEPTION 'INVALID_SOURCE_SNAPSHOT'; END IF;
   projected:='{}'::jsonb;
   FOREACH field IN ARRAY keys LOOP projected:=projected||jsonb_build_object(field,item->field); END LOOP;
   IF section='employees' THEN
    IF jsonb_typeof(item->'skills') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_SOURCE_SNAPSHOT'; END IF;
    projected:=jsonb_set(projected,'{skills}',coalesce((SELECT jsonb_agg(value ORDER BY value::text) FROM jsonb_array_elements(item->'skills')),'[]'));
   ELSIF section='registration_provenance' THEN
    projected:=projected||jsonb_build_object('submitted_at',(item->>'submitted_at')::timestamptz,'updated_at',(item->>'updated_at')::timestamptz);
   END IF;
   rows:=rows||jsonb_build_array(projected);
  END LOOP;
  result:=result||jsonb_build_object(section,coalesce((SELECT jsonb_agg(value ORDER BY value::text) FROM jsonb_array_elements(rows)),'[]'));
 END LOOP;
 IF jsonb_typeof(p_input->'holiday_dates') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_SOURCE_SNAPSHOT'; END IF;
 RETURN result||jsonb_build_object('holiday_dates',coalesce((SELECT jsonb_agg(value ORDER BY value::text) FROM (SELECT DISTINCT value FROM jsonb_array_elements(p_input->'holiday_dates')) d),'[]'));
END $$;

CREATE FUNCTION public.tv4_source_state_v2(p_schedule uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp SET timezone='UTC' AS $$
DECLARE s public.schedules; stored jsonb; current_input jsonb; normalized jsonb;
BEGIN
 SELECT * INTO STRICT s FROM public.schedules WHERE id=p_schedule;
 SELECT new_data->'source_snapshot' INTO stored FROM public.audit_logs
  WHERE entity_type='schedules' AND entity_id=s.id AND action='AUTO_GENERATE' ORDER BY created_at DESC,id DESC LIMIT 1;
 IF stored IS NULL OR stored='null'::jsonb THEN RETURN jsonb_build_object('source_state','UNKNOWN','source_reason','SOURCE_SNAPSHOT_MISSING'); END IF;
 BEGIN
  normalized:=public.tv3_normalize_source_snapshot_v2(stored);
  IF stored->'period'->>'id' IS DISTINCT FROM s.period_id::text OR stored->'period'->>'branch_id' IS DISTINCT FROM s.branch_id::text
   THEN RAISE EXCEPTION 'INVALID_SOURCE_SNAPSHOT'; END IF;
 EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('source_state','UNKNOWN','source_reason','SOURCE_SNAPSHOT_INVALID'); END;
 current_input:=public.tv3_scheduling_input(s.period_id);
 current_input:=jsonb_set(current_input,'{existing}',coalesce((SELECT jsonb_agg(x.value ORDER BY x.ordinality)
  FROM jsonb_array_elements(current_input->'existing') WITH ORDINALITY x
  WHERE NOT EXISTS(SELECT 1 FROM public.shift_assignments a WHERE a.schedule_id=s.id AND a.id::text=x.value->>'id')),'[]'));
 IF normalized IS DISTINCT FROM public.tv3_normalize_source_snapshot_v2(current_input)
  THEN RETURN jsonb_build_object('source_state','CHANGED','source_reason','SOURCE_CHANGED'); END IF;
 RETURN jsonb_build_object('source_state','CURRENT','source_reason',NULL);
END $$;

CREATE FUNCTION public.tv4_schedule_source_state(p_schedule_id uuid,p_branch_id uuid,p_expected_version integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE s public.schedules;
BEGIN
 IF session_user NOT IN ('postgres','supabase_admin') AND coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'FORBIDDEN_CALLER' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.schedules WHERE id=p_schedule_id AND branch_id=p_branch_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'SCHEDULE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF p_expected_version IS NULL OR s.version<>p_expected_version THEN RAISE EXCEPTION 'SCHEDULE_VERSION_CHANGED' USING ERRCODE='40001'; END IF;
 RETURN public.tv4_source_state_v2(s.id);
END $$;

CREATE FUNCTION public.tv4_assert_schedule_checks_v2(p_schedule uuid,p_require_full_coverage boolean) RETURNS void
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
   WHERE (p_require_full_coverage OR r.required_count<(SELECT count(*) FROM public.tv3_existing_coverage_v2(i) v WHERE (v.work_date,v.shift_id,v.department_id)=(r.work_date,r.shift_id,r.department_id))) AND r.required_count<>(SELECT count(*) FROM public.tv3_existing_coverage_v2(i) v
    WHERE (v.work_date,v.shift_id,v.department_id)=(r.work_date,r.shift_id,r.department_id)))
   THEN RAISE EXCEPTION 'COVERAGE_INCOMPLETE'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.tv4_assert_schedule_v2(p_schedule uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM public.tv4_assert_schedule_checks_v2(p_schedule,true);
END $$;

CREATE OR REPLACE FUNCTION public.tv4_transition_schedule_v2(p_schedule_id uuid,p_actor_id uuid,p_expected_version int,
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
 IF to_regclass('public.dev_import_batches') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.dev_import_batches IN SHARE MODE NOWAIT';
  END IF;
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
  -- Replay has already returned above. New workflow actions must use the saved source.
  DECLARE source jsonb; BEGIN
   source:=public.tv4_source_state_v2(s.id);
   IF source->>'source_state' IS DISTINCT FROM 'CURRENT' THEN
    RAISE EXCEPTION '%',coalesce(source->>'source_reason','SOURCE_SNAPSHOT_INVALID') USING ERRCODE='40001';
   END IF;
  END;
  PERFORM public.tv4_assert_schedule_checks_v2(s.id,false);
  UPDATE public.schedules SET status='PENDING_APPROVAL' WHERE id=s.id RETURNING * INTO s;
 ELSIF p_action IN ('APPROVED','NEEDS_REVISION') THEN
  IF s.status<>'PENDING_APPROVAL' THEN RAISE EXCEPTION 'INVALID_SCHEDULE_STATUS'; END IF;
  IF p_action='APPROVED' THEN
  -- Replay has already returned above. New workflow actions must use the saved source.
  DECLARE source jsonb; BEGIN
   source:=public.tv4_source_state_v2(s.id);
   IF source->>'source_state' IS DISTINCT FROM 'CURRENT' THEN
    RAISE EXCEPTION '%',coalesce(source->>'source_reason','SOURCE_SNAPSHOT_INVALID') USING ERRCODE='40001';
   END IF;
  END;
   PERFORM public.tv4_assert_schedule_checks_v2(s.id,false);
  END IF;
  IF p_action='NEEDS_REVISION' AND length(btrim(coalesce(p_reason,'')))=0 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  INSERT INTO public.schedule_approvals(schedule_id,supervisor_id,decision,reason)
   VALUES(s.id,actor.id,p_action,nullif(btrim(p_reason),''));
  UPDATE public.schedules SET status=p_action WHERE id=s.id RETURNING * INTO s;
 ELSE
  IF s.status<>'APPROVED' THEN RAISE EXCEPTION 'INVALID_SCHEDULE_STATUS'; END IF;
  IF p_feedback_deadline_at IS NULL OR p_feedback_deadline_at<clock_timestamp() THEN RAISE EXCEPTION 'INVALID_FEEDBACK_DEADLINE'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.schedule_approvals WHERE schedule_id=s.id AND decision='APPROVED')
    THEN RAISE EXCEPTION 'APPROVAL_REQUIRED'; END IF;
  -- Replay has already returned above. New workflow actions must use the saved source.
  DECLARE source jsonb; BEGIN
   source:=public.tv4_source_state_v2(s.id);
   IF source->>'source_state' IS DISTINCT FROM 'CURRENT' THEN
    RAISE EXCEPTION '%',coalesce(source->>'source_reason','SOURCE_SNAPSHOT_INVALID') USING ERRCODE='40001';
   END IF;
  END;
  PERFORM public.tv4_assert_schedule_checks_v2(s.id,false);
  UPDATE public.schedules SET status='PUBLISHED',published_at=clock_timestamp(),published_by=actor.id,
    feedback_deadline_at=p_feedback_deadline_at WHERE id=s.id RETURNING * INTO s;
  UPDATE public.shift_assignments SET status='ACTIVE' WHERE schedule_id=s.id AND status='DRAFT';
 END IF;
 INSERT INTO public.audit_logs(actor_id,entity_type,entity_id,action,old_data,new_data,change_source)
 VALUES(actor.id,'schedules',s.id,p_action,old_s,jsonb_build_object('rpc_version','tv4.v2',
   'request_id',p_request_id,'workflow_request',fingerprint,'schedule',to_jsonb(s)),'MANUAL');
 RETURN jsonb_build_object('reused',false,'schedule',to_jsonb(s));
END $$;;
ALTER FUNCTION public.tv3_normalize_source_snapshot_v2(jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tv3_normalize_source_snapshot_v2(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.tv4_source_state_v2(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tv4_source_state_v2(uuid) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.tv4_schedule_source_state(uuid,uuid,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tv4_schedule_source_state(uuid,uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION public.tv4_assert_schedule_checks_v2(uuid,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tv4_assert_schedule_checks_v2(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;
DO $acl$ DECLARE f regprocedure; grantee_name text; BEGIN
 FOREACH f IN ARRAY ARRAY['public.tv3_normalize_source_snapshot_v2(jsonb)'::regprocedure,'public.tv4_source_state_v2(uuid)'::regprocedure,'public.tv4_schedule_source_state(uuid,uuid,integer)'::regprocedure,'public.tv4_assert_schedule_checks_v2(uuid,boolean)'::regprocedure] LOOP
  FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=f::oid AND a.grantee<>p.proowner
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f,grantee_name); END LOOP;
 END LOOP;
END $acl$;
GRANT EXECUTE ON FUNCTION public.tv4_schedule_source_state(uuid,uuid,integer) TO service_role;
$ddl$;
END $migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
