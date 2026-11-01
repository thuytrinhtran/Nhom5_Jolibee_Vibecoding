-- LOCAL / REVIEW BEFORE APPLY. No seed, no Auth changes, no enable-persistence switch.
-- The remainder of this migration replaces only the audited TV3 function bodies.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $guard$
DECLARE entry record; actual text;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'Apply as trusted postgres owner'; END IF;
 FOR entry IN SELECT * FROM (VALUES
  ('public.tv3_scheduling_input(uuid)','cd4e4b5440ae3f1a38567d7dd0acf8b9'),
  ('public.persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text)','f3dfa0c40d77478ab317079fc68405e6'),
  ('public.generate_schedule_draft(uuid,uuid,jsonb,jsonb)','477fbe0785dcdbd85cd7cdf1dc600509')
 ) expected(signature,checksum) LOOP
  SELECT md5(regexp_replace(replace(p.prosrc,chr(13),''),'\s+',' ','g')) INTO actual
    FROM pg_proc p WHERE p.oid=to_regprocedure(entry.signature) AND pg_get_userbyid(p.proowner)='postgres';
  IF actual IS DISTINCT FROM entry.checksum THEN RAISE EXCEPTION 'Unknown TV3 function %, inspect before replacing',entry.signature; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid=to_regprocedure(entry.signature) AND
     (NOT p.prosecdef OR a.grantee=0 OR pg_get_userbyid(a.grantee) NOT IN ('postgres','service_role')
      OR (entry.signature='public.tv3_scheduling_input(uuid)' AND pg_get_userbyid(a.grantee)<>'postgres')))
    THEN RAISE EXCEPTION 'Unknown TV3 EXECUTE ACL %, inspect before replacing',entry.signature; END IF;
 END LOOP;
END $guard$;

-- Same week clipping and fixed eligible employee population as the TS objective.
CREATE FUNCTION public.tv3_balance_v2(p_input jsonb,p_assignments jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 WITH employees AS (
  SELECT * FROM jsonb_to_recordset(p_input->'employees') AS e(id uuid,department_id uuid,status text,is_active boolean,role text,skill_level text)
  WHERE status='ACTIVE' AND is_active AND role='NV' AND skill_level IN ('NEW','REGULAR','CREW_TRAINING')
 ), bookings AS (
  SELECT DISTINCT employee_id,work_date,shift_id,department_id FROM jsonb_to_recordset(COALESCE(p_input->'existing','[]')||p_assignments)
   AS b(employee_id uuid,work_date date,shift_id uuid,department_id uuid)
 ), intervals AS (
  SELECT b.employee_id,b.work_date+s.start_time AS a,
   b.work_date+s.end_time+CASE WHEN s.end_time<s.start_time THEN interval '1 day' ELSE interval '0' END AS z
  FROM bookings b JOIN jsonb_to_recordset(p_input->'shifts') AS s(id uuid,start_time time,end_time time) ON s.id=b.shift_id
 ), hours AS (
  SELECT e.id,e.department_id,COALESCE(sum(CASE WHEN i.employee_id IS NULL THEN 0 ELSE EXTRACT(epoch FROM greatest(interval '0',
   least(i.z,(p_input->'period'->>'work_start_date')::date+interval '7 days')-
   greatest(i.a,(p_input->'period'->>'work_start_date')::date::timestamp))) END)/3600,0) h
  FROM employees e LEFT JOIN intervals i ON i.employee_id=e.id GROUP BY e.id,e.department_id
 ), averages AS (SELECT department_id,count(*) n,sum(h) total,avg(h) mean FROM hours GROUP BY department_id),
 scores AS (
  SELECT a.department_id,a.n,a.total,a.mean,sum((h.h-a.mean)^2) score
  FROM averages a JOIN hours h USING(department_id) GROUP BY a.department_id,a.n,a.total,a.mean
 ) SELECT jsonb_build_object('objective',COALESCE(sum(score),0),'departments',COALESCE(jsonb_agg(jsonb_build_object(
   'department_id',department_id,'employee_count',n,'total_hours',total,'mean_hours',mean,'squared_deviation',score)
   ORDER BY department_id),'[]'::jsonb)) FROM scores;
$$;

-- Existing bookings are blockers regardless of coverage; only independently valid
-- rows in a declared cell count towards demand. Logical duplicates count once.
CREATE FUNCTION public.tv3_existing_coverage_v2(p_input jsonb)
RETURNS TABLE(employee_id uuid,work_date date,shift_id uuid,department_id uuid)
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 WITH booked AS (
  SELECT DISTINCT b.employee_id,b.work_date,b.shift_id,b.department_id,
   b.work_date+s.start_time a,b.work_date+s.end_time+
    CASE WHEN s.end_time<s.start_time THEN interval '1 day' ELSE interval '0' END z
  FROM jsonb_to_recordset(p_input->'existing') AS b(employee_id uuid,work_date date,shift_id uuid,department_id uuid)
  JOIN public.shifts s ON s.id=b.shift_id
 ) SELECT b.employee_id,b.work_date,b.shift_id,b.department_id FROM booked b
 JOIN public.employees e ON e.id=b.employee_id JOIN public.users u ON u.id=e.user_id
 JOIN public.shifts s ON s.id=b.shift_id
 JOIN jsonb_to_recordset(p_input->'requirements') AS r(department_id uuid,work_date date,shift_id uuid,required_skill_name text)
  ON (r.department_id,r.work_date,r.shift_id)=(b.department_id,b.work_date,b.shift_id)
 WHERE b.work_date BETWEEN (p_input->'period'->>'work_start_date')::date AND (p_input->'period'->>'work_end_date')::date
  AND e.status='ACTIVE' AND e.skill_level IN ('NEW','REGULAR','CREW_TRAINING') AND u.is_active AND u.role='NV'
  AND e.branch_id=(p_input->'period'->>'branch_id')::uuid AND u.branch_id=e.branch_id AND e.department_id=b.department_id
  AND s.is_active AND (s.branch_id IS NULL OR s.branch_id=e.branch_id) AND s.start_time<>s.end_time
  AND (r.required_skill_name IS NULL OR EXISTS(SELECT 1 FROM public.employee_skills k WHERE k.employee_id=e.id AND k.skill_name=r.required_skill_name))
  AND EXISTS(SELECT 1 FROM jsonb_to_recordset(p_input->'registrations') AS x(employee_id uuid,work_date date,shift_id uuid,status text)
   WHERE (x.employee_id,x.work_date,x.shift_id)=(b.employee_id,b.work_date,b.shift_id) AND x.status='VALID')
  AND NOT EXISTS(SELECT 1 FROM booked o WHERE o.employee_id=b.employee_id
   AND (o.employee_id,o.work_date,o.shift_id,o.department_id)<>(b.employee_id,b.work_date,b.shift_id,b.department_id)
   AND o.a<b.z AND b.a<o.z)
  AND (e.max_weekly_hours IS NULL OR NOT EXISTS(
   SELECT 1 FROM generate_series((p_input->'period'->>'work_start_date')::timestamp,b.z,interval '7 days') w
   WHERE (SELECT COALESCE(sum(EXTRACT(epoch FROM greatest(interval '0',least(o.z,w+interval '7 days')-greatest(o.a,w)))),0)/3600
    FROM booked o WHERE o.employee_id=e.id)>e.max_weekly_hours));
$$;

CREATE FUNCTION public.tv3_result_v2(p_input jsonb,p_schedule uuid,p_verified jsonb,p_supplied jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE coverage jsonb; stats jsonb; after_balance jsonb; before_balance jsonb;
 initial_plan jsonb; optimization jsonb; item jsonb; history jsonb; event jsonb; prior uuid;
BEGIN
 -- Verified assignments have already passed the locked RPC's hard checks.
 SELECT COALESCE(jsonb_agg(jsonb_build_object('employee_id',a->'selection_history'->'initial'->>'employee_id',
  'work_date',a->>'work_date','shift_id',a->>'shift_id','department_id',a->>'department_id')),'[]')
 INTO initial_plan FROM jsonb_array_elements(p_verified) a;
 FOR item IN SELECT value FROM jsonb_array_elements(p_verified) LOOP
  history:=item->'selection_history';
  IF jsonb_typeof(history->'initial') IS DISTINCT FROM 'object' OR jsonb_typeof(history->'replacements') IS DISTINCT FROM 'array'
   THEN RAISE EXCEPTION 'INVALID_SELECTION_HISTORY' USING ERRCODE='22023'; END IF;
  prior:=(history->'initial'->>'employee_id')::uuid;
  IF prior IS NULL THEN RAISE EXCEPTION 'INVALID_SELECTION_HISTORY' USING ERRCODE='22023'; END IF;
  FOR event IN SELECT value FROM jsonb_array_elements(history->'replacements') LOOP
   IF jsonb_typeof(event->'objective_after') IS DISTINCT FROM 'number' OR jsonb_typeof(event->'objective_before') IS DISTINCT FROM 'number'
    OR (event->>'from_employee_id')::uuid IS DISTINCT FROM prior OR (event->>'to_employee_id') IS NULL
    OR NOT ((event->>'objective_after')::numeric<(event->>'objective_before')::numeric)
    THEN RAISE EXCEPTION 'INVALID_SELECTION_HISTORY' USING ERRCODE='22023'; END IF;
   prior:=(event->>'to_employee_id')::uuid;
  END LOOP;
  IF prior IS DISTINCT FROM (item->>'employee_id')::uuid THEN RAISE EXCEPTION 'INVALID_SELECTION_HISTORY' USING ERRCODE='22023'; END IF;
 END LOOP;
 WITH old_rows AS (SELECT * FROM public.tv3_existing_coverage_v2(p_input)),
 new_rows AS (SELECT employee_id,work_date,shift_id,department_id FROM public.shift_assignments WHERE schedule_id=p_schedule),
 all_rows AS (SELECT * FROM old_rows UNION SELECT * FROM new_rows),
 counts AS (
  SELECT r.value r,count(a.employee_id) n,count(a.employee_id) FILTER(WHERE e.skill_level IN ('REGULAR','CREW_TRAINING')) experienced,
   (SELECT count(*) FROM old_rows o WHERE o.work_date=(r.value->>'work_date')::date AND o.shift_id=(r.value->>'shift_id')::uuid AND o.department_id=(r.value->>'department_id')::uuid) old_count,
   (SELECT count(*) FROM new_rows o WHERE o.work_date=(r.value->>'work_date')::date AND o.shift_id=(r.value->>'shift_id')::uuid AND o.department_id=(r.value->>'department_id')::uuid) new_count
  FROM jsonb_array_elements(p_input->'requirements') r LEFT JOIN all_rows a
   ON a.work_date=(r.value->>'work_date')::date AND a.shift_id=(r.value->>'shift_id')::uuid AND a.department_id=(r.value->>'department_id')::uuid
  LEFT JOIN public.employees e ON e.id=a.employee_id GROUP BY r.value
 ), cells AS (SELECT *,least(2,(r->>'required_count')::int) target,greatest(0,(r->>'required_count')::int-n) missing FROM counts)
 SELECT COALESCE(jsonb_agg(r||jsonb_build_object('assigned_count',n,'new_assigned_count',new_count,'existing_count',old_count,
  'missing_count',missing,'excess_count',greatest(0,n-(r->>'required_count')::int),'experienced_target',target,
  'experienced_count',experienced,'missing_experienced_count',greatest(0,target-experienced),
  'composition_status',CASE WHEN experienced<target THEN 'SHORTAGE' ELSE 'PASS' END,
  'warning',CASE WHEN experienced<target THEN 'EXPERIENCE_SHORTAGE' END,
  'warnings',to_jsonb(array_remove(ARRAY[CASE WHEN missing>0 THEN 'STAFFING_SHORTAGE' END,CASE WHEN experienced<target THEN 'EXPERIENCE_SHORTAGE' END],NULL)))
  ORDER BY r->>'work_date',r->>'shift_id',r->>'department_id'),'[]') INTO coverage FROM cells;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(coverage) c WHERE (c->>'excess_count')::int>0)
  THEN RAISE EXCEPTION 'DEMAND_EXCEEDED' USING ERRCODE='22023'; END IF;
 -- Same fixed employee population and same total hours as the engine.
 WITH bookings AS (
  SELECT DISTINCT employee_id,work_date,shift_id,department_id FROM jsonb_to_recordset((p_input->'existing')||p_verified)
   AS b(employee_id uuid,work_date date,shift_id uuid,department_id uuid)
 ) SELECT COALESCE(jsonb_agg(jsonb_build_object('employee_id',e.id,
  'shift_count',(SELECT count(*) FROM public.shift_assignments a WHERE a.schedule_id=p_schedule AND a.employee_id=e.id),
  'existing_shift_count',(SELECT count(*) FROM (SELECT DISTINCT employee_id,work_date,shift_id,department_id FROM jsonb_to_recordset(p_input->'existing') AS x(employee_id uuid,work_date date,shift_id uuid,department_id uuid)) x
    WHERE x.employee_id=e.id AND x.work_date BETWEEN (p_input->'period'->>'work_start_date')::date AND (p_input->'period'->>'work_end_date')::date),
  'holiday_shift_count',(SELECT count(*) FROM bookings b WHERE b.employee_id=e.id
    AND b.work_date BETWEEN (p_input->'period'->>'work_start_date')::date AND (p_input->'period'->>'work_end_date')::date
    AND b.work_date::text IN (SELECT jsonb_array_elements_text(p_input->'holiday_dates'))),
  'total_weekly_hours',(SELECT COALESCE(sum(EXTRACT(epoch FROM greatest(interval '0',
    least(b.work_date+s.end_time+CASE WHEN s.end_time<s.start_time THEN interval '1 day' ELSE interval '0' END,(p_input->'period'->>'work_start_date')::date+interval '7 days')-
    greatest(b.work_date+s.start_time,(p_input->'period'->>'work_start_date')::date::timestamp)))),0)/3600
   FROM bookings b JOIN public.shifts s ON s.id=b.shift_id WHERE b.employee_id=e.id)) ORDER BY e.id),'[]') INTO stats
 FROM public.employees e JOIN public.users u ON u.id=e.user_id WHERE e.branch_id=(p_input->'period'->>'branch_id')::uuid
 AND e.status='ACTIVE' AND u.is_active AND u.role='NV' AND u.branch_id=e.branch_id AND e.skill_level IN ('NEW','REGULAR','CREW_TRAINING');
 after_balance:=public.tv3_balance_v2(p_input,p_verified);
 before_balance:=public.tv3_balance_v2(p_input,initial_plan);
 optimization:=p_supplied->'optimization';
 IF optimization IS NOT NULL AND optimization<>'null'::jsonb THEN
  IF jsonb_typeof(optimization->'after'->'objective') IS DISTINCT FROM 'number'
   OR jsonb_typeof(optimization->'before'->'objective') IS DISTINCT FROM 'number'
   OR abs((optimization->'after'->>'objective')::numeric-(after_balance->>'objective')::numeric)>0.0000001
   OR abs((optimization->'before'->>'objective')::numeric-(before_balance->>'objective')::numeric)>0.0000001
   OR (after_balance->>'objective')::numeric>(before_balance->>'objective')::numeric+0.0000001
   THEN RAISE EXCEPTION 'INVALID_OPTIMIZATION_METRICS' USING ERRCODE='22023'; END IF;
  optimization:=optimization||jsonb_build_object('before',before_balance,'after',after_balance);
 END IF;
 RETURN jsonb_build_object('rule_version','tv3.rules.v2','plan_origin',COALESCE(p_supplied->>'plan_origin','SERVER_VALIDATED'),
  'assignments',p_verified,'coverage',coverage,'shortages',COALESCE((SELECT jsonb_agg(c) FROM jsonb_array_elements(coverage) c WHERE (c->>'missing_count')::int>0),'[]'),
  'composition_shortages',COALESCE((SELECT jsonb_agg(c) FROM jsonb_array_elements(coverage) c WHERE (c->>'missing_experienced_count')::int>0),'[]'),
  'assigned_count',jsonb_array_length(p_verified),'covered_count',(SELECT sum((c->>'assigned_count')::int) FROM jsonb_array_elements(coverage) c),
  'existing_count',(SELECT count(*) FROM public.tv3_existing_coverage_v2(p_input)),
  'required_count',(SELECT sum((c->>'required_count')::int) FROM jsonb_array_elements(coverage) c),'employee_statistics',stats,
  'new_employee_count_threshold',p_input->'new_employee_count_threshold','optimization',optimization,
  'registration_provenance',p_input->'registration_provenance',
  'notes',jsonb_build_array('Coverage includes valid existing work; assignments contains only new work.','Local search uses strict descent, not a global optimality guarantee.'));
END;
$$;

CREATE OR REPLACE FUNCTION public.tv3_scheduling_input(p_period_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE p public.registration_periods; v jsonb;
BEGIN
  SELECT * INTO STRICT p FROM public.registration_periods WHERE id=p_period_id;
  SELECT jsonb_build_object(
    'rule_version','tv3.rules.v2','holiday_dates','[]'::jsonb,
    'registration_provenance',COALESCE((SELECT jsonb_agg(jsonb_build_object('employee_id',h.employee_id,'batch_id',h.sample_batch_id,'submitted_at',h.submitted_at,'updated_at',h.updated_at) ORDER BY h.employee_id)
      FROM public.registration_submissions_sourced h JOIN public.employees e ON e.id=h.employee_id JOIN public.users u ON u.id=e.user_id
      WHERE h.period_id=p.id AND h.status='VALID' AND h.submitted_at IS NOT NULL AND h.sample_batch_id IS NULL
       AND e.branch_id=p.branch_id AND e.status='ACTIVE' AND e.skill_level<>'CREW_LEADER' AND u.role='NV' AND u.is_active AND u.branch_id=e.branch_id),'[]'::jsonb),
    'period',jsonb_build_object('id',p.id,'branch_id',p.branch_id,'work_start_date',p.work_start_date,
      'work_end_date',p.work_end_date,'status',public.registration_effective_status(p.open_at,p.close_at,statement_timestamp())),
    'employees',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'department_id',e.department_id,
      'employee_code',u.username,'skill_level',e.skill_level,'status',e.status,'is_active',u.is_active AND u.branch_id=e.branch_id,
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
    'existing',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'employee_id',a.employee_id,'work_date',a.work_date,'shift_id',a.shift_id,'department_id',a.department_id) ORDER BY a.id)
      FROM public.shift_assignments a JOIN public.employees e ON e.id=a.employee_id WHERE e.branch_id=p.branch_id AND a.status<>'REPLACED'
        AND a.work_date BETWEEN p.work_start_date-1 AND p.work_end_date+7),'[]'::jsonb),
    'new_employee_count_threshold',(SELECT w.new_employee_count_threshold FROM public.warning_configs w WHERE w.branch_id=p.branch_id)
  ) INTO v;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.persist_schedule_draft(p_period_id uuid,p_actor_id uuid,p_snapshot jsonb DEFAULT NULL,p_result jsonb DEFAULT NULL,
  p_schedule_id uuid DEFAULT NULL,p_expected_version integer DEFAULT NULL,p_request_id uuid DEFAULT NULL,p_fingerprint text DEFAULT NULL)
-- PostgREST must hoist statement_timeout before the main RPC statement starts.
-- Setting it only inside a running function cannot bound a slow SQL/trigger.
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp SET lock_timeout = '5s' SET statement_timeout = '5s' AS $$
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
    IF target.status<>'DRAFT' THEN RAISE EXCEPTION 'DRAFT_LOCKED' USING ERRCODE='40001'; END IF;
    IF p_expected_version IS NULL OR target.version<>p_expected_version OR EXISTS(
      SELECT 1 FROM public.schedules WHERE period_id=p.id AND (version>target.version OR schedule_group_id<>target.schedule_group_id OR status<>'DRAFT'))
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
$$;

CREATE OR REPLACE FUNCTION public.generate_schedule_draft(p_period_id uuid,p_actor_id uuid,p_snapshot jsonb DEFAULT NULL,p_result jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp SET statement_timeout='5s' AS $$
  SELECT public.persist_schedule_draft(p_period_id,p_actor_id,p_snapshot,p_result);
$$;

REVOKE ALL ON FUNCTION public.tv3_balance_v2(jsonb,jsonb),public.tv3_existing_coverage_v2(jsonb),public.tv3_result_v2(jsonb,uuid,jsonb,jsonb),public.tv3_scheduling_input(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text),public.generate_schedule_draft(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text),public.generate_schedule_draft(uuid,uuid,jsonb,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
