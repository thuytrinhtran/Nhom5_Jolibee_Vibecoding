/** Read-only Supabase compatibility probe. No RPC calls, Auth writes or migration execution. */
const fs=require('node:fs'),path=require('node:path'),dotenv=require('dotenv');
const contract={
 registration_periods_effective:['id','branch_id','status','stored_status','open_at','close_at'],
 registration_submissions_sourced:['period_id','employee_id','status','submitted_at','sample_batch_id'],
 registration_period_generation_state:['singleton','last_success_at','created_count'],
 branches:['id','name','status'],users:['id','role','branch_id','is_active','must_change_password','password_reset_id'],
 employees:['id','user_id','full_name','branch_id','department_id','skill_level','status'],departments:['id','name'],
 shifts:['id','name','start_time','end_time','branch_id','is_active'],
 registration_periods:['id','branch_id','work_start_date','work_end_date','open_at','close_at','status'],
 shift_registrations:['id','period_id','employee_id','work_date','shift_id','status','submitted_at','updated_at'],
 registration_submissions:['period_id','employee_id','status','errors','submitted_at','updated_at','sample_batch_id'],
 registration_schedule_config:['singleton','timezone','open_iso_day','open_local_time','close_iso_day','close_local_time','reminder_minutes'],
 registration_automation_config:['singleton','enabled'],
 notifications:['id','recipient_id','type','title','content','status','created_at','idempotency_key'],
 audit_logs:['id','actor_id','entity_type','entity_id','action','old_data','new_data','change_source','created_at'],
};
async function inspect(env,fetcher=fetch){
 const raw=env.SUPABASE_URL||'';const base=raw.replace(/\/rest\/v1\/?$/,'').replace(/\/$/,'');
 const key=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_KEY||env.SUPABASE_ANON_KEY;
 if(!key||!base)throw Error('Missing server-side Supabase configuration.');
 const url=new URL(base);if(url.username||url.password||url.search||url.hash)throw Error('Supabase URL must not contain credentials or query parameters.');
 const expected={timezone:'Asia/Ho_Chi_Minh',open_iso_day:5,open_local_time:'15:00',close_iso_day:7,close_local_time:'12:00'};
 const headers={apikey:key,Authorization:`Bearer ${key}`,Prefer:'count=exact'};
 async function get(resource){
  try{const response=await fetcher(`${base}/rest/v1/${resource}`,{method:'GET',headers,signal:AbortSignal.timeout(12000)});
   const data=await response.json().catch(()=>null);return{http:response.status,code:response.ok?null:data?.code||'HTTP_ERROR',data:response.ok?data:null,count:response.headers.get('content-range')?.split('/')[1]};
  }catch{return{http:0,code:'NETWORK_ERROR',data:null};}
 }
 const entries=await Promise.all(Object.entries(contract).map(async([table,columns])=>{
  const result=await get(`${table}?select=${columns.join(',')}&limit=1`);
  return{table,columns,http:result.http,code:result.code,accessible:result.http>=200&&result.http<300,count:result.count&&result.count!=='*'?Number(result.count):null};
 }));
 const [openapi,schedule,automation]=await Promise.all([get(''),get('registration_schedule_config?select=timezone,open_iso_day,open_local_time,close_iso_day,close_local_time,reminder_minutes&singleton=eq.true'),get('registration_automation_config?select=enabled&singleton=eq.true')]);
 const paths=openapi.data?.paths||{};
 for(const table of entries){
  const properties=openapi.data?.definitions?.[table.table]?.properties;
  table.rest_types=properties?Object.fromEntries(table.columns.filter(name=>properties[name]).map(name=>[name,{type:properties[name].type,format:properties[name].format||null}])):null;
 }
 const functions=['save_employee_registration','run_registration_automation'].map(name=>{
  const endpoint=paths[`/rpc/${name}`]?.post;const schema=endpoint?.parameters?.find(p=>p.in==='body')?.schema;
  return{name,exposed:!!endpoint,arguments:Object.keys(schema?.properties||{})};
 });
 const s=schedule.data?.[0];const correctSchedule=!!s&&s.timezone===expected.timezone&&s.open_iso_day===expected.open_iso_day&&s.open_local_time.startsWith(expected.open_local_time)&&s.close_iso_day===expected.close_iso_day&&s.close_local_time.startsWith(expected.close_local_time)&&s.reminder_minutes===30;
 const rpc=functions.find(f=>f.name==='save_employee_registration');
 const expectedArgs=['p_user','p_period','p_preferences','p_submit'];
 const optional=['registration_automation_config','notifications'];
 const compatibleApi=entries.filter(t=>!optional.includes(t.table)).every(t=>t.accessible)&&correctSchedule&&rpc.exposed&&rpc.arguments.length===expectedArgs.length&&expectedArgs.every(a=>rpc.arguments.includes(a));
 return{checked_at:new Date().toISOString(),project_host:url.hostname,read_only:true,database_environment:'Not inferred from NODE_ENV; operator must confirm project identity',tables:entries,functions,schedule:s||null,schedule_matches_requested_policy:correctSchedule,automation_enabled:automation.data?.[0]?.enabled??null,api_schema_ready:compatibleApi,catalog_checks:'Run docs/tv2-release/official/00_inspect_shared_schema.sql to verify FK, UNIQUE, RLS, policies, function privileges and data eligibility. REST alone cannot certify these.',activation_ready:false,note:'activation_ready remains false until catalog checks, approved shifts/period, real login-persistence smoke test and team approval are recorded.'};
}
if(require.main===module){(async()=>{
 const args=process.argv.slice(2);const value=flag=>{const at=args.indexOf(flag);return at<0?null:args[at+1];};
 const file=path.resolve(value('--env')||path.join(__dirname,'../.env'));
 const env={...dotenv.parse(fs.readFileSync(file)),...process.env};
 const report=await inspect(env);const json=JSON.stringify(report,null,2)+'\n';
 const output=value('--output');if(output){fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,json);console.log(`Read-only report written: ${output}`);}else console.log(json);
 if(!report.api_schema_ready)process.exitCode=2;
})().catch(()=>{console.error('Read-only probe failed. Check configuration/network; no database writes were attempted.');process.exitCode=1;});}
module.exports={inspect,contract};
