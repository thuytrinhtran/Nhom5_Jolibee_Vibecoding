// Preload for an isolated audit: never use .env credentials or opt into DB tests.
// Usage from backend: $env:NODE_OPTIONS='--require=./tests/helpers/offline-only.cjs'; npm.cmd test
process.env.SCHEDULING_TEST_DATABASE_URL='';
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY='isolated-test-placeholder';
process.env.GEMINI_API_KEY='isolated-test-placeholder';
process.env.TV3_AI_EXTERNAL_ENABLED='false';
const originalFetch=global.fetch;
global.fetch=(input,options)=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('Offline audit blocked external fetch');
  return originalFetch(input,options);
};
