-- OPTIONAL CLEANUP, SEPARATE APPROVAL REQUIRED. No SQL has been run by Codex.
-- Prepend in the SAME SQL Editor Run using sample_batch_id returned by file 03:
-- SET app.tv3_sample_batch_id='UUID_OF_APPROVED_SAMPLE_BATCH';
-- Removes only unchanged rows still owned by that sample batch.
-- Genuine self-service save clears sample_batch_id: those headers/rows are preserved.
-- Never deletes employees, Auth, shifts, periods or immutable audit history.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SELECT pg_advisory_xact_lock(72910453);
CREATE TEMP TABLE tv3_cleanup_batch ON COMMIT DROP AS
SELECT a.id,a.new_data FROM public.audit_logs a
WHERE a.id=nullif(current_setting('app.tv3_sample_batch_id',true),'')::uuid
 AND a.action='TV3_SAMPLE_SEED' AND a.actor_id IS NULL AND a.change_source='SYSTEM'
 AND a.new_data->>'is_sample'='true';
DO $guard$ BEGIN
 IF (SELECT count(*) FROM tv3_cleanup_batch)<>1 THEN RAISE EXCEPTION 'Provide a valid approved TV3 sample_batch_id from file 03; no data deleted.'; END IF;
 PERFORM 1 FROM public.registration_periods p WHERE EXISTS(SELECT 1 FROM public.registration_submissions h JOIN tv3_cleanup_batch b ON b.id=h.sample_batch_id WHERE h.period_id=p.id) ORDER BY p.id FOR UPDATE;
END $guard$;
LOCK TABLE public.registration_submissions,public.shift_registrations IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE tv3_cleanup_headers ON COMMIT DROP AS
SELECT h.* FROM public.registration_submissions h JOIN tv3_cleanup_batch b ON b.id=h.sample_batch_id;
DO $fingerprints$ BEGIN
 IF EXISTS(SELECT 1 FROM tv3_cleanup_headers h CROSS JOIN tv3_cleanup_batch b
  WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(b.new_data->'headers') AS items(value) WHERE items.value=to_jsonb(h))) THEN
  RAISE EXCEPTION 'Sample header has changed; stop for review, no data deleted.';
 END IF;
 IF EXISTS(SELECT 1 FROM public.shift_registrations r JOIN tv3_cleanup_headers h ON h.period_id=r.period_id AND h.employee_id=r.employee_id CROSS JOIN tv3_cleanup_batch b
  WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(b.new_data->'registrations') AS items(value) WHERE items.value=to_jsonb(r))) THEN
  RAISE EXCEPTION 'Sample preferences have changed; stop for review, no data deleted.';
 END IF;
END $fingerprints$;
DELETE FROM public.shift_registrations r USING tv3_cleanup_headers h
WHERE r.period_id=h.period_id AND r.employee_id=h.employee_id;
DELETE FROM public.registration_submissions h USING tv3_cleanup_headers owned,tv3_cleanup_batch b
WHERE h.period_id=owned.period_id AND h.employee_id=owned.employee_id AND h.sample_batch_id=b.id;
INSERT INTO public.audit_logs(actor_id,entity_type,entity_id,action,new_data,change_source)
SELECT NULL,'tv2_sample_batch',b.id,'TV3_SAMPLE_CLEANUP',jsonb_build_object('sample_batch_id',b.id,'removed_headers',(SELECT count(*) FROM tv3_cleanup_headers),'genuine_data_preserved',true),'SYSTEM'
FROM tv3_cleanup_batch b;
SELECT b.id AS sample_batch_id,(SELECT count(*) FROM tv3_cleanup_headers) AS removed_sample_headers,
 (SELECT count(*) FROM public.registration_submissions h WHERE h.sample_batch_id=b.id) AS remaining_owned_headers
FROM tv3_cleanup_batch b;
COMMIT;
