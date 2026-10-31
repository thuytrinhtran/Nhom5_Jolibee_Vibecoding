const {test}=require('node:test');
const assert=require('node:assert/strict');
process.env.NODE_ENV='test';
const {previewSchedule}=require('../dist/services/schedule-preview.service.js');
const {generateSchedule}=require('../dist/services/scheduling.engine.js');
const {schedulingInput}=require('../dist/services/scheduling-input.js');
function fixture(){return {source:'supabase',branch:{id:'b',name:'Branch'},period:{id:'p',branch_id:'b',work_start_date:'2026-11-02',work_end_date:'2026-11-08',status:'CLOSED'},employees:[{id:'a',full_name:'Employee',branch_id:'b',department_id:'d',skill_level:'REGULAR',status:'ACTIVE',is_active:true,role:'NV',skills:[],max_weekly_hours:40}],shifts:[{id:'s',name:'Morning',start_time:'08:00:00',end_time:'12:00:00',is_active:true}],departments:[{id:'d',name:'Kitchen'}],registrations:[{id:'r',period_id:'p',employee_id:'a',work_date:'2026-11-02',shift_id:'s',status:'VALID'}],requirements:[{id:'n',department_id:'d',work_date:'2026-11-02',shift_id:'s',required_count:1,required_skill_name:null}],existing:[],new_employee_count_threshold:null};}
test('preview matches existing engine, reads branch scoped snapshot and never calls writers',async()=>{
 const data=fixture();let reads=0;const repo={load:async(b,p)=>{assert.equal(b,'b');assert.equal(p,'p');reads++;return data},saveRequirement:()=>assert.fail('write'),clearRequirement:()=>assert.fail('write')};
 const before=JSON.stringify(data),value=await previewSchedule('p','b',{period_id:'p'},repo);
 assert.deepEqual(value.result,generateSchedule(schedulingInput(data)));assert.equal(value.persisted,false);assert.equal(value.kind,'preview');assert.equal(value.persistence.enabled,false);assert.equal(value.schedule,undefined);assert.equal(reads,1);assert.equal(JSON.stringify(data),before);
 const assignments=value.result.assignments.map(({employee_id,work_date,shift_id,department_id})=>({employee_id,work_date,shift_id,department_id}));
 const reviewed=await previewSchedule('p','b',{period_id:'p',input_revision:value.input_revision,assignments},repo);assert.equal(reviewed.result.assigned_count,1);
 await assert.rejects(previewSchedule('p','b',{period_id:'p',input_revision:value.input_revision,assignments:[{...assignments[0],work_date:'2026-11-03'}]},repo));
 data.requirements[0].required_count=2;
 await assert.rejects(previewSchedule('p','b',{period_id:'p',input_revision:value.input_revision,assignments},repo),e=>e.code==='PREVIEW_STALE');
});
test('preview rejects open periods, missing demand and untrusted fields',async()=>{
 const data=fixture(),repo={load:async()=>data};
 await assert.rejects(previewSchedule('p','b',{actor_id:'other'},repo),e=>e.status===400);
 data.period.status='OPEN';await assert.rejects(previewSchedule('p','b',{},repo));
 data.period.status='CLOSED';data.requirements=[];await assert.rejects(previewSchedule('p','b',{},repo));
});
test('review rejects excess demand and unregistered employee, then accepts a valid replacement',async()=>{
 const data=fixture();data.employees.push({...data.employees[0],id:'b',full_name:'Second'});data.registrations.push({...data.registrations[0],id:'r2',employee_id:'b'});
 const repo={load:async()=>data},initial=await previewSchedule('p','b',{},repo);
 const a={employee_id:'a',work_date:'2026-11-02',shift_id:'s',department_id:'d'},b={...a,employee_id:'b'};
 const review=assignments=>previewSchedule('p','b',{assignments,input_revision:initial.input_revision},repo);
 await assert.rejects(review([a,b]),e=>e.status===422&&e.code==='DEMAND_EXCEEDED');
 data.employees.push({...data.employees[0],id:'unregistered'});
 const fresh=await previewSchedule('p','b',{},repo);
 await assert.rejects(previewSchedule('p','b',{assignments:[{...a,employee_id:'unregistered'}],input_revision:fresh.input_revision},repo),e=>e.status===422&&e.code==='REGISTRATION_REQUIRED');
 const valid=await previewSchedule('p','b',{assignments:[b],input_revision:fresh.input_revision},repo);assert.equal(valid.result.assigned_count,1);assert.equal(valid.result.assignments[0].employee_id,'b');assert.equal(valid.result.coverage[0].missing_count,0);
});
test('preview HTTP requires manager and own branch; no database mutation or RPC',async()=>{
 const app=require('../dist/server.js').default,{supabaseAdmin:db}=require('../dist/config/supabase.js');
 const repositories=require('../dist/repositories/registration-summary.repository.js');
 const original={getUser:db.auth.getUser,from:db.from,rpc:db.rpc,repository:repositories.registrationSummaryRepository};
 const id='00000000-0000-4000-8000-000000000001';let role='QL',branch=id,loads=0;
 db.auth.getUser=async()=>({data:{user:{id}}});db.rpc=()=>assert.fail('RPC forbidden');
 db.from=table=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:null}),single:async()=>({data:table==='users'?{id,role,branch_id:branch,is_active:true,must_change_password:false}:{name:'Branch'}})});
 repositories.registrationSummaryRepository=()=>({load:async(b,p)=>{loads++;assert.equal(b,id);assert.equal(p,id);const data=fixture();data.period.id=id;data.period.branch_id=id;data.employees.push({...data.employees[0],id:'b'},{...data.employees[0],id:'unregistered'});data.registrations.push({...data.registrations[0],id:'r2',employee_id:'b'});return data}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url=`http://127.0.0.1:${server.address().port}/api/schedules/preview`;
 const post=(body={period_id:id},auth=true)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer fixture'}:{})},body:JSON.stringify(body)});
 try{assert.equal((await post({},false)).status,401);for(const r of ['NV','GS']){role=r;assert.equal((await post()).status,403)}role='QL';branch=null;assert.equal((await post()).status,403);branch=id;assert.equal((await post({period_id:'bad'})).status,400);assert.equal(loads,0);const response=await post();assert.equal(response.status,200);const preview=(await response.json()).result;assert.equal(preview.persisted,false);assert.equal(loads,1);
 const assignment={employee_id:'a',work_date:'2026-11-02',shift_id:'s',department_id:'d'};
 for(const [assignments,code] of [[[assignment,{...assignment,employee_id:'b'}],'DEMAND_EXCEEDED'],[[{...assignment,employee_id:'unregistered'}],'REGISTRATION_REQUIRED']]){
  const rejected=await post({period_id:id,input_revision:preview.input_revision,assignments});assert.equal(rejected.status,422);const body=await rejected.json();assert.equal(body.code,code);assert.ok(body.message.length>10);
 }
 const accepted=await post({period_id:id,input_revision:preview.input_revision,assignments:[{...assignment,employee_id:'b'}]});assert.equal(accepted.status,200);assert.equal((await accepted.json()).result.result.assignments[0].employee_id,'b');
 }finally{db.auth.getUser=original.getUser;db.from=original.from;db.rpc=original.rpc;repositories.registrationSummaryRepository=original.repository;await new Promise(r=>server.close(r));}
});
