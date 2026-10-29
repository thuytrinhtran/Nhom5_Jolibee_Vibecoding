import { defineConfig, loadEnv, ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
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
