// Regression fixtures must never inherit a developer's real Supabase settings.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/^(SUPABASE_|TV[2345]_|DEV_IMPORT_|REGISTRATION_|SCHEDULING_|GEMINI_|API_PROXY_TARGET$|NODE_OPTIONS$)/.test(key)) delete env[key];
}
Object.assign(env, {
  NODE_ENV: 'test',
  SUPABASE_URL: 'http://127.0.0.1:9',
  SUPABASE_SECRET_KEY: 'isolated-test-placeholder',
  SCHEDULING_DATA_SOURCE: 'supabase',
  REGISTRATION_USE_NATIVE: 'false',
  DEV_IMPORT_ENABLED: 'false',
  TV3_WRITE_SCOPE_ENABLED: 'false',
  TV3_WRITE_SCOPE_MODE: 'legacy',
  TV3_TEST_PREVIEW_ENABLED: 'false',
  TV3_DRAFT_PERSISTENCE_ENABLED: 'false',
  TV4_WORKFLOW_PERSISTENCE_ENABLED: 'false',
  TV5_PERSISTENCE_ENABLED: 'false',
  TV3_AI_EXTERNAL_ENABLED: 'false',
});
const child = spawnSync(process.execPath, [
  '--require', path.join(__dirname, 'test-no-dotenv.cjs'),
  '--test', 'tests/*.test.cjs',
], { cwd: path.join(__dirname, '..'), env, stdio: 'inherit' });
if (child.error) {
  console.error('Could not start isolated backend regression:', child.error.message);
  process.exitCode = 1;
} else process.exitCode = child.status ?? 1;
