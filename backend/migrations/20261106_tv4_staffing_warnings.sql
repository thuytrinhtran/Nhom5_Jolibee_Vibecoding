-- REVIEW BEFORE APPLY. No schedule/data changes and no new grants.
-- Requires the reviewed TV4 v2 helper from 20261102_tv4_workflow_v2.sql.
-- SUBMIT, APPROVED and PUBLISH share this helper: shortages are advisory at all
-- three steps; assigning above declared demand remains a hard constraint.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $policy$
DECLARE target regprocedure; body_hash text; definition text;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'Apply as trusted postgres owner'; END IF;
 target:=to_regprocedure('public.tv4_assert_schedule_v2(uuid)');
 SELECT md5(regexp_replace(replace(p.prosrc,chr(13),''),'\s+',' ','g')),pg_get_functiondef(p.oid)
 INTO body_hash,definition FROM pg_proc p
 WHERE p.oid=target AND pg_get_userbyid(p.proowner)='postgres' AND NOT p.prosecdef;
 IF body_hash='7d27134c34212ad0920647934fe0a5ea' THEN RETURN; END IF;
 IF body_hash IS DISTINCT FROM '67c725836fb9b441d34fa56e60eead74'
 THEN RAISE EXCEPTION 'TV4_STAFFING_POLICY_REVIEW_REQUIRED: inspect helper definition before applying'; END IF;
 -- Change only the coverage lower bound. Preserve upper bound, authorization,
 -- eligibility, required skills, overlap/hours, locks, versions, audit and ACL.
 definition:=replace(definition,'r.required_count<>','r.required_count<');
 definition:=replace(definition,'RAISE EXCEPTION ''COVERAGE_INCOMPLETE''','RAISE EXCEPTION ''DEMAND_EXCEEDED''');
 EXECUTE definition;
END;
$policy$;
NOTIFY pgrst,'reload schema';
COMMIT;
