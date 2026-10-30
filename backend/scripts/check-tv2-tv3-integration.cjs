// GET-only audit. No RPC execution, schedule generation, Auth session or cloud writes.
const fs=require('node:fs');
const {officialEnvironment}=require('./tv2-official-server.cjs');
const env=officialEnvironment();
for(const key of ['SUPABASE_URL','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_KEY','SUPABASE_ANON_KEY'])delete process.env[key];
Object.assign(process.env,env);
const {supabaseAdmin}=require('../dist/config/supabase.js');
const {SupabaseRegistrationSummaryRepository}=require('../dist/repositories/registration-summary.supabase.js');
const {summarizeRegistrations}=require('../dist/services/registration-summary.service.js');
(async()=>{
 const branch=process.argv[2]||'11111111-1111-1111-1111-111111111111';
 const period=process.argv[3]||'79a979cc-8347-48b5-a411-f03bd8aceb92';
 const data=await new SupabaseRegistrationSummaryRepository(supabaseAdmin).load(branch,period);
 const result={checked_at:new Date().toISOString(),read_only:true,project_host:new URL(env.SUPABASE_URL).host,
 source:data.source,period:data.period,valid_real_registration_rows:data.registrations.length,
 declarations:data.registration_declarations.reduce((a,r)=>(a[r.declaration]=(a[r.declaration]||0)+1,a),{}),
 summary_groups:summarizeRegistrations(data).rows.length,requirements:data.requirements.length,
 note:'Real data read through TV3 adapter only. No schedule generation, RPC writes or authenticated browser session tested.'};
 const output=process.argv[4];if(output)fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
})().catch(error=>{console.error(JSON.stringify({read_only:true,code:error.code||'READ_FAILED',message:'Không hoàn tất kiểm tra đọc TV2/TV3.'}));process.exitCode=1;});
