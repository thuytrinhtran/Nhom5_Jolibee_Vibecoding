// Generates a reviewable additive migration locally. Never connects to a database.
const fs = require('node:fs'), path = require('node:path');
const { saveFunction } = require('./prepare-tv2-official.cjs');
const root = path.resolve(__dirname, '../..');
const rpc = saveFunction();
const oldGuard = "p.status <> 'OPEN' OR clock_timestamp() < p.open_at OR clock_timestamp() >= p.close_at";
if (!rpc.sql.includes(oldGuard)) throw Error('Save RPC changed; review generator.');
const newRpc = rpc.sql.replace(oldGuard, "public.registration_effective_status(p.open_at,p.close_at,clock_timestamp()) <> 'OPEN'");
const crypto = require('node:crypto');
const body = /AS \$\$([\s\S]*?)\$\$;/.exec(newRpc)[1].trim();
const hashes = [...new Set([...rpc.knownBodyMd5, crypto.createHash('md5').update(body).digest('hex')])];
const sql = `-- PREPARED ONLY: review before applying to official Supabase. No status/data backfill.
-- Replaces manual 05_repair_friday_registration.sql. Do not run legacy Thursday bundle.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(72910453);

-- Pure rule shared by save RPC and TV3 view. No client-supplied clock is used by saves.
CREATE OR REPLACE FUNCTION public.registration_effective_status(p_open timestamptz,p_close timestamptz,p_now timestamptz)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT CASE WHEN p_open>=p_close THEN 'CLOSED' WHEN p_now<p_open THEN 'PLANNED'
 WHEN p_now<p_close THEN 'OPEN' ELSE 'CLOSED' END
$$;
REVOKE ALL ON FUNCTION public.registration_effective_status(timestamptz,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.registration_effective_status(timestamptz,timestamptz,timestamptz) TO service_role;

ALTER TABLE public.registration_submissions ADD COLUMN IF NOT EXISTS sample_batch_id uuid REFERENCES public.audit_logs(id);
DO $shape$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='registration_submissions'
 AND column_name='sample_batch_id' AND udt_name='uuid' AND is_nullable='YES') THEN RAISE EXCEPTION 'Unexpected provenance column'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint k JOIN pg_attribute a ON a.attrelid=k.conrelid AND k.conkey=ARRAY[a.attnum]::smallint[]
 JOIN pg_attribute b ON b.attrelid=k.confrelid AND k.confkey=ARRAY[b.attnum]::smallint[]
 WHERE k.conrelid='public.registration_submissions'::regclass AND k.contype='f' AND k.convalidated
 AND a.attname='sample_batch_id' AND k.confrelid='public.audit_logs'::regclass AND b.attname='id')
 THEN RAISE EXCEPTION 'Provenance FK missing; review schema'; END IF;
END $shape$;

-- Refuse to overwrite unreviewed deployed code/overloads. Read pg_get_functiondef first if rejected.
DO $rpc_guard$ BEGIN
 IF to_regprocedure('public.save_employee_registration(uuid,uuid,jsonb,boolean)') IS NULL
 OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='save_employee_registration' AND
 (p.oid <> to_regprocedure('public.save_employee_registration(uuid,uuid,jsonb,boolean)')
 OR pg_get_userbyid(p.proowner) NOT IN ('postgres','supabase_admin')
 OR p.proargnames IS DISTINCT FROM ARRAY['p_user','p_period','p_preferences','p_submit']::text[]
 OR md5(btrim(replace(p.prosrc,chr(13),''),chr(10)||chr(9)||' ')) NOT IN (${hashes.map(h=>`'${h}'`).join(',')})))
 THEN RAISE EXCEPTION 'Unknown save RPC; stop for review'; END IF;
END $rpc_guard$;
${newRpc}

-- Only the server role can read this view; TV3 must still filter by authorized branch.
CREATE OR REPLACE VIEW public.registration_periods_effective WITH (security_invoker=true) AS
 SELECT p.id,p.branch_id,p.work_start_date,p.work_end_date,p.open_at,p.close_at,p.created_at,
 p.status AS stored_status,public.registration_effective_status(p.open_at,p.close_at,statement_timestamp()) AS status
 FROM public.registration_periods p;
REVOKE ALL ON public.registration_periods_effective FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.registration_periods_effective TO service_role;

-- Preserve legacy fixtures without updating historical headers. Only the exact audited v2
-- fixture, unchanged header timestamp and original employee list qualify as a legacy sample.
CREATE OR REPLACE VIEW public.registration_submissions_sourced WITH (security_invoker=true) AS
 SELECT h.period_id,h.employee_id,h.status,h.errors,h.submitted_at,h.updated_at,
 coalesce(h.sample_batch_id,legacy.id) AS sample_batch_id,h.sample_batch_id AS stored_sample_batch_id
 FROM public.registration_submissions h
 LEFT JOIN LATERAL (SELECT a.id FROM public.audit_logs a
 WHERE a.entity_id=h.period_id AND a.action='TV2_TEST_SEED' AND a.change_source='SYSTEM' AND a.actor_id IS NULL
 AND a.new_data->>'fixture'='tv2-test-week-20261026-v1' AND a.new_data->>'synthetic'='true'
 AND a.new_data->'employee_ids' @> jsonb_build_array(h.employee_id)
 AND h.status='VALID' AND h.errors='[]'::jsonb
 AND h.submitted_at=timestamptz '2026-10-24 10:00+07' AND h.updated_at<=a.created_at
 ORDER BY a.created_at LIMIT 1) legacy ON h.sample_batch_id IS NULL;
REVOKE ALL ON public.registration_submissions_sourced FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.registration_submissions_sourced TO service_role;

-- Friday policy for FUTURE period creation only. Existing period timestamps/data stay untouched.
DO $config$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.registration_schedule_config WHERE singleton AND timezone='Asia/Ho_Chi_Minh')
 THEN RAISE EXCEPTION 'Missing Vietnam schedule config'; END IF;
END $config$;
UPDATE public.registration_schedule_config SET open_iso_day=5,open_local_time=time '15:00',close_iso_day=7,close_local_time=time '12:00'
WHERE singleton AND (open_iso_day,open_local_time,close_iso_day,close_local_time) IS DISTINCT FROM (5,time '15:00',7,time '12:00');
${fs.readFileSync(path.join(__dirname,'tv2-period-scheduler.sql.template'),'utf8')}
NOTIFY pgrst,'reload schema';
COMMIT;
`;
const target = path.join(root,'backend/migrations/20261030_registration_effective_state.sql');
fs.writeFileSync(target,sql);
console.log('Prepared time-state migration locally; no database changes.');
