const {test}=require('node:test');const assert=require('node:assert/strict');
const {inspect}=require('../scripts/check-tv2-readiness.cjs');
test('readiness is GET-only, accepts 206, checks RPC signature and never reports secrets or certifies activation',async()=>{
 const calls=[];const env={SUPABASE_URL:'https://fixture.supabase.co/rest/v1/',SUPABASE_SECRET_KEY:'SECRET_MUST_NEVER_APPEAR'};
 let missing=false,scheduleDay=5;
 const fetcher=async(url,options)=>{
  calls.push({url,options});assert.equal(options.method,'GET');
  let data=[];let status=206;
  if(url.endsWith('/rest/v1/')){status=200;data={paths:{'/rpc/save_employee_registration':{post:{parameters:[{in:'body',schema:{properties:Object.fromEntries(['p_user','p_period','p_preferences','p_submit'].map(n=>[n,{}]))}}]}},'/rpc/run_registration_automation':{post:{}}}};}
  else if(url.includes('registration_schedule_config?')){status=200;data=[{timezone:'Asia/Ho_Chi_Minh',open_iso_day:scheduleDay,open_local_time:'15:00:00',close_iso_day:7,close_local_time:'12:00:00',reminder_minutes:30}];}
  else if(url.includes('registration_automation_config?')){status=200;data=[{enabled:false}];}
  else if(missing&&url.includes('registration_submissions?')){status=404;data={code:'PGRST205'};}
  return new Response(JSON.stringify(data),{status,headers:{'content-range':'0-0/5','content-type':'application/json'}});
 };
 let result=await inspect(env,fetcher);assert.equal(result.api_schema_ready,true);assert.equal(result.activation_ready,false);
 assert.ok(result.tables.every(t=>t.accessible));assert.ok(!JSON.stringify(result).includes(env.SUPABASE_SECRET_KEY));
 assert.ok(calls.every(c=>!c.url.includes('/rpc/')));
 missing=true;result=await inspect(env,fetcher);assert.equal(result.api_schema_ready,false);assert.equal(result.tables.find(t=>t.table==='registration_submissions').code,'PGRST205');
 missing=false;scheduleDay=4;
 const officialEnv={...env,SUPABASE_URL:'https://wlbpprpiieonjrqglicv.supabase.co'};
 result=await inspect(officialEnv,fetcher);assert.equal(result.api_schema_ready,false);assert.equal(result.automation_enabled,false);
 scheduleDay=5;result=await inspect(officialEnv,fetcher);assert.equal(result.schedule_matches_requested_policy,true);
});
