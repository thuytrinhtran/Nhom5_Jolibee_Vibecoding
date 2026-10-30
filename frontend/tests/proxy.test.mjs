import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

test('original proxy failure is empty HTTP 500; fixed proxy returns JSON 502', async () => {
  for (const [configFile, expected] of [['vite.config.js', 500], ['vite.config.ts', 502]]) {
    const previous = process.env.API_PROXY_TARGET;
    process.env.API_PROXY_TARGET = 'http://127.0.0.1:1';
    const server = await createServer({
      configFile, logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0, strictPort: false, proxy: { '/api': { target: 'http://127.0.0.1:1' } } },
    });
    try {
      await server.listen();
      const port = server.httpServer.address().port;
      const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: 'POST' });
      assert.equal(response.status, expected);
      if (expected === 500) assert.equal(await response.text(), '');
      else {
        assert.match(response.headers.get('content-type'), /application\/json/);
        assert.equal((await response.json()).status, 'error');
      }
    } finally {
      await server.close();
      if (previous === undefined) delete process.env.API_PROXY_TARGET;
      else process.env.API_PROXY_TARGET = previous;
    }
  }
});
