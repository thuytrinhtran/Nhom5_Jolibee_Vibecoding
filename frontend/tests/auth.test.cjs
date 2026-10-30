const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function service(fetch, env = {}) {
  const source = fs.readFileSync('src/services/auth.service.ts', 'utf8').replace('import.meta.env', JSON.stringify(env));
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const memory = new Map();
  const context = { exports: {}, fetch, AbortSignal, Response, localStorage: {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: key => memory.delete(key),
  } };
  vm.runInNewContext(code, context);
  return { ...context.exports, memory };
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

test('empty/HTML responses and network failure produce actionable errors', async () => {
  for (const body of ['', '<html>proxy error</html>']) {
    const { authService } = service(async () => new Response(body, { status: 502 }));
    await assert.rejects(authService.login('', ''), error => error.status === 502 && !error.message.includes('Unexpected'));
  }
  const { authService } = service(async () => { throw new TypeError('network'); });
  await assert.rejects(authService.login('', ''), error => error.status === 0);
});

test('configured API URL is used and invalid login is never persisted', async () => {
  let url;
  const { authService, memory } = service(async input => { url = input; return json({ status: 'error', message: 'denied' }, 401); }, { VITE_API_URL: 'http://localhost:5000/api/' });
  await assert.rejects(authService.login('', ''), /denied/);
  assert.equal(url, 'http://localhost:5000/api/auth/login');
  assert.equal(memory.size, 0);
});

test('temporary API failure preserves session, rejected session clears credentials', async () => {
  for (const status of [503, 401, 403]) {
    const { authService, memory } = service(async () => json({ status: 'error', message: 'unavailable' }, status));
    memory.set('jollishift_access_token', 'isolated-placeholder');
    await assert.rejects(authService.getMe());
    assert.equal(memory.has('jollishift_access_token'), status === 503);
  }
});

test('logout clears all local session data even when server is unavailable', async () => {
  const { authService, memory } = service(async () => { throw new Error('offline'); });
  memory.set('jollishift_access_token', 'isolated-placeholder');
  memory.set('jollishift_refresh_token', 'isolated-placeholder');
  await assert.rejects(authService.logout());
  assert.equal(memory.size, 0);
});

test('concurrent restoration refreshes once when the session has expired', async () => {
  let refreshes = 0;
  const { authService, memory } = service(async path => {
    if (path.endsWith('/refresh')) {
      refreshes++;
      await new Promise(resolve => setTimeout(resolve, 10));
      return json({ status: 'error', message: 'expired' }, 401);
    }
    throw new Error('unexpected request');
  });
  memory.set('jollishift_access_token', 'isolated-placeholder');
  memory.set('jollishift_refresh_token', 'isolated-placeholder');
  memory.set('jollishift_expires_at', '1');
  const results = await Promise.allSettled([authService.getMe(), authService.getMe()]);
  assert.equal(refreshes, 1);
  assert.ok(results.every(result => result.status === 'rejected'));
  assert.equal(memory.size, 0);
});

// Profiles below exist only as in-memory HTTP fixtures; no accounts or DB rows are created.
test('login, reload restoration and refresh rotation validate the API profile', async () => {
  for (const role of ['NV', 'QL', 'GS']) {
    const profile = { id: 'in-memory-fixture', username: 'fixture', role, is_active: true, must_change_password: false };
    let refreshes = 0;
    const { authService, memory } = service(async path => {
      if (path.endsWith('/me')) return json({ status: 'ok', user: profile });
      if (path.endsWith('/refresh')) refreshes++;
      return json({ status: 'ok', user: profile, access_token: 'isolated-placeholder', refresh_token: 'rotated-placeholder', expires_at: Math.floor(Date.now() / 1000) + 3600 });
    });
    assert.equal((await authService.login('', '')).user.role, role);
    assert.equal((await authService.getMe()).role, role);
    memory.set('jollishift_expires_at', '1');
    assert.equal((await authService.getMe()).role, role);
    assert.equal(refreshes, 1);
    assert.equal(memory.get('jollishift_refresh_token'), 'rotated-placeholder');
  }
});

test('unsupported or inactive profiles cannot establish a frontend session', async () => {
  for (const user of [{ role: 'ADMIN', is_active: true, must_change_password: false }, { role: 'NV', is_active: false }]) {
    const { authService, memory } = service(async () => json({ status: 'ok', user }));
    await assert.rejects(authService.login('', ''), error => error.status === 403);
    assert.equal(memory.size, 0);
  }
});

const fixture = { id: 'fixture', username: 'fixture', role: 'NV', is_active: true, must_change_password: false };
const session = { status: 'ok', user: fixture, access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_at: 9999999999 };
test('body read timeout is normalized as ApiError without clearing credentials', async () => {
  const { authService, ApiError, memory } = service(async () => ({ text: async () => { throw new DOMException('timeout', 'TimeoutError'); } }));
  memory.set('jollishift_access_token', 'fixture');
  await assert.rejects(authService.getMe(), e => e instanceof ApiError && e.status === 0);
  assert.equal(memory.size, 1);
});

test('refresh transport errors and throttling preserve session', async () => {
  for (const status of [503, 429]) {
    const { authService, memory } = service(async () => json({ status: 'error' }, status));
    memory.set('jollishift_access_token', 'fixture');
    memory.set('jollishift_refresh_token', 'fixture');
    memory.set('jollishift_expires_at', '1');
    await assert.rejects(authService.getMe(), e => e.status === status);
    assert.equal(memory.size, 3);
  }
});

test('late login cannot restore a session after logout', async () => {
  let resolve;
  const { authService, memory } = service(() => new Promise(r => { resolve = r; }));
  const login = authService.login('', '');
  await authService.logout();
  resolve(json(session));
  await assert.rejects(login, e => e.code === 'SESSION_CHANGED');
  assert.equal(memory.size, 0);
});

test('old profile success or 401 cannot affect a newer login', async () => {
  for (const status of [200, 401]) {
    let resolve;
    const { authService, memory } = service(path => path.endsWith('/me')
      ? new Promise(r => { resolve = r; }) : Promise.resolve(json(session)));
    memory.set('jollishift_access_token', 'old');
    const old = authService.getMe();
    await authService.login('', '');
    resolve(json({ status: 'ok', user: fixture }, status));
    await assert.rejects(old, e => e.code === 'SESSION_CHANGED');
    assert.equal(memory.get('jollishift_access_token'), session.access_token);
  }
});

test('logout clears immediately and its late completion preserves a newer login', async () => {
  let resolve;
  const { authService, memory } = service(path => path.endsWith('/logout')
    ? new Promise(r => { resolve = r; }) : Promise.resolve(json(session)));
  memory.set('jollishift_access_token', 'old');
  const logout = authService.logout();
  assert.equal(memory.size, 0);
  await authService.login('', '');
  resolve(json({ status: 'ok' }));
  await logout;
  assert.equal(memory.get('jollishift_access_token'), session.access_token);
});
