-- Restore only the prior source checker; retain schedules, snapshots and audit history.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $rollback$ BEGIN
 IF ((SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.tv4_source_state_v2(uuid)'))='0f6dfafe9caf2dc68045f31dc0033b25' AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.tv4_source_state_v2(uuid)') AND pg_get_userbyid(proowner)='postgres' AND NOT prosecdef AND provolatile='s' AND NOT proisstrict AND NOT proleakproof AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp','TimeZone=UTC']::text[]) AND NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('public.tv4_source_state_v2(uuid)') AND a.grantee<>p.proowner) AND to_regprocedure('public.tv3_relevant_source_snapshot_v3(jsonb,jsonb)') IS NULL) THEN RETURN; END IF;
 IF NOT ((SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.tv4_source_state_v2(uuid)'))='3f2c9e5b8c5dc77430daa559afac9ebe' AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.tv4_source_state_v2(uuid)') AND pg_get_userbyid(proowner)='postgres' AND NOT prosecdef AND provolatile='s' AND NOT proisstrict AND NOT proleakproof AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp','TimeZone=UTC']::text[]) AND NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('public.tv4_source_state_v2(uuid)') AND a.grantee<>p.proowner) AND (SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.tv3_relevant_source_snapshot_v3(jsonb,jsonb)'))='de82e677563f0b1a7859377efd1280e2' AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.tv3_relevant_source_snapshot_v3(jsonb,jsonb)') AND pg_get_userbyid(proowner)='postgres' AND NOT prosecdef AND provolatile='i' AND NOT proisstrict AND NOT proleakproof AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp','TimeZone=UTC']::text[]) AND NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('public.tv3_relevant_source_snapshot_v3(jsonb,jsonb)') AND a.grantee<>p.proowner)) THEN RAISE EXCEPTION 'SOURCE_RELEVANCE_ROLLBACK_REVIEW_REQUIRED'; END IF;
 EXECUTE $source$CREATE OR REPLACE FUNCTION public.tv4_source_state_v2(p_schedule uuid) RETURNS jsonb
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
END $$;$source$;
 DROP FUNCTION public.tv3_relevant_source_snapshot_v3(jsonb,jsonb);
 IF NOT ((SELECT md5(replace(prosrc,chr(13),'')) FROM pg_proc WHERE oid=to_regprocedure('public.tv4_source_state_v2(uuid)'))='0f6dfafe9caf2dc68045f31dc0033b25' AND EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.tv4_source_state_v2(uuid)') AND pg_get_userbyid(proowner)='postgres' AND NOT prosecdef AND provolatile='s' AND NOT proisstrict AND NOT proleakproof AND proconfig=ARRAY['search_path=pg_catalog, public, pg_temp','TimeZone=UTC']::text[]) AND NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=to_regprocedure('public.tv4_source_state_v2(uuid)') AND a.grantee<>p.proowner) AND to_regprocedure('public.tv3_relevant_source_snapshot_v3(jsonb,jsonb)') IS NULL) THEN RAISE EXCEPTION 'SOURCE_RELEVANCE_ROLLBACK_FAILED'; END IF;
END $rollback$;
NOTIFY pgrst,'reload schema';
COMMIT;
