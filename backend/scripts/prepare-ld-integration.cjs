// PREPARE ONLY. No apply mode, SQL execution, Auth creation or remote mutation.
// Run from backend: node --import tsx scripts/prepare-ld-integration.cjs
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
require('dotenv').config({path:path.resolve(__dirname,'../.env'),quiet:true});
const originalFetch=global.fetch;
global.fetch=(input,options={})=>{
  const method=options.method||(input instanceof Request?input.method:'GET');
  if(method.toUpperCase()!=='GET')throw Error('PREPARE_ONLY: remote writes are forbidden');
  return originalFetch(input,options);
};
const {supabaseAdmin:db,supabaseUrl}=require('../src/config/supabase.ts');
const {SupabaseRegistrationSummaryRepository}=require('../src/repositories/registration-summary.supabase.ts');
const {buildLDTestFixture}=require('../src/services/ld-test-fixture.ts');
const {generateSchedule}=require('../src/services/scheduling.engine.ts');
const {schedulingInput}=require('../src/services/scheduling-input.ts');
const {LD_TEST_BATCH_ID:BATCH,LD_TEST_BRANCH_ID:BRANCH,LD_TEST_PERIOD_ID:PERIOD}=require('../src/services/test-preview-policy.ts');
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function userId(employeeId){const h=digest([BATCH,'auth',employeeId]);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;}
async function read(table,select,filter,order='id'){
 const rows=[];for(let start=0;;start+=500){let q=db.from(table).select(select).order(order).range(start,start+499);if(filter)q=filter(q);const r=await q;if(r.error)throw Error(`${table}: ${r.error.code}`);rows.push(...r.data);if(r.data.length<500)return rows;}
}
async function prepare(){
 const repo=new SupabaseRegistrationSummaryRepository(db),before=await repo.load(BRANCH,PERIOD);
 const allUsers=await read('users','id,username,role,branch_id,is_active,must_change_password');
 const users=allUsers.filter(u=>u.branch_id===BRANCH);
 const employees=await read('employees','id,user_id,branch_id,department_id,full_name,skill_level,status,max_weekly_hours',q=>q.eq('branch_id',BRANCH));
 const headers=await read('registration_submissions','*',q=>q.eq('period_id',PERIOD),'employee_id');
 const registrations=await read('shift_registrations','*',q=>q.eq('period_id',PERIOD));
 const requirements=await read('staffing_requirements','*',q=>q.eq('branch_id',BRANCH).gte('work_date','2026-11-02').lte('work_date','2026-11-08'));
 const schedules=await read('schedules','*',q=>q.eq('branch_id',BRANCH).eq('period_id',PERIOD));
 const authIds=[];for(let page=1;;page++){const r=await db.auth.admin.listUsers({page,perPage:1000});if(r.error)throw Error('Cannot inspect Auth bindings');authIds.push(...r.data.users.map(u=>u.id));if(r.data.users.length<1000)break;}
 const {snapshot,metadata}=buildLDTestFixture(before,BATCH);
 const virtual=new Set(metadata.virtual_employee_ids),fixtureIds=new Set(metadata.fixture_registration_ids);
 const profiles=snapshot.employees.filter(e=>virtual.has(e.id)).map(e=>({id:userId(e.id),username:e.employee_code.toLowerCase(),role:'NV',branch_id:BRANCH,is_active:true,must_change_password:true}));
 if(profiles.some(p=>allUsers.some(u=>u.id===p.id||u.username===p.username)||authIds.includes(p.id)))throw Error('Planned account collision: stop, do not overwrite');
 const additions=snapshot.employees.filter(e=>virtual.has(e.id)).map(e=>({id:e.id,user_id:userId(e.id),full_name:e.full_name.replace('[TV3 TEST] ','LD Test '),branch_id:BRANCH,department_id:e.department_id,skill_level:e.skill_level,status:'ACTIVE',max_weekly_hours:null}));
 const fixtureRows=snapshot.registrations.filter(r=>fixtureIds.has(r.id)).map(r=>({...r,submitted_at:'DATABASE_IMPORT_TIME_NOT_HISTORICAL',updated_at:'DATABASE_IMPORT_TIME_NOT_HISTORICAL'}));
 const negative=generateSchedule(schedulingInput(snapshot));
 const completion=[];
 // The shortage fixture cannot pass today's coverage gate. Prepare a separate
 // positive scenario by ADDING preferences of already-participating experienced
 // employees; never reduce demand or alter existing real registrations.
 const participantIds=new Set(metadata.fixture_employee_ids);
 for(const need of negative.shortages){
  const candidates=snapshot.employees.filter(e=>participantIds.has(e.id)&&e.department_id===need.department_id&&['REGULAR','CREW_TRAINING'].includes(e.skill_level)&&
   snapshot.registrations.some(r=>r.employee_id===e.id&&r.work_date===need.work_date)&&
   !snapshot.registrations.some(r=>r.employee_id===e.id&&r.work_date===need.work_date&&r.shift_id===need.shift_id))
   .sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  if(candidates.length<need.missing_count)throw Error('Cannot prepare positive scenario without changing existing participants');
  for(const employee of candidates.slice(0,need.missing_count)){
   const id=userId(`completion/${employee.id}/${need.work_date}/${need.shift_id}`);
   completion.push({id,period_id:PERIOD,employee_id:employee.id,work_date:need.work_date,shift_id:need.shift_id,status:'VALID',submitted_at:'DATABASE_IMPORT_TIME_NOT_HISTORICAL',updated_at:'DATABASE_IMPORT_TIME_NOT_HISTORICAL'});
  }
 }
 const positive=generateSchedule(schedulingInput({...snapshot,registrations:[...snapshot.registrations,...completion]}));
 if(positive.shortages.length||positive.composition_shortages.length)throw Error('Positive scenario does not pass coverage/composition');
 // Take a second read so a changing source cannot quietly become a seed plan.
 const after=await repo.load(BRANCH,PERIOD);
 if(digest(before)!==digest(after))throw Error('Source changed during preparation; regenerate the plan');
 const backup={period:before.period,branch:before.branch,users,employees,headers,registrations,requirements,schedules};
 const plan={format:'ld-integration-seed-plan.v1',prepared_only:true,apply_allowed:false,batch_id:BATCH,branch_id:BRANCH,period_id:PERIOD,
  project_fingerprint:digest(supabaseUrl),baseline_sha256:digest(backup),created_at:new Date().toISOString(),
  prerequisite_gates:['Inspect actual PostgreSQL FK/CHECK/triggers/RLS/function bodies; OpenAPI is insufficient',
   'Implement one scoped, persisted dev-import provenance contract shared by TV2 reports, TV3 and SQL snapshot',
   'Synchronize DRAFT persistence with current coverage/experience/local-search contracts',
   'Review Auth triggers and provision only listed accounts/profiles, recording returned IDs and before/after images',
   'Stop if any baseline source changes; never overwrite a pre-existing employee/period submission'],
  auth_profiles_to_provision:profiles,employees_to_insert:additions,
  submission_headers_to_insert:metadata.fixture_employee_ids.map(employee_id=>({period_id:PERIOD,employee_id,status:'VALID',errors:[],sample_batch_id:BATCH,submitted_at:'DATABASE_IMPORT_TIME_NOT_HISTORICAL',updated_at:'DATABASE_IMPORT_TIME_NOT_HISTORICAL'})),
  shift_registrations_to_insert:fixtureRows,daily:metadata.daily,
  optional_positive_scenario:{recommended_for_publication:true,additional_shift_registrations:completion,
   no_additional_people:true,negative:{assigned:negative.assigned_count,shortage:negative.required_count-negative.assigned_count,composition_cells:negative.composition_shortages.length},
   positive:{assigned:positive.assigned_count,shortage:positive.required_count-positive.assigned_count,composition_cells:positive.composition_shortages.length}},
  provenance:{audit_batch_id:BATCH,action:'LD_INTEGRATION_TEST_IMPORT',source:'DEVELOPMENT_TEST',late_import:true,fixture_version:'ld-20261102-v1',
   requirement_mutations:[],period_mutations:[],existing_registration_mutations:[],timestamp_policy:'Use database import time; no fake TV2 SUBMIT event'},
  rollback:{registration_ids:[...metadata.fixture_registration_ids,...completion.map(r=>r.id)],header_keys:metadata.fixture_employee_ids.map(employee_id=>({period_id:PERIOD,employee_id,sample_batch_id:BATCH})),
   employee_ids:additions.map(e=>e.id),profile_ids:profiles.map(p=>p.id),auth_ids:profiles.map(p=>p.id),
   protocol:['Capture transaction after-images and audit ID at apply time; no row-count-only deletion',
    'Before rollback compare complete after-images, ownership and all inbound FK references',
    'Abort if schedules, requests, resubmissions, skills or other member-created dependencies appeared',
    'Delete exact unchanged registration IDs, then unchanged batch headers; never delete by date, branch or prefix',
    'Delete new employees/profiles/Auth only in separate approved phases after FK checks; never cascade',
    'Keep audit evidence; append rollback audit. Preserve all pre-existing rows and newly created team work']}};
 plan.plan_sha256=digest(plan);
 const out=path.resolve(__dirname,`../../docs/ld-integration-prepared/${Date.now()}`);
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'baseline.json'),JSON.stringify(backup,null,2),{flag:'wx'});
 fs.writeFileSync(path.join(out,'seed-plan.json'),JSON.stringify(plan,null,2),{flag:'wx'});
 console.log(JSON.stringify({prepared_only:true,output_directory:out,profiles:profiles.length,employees:additions.length,headers:plan.submission_headers_to_insert.length,registrations:fixtureRows.length,positive_extra_registrations:completion.length,positive:plan.optional_positive_scenario.positive,baseline_sha256:plan.baseline_sha256,plan_sha256:plan.plan_sha256}));
}
prepare().catch(e=>{console.error(e.message);process.exitCode=1});
