-- READ ONLY. Run in Supabase SQL Editor before approving/provisioning.
SELECT table_name, column_name, data_type, is_nullable, column_default,
       character_maximum_length
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('branches','departments','users','employees')
ORDER BY table_name, ordinal_position;

SELECT c.conrelid::regclass AS table_name, c.conname, c.contype,
       pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
WHERE c.conrelid IN ('public.branches'::regclass, 'public.departments'::regclass,
                    'public.users'::regclass, 'public.employees'::regclass)
ORDER BY c.conrelid::regclass::text, c.conname;

-- Inspect auth.users triggers as Admin API creation can invoke custom triggers.
-- Do not disable/change triggers automatically. Review compatibility first.
SELECT t.tgrelid::regclass AS table_name, t.tgname,
       pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
WHERE NOT t.tgisinternal
  AND t.tgrelid IN ('auth.users'::regclass, 'public.branches'::regclass,
                    'public.departments'::regclass, 'public.users'::regclass,
                    'public.employees'::regclass)
ORDER BY t.tgrelid::regclass::text, t.tgname;
