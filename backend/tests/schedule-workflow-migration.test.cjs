const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(path.join(__dirname, '../migrations/20261029_tv4_schedule_workflow.sql'), 'utf8');
const schema = fs.readFileSync(path.join(__dirname, '../../docs/Jollishift.sql'), 'utf8');

function functionBody(name) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0, `Expected migration function ${name}`);
  const bodyStart = migration.indexOf('AS $$', start);
  const bodyEnd = migration.indexOf('$$;', bodyStart + 5);
  assert.ok(bodyStart >= 0 && bodyEnd > bodyStart, `Expected function body for ${name}`);
  return migration.slice(bodyStart + 5, bodyEnd);
}

test('TV4 migration is wrapped in one transaction and preserves a nullable UUID publisher FK', () => {
  assert.match(migration, /^BEGIN;$/m);
  assert.match(migration, /COMMIT;\s*$/);
  assert.match(migration, /published_by uuid/i);
  assert.match(migration, /v_type <> 'uuid'::(?:pg_catalog\.)?regtype OR v_not_null/);
  assert.match(migration, /FOREIGN KEY \(published_by\) REFERENCES public\.users\(id\) NOT VALID/);
  assert.match(migration, /AND NOT c\.convalidated[\s\S]*?VALIDATE CONSTRAINT %I/);
  assert.match(migration, /c\.confupdtype = 'a' AND c\.confdeltype = 'a'/);
});

test('decision history is inserted while pending before the status transition required by existing triggers', () => {
  const decision = functionBody('tv4_decide_schedule');
  const insertAt = decision.indexOf('INSERT INTO public.schedule_approvals');
  const updateAt = decision.indexOf('UPDATE public.schedules');
  assert.ok(insertAt >= 0 && updateAt > insertAt, 'decision history must precede status update');
  assert.match(schema, /validate_schedule_approval[\s\S]*?v_status IS DISTINCT FROM 'PENDING_APPROVAL'/);
  assert.match(schema, /validate_schedule_publish[\s\S]*?last_decision IS DISTINCT FROM 'APPROVED'/);
});

test('rejection uses the existing NEEDS_REVISION value and requires a nonblank reason', () => {
  const decision = functionBody('tv4_decide_schedule');
  assert.match(schema, /decision IN \('APPROVED', 'NEEDS_REVISION'\)/);
  assert.match(schema, /status IN \('DRAFT', 'PENDING_APPROVAL', 'NEEDS_REVISION'/);
  assert.match(decision, /p_decision = 'NEEDS_REVISION'[\s\S]*?length\(btrim\(coalesce\(p_reason, ''\)\)\) = 0/);
  assert.match(decision, /CASE WHEN p_decision = 'NEEDS_REVISION' THEN nullif\(btrim\(p_reason\), ''\)/);
  assert.doesNotMatch(decision, /'REJECTED'/);
});

test('decision guards enforce role, assigned branch, pending state, row lock and observed newer versions', () => {
  const decision = functionBody('tv4_decide_schedule');
  assert.match(decision, /v_role, ''\) <> 'GS'/);
  assert.match(decision, /supervisor_id = p_actor_id/);
  assert.match(decision, /FOR UPDATE/);
  assert.match(decision, /v_schedule\.status <> 'PENDING_APPROVAL'/);
  assert.match(decision, /newer\.version > v_schedule\.version/);
});

test('publication requires an in-scope QL and approved current version, then activates assignments', () => {
  const publish = functionBody('tv4_publish_schedule');
  assert.match(publish, /v_role, ''\) <> 'QL'/);
  assert.match(publish, /branch_id = v_schedule\.branch_id/);
  assert.match(publish, /v_schedule\.status <> 'APPROVED'/);
  assert.match(publish, /newer\.version > v_schedule\.version/);
  assert.match(publish, /published_by = p_actor_id/);
  assert.match(publish, /UPDATE public\.shift_assignments[\s\S]*?status = 'ACTIVE'[\s\S]*?status = 'DRAFT'/);
});

test('SECURITY DEFINER functions use a pinned search path and only grant direct execute to service_role', () => {
  assert.equal((migration.match(/SECURITY DEFINER SET search_path = pg_catalog/g) || []).length, 2);
  assert.equal((migration.match(/OWNER TO postgres/g) || []).length, 2);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.tv4_decide_schedule[\s\S]*?FROM PUBLIC/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.tv4_publish_schedule[\s\S]*?FROM PUBLIC/);
  assert.equal((migration.match(/GRANT EXECUTE ON FUNCTION/g) || []).length, 2);
  assert.match(migration, /TO service_role/);
});
