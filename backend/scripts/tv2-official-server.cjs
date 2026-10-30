// Uses the existing shared TV1 configuration; does not execute migrations or seeds.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const expectedHost = 'wlbpprpiieonjrqglicv.supabase.co';
const credentialKeys = ['SUPABASE_URL','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_KEY','SUPABASE_ANON_KEY'];
function officialEnvironment(file = path.resolve(__dirname, '../.env')) {
  const env = dotenv.parse(fs.readFileSync(file));
  const url = (env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
  let parsed;
  try { parsed = new URL(url); } catch { throw Error('Official backend requires the existing shared Supabase URL.'); }
  if (parsed.protocol !== 'https:' || parsed.hostname !== expectedHost || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw Error('Official backend refused: expected the shared Supabase project wlbpprpiieonjrqglicv.');
  }
  if (!env.SUPABASE_SECRET_KEY && !env.SUPABASE_SERVICE_ROLE_KEY) throw Error('Official backend requires a server key in backend/.env; never put it in VITE_*.');
  return {...env, SUPABASE_URL:url, PORT:'5000', FRONTEND_URL:'http://localhost:5173', NODE_ENV:env.NODE_ENV || 'development'};
}
if (require.main === module) {
  try {
    const env = officialEnvironment();
    for (const key of credentialKeys) delete process.env[key];
    Object.assign(process.env, env);
    console.log('[TV2 official] Shared Supabase host: ' + expectedHost + '; API port: 5000; existing TV1 Auth.');
    require('../dist/server.js');
  } catch {
    console.error('Official backend was not started. Check shared project URL/server key and run the backend build; no credentials were logged.');
    process.exitCode = 1;
  }
}
module.exports = {officialEnvironment};
