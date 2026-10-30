-- PREPARED ONLY: execute manually after review in jollishift-tv2-test.
-- TARGET: https://wimikwyuzhltpjciafod.supabase.co (project ref wimikwyuzhltpjciafod).
-- SQL does not connect/switch project. Check the Dashboard URL before every Run.
-- Never run against the shared project. Apply this file once; stop on any error.
-- SOURCE: backend/migrations/20261029_require_password_change.sql
BEGIN;
DO $tv2_guard$ BEGIN
 IF to_regclass('public.tv2_test_installation') IS NULL THEN RAISE EXCEPTION 'Run this TEST bundle step 01 first; wrong/uninitialized project.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tv2_test_installation WHERE step='01' AND project_ref='wimikwyuzhltpjciafod' AND source_sha256='6520546beb231ba3377968f5a61c122a2a051867e4bbb34f774918e7abd4b4c2')
 THEN RAISE EXCEPTION 'STOP: prerequisite 01 or its checksum/project marker does not match this bundle.'; END IF;
 IF EXISTS(SELECT 1 FROM public.tv2_test_installation WHERE step='02') THEN RAISE EXCEPTION 'Step 02 already applied. Inspect existing data; do not rerun.'; END IF;
END $tv2_guard$;
-- REVIEW ONLY. Apply manually after approval; never executed by application startup.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_reset_id uuid;

CREATE OR REPLACE FUNCTION public.guard_password_change_state()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND (NEW.must_change_password OR NEW.password_reset_id IS NOT NULL))
     OR (TG_OP = 'UPDATE' AND
       (NEW.must_change_password IS DISTINCT FROM OLD.must_change_password
        OR NEW.password_reset_id IS DISTINCT FROM OLD.password_reset_id)) THEN
    IF COALESCE(auth.role(), '') <> 'service_role'
       AND NOT (COALESCE(auth.role(), '') = '' AND current_user IN ('postgres','supabase_admin')) THEN
      RAISE EXCEPTION 'Only trusted backend may modify password change state' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_password_change_state() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_password_change_state ON public.users;
CREATE TRIGGER guard_password_change_state BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.guard_password_change_state();

-- SECURITY DEFINER avoids recursive RLS when checking public.users itself.
CREATE OR REPLACE FUNCTION public.jollishift_business_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.is_active AND NOT u.must_change_password);
$$;
REVOKE ALL ON FUNCTION public.jollishift_business_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jollishift_business_access() TO authenticated;

-- Restrictive policies combine with existing policies using AND, never grant new access.
-- Service role still bypasses RLS; Express must enforce the same condition on every business API.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['branches','users','departments','employees','employee_skills',
    'shifts','registration_periods','shift_registrations','staffing_requirements','schedules',
    'shift_assignments','schedule_approvals','shift_change_requests','replacement_invitations',
    'incidents','branch_support_requests','notifications','audit_logs','warning_configs',
    'crew_leader_days_off','ai_schedule_evaluations','ai_schedule_suggestions'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS password_change_gate ON public.%I', t);
      EXECUTE format('CREATE POLICY password_change_gate ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.jollishift_business_access()) WITH CHECK (public.jollishift_business_access())', t);
    END IF;
  END LOOP;
END $$;
INSERT INTO public.tv2_test_installation(step,project_ref,source_sha256) VALUES('02','wimikwyuzhltpjciafod','fee1a57e7e8ff8a97ba8b93841d11ab784e2b89bfd21ceec77537db81adf9582');
COMMIT;
