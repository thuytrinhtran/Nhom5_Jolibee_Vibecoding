-- REVIEW ONLY. Apply manually after approval; never executed by application startup.
BEGIN;
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
COMMIT;
