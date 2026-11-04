-- Incremental, after 20261105. No data/index/existing permission changes.
-- Verify immutable receipt ONCE per source snapshot, not once per registration.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Match executor after-images in UTC without changing API timestamp rendering.
-- This helper only serializes its supplied value; it performs no table read.
CREATE FUNCTION public.dev_import_utc_image(p_row anyelement) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp SET timezone='UTC'
AS $$ SELECT to_jsonb(p_row) $$;
ALTER FUNCTION public.dev_import_utc_image(anyelement) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.dev_import_utc_image(anyelement) FROM PUBLIC,anon,authenticated,service_role;
DO $migration$
DECLARE f text; prefix text;
BEGIN
 IF (SELECT md5(regexp_replace(replace(prosrc,chr(13),''),'\s+',' ','g'))
     FROM pg_proc WHERE oid=to_regprocedure('public.tv3_scheduling_input(uuid)')
      AND pg_get_userbyid(proowner)='postgres' AND prosecdef)
    IS DISTINCT FROM 'ef26158ddf7291344ac48c768fc1998d' THEN
   RAISE EXCEPTION 'TV3_INPUT_CHECKSUM_MISMATCH';
 END IF;
 f:=replace(pg_get_functiondef('public.tv3_scheduling_input(uuid)'::regprocedure),chr(13),'');
 prefix:=$cte$
 WITH approved_batches AS MATERIALIZED (
   SELECT b.* FROM public.dev_import_batches b
   WHERE b.period_id=p.id AND b.branch_id=p.branch_id
    AND p.work_start_date=date '2026-11-02' AND p.work_end_date=date '2026-11-08'
    AND public.dev_import_context_matches(b)
 ), approved_headers AS MATERIALIZED (
   SELECT h.period_id,h.employee_id,h.sample_batch_id,b.manifest
   FROM approved_batches b JOIN public.registration_submissions h
    ON h.period_id=b.period_id AND h.sample_batch_id=b.batch_id
   WHERE b.manifest->'after_images'->'registration_submissions' @> jsonb_build_array(public.dev_import_utc_image(h))
 ), approved_rows AS MATERIALIZED (
   SELECT r.id FROM public.shift_registrations r JOIN approved_headers h USING(period_id,employee_id)
   WHERE h.manifest->'after_images'->'shift_registrations' @> jsonb_build_array(public.dev_import_utc_image(r))
 )
 SELECT jsonb_build_object(
    'rule_version'$cte$;
 IF position(E'SELECT jsonb_build_object(\n    ''rule_version''' IN f)=0
   OR position('h.dev_import_allowed' IN f)=0
   OR position('public.dev_import_registration_allowed(r.id)' IN f)=0 THEN
   RAISE EXCEPTION 'TV3_INPUT_REVIEW_REQUIRED';
 END IF;
 f:=replace(f,E'SELECT jsonb_build_object(\n    ''rule_version''',prefix);
 f:=replace(f,'h.dev_import_allowed',
  'EXISTS(SELECT 1 FROM approved_headers ah WHERE ah.period_id=h.period_id AND ah.employee_id=h.employee_id AND ah.sample_batch_id=h.sample_batch_id)');
 f:=replace(f,'public.dev_import_registration_allowed(r.id)',
  'EXISTS(SELECT 1 FROM approved_rows ar WHERE ar.id=r.id)');
 EXECUTE f;
END;
$migration$;
NOTIFY pgrst,'reload schema';
COMMIT;
