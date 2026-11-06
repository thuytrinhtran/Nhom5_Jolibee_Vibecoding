-- LOCAL REVIEW ONLY. Do not apply to shared Supabase without operator approval.
-- Requires TV3 rules v2 and TV4 workflow v2. No data, grants or flags are changed.
-- Preserve every other check, source/snapshot lock, CAS, receipt and audit write.
BEGIN;
SET LOCAL search_path=pg_catalog,public;
DO $migration$
DECLARE f text; needle text;
BEGIN
  f:=replace(pg_get_functiondef('public.tv4_assert_schedule_v2(uuid)'::regprocedure),E'\r\n',E'\n');
  needle:=$block$ IF EXISTS(SELECT 1 FROM jsonb_to_recordset(i->'requirements') r(work_date date,shift_id uuid,department_id uuid,required_count int)
   WHERE r.required_count<>(SELECT count(*) FROM public.tv3_existing_coverage_v2(i) v
    WHERE (v.work_date,v.shift_id,v.department_id)=(r.work_date,r.shift_id,r.department_id)))
   THEN RAISE EXCEPTION 'COVERAGE_INCOMPLETE'; END IF;$block$;
  IF position(needle IN f)=0 THEN RAISE EXCEPTION 'TV4_STAFFING_POLICY_REVIEW_REQUIRED'; END IF;
  EXECUTE replace(f,needle,' -- Staffing counts and experience targets are supervisor warnings.');

  f:=replace(pg_get_functiondef('public.persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text)'::regprocedure),E'\r\n',E'\n');
  needle:=$block$    IF (SELECT count(*) FROM public.shift_assignments WHERE schedule_id=saved.id AND work_date=need.work_date AND shift_id=shift_row.id AND department_id=need.department_id)>need.required_count
      THEN RAISE EXCEPTION 'DEMAND_EXCEEDED' USING ERRCODE='22023'; END IF;$block$;
  IF position(needle IN f)=0 OR position('tv3_result_v2' IN f)=0
    OR position('NEEDS_REVISION' IN f)=0 THEN RAISE EXCEPTION 'TV3_STAFFING_POLICY_REVIEW_REQUIRED'; END IF;
  EXECUTE replace(f,needle,'    -- Excess staffing is retained for supervisor review.');

  f:=replace(pg_get_functiondef('public.tv3_result_v2(jsonb,uuid,jsonb,jsonb)'::regprocedure),E'\r\n',E'\n');
  needle:=$block$ IF EXISTS(SELECT 1 FROM jsonb_array_elements(coverage) c WHERE (c->>'excess_count')::int>0)
  THEN RAISE EXCEPTION 'DEMAND_EXCEEDED' USING ERRCODE='22023'; END IF;$block$;
  IF position(needle IN f)=0 THEN RAISE EXCEPTION 'TV3_RESULT_POLICY_REVIEW_REQUIRED'; END IF;
  f:=replace(f,needle,' -- Persist excess_count as a warning, preserving the verified assignments.');
  needle:=$block$CASE WHEN missing>0 THEN 'STAFFING_SHORTAGE' END,CASE WHEN experienced<target THEN 'EXPERIENCE_SHORTAGE' END$block$;
  IF position(needle IN f)=0 THEN RAISE EXCEPTION 'TV3_WARNING_POLICY_REVIEW_REQUIRED'; END IF;
  f:=replace(f,needle,$block$CASE WHEN missing>0 THEN 'STAFFING_SHORTAGE' END,CASE WHEN n>(r->>'required_count')::int THEN 'STAFFING_EXCESS' END,CASE WHEN experienced<target THEN 'EXPERIENCE_SHORTAGE' END$block$);
  EXECUTE f;
END $migration$;
COMMIT;
