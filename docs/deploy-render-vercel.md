# Render + Vercel deployment configuration

This describes the current application. It does not deploy, change Supabase,
enable automation or grant permission to write additional periods.

## Render backend

- Root directory: `backend`; Node version: `24.22.1` (`.nvmrc`).
- Build: `npm ci --include=dev && npm run build`; start: `npm start`.
- HTTP health check: `/api/health`. Render supplies `PORT`.
- Configure `NODE_ENV=production`, `SCHEDULING_DATA_SOURCE=supabase`, the
  exact Vercel origin as `FRONTEND_URL`, and `SUPABASE_URL` plus a server-only
  `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` in Render's environment.
- Configure `TV3_DRAFT_PERSISTENCE_ENABLED`, `TV4_WORKFLOW_PERSISTENCE_ENABLED`
  and `TV5_PERSISTENCE_ENABLED` for the approved workflow, and keep
  `TV3_TEST_PREVIEW_ENABLED=false`.
- Configure `TV3_WRITE_SCOPE_ENABLED=true`, `TV3_WRITE_SCOPE_MODE=allowlist`,
  `TV3_WRITE_PROJECT_REF` and `TV3_WRITE_SCOPE_ALLOWLIST` for exactly the
  approved project, branch and three period IDs. The allowlist is a JSON array
  of objects with `branch_id` and `period_ids`. An empty or invalid list denies
  writes. Never replace the approved list with a wildcard.
- Keep `DEV_IMPORT_ENABLED`, `TV5_LOCAL_PG_RPC_ENABLED`,
  `TV2_LOCAL_SOURCE_READ_ENABLED`, `REGISTRATION_DEV_TEST_MODE` and
  `TV3_TEST_PREVIEW_ENABLED` disabled; omit local PG file/client paths. TV5
  then uses the Supabase RPC path, which must be smoke tested online.
- `REGISTRATION_AUTOMATION_TOKEN` is optional and requires separate operator
  approval and a real scheduler. AI requires separate approval and the optional
  `TV3_AI_EXTERNAL_ENABLED`, `TV3_AI_PROVIDER`, `TV3_AI_MODEL`, `GEMINI_API_KEY`.
  No server secret belongs in a Vercel variable.

## Vercel frontend

- Root directory: `frontend`; Node version: `24.22.1` (`.nvmrc`).
- Build: `npm ci && npm run build`; output: `dist`.
- Set `VITE_API_URL` to the HTTPS Render backend URL ending in `/api`.
  `API_PROXY_TARGET` is a Vite development/preview proxy, not a hosted proxy.
- Keep `VITE_TV2_DEMO=false`. `vercel.json` rewrites SPA routes to `index.html`.
- CORS permits the exact `FRONTEND_URL`; review each preview origin before use.
  Check Supabase Auth Site URL and allowed redirects in the dashboard for the
  intended environment. Do not expose tokens or service keys to the browser.

## Tests and release gate

`npm test` in `backend` uses fixture environment variables and disables dotenv
loading for its process and workers. Native PostgreSQL/browser E2E is separate
and must use the disposable loopback harness. Frontend tests use `npm test`.
Test real Auth, permissions, Supabase RPC via Render, and workflow with separately
approved demo data before declaring the online environment ready. Do not use
the existing v8 schedule for write smoke tests.
