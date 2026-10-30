-- TV4 workflow operations. Additive and transactional; run only after reviewing
-- the installed schema and coordinating version creation with TV3.
BEGIN;
SET LOCAL search_path = pg_catalog, public;

-- Keep existing data. The new field is nullable because schedules can exist
-- before publication. If a prior partial rollout created the column, verify
-- its type and repair a missing FK without replacing any existing constraint.
DO $tv4_published_by$
DECLARE
  v_type oid;
  v_not_null boolean;
  v_column smallint;
  v_user_id smallint;
  v_fk_name name;
BEGIN
  IF pg_catalog.to_regclass('public.schedules') IS NULL OR pg_catalog.to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'TV4 requires public.schedules and public.users';
  END IF;

  SELECT a.atttypid, a.attnotnull, a.attnum
    INTO v_type, v_not_null, v_column
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.schedules'::pg_catalog.regclass
    AND a.attname = 'published_by'
    AND a.attnum > 0 AND NOT a.attisdropped;

  IF NOT FOUND THEN
    ALTER TABLE public.schedules ADD COLUMN published_by uuid;
    SELECT a.atttypid, a.attnotnull, a.attnum
      INTO v_type, v_not_null, v_column
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.schedules'::pg_catalog.regclass
      AND a.attname = 'published_by'
      AND a.attnum > 0 AND NOT a.attisdropped;
  ELSIF v_type <> 'uuid'::pg_catalog.regtype OR v_not_null THEN
    RAISE EXCEPTION 'public.schedules.published_by must be nullable uuid';
  END IF;

  SELECT a.attnum INTO v_user_id
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = 'public.users'::pg_catalog.regclass
    AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'public.users.id is required for published_by';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.schedules'::pg_catalog.regclass
      AND c.contype = 'f'
      AND c.conkey = ARRAY[v_column]::smallint[]
      AND c.confrelid = 'public.users'::pg_catalog.regclass
      AND c.confkey = ARRAY[v_user_id]::smallint[]
      AND c.confupdtype = 'a' AND c.confdeltype = 'a'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = 'public.schedules'::pg_catalog.regclass
        AND c.contype = 'f'
        AND v_column = ANY(c.conkey)
    ) THEN
      RAISE EXCEPTION 'public.schedules.published_by has a conflicting foreign key; review it manually';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint c
      WHERE c.conrelid = 'public.schedules'::pg_catalog.regclass
        AND c.conname = 'tv4_schedules_published_by_fkey'
    ) THEN
      RAISE EXCEPTION 'Constraint tv4_schedules_published_by_fkey exists with a different definition';
    END IF;
    ALTER TABLE public.schedules
      ADD CONSTRAINT tv4_schedules_published_by_fkey
      FOREIGN KEY (published_by) REFERENCES public.users(id) NOT VALID;
  END IF;

  -- Validate every matching NOT VALID constraint, including one left by an
  -- earlier partial rollout. Existing orphan values abort the transaction.
  FOR v_fk_name IN
    SELECT c.conname FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.schedules'::pg_catalog.regclass
      AND c.contype = 'f'
      AND c.conkey = ARRAY[v_column]::smallint[]
      AND c.confrelid = 'public.users'::pg_catalog.regclass
      AND c.confkey = ARRAY[v_user_id]::smallint[]
      AND c.confupdtype = 'a' AND c.confdeltype = 'a'
      AND NOT c.convalidated
  LOOP
    EXECUTE pg_catalog.format('ALTER TABLE public.schedules VALIDATE CONSTRAINT %I', v_fk_name);
  END LOOP;
END;
$tv4_published_by$;

CREATE OR REPLACE FUNCTION public.tv4_decide_schedule(
  p_schedule_id uuid,
  p_actor_id uuid,
  p_decision varchar,
  p_reason text DEFAULT NULL
) RETURNS public.schedules
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_schedule public.schedules;
  v_role varchar;
BEGIN
  -- The existing schema uses NEEDS_REVISION as the rejection decision/status.
  -- Do not introduce REJECTED: schedule_approvals and schedules both constrain
  -- their values to the current NEEDS_REVISION convention.
  IF p_decision IS NULL OR p_decision NOT IN ('APPROVED', 'NEEDS_REVISION') THEN
    RAISE EXCEPTION 'INVALID_DECISION';
  END IF;
  IF p_decision = 'NEEDS_REVISION' AND length(btrim(coalesce(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  SELECT role INTO v_role
  FROM public.users WHERE id = p_actor_id AND is_active = true;
  IF coalesce(v_role, '') <> 'GS' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  SELECT * INTO v_schedule
  FROM public.schedules WHERE id = p_schedule_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SCHEDULE_NOT_FOUND'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.branches
    WHERE id = v_schedule.branch_id AND supervisor_id = p_actor_id
  ) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF v_schedule.status <> 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'INVALID_SCHEDULE_STATUS';
  END IF;
  -- This is a point-in-time stale-version check, not serialization against a
  -- concurrent TV3 INSERT. TV3's version-creation path is absent from this repo;
  -- inspect and coordinate both paths before applying this migration.
  IF EXISTS (
    SELECT 1 FROM public.schedules newer
    WHERE newer.schedule_group_id = v_schedule.schedule_group_id
      AND newer.version > v_schedule.version
  ) THEN RAISE EXCEPTION 'STALE_SCHEDULE_VERSION'; END IF;

  -- The schema's BEFORE INSERT trigger requires PENDING_APPROVAL. The status
  -- trigger then requires an APPROVED history row before this transition.
  -- Insert first, update second. Both changes belong to this RPC transaction;
  -- an exception from either trigger rolls both back.
  INSERT INTO public.schedule_approvals(schedule_id, supervisor_id, decision, reason)
  VALUES (
    p_schedule_id,
    p_actor_id,
    p_decision,
    CASE WHEN p_decision = 'NEEDS_REVISION' THEN nullif(btrim(p_reason), '') ELSE NULL END
  );

  UPDATE public.schedules
  SET status = p_decision
  WHERE id = p_schedule_id
  RETURNING * INTO v_schedule;
  RETURN v_schedule;
END;
$$;

CREATE OR REPLACE FUNCTION public.tv4_publish_schedule(
  p_schedule_id uuid,
  p_actor_id uuid,
  p_feedback_deadline_at timestamptz
) RETURNS public.schedules
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_schedule public.schedules;
  v_role varchar;
BEGIN
  SELECT role INTO v_role
  FROM public.users WHERE id = p_actor_id AND is_active = true;
  IF coalesce(v_role, '') <> 'QL' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  SELECT * INTO v_schedule
  FROM public.schedules WHERE id = p_schedule_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SCHEDULE_NOT_FOUND'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_actor_id AND branch_id = v_schedule.branch_id AND is_active = true
  ) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF v_schedule.status <> 'APPROVED' THEN RAISE EXCEPTION 'INVALID_SCHEDULE_STATUS'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.schedules newer
    WHERE newer.schedule_group_id = v_schedule.schedule_group_id
      AND newer.version > v_schedule.version
  ) THEN RAISE EXCEPTION 'STALE_SCHEDULE_VERSION'; END IF;
  IF p_feedback_deadline_at IS NULL OR p_feedback_deadline_at < now() THEN
    RAISE EXCEPTION 'INVALID_FEEDBACK_DEADLINE';
  END IF;

  UPDATE public.schedules
  SET status = 'PUBLISHED', published_at = now(), published_by = p_actor_id,
      feedback_deadline_at = p_feedback_deadline_at
  WHERE id = p_schedule_id
  RETURNING * INTO v_schedule;
  UPDATE public.shift_assignments
  SET status = 'ACTIVE'
  WHERE schedule_id = p_schedule_id AND status = 'DRAFT';
  RETURN v_schedule;
END;
$$;

-- Supabase SQL Editor runs this as postgres. Pin SECURITY DEFINER ownership to
-- this trusted role and remove any retained direct grants except service_role.
ALTER FUNCTION public.tv4_decide_schedule(uuid, uuid, varchar, text) OWNER TO postgres;
ALTER FUNCTION public.tv4_publish_schedule(uuid, uuid, timestamptz) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.tv4_decide_schedule(uuid, uuid, varchar, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tv4_publish_schedule(uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tv4_decide_schedule(uuid, uuid, varchar, text) FROM service_role;
REVOKE ALL ON FUNCTION public.tv4_publish_schedule(uuid, uuid, timestamptz) FROM service_role;

DO $tv4_function_acl$
DECLARE
  v_function oid;
  v_grantee name;
  v_function_name name;
  v_arguments text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'Supabase service_role is required';
  END IF;

  FOREACH v_function IN ARRAY ARRAY[
    'public.tv4_decide_schedule(uuid,uuid,character varying,text)'::pg_catalog.regprocedure::oid,
    'public.tv4_publish_schedule(uuid,uuid,timestamp with time zone)'::pg_catalog.regprocedure::oid
  ] LOOP
    SELECT p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)
      INTO v_function_name, v_arguments
    FROM pg_catalog.pg_proc p WHERE p.oid = v_function;

    FOR v_grantee IN
      SELECT DISTINCT r.rolname
      FROM pg_catalog.pg_proc p
      CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
      JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
      WHERE p.oid = v_function
        AND a.grantee <> p.proowner
        AND r.rolname <> 'service_role'
    LOOP
      EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION public.%I(%s) FROM %I',
        v_function_name, v_arguments, v_grantee);
    END LOOP;
  END LOOP;
END;
$tv4_function_acl$;

GRANT EXECUTE ON FUNCTION public.tv4_decide_schedule(uuid, uuid, varchar, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.tv4_publish_schedule(uuid, uuid, timestamptz) TO service_role;

COMMIT;
