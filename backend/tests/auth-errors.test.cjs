const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_ENV = 'test';
const app = require('../dist/server.js').default;
const config = require('../dist/config/supabase.js');

test('login, refresh and token verification preserve upstream failure categories', async () => {
  const original = { createAuthClient: config.createAuthClient, getUser: config.supabaseAdmin.auth.getUser };
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    for (const [status, expected] of [[0,503], [undefined,503], [500,503], [429,429], [400,401], [401,401]]) {
      const failed = async () => ({ data: { user: null, session: null }, error: { status } });
      config.createAuthClient = () => ({ auth: { signInWithPassword: failed, refreshSession: failed } });
      config.supabaseAdmin.auth.getUser = failed;
      for (const [path, body] of [['login', { email: 'fixture@example.invalid', password: 'fixture' }], ['refresh', { refresh_token: 'fixture' }], ['me', null]]) {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/${path}`, {
          method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture' },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        assert.equal(response.status, expected, `${path}: ${status}`);
        assert.equal((await response.json()).status, 'error');
      }
    }
  } finally {
    config.createAuthClient = original.createAuthClient;
    config.supabaseAdmin.auth.getUser = original.getUser;
    await new Promise(resolve => server.close(resolve));
  }
});
