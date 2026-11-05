// Read-only service/API dependency probe; excludes browser rendering and token verification.
const fs=require('node:fs'),path=require('node:path');
const fetchOriginal=global.fetch;let spans=[];const inFlight=new Set();
global.fetch=async(input,init)=>{let done;const work=new Promise(r=>done=r);inFlight.add(work);const start=performance.now();try{const response=await fetchOriginal(input,init);const url=new URL(typeof input==='string'?input:input.url??String(input));spans.push({endpoint:url.pathname.replace('/rest/v1/',''),method:init?.method??'GET',ms:Math.round(performance.now()-start),status:response.status});return response;}catch(e){spans.push({endpoint:'TRANSPORT',ms:Math.round(performance.now()-start),error:true});throw e;}finally{inFlight.delete(work);done();}};
const {supabaseAdmin:db}=require('../dist/config/supabase.js');
const {listSchedulingPeriods,readSchedulingContext,readDraft,readRegistrationSummary}=require('../dist/services/scheduling.service.js');
const {readManagerOverview}=require('../dist/services/manager-overview.service.js');
const {readDemand}=require('../dist/services/staffing-demand.service.js');
const {readManagerCalendar}=require('../dist/services/manager-calendar.service.js');
const {localTv5Rpc}=require('../dist/services/tv5-local-rpc.js');
const {readOfficialCalendar}=require('../dist/services/official-calendar.service.js');
const branch='11111111-1111-1111-1111-111111111111',period='79a979cc-8347-48b5-a411-f03bd8aceb92';
async function main(){
 const name=process.argv[2];if(!/^(before|after)$/.test(name))throw Error('INVALID_PHASE');
 const profiles=await db.from('users').select('id,role,username').in('username',['ql_jollibee','nv_jollibee','gs_jollibee']);if(profiles.error)throw Error('PROFILE_READ_FAILED');
 const ql=profiles.data.find(u=>u.role==='QL').id,nv=profiles.data.find(u=>u.username==='nv_jollibee').id;
 const sched=await db.from('schedules').select('id').eq('period_id',period).order('version',{ascending:false}).limit(1).single();if(sched.error)throw Error('SCHEDULE_READ_FAILED');const schedule=sched.data.id;
 const select=fs.readFileSync(path.resolve(__dirname,'../src/routes/schedule-workflow.routes.ts'),'utf8').match(/const scheduleSelect = '([^']+)'/)[1];
 const work={
  dashboard:async()=>{await listSchedulingPeriods(branch);return readManagerOverview(period,branch,ql);},
  registration_dependencies:async()=>Promise.all([db.from('registration_periods').select('*').eq('id','7f48f53e-d707-4a32-9f15-eb32aeb0095a').eq('branch_id',branch),db.from('shifts').select('id,name,start_time,end_time').eq('is_active',true),db.from('registration_schedule_config').select('timezone,open_iso_day,open_local_time,close_iso_day,close_local_time,reminder_minutes').eq('singleton',true),db.from('employees').select('id').eq('user_id',nv)]),
  demand:async()=>{await listSchedulingPeriods(branch);return readDemand(period,branch);},
  scheduling:async()=>{await listSchedulingPeriods(branch);return Promise.all([readSchedulingContext(period,branch).then(async v=>({context:v,draft:await readDraft(schedule,branch)})),readRegistrationSummary(period,branch,{})]);},
  publication:async()=>{const s=await db.from('schedules').select(select).eq('branch_id',branch).order('created_at',{ascending:false});if(s.error)throw Error('PUBLICATION_READ_FAILED');return s.data;},
  official_calendar:async()=>{await listSchedulingPeriods(branch);return name==='after'?readOfficialCalendar(period,branch,{page:0,page_size:20,metadata:true}):readManagerCalendar(period,branch);},
  shift_changes:async()=>Promise.all([localTv5Rpc('tv5_read',{p_actor_id:nv}),db.rpc('employee_schedule_week',{p_actor_id:nv,p_week_start:'2026-11-02'})]),
  employee_schedule:async()=>db.rpc('employee_schedule_week',{p_actor_id:nv,p_week_start:'2026-11-02'}),
 };
 const report={phase:name,created_at:new Date().toISOString(),project_ref:'wlbpprpiieonjrqglicv',measurement:'READ_ONLY_SERVICE_WALL_TIME; API_SUBREQUEST_HEADERS_TIME; excludes browser/Auth HTTP; first vs subsequent is process/client warm-up, not browser cache',runs:[]};
 for(let run=0;run<3;run++)for(const [page,fn]of Object.entries(work)){
  spans=[];const started=performance.now();let error=null;try{await fn();}catch(e){error=e.code??'READ_FAILED';}await Promise.allSettled([...inFlight]);
  const row={page,run,kind:run===0?'first':'subsequent',ms:Math.round(performance.now()-started),subrequests:spans.length,spans:[...spans],error};report.runs.push(row);console.log(JSON.stringify({phase:name,...row,spans:undefined}));
  fs.mkdirSync(path.resolve(__dirname,'../../docs/performance-20261103'),{recursive:true});fs.writeFileSync(path.resolve(__dirname,`../../docs/performance-20261103/${name}.json`),JSON.stringify(report,null,2)+'\n');
 }
}
main().catch(e=>{console.error(/^[A-Z_]+$/.test(e.message)?e.message:'READ_ONLY_BENCHMARK_FAILED');process.exitCode=1;});
