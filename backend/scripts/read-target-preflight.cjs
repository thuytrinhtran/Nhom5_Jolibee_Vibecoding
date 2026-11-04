// GET only. Sanitized evidence, never logs credentials or raw Auth responses.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..'), TARGET='wlbpprpiieonjrqglicv';
const select={
 branches:['id','name','status','supervisor_id'], departments:['id','name'],
 users:['id','username','role','branch_id','is_active','must_change_password'],
 employees:['id','user_id','branch_id','department_id','skill_level','status','max_weekly_hours'],
 employee_skills:['id','employee_id','department_id','proficiency','skill_id'],
 shifts:['id','name','start_time','end_time','branch_id','duration_hours'],
 registration_periods:['id','branch_id','work_start_date','work_end_date','open_at','close_at','status'],
 registration_submissions_sourced:['period_id','employee_id','status','errors','submitted_at','updated_at','sample_batch_id','dev_import_allowed'],
 shift_registrations:['id','period_id','employee_id','work_date','shift_id','status','submitted_at','updated_at'],
 staffing_requirements:['id','branch_id','work_date','shift_id','department_id','required_count','excludes_crew_leader','required_skill_name','sales_forecast_ref','created_by','updated_at'],
 schedules:['id','period_id','branch_id','schedule_group_id','version','status','published_at'],
 shift_assignments:['id','schedule_id','employee_id','work_date','shift_id','department_id','status','actual_branch_id'],
 schedule_approvals:['id','schedule_id','status'],
 shift_change_requests:['id','original_assignment_id','status','assignment_snapshot'],
 incidents:['id','original_assignment_id','status','assignment_snapshot'],
 replacement_invitations:['id','request_id','incident_id','employee_id','status','expires_at'],
};
async function main(){
 const env=require('../node_modules/dotenv').parse(fs.readFileSync(path.join(ROOT,'backend/.env')));
 const base=(env.SUPABASE_URL||'').replace(/\/rest\/v1\/?$/,'').replace(/\/$/,'');
 if(base!==`https://${TARGET}.supabase.co`)throw Error('TARGET_PROJECT_MISMATCH');
 const key=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_KEY||env.SUPABASE_ANON_KEY;
 if(!key)throw Error('NO_KEY');
 const out={format:'target-rest-readonly.v1',captured_at:new Date().toISOString(),project_ref:TARGET,method:'GET_ONLY',requests:0,tables:{},errors:[],limits:['REST/OpenAPI cannot verify FK/CHECK/index/trigger/RLS/effective grants/function bodies or migration history.','Separate GETs are not a consistent PostgreSQL snapshot.','Auth export retains IDs only; password, tokens, emails and metadata are discarded.']};
 async function get(endpoint,extra={}){out.requests++;const r=await fetch(base+endpoint,{method:'GET',headers:{apikey:key,Authorization:`Bearer ${key}`,...extra},signal:AbortSignal.timeout(20000),redirect:'error'});if(!r.ok)return{error:r.status};return {data:await r.json(),range:r.headers.get('content-range')};}
 const schema=await get('/rest/v1/');
 if(schema.error)throw Error(`SCHEMA_HTTP_${schema.error}`);
 out.openapi=schema.data; // PostgREST structural schema only; no response rows.
 for(const [table,allowed] of Object.entries(select)){
  const columns=Object.keys(schema.data.definitions?.[table]?.properties||{});
  if(!columns.length){out.errors.push({table,reason:'NOT_EXPOSED_OR_NOT_VISIBLE'});continue;}
  const chosen=allowed.filter(c=>columns.includes(c));
  if(!chosen.length){out.errors.push({table,reason:'NO_SAFE_COLUMNS'});continue;}
  const order=chosen.includes('id')?'id':chosen.filter(c=>['period_id','employee_id','work_date','shift_id'].includes(c)).join(',');
  const rows=[];let total=null,complete=false;
  for(let page=0;page<10000;page++){
   const r=await get(`/rest/v1/${table}?select=${chosen.join(',')}&${order?'order='+order+'&':''}limit=500&offset=${rows.length}`,{Prefer:'count=exact'});
   if(r.error){out.errors.push({table,http:r.error});break;}
   const match=r.range?.match(/\/(\d+)$/);if(match)total=Number(match[1]);
   if(!Array.isArray(r.data))throw Error('UNEXPECTED_REST_RESPONSE');
   rows.push(...r.data);
   if(total!==null&&rows.length===total){complete=true;break;}
   if(!r.data.length){complete=total===null;break;}
  }
  out.tables[table]={columns,selected:chosen,total,exported:rows.length,complete,rows};
 }
 const ids=[];let authComplete=false;
 for(let page=1;page<=1000;page++){
  const r=await get(`/auth/v1/admin/users?page=${page}&per_page=100`);
  if(r.error){out.errors.push({entity:'auth-user-ids',http:r.error});break;}
  const users=r.data.users;if(!Array.isArray(users))throw Error('UNEXPECTED_AUTH_RESPONSE');
  ids.push(...users.map(u=>u.id));
  if(users.length<100){authComplete=true;break;}
 }
 out.auth={ids:[...new Set(ids)].sort(),complete:authComplete};
 const dir=path.join(ROOT,'docs/deployment-6.3.1');
 const filename='target-rest-'+Date.now()+'.json';const bytes=JSON.stringify(out,null,2)+'\n';
 fs.writeFileSync(path.join(dir,filename),bytes,{flag:'wx'});
 console.log(JSON.stringify({file:filename,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),requests:out.requests,counts:Object.fromEntries(Object.entries(out.tables).map(([k,v])=>[k,{rows:v.exported,total:v.total,complete:v.complete}])),authIds:ids.length,authComplete,errors:out.errors}));
}
if(require.main===module)main().catch(e=>{console.error(/^[A-Z_0-9]+$/.test(e.message||'')?e.message:'READ_ONLY_TRANSPORT_OR_CONFIG_FAILURE');process.exitCode=1;});
