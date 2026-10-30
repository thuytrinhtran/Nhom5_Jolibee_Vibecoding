-- APPROVAL REQUIRED. Run ONCE as postgres after the final additive migration.
-- Enable Supabase Cron/pg_cron through Dashboard first. No keys, network or localhost.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(72910455);
DO $guard$ BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'Activation must run as postgres'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN RAISE EXCEPTION 'Enable Supabase Cron before activation'; END IF;
 IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='tv2-create-registration-periods' AND
 (command<>'SELECT public.tv2_ensure_registration_periods();' OR username<>current_user OR database<>current_database()))
 THEN RAISE EXCEPTION 'Existing job differs; review before activation'; END IF;
 -- Never enable the old automation: it includes notification/reminder behavior.
 IF EXISTS(SELECT 1 FROM public.registration_automation_config WHERE enabled)
 THEN RAISE EXCEPTION 'Legacy automation enabled; review and disable separately'; END IF;
END $guard$;
-- Bootstrap creates the next four weeks immediately without touching existing periods.
SELECT public.tv2_ensure_registration_periods();
SELECT cron.schedule('tv2-create-registration-periods','7 * * * *',
 'SELECT public.tv2_ensure_registration_periods();');
COMMIT;
-- Hourly UTC execution is sufficient because periods exist weeks before their opening.
-- Opening/closing uses timestamps, not the cron tick. Named job replay does not duplicate it.
