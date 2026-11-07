const {test}=require('node:test'),assert=require('node:assert/strict');
process.env.SUPABASE_URL||='https://example.supabase.co';process.env.SUPABASE_SECRET_KEY||='isolated-test-placeholder';
const {previewSchedule}=require('../dist/services/schedule-preview.service.js');
const {previewCandidates}=require('../dist/services/preview-candidates.service.js');
const period='7f48f53e-d707-4a32-9f15-eb32aeb0095a',branch='11111111-1111-1111-1111-111111111111';
function fixture(){return {source:'supabase',branch:{id:branch,name:'Branch'},period:{id:period,branch_id:branch,work_start_date:'2026-11-09',work_end_date:'2026-11-15',status:'OPEN'},employees:['a','b','unregistered'].map(id=>({id,full_name:id,phone:'0900000000',branch_id:branch,department_id:'d',skill_level:'REGULAR',status:'ACTIVE',is_active:true,role:'NV',skills:[],max_weekly_hours:40})),shifts:[{id:'s',name:'Morning',start_time:'08:00:00',end_time:'12:00:00',is_active:true}],departments:[{id:'d',name:'Kitchen'}],registrations:['a','b'].map(employee_id=>({id:employee_id,period_id:period,employee_id,work_date:'2026-11-09',shift_id:'s',status:'VALID'})),requirements:[{id:'n',department_id:'d',work_date:'2026-11-09',shift_id:'s',required_count:1,required_skill_name:null}],existing:[],new_employee_count_threshold:null};}
test('development exception is read-only, scoped and preserves publication and all engine checks',async()=>{
 const original={...process.env};Object.assign(process.env,{NODE_ENV:'development',TV3_OPEN_REGISTRATION_PREVIEW_ENABLED:'true',TV3_WRITE_SCOPE_MODE:'manual-test',TV3_WRITE_SCOPE_ENABLED:'true',TV3_WRITE_PROJECT_REF:'wlbpprpiieonjrqglicv',SUPABASE_URL:'https://wlbpprpiieonjrqglicv.supabase.co',TV3_WRITE_BRANCH_ID:branch,TV3_WRITE_PERIOD_ID:period});
 try{
 const data=fixture(),repo={load:async()=>structuredClone(data),listPeriods:async()=>[{id:period,schedules:[]} ]};
 const preview=await previewSchedule(period,branch,{},repo);
 assert.equal(preview.context.development_preview,true);assert.equal(preview.persistence.enabled,false);assert.equal(data.period.status,'OPEN');
 data.requirements=[];await assert.rejects(previewSchedule(period,branch,{},repo));data.requirements=fixture().requirements;
 data.period.id='another';await assert.rejects(previewSchedule('another',branch,{},repo),e=>e.code==='PERIOD_NOT_CLOSED');data.period.id=period;
 process.env.NODE_ENV='production';await assert.rejects(previewSchedule(period,branch,{},repo),e=>e.code==='PERIOD_NOT_CLOSED');process.env.NODE_ENV='development';
 repo.listPeriods=async()=>[{id:period,schedules:[{status:'PUBLISHED'}]}];await assert.rejects(previewSchedule(period,branch,{},repo),e=>e.code==='PERIOD_LOCKED');
 data.period.status='PUBLISHED';await assert.rejects(previewSchedule(period,branch,{},repo),e=>e.code==='PERIOD_LOCKED');
 }finally{for(const k of Object.keys(process.env))if(!(k in original))delete process.env[k];Object.assign(process.env,original);}
});
test('candidate list checks full plan, excludes unregistered/over-hours/duplicate staff and rejects stale input',async()=>{
 const data=fixture();data.period.status='CLOSED';const repo={load:async()=>structuredClone(data)};
 const preview=await previewSchedule(period,branch,{},repo);
 const body={period_id:period,input_revision:preview.input_revision,assignments:preview.result.assignments.map(({employee_id,work_date,shift_id,department_id})=>({employee_id,work_date,shift_id,department_id})),requirement_id:'n',replace_index:0};
 const rows=await previewCandidates(period,branch,body,repo);assert.deepEqual(rows.map(e=>e.id),['b']);assert.equal(rows[0].phone,'0900000000');assert.equal(rows[0].employee_status,'ACTIVE');assert.equal(rows[0].status,'ELIGIBLE');
 const full=await previewCandidates(period,branch,Object.fromEntries(Object.entries(body).filter(([k])=>k!=='replace_index')),repo);assert.equal(full.length,0);
 data.employees[1].max_weekly_hours=2;await assert.rejects(previewCandidates(period,branch,body,repo),e=>e.code==='PREVIEW_STALE');
 const fresh=await previewSchedule(period,branch,{},repo);const filtered=await previewCandidates(period,branch,{...body,input_revision:fresh.input_revision},repo);assert.deepEqual(filtered.map(e=>e.id),[]);
});

test('closed published period refuses generation, candidate lookup and manual review',async()=>{
 const data=fixture();data.period.status='CLOSED';
 let published=false;const repo={load:async()=>structuredClone(data),listPeriods:async()=>[{id:period,schedules:published?[{status:'PUBLISHED',version:1}]:[]}]};
 const preview=await previewSchedule(period,branch,{},repo);published=true;
 for(const body of [{},{input_revision:preview.input_revision,assignments:[]},{schedule_id:'draft',expected_version:1}])await assert.rejects(previewSchedule(period,branch,body,repo),e=>e.code==='PERIOD_LOCKED');
 await assert.rejects(previewCandidates(period,branch,{period_id:period,input_revision:preview.input_revision,assignments:[],requirement_id:'n'},repo),e=>e.code==='PERIOD_LOCKED');
});

test('candidate filtering keeps same-branch active registered skilled staff within configured hours',async()=>{
 const data=fixture();data.period.status='CLOSED';data.requirements[0].required_skill_name='fry';
 const valid={...data.employees[0],skills:['fry']};
 data.employees=[valid,...[
  {id:'other-branch',branch_id:'foreign'}, {id:'other-department',department_id:'other'},
  {id:'inactive',status:'INACTIVE'},{id:'disabled',is_active:false},{id:'leader',skill_level:'CREW_LEADER'},
  {id:'no-skill',skills:[]},{id:'over-hours',max_weekly_hours:2},{id:'no-registration'}
 ].map(e=>({...valid,...e}))];
 data.registrations=data.employees.filter(e=>e.id!=='no-registration').map(e=>({...data.registrations[0],id:e.id,employee_id:e.id}));
 const repo={load:async()=>structuredClone(data)},preview=await previewSchedule(period,branch,{},repo);
 const rows=await previewCandidates(period,branch,{input_revision:preview.input_revision,assignments:[],requirement_id:'n'},repo);
 assert.deepEqual(rows.map(e=>e.id),['a']);assert.equal(rows[0].full_name,'a');
});
