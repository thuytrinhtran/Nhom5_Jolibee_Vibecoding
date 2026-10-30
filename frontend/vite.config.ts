import { defineConfig, loadEnv, ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = { ...(mode === 'tv2-official' ? { VITE_TV2_DEMO: 'false', VITE_API_URL: '/api', API_PROXY_TARGET: 'http://127.0.0.1:5000' } : {}), ...loadEnv(mode, '.', '') };
  if (mode === 'tv2-official' && (env.VITE_TV2_DEMO !== 'false' || env.VITE_API_URL !== '/api' || env.API_PROXY_TARGET !== 'http://127.0.0.1:5000')) {
    throw new Error('TV2 official requires DEMO=false and /api proxied to the existing TV1 backend on port 5000.');
  }
  const proxy = {
    '/api': {
      target: env.API_PROXY_TARGET || 'http://127.0.0.1:5000',
      changeOrigin: true,
      configure(proxy) {
        proxy.on('error', (_error, _req, res) => {
          if ('writeHead' in res && !res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ status: 'error', message: 'Không kết nối được Backend. Hãy khởi động API và kiểm tra API_PROXY_TARGET.' }));
          }
        });
      },
    } satisfies ProxyOptions,
  };
  return {
    plugins: [react()],
    server: { port: 5173, strictPort: true, host: true, proxy },
    preview: { proxy },
  };
});
