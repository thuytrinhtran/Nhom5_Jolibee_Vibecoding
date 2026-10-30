const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY ||= 'isolated-test-placeholder';

const app = require('../dist/server.js').default;
const { supabaseAdmin: db } = require('../dist/config/supabase.js');

const actorId = '00000000-0000-4000-8000-000000000001';
const branchId = '00000000-0000-4000-8000-000000000002';
const otherBranchId = '00000000-0000-4000-8000-000000000003';
const scheduleId = '00000000-0000-4000-8000-000000000004';
const assignmentId = '00000000-0000-4000-8000-000000000005';
const shiftId = '00000000-0000-4000-8000-000000000006';

test('TV4 resubmit validates request and scope, then returns not configured without writes', async () => {
  const original = { getUser: db.auth.getUser, from: db.from, rpc: db.rpc };
  let role = 'QL';
  let actorBranchId = branchId;
  let scheduleBranchId = branchId;
  const queries = [];
  const writes = [];
  const rpcCalls = [];

  db.auth.getUser = async () => ({ data: { user: { id: actorId } }, error: null });
  db.rpc = async (...args) => { rpcCalls.push(args[0]); throw new Error('RPC must not be called by validation-only endpoint'); };
  db.from = table => {
    const query = { table, filters: [], columns: null };
    queries.push(query);
    const chain = {
      select(columns) { query.columns = columns; return this; },
      eq(column, value) { query.filters.push([column, value]); return this; },
      single: async () => ({
        data: table === 'users'
          ? { id: actorId, username: 'fixture-manager', role, branch_id: actorBranchId, is_active: true, must_change_password: false }
          : table === 'branches' ? { name: 'Test Branch' } : null,
        error: null,
      }),
      maybeSingle: async () => ({
        data: table === 'schedules' ? { id: scheduleId, branch_id: scheduleBranchId } : null,
        error: null,
      }),
      insert() { writes.push(`${table}.insert`); return this; },
      update() { writes.push(`${table}.update`); return this; },
      upsert() { writes.push(`${table}.upsert`); return this; },
      delete() { writes.push(`${table}.delete`); return this; },
    };
    return chain;
  };

  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/schedules/workflow/${scheduleId}/resubmit`;
  const validBody = {
    expected_version: 2,
    adjustment_note: 'Đã điều chỉnh ca theo góp ý.',
    assignments: [{ source_assignment_id: assignmentId, shift_id: shiftId }],
  };
  const post = (body, token = 'fixture-session') => fetch(url, {
    method: 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  try {
    assert.equal((await post(validBody, null)).status, 401, 'missing session must be rejected');

    role = 'NV';
    assert.equal((await post(validBody)).status, 403, 'non-QL role must be rejected');

    role = 'QL';
    actorBranchId = null;
    const missingBranch = await post(validBody);
    assert.equal(missingBranch.status, 403, 'QL without assigned branch must be rejected');
    assert.equal((await missingBranch.json()).code, 'FORBIDDEN');
    actorBranchId = branchId;

    const invalidCases = [
      [{ ...validBody, expected_version: '2' }, 400, 'INVALID_RESUBMIT_REQUEST'],
      [{ ...validBody, adjustment_note: '  ' }, 422, 'ADJUSTMENT_NOTE_REQUIRED'],
      [{ ...validBody, assignments: [] }, 422, 'INVALID_ASSIGNMENTS'],
      [{ ...validBody, assignments: [{ source_assignment_id: assignmentId, shift_id: shiftId }, { source_assignment_id: assignmentId, shift_id: shiftId }] }, 422, 'INVALID_ASSIGNMENTS'],
      [{ ...validBody, assignments: [{ source_assignment_id: 'not-a-uuid', shift_id: shiftId }] }, 422, 'INVALID_ASSIGNMENTS'],
    ];
    for (const [body, status, code] of invalidCases) {
      const response = await post(body);
      assert.equal(response.status, status);
      assert.equal((await response.json()).code, code);
    }

    scheduleBranchId = otherBranchId;
    const outOfScope = await post(validBody);
    assert.equal(outOfScope.status, 403, 'QL must not resubmit a schedule from another branch');
    assert.equal((await outOfScope.json()).code, 'FORBIDDEN');

    scheduleBranchId = branchId;
    const configured = await post(validBody);
    assert.equal(configured.status, 501);
    assert.equal((await configured.json()).code, 'RESUBMIT_NOT_CONFIGURED');
    assert.ok(queries.some(query => query.table === 'schedules'
      && query.filters.some(([column, value]) => column === 'id' && value === scheduleId)));
    assert.ok(queries.some(query => query.table === 'users'
      && query.filters.some(([column, value]) => column === 'id' && value === actorId)));
    assert.deepEqual(writes, [], 'endpoint must not invoke Supabase write methods');
    assert.deepEqual(rpcCalls, [], 'endpoint must not invoke an unverified RPC');
  } finally {
    db.auth.getUser = original.getUser;
    db.from = original.from;
    db.rpc = original.rpc;
    await new Promise(resolve => server.close(resolve));
  }
});
