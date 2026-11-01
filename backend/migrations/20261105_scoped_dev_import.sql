-- Local only. After TV3/TV4/TV5. Empty registry: default behavior unchanged.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.dev_import_batches (
 batch_id uuid PRIMARY KEY REFERENCES public.audit_logs(id),
 project_ref text NOT NULL CHECK(project_ref='wimikwyuzhltpjciafod'),
 environment text NOT NULL CHECK(environment IN('development','test')),
 branch_id uuid NOT NULL REFERENCES public.branches(id) CHECK(branch_id='11111111-1111-1111-1111-111111111111'),
 period_id uuid NOT NULL REFERENCES public.registration_periods(id) CHECK(period_id='79a979cc-8347-48b5-a411-f03bd8aceb92'),
 enabled boolean NOT NULL DEFAULT false,
 manifest jsonb NOT NULL,
 CHECK(batch_id='6e1d2026-1102-4000-8000-000000000017')
);
ALTER TABLE public.dev_import_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dev_import_batches FROM PUBLIC,anon,authenticated,service_role;
-- Backend cannot approve/import batches. Operator-only executor, no write RPC.
CREATE FUNCTION public.dev_import_context_matches(b public.dev_import_batches) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp SET timezone='UTC' AS $$
 SELECT b.enabled AND coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-jollishift-dev-import','')=
  b.environment||'/'||b.project_ref||'/'||b.batch_id::text
  AND b.manifest->>'environment'=b.environment AND EXISTS(SELECT 1 FROM public.audit_logs a
   WHERE a.id=(b.manifest->>'receipt_id')::uuid AND a.action='DEV_IMPORT_RECEIPT' AND a.new_data->'manifest'=b.manifest)
$$;
CREATE FUNCTION public.dev_import_header_allowed(p_period uuid,p_employee uuid,p_batch uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp SET timezone='UTC' AS $$
 SELECT EXISTS(SELECT 1 FROM public.dev_import_batches b JOIN public.registration_submissions h
  ON h.period_id=b.period_id AND h.employee_id=p_employee AND h.sample_batch_id=b.batch_id
  JOIN public.registration_periods p ON p.id=b.period_id
  WHERE b.batch_id=p_batch AND b.period_id=p_period AND p.branch_id=b.branch_id
   AND p.work_start_date=date '2026-11-02' AND p.work_end_date=date '2026-11-08'
   AND public.dev_import_context_matches(b)
   AND b.manifest->'after_images'->'registration_submissions' @> jsonb_build_array(to_jsonb(h)))
$$;
CREATE FUNCTION public.dev_import_registration_allowed(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp SET timezone='UTC' AS $$
 SELECT EXISTS(SELECT 1 FROM public.shift_registrations r JOIN public.registration_submissions h USING(period_id,employee_id)
  JOIN public.dev_import_batches b ON b.batch_id=h.sample_batch_id AND b.period_id=r.period_id
  WHERE r.id=p_id AND public.dev_import_header_allowed(h.period_id,h.employee_id,h.sample_batch_id)
   AND b.manifest->'after_images'->'shift_registrations' @> jsonb_build_array(to_jsonb(r)))
$$;
-- Preserve exact legacy provenance view, including sample_batch_id and its order.
DO $$ DECLARE d text; BEGIN
 SELECT pg_get_viewdef('public.registration_submissions_sourced'::regclass,true) INTO d;
 EXECUTE 'CREATE OR REPLACE VIEW public.registration_submissions_sourced WITH(security_invoker=true) AS SELECT v.*, public.dev_import_header_allowed(v.period_id,v.employee_id,v.sample_batch_id) dev_import_allowed FROM ('||rtrim(d,E'; \n\r')||') v';
END $$;
CREATE VIEW public.shift_registrations_sourced WITH(security_invoker=true) AS
 SELECT r.*,public.dev_import_registration_allowed(r.id) dev_import_allowed FROM public.shift_registrations r;
REVOKE ALL ON public.registration_submissions_sourced,public.shift_registrations_sourced FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.registration_submissions_sourced,public.shift_registrations_sourced TO service_role;
DO $$ DECLARE f text; BEGIN
 IF (SELECT md5(regexp_replace(replace(prosrc,chr(13),''),'\s+',' ','g')) FROM pg_proc
  WHERE oid=to_regprocedure('public.tv3_scheduling_input(uuid)') AND pg_get_userbyid(proowner)='postgres' AND prosecdef)
  IS DISTINCT FROM '80ec1098f661c668d89acda7a2dfbb25' THEN RAISE EXCEPTION 'TV3_INPUT_CHECKSUM_MISMATCH'; END IF;
 f:=pg_get_functiondef('public.tv3_scheduling_input(uuid)'::regprocedure);
 IF position('tv3.rules.v2' IN f)=0 OR position('h.sample_batch_id IS NULL' IN f)=0 THEN RAISE EXCEPTION 'TV3_INPUT_REVIEW_REQUIRED'; END IF;
 f:=replace(f,'h.sample_batch_id IS NULL','(h.sample_batch_id IS NULL OR h.dev_import_allowed)');
 IF position('WHERE r.period_id=p.id AND r.status=' IN f)=0 THEN RAISE EXCEPTION 'TV3_INPUT_REVIEW_REQUIRED'; END IF;
 f:=replace(f,'WHERE r.period_id=p.id AND r.status=', 'WHERE (h.sample_batch_id IS NULL OR public.dev_import_registration_allowed(r.id)) AND r.period_id=p.id AND r.status=');
 EXECUTE f;
END $$;
DO $$ DECLARE f regprocedure; g name; BEGIN
 FOR f IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN('dev_import_context_matches','dev_import_header_allowed','dev_import_registration_allowed') LOOP
  EXECUTE format('ALTER FUNCTION %s OWNER TO postgres',f);EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f);
  FOR g IN SELECT DISTINCT r.rolname FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a JOIN pg_roles r ON r.oid=a.grantee WHERE p.oid=f::oid AND r.rolname<>'postgres'
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',f,g);END LOOP;
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.dev_import_header_allowed(uuid,uuid,uuid),public.dev_import_registration_allowed(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
