const {test}=require('node:test');const assert=require('node:assert/strict');
const {validateTestEnvironment:v}=require('../scripts/tv2-test-server.cjs');
const base={TV2_DATABASE_ENV:'isolated-test',TV2_TEST_PROJECT_REF:'separatetest',SUPABASE_URL:'https://separatetest.supabase.co',SUPABASE_SECRET_KEY:'fixture-only'};
test('TEST launcher blocks shared project even when labeled test',()=>{for(const e of [{...base,SUPABASE_URL:'https://wlbpprpiieonjrqglicv.supabase.co/rest/v1'},{...base,TV2_TEST_PROJECT_REF:'wlbpprpiieonjrqglicv'}])assert.throws(()=>v(e),/Shared/);});
test('TEST launcher requires explicit matching target and server key',()=>{for(const e of [{...base,TV2_DATABASE_ENV:'development'},{...base,TV2_TEST_PROJECT_REF:'other'},{...base,SUPABASE_SECRET_KEY:''}])assert.throws(()=>v(e));assert.equal(v(base).port,'5001');assert.equal(v({...base,SUPABASE_URL:'http://127.0.0.1:54321'}).origin,'http://127.0.0.1:54321');});
