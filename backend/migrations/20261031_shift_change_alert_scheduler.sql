-- PREPARED ONLY. Review and apply manually on the isolated Supabase TEST project.
-- Applying this file ACTIVATES one Cron job; no bootstrap call, seed or external request.
-- First enable pg_cron in Integrations > Cron. Never install/drop extensions or touch other jobs here.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(72910561);

DO $guard$ BEGIN
  IF current_user<>'postgres' THEN RAISE EXCEPTION 'TV5 scheduler installation requires postgres'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name='pg_cron') THEN
    RAISE EXCEPTION 'pg_cron is not available on this server; stop and review Supabase configuration';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    RAISE EXCEPTION 'Enable pg_cron in the TEST project before installing TV5 scheduler';
  END IF;
  IF to_regclass('cron.job') IS NULL OR to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Compatible Supabase Cron catalog/schedule function is required';
  END IF;
  IF to_regprocedure('public.tv5_alert_due(uuid)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.tv5_alert_due(uuid)')
      AND proowner=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND prosecdef
  ) THEN RAISE EXCEPTION 'Apply reviewed TV5 workflow migration first'; END IF;
END $guard$;

-- Only the postgres-owned Cron job may call this entry point. No actor or clock from clients.
CREATE FUNCTION public.tv5_run_shift_change_alerts()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='1s' AS $$
BEGIN
  RETURN jsonb_build_object('notifications_created',public.tv5_alert_due(NULL));
END;
$$;
ALTER FUNCTION public.tv5_run_shift_change_alerts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tv5_run_shift_change_alerts() FROM PUBLIC,anon,authenticated,service_role;

-- A named schedule can overwrite an existing job: refuse collisions instead.
DO $job$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='tv5-shift-change-t60-alerts') THEN
    RAISE EXCEPTION 'TV5 job name already exists; inspect it instead of overwriting';
  END IF;
END $job$;
SELECT cron.schedule('tv5-shift-change-t60-alerts','* * * * *',
  'SELECT public.tv5_run_shift_change_alerts();');
COMMIT;
