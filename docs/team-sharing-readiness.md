# Team sharing: readiness and proposed hosting

No commit, push, deployment, migration or live service call was performed by this review.

## Safe source changes

The staged application changes provide automatic preview AI evaluation, stale-result
protection, provider error diagnostics, a development-only model override, revision
context in the editor, and an exact-period development preview exception. Tests and
the environment template are included. Real `.env` files and acceptance backups are not.

The development exception requires all configured project/branch/period scope checks,
`TV3_WRITE_SCOPE_MODE=manual-test`, `TV3_WRITE_SCOPE_ENABLED=true`, and
`TV3_OPEN_REGISTRATION_PREVIEW_ENABLED=true`. It applies to OPEN preview inspection
only. It does not relax DRAFT persistence, approval or SQL/RPC deadline checks.
Production does not enable this exception or the development model override.

## Files deliberately withheld

- `JolliShift-transfer/`, nested frontend checkout and `frontend/errors.txt`: transfer copies/local diagnostics.
- `docs/demo-datasets/`: database-derived employee references, availability and seed plans.
- Local manual/integration acceptance reports: account mappings and private backup paths.
- `.env`, backups, `.tmp`, dependencies and build outputs.

Two tests in `backend/tests/existing-employee-fixtures.test.cjs` require the withheld
JSON artifacts. Passing the local full suite therefore does **not** establish that a
fresh clone can run all tests. Before sharing a reproducible full test suite, replace
this dependency with reviewed synthetic fixtures or provide private artifacts through
an agreed secure channel; do not publish internal data simply to make tests pass.

Existing tracked internal artifacts also need an explicit decision before public
release: `docs/seed-foundation/roster.csv`, `docs/ld-integration-prepared/`, database
snapshots/catalog exports and the tracked drawio `.bkp` file. New ignore rules do not
untrack existing files or erase Git history. This review does not certify historical
commits or binary archives as free of sensitive information. Prefer a private team
repository until this separate review is complete.

## Local teammate startup

Use `npm ci` separately in `backend` and `frontend`. Each teammate needs private
backend configuration supplied outside Git: the shared Supabase project credentials,
allowed test scope and, if enabled, Gemini credentials/model settings. Use each user's
existing account; do not place passwords in documentation or frontend environment variables.

Start backend with `npm run dev`; frontend with `npm run dev:official`. The latter
requires the real API proxy and disables the registration demo. Team members can use
the existing approved test period without migrations or seeding. Confirm its effective
registration window when testing; dates in source/docs are not a rolling test window.

## Existing deployment support

- Frontend already has a Vite production build and `VITE_API_URL`.
- Backend already has TypeScript build, `npm start`, platform `PORT`, CORS
  `FRONTEND_URL`, and `/api/health`.
- No provider manifest, container deployment, or hosted SPA fallback was found.
- Backend does not currently serve frontend static assets. The local Vite `/api`
  proxy is not part of the generated static site.

## Proposed shared URL (not deployed)

Use Vercel for the frontend and Render for the existing Express backend. The team
opens one frontend URL; the browser calls the separate backend origin.

| Service | Root | Build | Start/output |
| --- | --- | --- | --- |
| Render backend | backend | npm ci && npm run build | npm start |
| Vercel frontend | frontend | npm ci && npm run build | dist |

Backend secrets belong only in the Render environment. Set `FRONTEND_URL` to the
frontend origin, retain the existing Supabase project, and disable direct local
PostgreSQL readers/writers. Set frontend `VITE_API_URL` to the HTTPS backend URL plus
`/api`; never put service-role keys or Gemini keys in `VITE_*`. Add the Vercel SPA
fallback so direct links such as `/employee/register` resolve to `index.html`.

For ordinary production hosting use `NODE_ENV=production`; preserve production model
selection. This will intentionally disable the current development-only open-period
preview exception and reject its development-only write scope. A shared staging
policy/model decision is needed if the team expects the exact ASUS development
preview behavior on the hosted service. Do not disable write scopes or set a public
production service to development just to bypass this distinction.

No pre-deploy migration/seed command is needed or authorized. Disable automatic
deployment while the staged changes and data exclusions are still being reviewed.

Official references:
- https://render.com/docs/deploy-node-express-app
- https://vercel.com/docs/frameworks/frontend/vite
- https://vite.dev/guide/env-and-mode

## Review results

Offline backend build: PASS; 294 tests, 268 PASS, 0 FAIL, 26 SKIP.
Frontend TypeScript/Vite build: PASS; 230 PASS, 0 FAIL, 0 SKIP.
No external Supabase/Gemini calls were allowed by the test preload.
These counts include the private fixture files available locally; see fresh-clone limitation above.

Secret checks on staged content found no configured backend secret values, Google API-key
signatures, Supabase secret-key signatures, JWTs or private keys. Test-only credential
literals are synthetic. This is not a certification of historical or binary content.

Proposed commit message:

```text
feat: automate schedule AI review and scope development workflow testing
```

Staged paths (39 files; SQL files are source artifacts only, not executed):

- `.gitignore`
- `backend/.env.example`
- `backend/src/registrations/dev-test-window.ts`
- `backend/src/routes/registration.routes.ts`
- `backend/src/services/draft-write-scope.ts`
- `backend/src/services/preview-ai.service.ts`
- `backend/src/services/schedule-ai.gemini.ts`
- `backend/src/services/schedule-preview.service.ts`
- `backend/src/services/schedule-workflow.service.ts`
- `backend/src/services/scheduling.service.ts`
- `backend/src/services/shift-change-write-scope.ts`
- `backend/src/services/staffing-demand.service.ts`
- `backend/tests/draft-write-scope.test.cjs`
- `backend/tests/registration-dev-window.test.cjs`
- `backend/tests/registration-http.test.cjs`
- `backend/tests/schedule-adjustment.test.cjs`
- `backend/tests/schedule-ai.test.cjs`
- `backend/tests/schedule-preview.test.cjs`
- `backend/tests/tv3-journey.test.cjs`
- `frontend/src/pages/employee/ShiftRegistration.tsx`
- `frontend/src/pages/manager/ManagerSchedule.tsx`
- `frontend/src/pages/manager/ScheduleAIPanel.css`
- `frontend/src/pages/manager/ScheduleAIPanel.tsx`
- `frontend/src/pages/manager/ScheduleReviewPanel.tsx`
- `frontend/src/pages/schedules/ScheduleWorkflow.tsx`
- `frontend/src/services/scheduling.service.ts`
- `frontend/src/types/scheduling.ts`
- `frontend/tests/preview-ai.test.cjs`
- `frontend/tests/registration.test.cjs`
- `frontend/tests/schedule-review.test.cjs`
- `frontend/tests/scheduling.test.cjs`
- `backend/src/services/manual-preview-policy.ts`
- `backend/migrations/20261106_dev_import_source_materialization.sql`
- `docs/deployment-6.3.1/sql-editor-auth-check.sql`
- `docs/deployment-6.3.1/sql-editor-complete-catalog.sql`
- `docs/flash-lite-web-acceptance.md`
- `docs/gemini-503-investigation.md`
- `docs/team-sharing-readiness.md`
- `frontend/tests/schedule-revision-context.test.cjs`
