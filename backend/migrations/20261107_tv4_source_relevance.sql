-- Forward-only source comparison fix. No business rows, existing RPC signatures or write grants changed.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $migration$ DECLARE grantee_name text; BEGIN
 IF NOT ((SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.tv3_normalize_source_snapshot_v2(jsonb)'))='85eebb7860165415be93fab9aed9c67b' AND (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text)'))='1ae21e5aec61bdefbd240177dd64532b' AND (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.tv4_transition_schedule_v2(uuid,uuid,integer,text,uuid,text,timestamptz)'))='8fe7a96d03ee0a82ec5d6795e0d7928f') THEN RAISE EXCEPTION 'SOURCE_RELEVANCE_DEPENDENCY_REVIEW_REQUIRED'; END IF;
 IF ((SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.tv4_source_state_v2(uuid)'))='3f2c9e5b8c5dc77430daa559afac9ebe' AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.tv4_source_state_v2(uuid)') AND pg_get_userbyid(proowner)='postgres' AND NOT prosecdef AND provolatile='s' AND NOT proisstrict AND NOT proleakproof AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp','TimeZone=UTC']::text[]) AND NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('public.tv4_source_state_v2(uuid)') AND a.grantee<>p.proowner) AND (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.tv3_relevant_source_snapshot_v3(jsonb,jsonb)'))='de82e677563f0b1a7859377efd1280e2' AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.tv3_relevant_source_snapshot_v3(jsonb,jsonb)') AND pg_get_userbyid(proowner)='postgres' AND NOT prosecdef AND provolatile='i' AND NOT proisstrict AND NOT proleakproof AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp','TimeZone=UTC']::text[]) AND NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('public.tv3_relevant_source_snapshot_v3(jsonb,jsonb)') AND a.grantee<>p.proowner)) THEN RETURN; END IF;
 IF NOT ((SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.tv4_source_state_v2(uuid)'))='0f6dfafe9caf2dc68045f31dc0033b25' AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.tv4_source_state_v2(uuid)') AND pg_get_userbyid(proowner)='postgres' AND NOT prosecdef AND provolatile='s' AND NOT proisstrict AND NOT proleakproof AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp','TimeZone=UTC']::text[]) AND NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('public.tv4_source_state_v2(uuid)') AND a.grantee<>p.proowner) AND to_regprocedure('public.tv3_relevant_source_snapshot_v3(jsonb,jsonb)') IS NULL) THEN RAISE EXCEPTION 'SOURCE_RELEVANCE_REVIEW_REQUIRED'; END IF;
 EXECUTE $projection$CREATE FUNCTION public.tv3_relevant_source_snapshot_v3(p_input jsonb,p_assignments jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public,pg_temp SET timezone='UTC' AS $$
DECLARE normalized jsonb; bookings jsonb; relevant_shifts jsonb; first_day date; last_day date;
BEGIN
 normalized:=public.tv3_normalize_source_snapshot_v2(p_input);
 IF jsonb_typeof(p_assignments) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_SOURCE_SNAPSHOT'; END IF;
 first_day:=(normalized->'period'->>'work_start_date')::date;
 last_day:=(normalized->'period'->>'work_end_date')::date;
 IF last_day<>first_day+6 THEN RAISE EXCEPTION 'INVALID_SOURCE_SNAPSHOT'; END IF;
 WITH shifts AS (
  SELECT * FROM jsonb_to_recordset(normalized->'shifts') s(id uuid,start_time time,end_time time)
 ), own AS (
  SELECT a.employee_id,a.work_date+s.start_time starts,
   a.work_date+s.end_time+CASE WHEN s.end_time<s.start_time THEN interval '1 day' ELSE interval '0' END ends,
   e.max_weekly_hours
  FROM jsonb_to_recordset(p_assignments) a(employee_id uuid,work_date date,shift_id uuid)
  JOIN shifts s ON s.id=a.shift_id
  LEFT JOIN jsonb_to_recordset(normalized->'employees') e(id uuid,max_weekly_hours numeric) ON e.id=a.employee_id
 ), booked AS (
  SELECT x.value item,a.employee_id,a.work_date,
   a.work_date+s.start_time starts,
   a.work_date+s.end_time+CASE WHEN s.end_time<s.start_time THEN interval '1 day' ELSE interval '0' END ends
  FROM jsonb_array_elements(normalized->'existing') x
  CROSS JOIN LATERAL jsonb_to_record(x.value) a(employee_id uuid,work_date date,shift_id uuid)
  LEFT JOIN shifts s ON s.id=a.shift_id
 ) SELECT coalesce(jsonb_agg(item ORDER BY item::text),'[]'::jsonb) INTO bookings FROM booked b
 WHERE b.work_date BETWEEN first_day AND last_day
  OR (b.starts<(last_day+1)::timestamp AND b.ends>first_day::timestamp)
  OR EXISTS(SELECT 1 FROM own a WHERE a.employee_id=b.employee_id AND (
    (b.starts<a.ends AND a.starts<b.ends)
    OR (a.max_weekly_hours IS NOT NULL AND a.ends>(last_day+1)::timestamp
        AND b.starts<(last_day+8)::timestamp AND b.ends>(last_day+1)::timestamp)
  ));
 -- Ignore unrelated shift catalog entries introduced only by a future booking.
 WITH refs AS (
  SELECT r.shift_id FROM jsonb_to_recordset(normalized->'requirements') r(shift_id uuid)
  UNION SELECT r.shift_id FROM jsonb_to_recordset(normalized->'registrations') r(shift_id uuid)
  UNION SELECT r.shift_id FROM jsonb_to_recordset(bookings) r(shift_id uuid)
  UNION SELECT r.shift_id FROM jsonb_to_recordset(p_assignments) r(shift_id uuid)
 ) SELECT coalesce(jsonb_agg(s.value ORDER BY s.value::text),'[]'::jsonb) INTO relevant_shifts
 FROM jsonb_array_elements(normalized->'shifts') s WHERE (s.value->>'id')::uuid IN (SELECT shift_id FROM refs);
 RETURN jsonb_set(jsonb_set(normalized,'{existing}',bookings),'{shifts}',relevant_shifts);
END $$;$projection$;
 EXECUTE $source$CREATE OR REPLACE FUNCTION public.tv4_source_state_v2(p_schedule uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp SET timezone='UTC' AS $$
DECLARE s public.schedules; stored jsonb; current_input jsonb; normalized jsonb; own_assignments jsonb;
BEGIN
 SELECT * INTO STRICT s FROM public.schedules WHERE id=p_schedule;
 SELECT coalesce(jsonb_agg(jsonb_build_object('employee_id',a.employee_id,'work_date',a.work_date,'shift_id',a.shift_id,'department_id',a.department_id) ORDER BY a.id),'[]'::jsonb)
 INTO own_assignments FROM public.shift_assignments a WHERE a.schedule_id=s.id AND a.status<>'REPLACED' AND a.assignment_source='REGULAR';
 SELECT new_data->'source_snapshot' INTO stored FROM public.audit_logs
  WHERE entity_type='schedules' AND entity_id=s.id AND action='AUTO_GENERATE' ORDER BY created_at DESC,id DESC LIMIT 1;
 IF stored IS NULL OR stored='null'::jsonb THEN RETURN jsonb_build_object('source_state','UNKNOWN','source_reason','SOURCE_SNAPSHOT_MISSING'); END IF;
 BEGIN
  normalized:=public.tv3_relevant_source_snapshot_v3(stored,own_assignments);
  IF stored->'period'->>'id' IS DISTINCT FROM s.period_id::text OR stored->'period'->>'branch_id' IS DISTINCT FROM s.branch_id::text
   THEN RAISE EXCEPTION 'INVALID_SOURCE_SNAPSHOT'; END IF;
 EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('source_state','UNKNOWN','source_reason','SOURCE_SNAPSHOT_INVALID'); END;
 current_input:=public.tv3_scheduling_input(s.period_id);
 current_input:=jsonb_set(current_input,'{existing}',coalesce((SELECT jsonb_agg(x.value ORDER BY x.ordinality)
  FROM jsonb_array_elements(current_input->'existing') WITH ORDINALITY x
  WHERE NOT EXISTS(SELECT 1 FROM public.shift_assignments a WHERE a.schedule_id=s.id AND a.id::text=x.value->>'id')),'[]'));
 IF normalized IS DISTINCT FROM public.tv3_relevant_source_snapshot_v3(current_input,own_assignments)
  THEN RETURN jsonb_build_object('source_state','CHANGED','source_reason','SOURCE_CHANGED'); END IF;
 RETURN jsonb_build_object('source_state','CURRENT','source_reason',NULL);
END $$;$source$;
 ALTER FUNCTION public.tv3_relevant_source_snapshot_v3(jsonb,jsonb) OWNER TO postgres;
 REVOKE ALL ON FUNCTION public.tv3_relevant_source_snapshot_v3(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
 FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid='public.tv3_relevant_source_snapshot_v3(jsonb,jsonb)'::regprocedure AND a.grantee<>p.proowner LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION public.tv3_relevant_source_snapshot_v3(jsonb,jsonb) FROM %I',grantee_name);
 END LOOP;
 IF NOT ((SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.tv4_source_state_v2(uuid)'))='3f2c9e5b8c5dc77430daa559afac9ebe' AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.tv4_source_state_v2(uuid)') AND pg_get_userbyid(proowner)='postgres' AND NOT prosecdef AND provolatile='s' AND NOT proisstrict AND NOT proleakproof AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp','TimeZone=UTC']::text[]) AND NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('public.tv4_source_state_v2(uuid)') AND a.grantee<>p.proowner) AND (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.tv3_relevant_source_snapshot_v3(jsonb,jsonb)'))='de82e677563f0b1a7859377efd1280e2' AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.tv3_relevant_source_snapshot_v3(jsonb,jsonb)') AND pg_get_userbyid(proowner)='postgres' AND NOT prosecdef AND provolatile='i' AND NOT proisstrict AND NOT proleakproof AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp','TimeZone=UTC']::text[]) AND NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('public.tv3_relevant_source_snapshot_v3(jsonb,jsonb)') AND a.grantee<>p.proowner)) THEN RAISE EXCEPTION 'SOURCE_RELEVANCE_PATCH_FAILED'; END IF;
END $migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
