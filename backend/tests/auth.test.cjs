const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_ENV = 'test';
const app = require('../dist/server.js').default;
const { supabaseAdmin } = require('../dist/config/supabase.js');
const { requireRole } = require('../dist/middleware/auth.middleware.js');

test('Backend HTTP validation, JSON responses and unauthenticated access', async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const cases = [
      ['/api/health', {}, 200],
      ['/api/missing', {}, 404],
      ['/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 400],
      ['/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }, 400],
      ['/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email":123,"password":[]}' }, 400],
      ['/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 400],
      ['/api/auth/me', {}, 401],
      ['/api/auth/logout', { method: 'POST' }, 401],
      ...['employee-only', 'manager-only', 'supervisor-only'].map(role => [`/api/auth/test/${role}`, {}, 401]),
    ];
    for (const [path, options, expected] of cases) {
      const response = await fetch(base + path, options);
      assert.equal(response.status, expected, path);
      assert.match(response.headers.get('content-type'), /application\/json/);
      const data = await response.json();
      assert.ok(data.status);
      if (path.startsWith('/api/auth')) assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('RBAC matrix: each role has access only to its own resource', () => {
  for (const actual of ['NV', 'QL', 'GS']) {
    for (const allowed of ['NV', 'QL', 'GS']) {
      let status, passed = false;
      const res = { status(value) { status = value; return this; }, json() {} };
      requireRole([allowed])({ user: { role: actual, must_change_password: false } }, res, () => { passed = true; });
      assert.equal(passed, actual === allowed);
      if (actual !== allowed) assert.equal(status, 403);
    }
  }
});

test('logout invokes Supabase session revocation with local scope', async () => {
  const original = supabaseAdmin.auth.admin.signOut;
  let calls = 0;
  supabaseAdmin.auth.admin.signOut = async (_credential, scope) => {
    calls++;
    assert.equal(scope, 'local');
    return { error: null };
  };
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/logout`, {
      method: 'POST', headers: { Authorization: 'Bearer isolated-test-placeholder' },
    });
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
  } finally {
    supabaseAdmin.auth.admin.signOut = original;
    await new Promise(resolve => server.close(resolve));
  }
});

// These SDK stubs are in memory only. They never create accounts or database records.
test('login, me, refresh and protected endpoints use the database role', async () => {
  const config = require('../dist/config/supabase.js');
  const original = { createAuthClient: config.createAuthClient, getUser: supabaseAdmin.auth.getUser, from: supabaseAdmin.from };
  let profile = { id: 'in-memory-fixture', username: 'fixture', role: 'NV', branch_id: null, is_active: true, must_change_password: false };
  const session = { access_token: 'isolated-access-placeholder', refresh_token: 'isolated-refresh-placeholder', expires_at: Math.floor(Date.now() / 1000) + 3600 };
  config.createAuthClient = () => ({ auth: {
    signInWithPassword: async () => ({ data: { user: { id: profile.id }, session }, error: null }),
    refreshSession: async () => ({ data: { session }, error: null }),
  } });
  supabaseAdmin.auth.getUser = async () => ({ data: { user: { id: profile.id } }, error: null });
  supabaseAdmin.from = () => ({ select() { return this; }, eq() { return this; },
    single: async () => ({ data: profile, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/auth`;
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer isolated-access-placeholder' };
  try {
    for (const role of ['NV', 'QL', 'GS']) {
      profile.role = role;
      for (const [path, options] of [
        ['/login', { method: 'POST', body: JSON.stringify({ email: 'fixture@example.invalid', password: 'isolated-placeholder', role: 'ADMIN' }) }],
        ['/me', {}],
        ['/refresh', { method: 'POST', body: JSON.stringify({ refresh_token: 'isolated-refresh-placeholder' }) }],
      ]) {
        const response = await fetch(base + path, { ...options, headers });
        assert.equal(response.status, 200, path);
        assert.equal((await response.json()).user.role, role);
      }
      for (const [allowed, endpoint] of [['NV', 'employee-only'], ['QL', 'manager-only'], ['GS', 'supervisor-only']]) {
        const response = await fetch(`${base}/test/${endpoint}`, { headers });
        assert.equal(response.status, role === allowed ? 200 : 403);
      }
    }
    for (const invalid of [{ ...profile, is_active: false }, { ...profile, role: 'ADMIN' }, null]) {
      profile = invalid;
      // Auth identity exists even if the public profile is missing.
      supabaseAdmin.auth.getUser = async () => ({ data: { user: { id: 'in-memory-fixture' } }, error: null });
      const response = await fetch(base + '/me', { headers });
      assert.equal(response.status, 403);
    }
  } finally {
    config.createAuthClient = original.createAuthClient;
    supabaseAdmin.auth.getUser = original.getUser;
    supabaseAdmin.from = original.from;
    await new Promise(resolve => server.close(resolve));
  }
});
