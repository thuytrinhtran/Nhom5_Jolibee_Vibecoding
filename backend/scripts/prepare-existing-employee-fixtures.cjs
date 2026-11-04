// Local preparation only. Online mode reads using GET only; never imports/Auth/writer RPC.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..');
const {SCOPE,hash}=require('./dev-import-executor.cjs');
const {generateSchedule,interval,reviewAssignments}=require('../dist/services/scheduling.engine.js');
function id(key){const h=crypto.createHash('sha256').update(`${SCOPE.batch_id}/existing-employee-fixture/${key}`).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;}
const dates=p=>Array.from({length:7},(_,i)=>new Date(Date.parse(p.work_start_date+'T00:00:00Z')+i*86400000).toISOString().slice(0,10));
function assertSafe(input,rows){
 const keys=new Set();for(const r of rows){const k=[r.employee_id,r.work_date,r.shift_id].join('/');if(keys.has(k))throw Error('DUPLICATE_FIXTURE_ROW');keys.add(k);}
 for(const a of rows){const sa=input.shifts.find(s=>s.id===a.shift_id);if(!sa)throw Error('SHIFT_MISSING');const [x,y]=interval(a.work_date,sa);for(const b of rows){if(a===b||a.employee_id!==b.employee_id)continue;const [u,v]=interval(b.work_date,input.shifts.find(s=>s.id===b.shift_id));if(x<v&&u<y)throw Error('FIXTURE_OVERLAP');}}
}
function existingFixture(input,headerEmployeeIds){
 if(input.period.id!==SCOPE.period_id||input.period.branch_id!==SCOPE.branch_id)throw Error('FIXTURE_SCOPE_MISMATCH');
 const occupied=new Set(headerEmployeeIds),people=input.employees.filter(e=>e.is_active&&e.role==='NV'&&e.status==='ACTIVE'&&e.skill_level!=='CREW_LEADER'&&!occupied.has(e.id)).sort((a,b)=>a.id.localeCompare(b.id));
 const shifts=input.shifts.filter(s=>s.is_active&&(s.branch_id==null||s.branch_id===SCOPE.branch_id)).sort((a,b)=>a.start_time.localeCompare(b.start_time)||a.id.localeCompare(b.id));
 if(!people.length||!shifts.length)throw Error('NO_FIXTURE_CANDIDATES');
 const extra=[];const add=(e,date,s)=>{if(extra.some(r=>r.employee_id===e.id&&r.work_date===date&&r.shift_id===s.id))return;const row={id:id(`${e.id}/${date}/${s.id}`),period_id:input.period.id,employee_id:e.id,work_date:date,shift_id:s.id,status:'VALID'};const [x,y]=interval(date,s);if([...input.registrations,...extra].some(r=>r.employee_id===e.id&&(()=>{const [u,v]=interval(r.work_date,input.shifts.find(t=>t.id===r.shift_id));return x<v&&u<y;})()))return;extra.push(row);};
 // Varied personal availability, independent of the generated assignment list.
 people.forEach((e,i)=>dates(input.period).forEach((d,j)=>{add(e,d,shifts[(i+j)%shifts.length]);if((i+j)%3!==0)add(e,d,shifts[(i+j+1)%shifts.length]);}));
 let preview=generateSchedule({...input,registrations:[...input.registrations,...extra]});
 // Complete fixture availability only in shortage cells; no assignments are seeded.
 for(let round=0;round<shifts.length&&preview.shortages.length;round++){
  const before=extra.length;for(const need of preview.shortages){for(const e of people.filter(e=>e.department_id===need.department_id)){const s=shifts.find(s=>s.id===need.shift_id);if(s)add(e,need.work_date,s);}}
  if(extra.length===before)break;preview=generateSchedule({...input,registrations:[...input.registrations,...extra]});
 }
 assertSafe(input,[...input.registrations,...extra]);reviewAssignments({...input,registrations:[...input.registrations,...extra]},preview.assignments);
 const seed={format:'ld-integration-seed-plan.v1',prepared_only:true,apply_allowed:false,...SCOPE,fixture_policy:'existing-employees-v1',auth_profiles_to_provision:[],employees_to_insert:[],submission_headers_to_insert:people.filter(e=>extra.some(r=>r.employee_id===e.id)).map(e=>({period_id:input.period.id,employee_id:e.id,status:'VALID',sample_batch_id:SCOPE.batch_id,submitted_at_policy:'DB_TRANSACTION_TIME_ON_APPROVED_IMPORT'})),shift_registrations_to_insert:extra,optional_positive_scenario:{additional_shift_registrations:[]}};
 return {seed,input:{...input,registrations:[...input.registrations,...extra]},result:preview};
}
function shortageFixture(){
 const branch=id('small/branch'),deps=[0,1,2].map(n=>id('small/dept/'+n));
 const shifts=[{id:id('small/am'),start_time:'08:00:00',end_time:'12:00:00',is_active:true,branch_id:branch},{id:id('small/pm'),start_time:'12:00:00',end_time:'17:00:00',is_active:true,branch_id:branch}];
 const employees=deps.flatMap((department_id,d)=>['NEW','REGULAR','CREW_TRAINING'].map((skill_level,n)=>({id:id(`small/${d}/${n}`),employee_code:`SMALL_${d}_${n}`,department_id,skill_level,status:'ACTIVE',is_active:true,role:'NV',max_weekly_hours:null,skills:[]})));
 const requirements=deps.flatMap(department_id=>['2026-11-09','2026-11-10'].flatMap(work_date=>shifts.map(s=>({id:id(`small/need/${department_id}/${work_date}/${s.id}`),department_id,work_date,shift_id:s.id,required_count:3,required_skill_name:null}))));
 const registrations=employees.flatMap(e=>['2026-11-09','2026-11-10'].map(work_date=>({employee_id:e.id,work_date,shift_id:shifts[0].id,status:'VALID'})));
 for(const e of employees.filter(e=>e.skill_level==='CREW_TRAINING'))registrations.push({employee_id:e.id,work_date:'2026-11-09',shift_id:shifts[1].id,status:'VALID'});
 const input={rule_version:'tv3.rules.v2',period:{id:id('small/period'),branch_id:branch,work_start_date:'2026-11-09',work_end_date:'2026-11-15',status:'CLOSED'},employees,shifts,requirements,registrations,existing:[],registration_provenance:[],holiday_dates:[],new_employee_count_threshold:null};
 assertSafe(input,registrations);return{input,result:generateSchedule(input)};
}
async function main(){
 process.env.DEV_IMPORT_ENABLED='false';
 const env=require('../node_modules/dotenv').parse(fs.readFileSync(path.join(ROOT,'backend/.env'))),url=env.SUPABASE_URL.replace(/\/rest\/v1\/?$/,'').replace(/\/$/,'');
 if(url!==`https://${SCOPE.project_ref}.supabase.co`)throw Error('PROJECT_MISMATCH');
 const db=require('../node_modules/@supabase/supabase-js').createClient(url,env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(u,o)=>{if((o?.method||'GET')!=='GET'||new URL(u).origin!==url)throw Error('READ_ONLY_REQUEST_REQUIRED');return fetch(u,{...o,redirect:'error'});}}});
 const source=await new(require('../dist/repositories/registration-summary.supabase.js').SupabaseRegistrationSummaryRepository)(db).load(SCOPE.branch_id,SCOPE.period_id);
 const loaded=require('../dist/services/scheduling-input.js').schedulingInput(source);
 const input={...loaded,employees:loaded.employees.map(({full_name,...e})=>e)};
 const positive=existingFixture(input,source.registration_submission_employee_ids),negative=shortageFixture();
 const dir=path.join(ROOT,'docs/demo-datasets',String(Date.now()));fs.mkdirSync(dir,{recursive:true});
 const files={'real-source-input.json':input,'existing-employees-seed.json':positive.seed,'existing-employees-input.json':positive.input,'shortage-input.json':negative.input};
 const manifest={scope:'LOCAL_FIXTURES_NOT_SHARED_IMPORT_AUTHORIZATION',project_ref:SCOPE.project_ref,captured_at:new Date().toISOString(),baseline_input_sha256:hash(input),preserved_headers:source.registration_submission_employee_ids.length,preserved_real_registrations:input.registrations.length,existing_employees:input.employees.length,extra_auth_required:0,extra_employees_required:0,new_headers:positive.seed.submission_headers_to_insert.length,extra_registrations:positive.seed.shift_registrations_to_insert.length,positive:{assigned:positive.result.assigned_count,required:positive.result.required_count,shortages:positive.result.shortages,composition_shortages:positive.result.composition_shortages,optimization:positive.result.optimization},negative:{employees:negative.input.employees.length,registrations:negative.input.registrations.length,assigned:negative.result.assigned_count,required:negative.result.required_count,shortages:negative.result.shortages,composition_shortages:negative.result.composition_shortages},files:[]};
 for(const [file,data] of Object.entries(files)){fs.writeFileSync(path.join(dir,file),JSON.stringify(data,null,2)+'\n');manifest.files.push({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,file))).digest('hex')});}
 fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({directory:path.relative(ROOT,dir),new_headers:manifest.new_headers,extra_registrations:manifest.extra_registrations,positive:{assigned:manifest.positive.assigned,required:manifest.positive.required,shortage_cells:manifest.positive.shortages.length,experience_warning_cells:manifest.positive.composition_shortages.length},negative:{assigned:manifest.negative.assigned,required:manifest.negative.required,shortage_cells:manifest.negative.shortages.length},new_auth:0}));
}
if(require.main===module)main().catch(e=>{console.error(/^[A-Z_]+$/.test(e.message||'')?e.message:'FIXTURE_PREPARATION_FAILED_NO_SECRETS_LOGGED');process.exitCode=1;});
module.exports={existingFixture,shortageFixture,assertSafe};
