const {test}=require('node:test'),assert=require('node:assert/strict');
const {canonicalInput,serverVerifiedPlan}=require('../dist/services/draft-persistence.service.js');
const {generateSchedule}=require('../dist/services/scheduling.engine.js');
const {previewRevision}=require('../dist/services/schedule-preview.service.js');
function fixture(){return{rule_version:'tv3.rules.v2',period:{id:'p',branch_id:'b',work_start_date:'2026-11-02',work_end_date:'2026-11-08',status:'CLOSED'},employees:['a','b'].map(id=>({id,employee_code:id,department_id:'d',status:'ACTIVE',is_active:true,role:'NV',skill_level:'REGULAR',skills:[],max_weekly_hours:null})),shifts:[{id:'s',is_active:true,start_time:'08:00:00',end_time:'12:00:00'}],registrations:['a','b'].map(employee_id=>({employee_id,work_date:'2026-11-02',shift_id:'s',status:'VALID'})),requirements:[{id:'r',work_date:'2026-11-02',shift_id:'s',department_id:'d',required_count:1,required_skill_name:null}],existing:[],new_employee_count_threshold:null};}
test('fingerprint binds employee codes, rule version, holidays and provenance, independent of row order',()=>{
 const x=fixture(),base=canonicalInput(x);
 assert.equal(canonicalInput({...x,employees:[...x.employees].reverse()}),base);
 for(const change of [x=>x.employees[0].employee_code='new',x=>x.rule_version='future',x=>x.holiday_dates=['2026-11-02'],x=>x.registration_provenance=[{employee_id:'a',batch_id:null,submitted_at:'2026-11-01T05:00:00Z',updated_at:'2026-11-01T05:00:00Z'}]]){const y=structuredClone(x);change(y);assert.notEqual(canonicalInput(y),base);}
 const y={...x,registration_provenance:[{employee_id:'a',batch_id:null,submitted_at:'2026-11-01T05:00:00Z',updated_at:'2026-11-01T05:00:00Z'}]};
 assert.equal(canonicalInput(y),canonicalInput({...y,registration_provenance:[{...y.registration_provenance[0],submitted_at:'2026-11-01T12:00:00+07:00'}]}));
 assert.notEqual(canonicalInput({...y,registration_provenance:[{...y.registration_provenance[0],updated_at:'2026-11-01T05:00:00.000001Z'}]}),canonicalInput({...y,registration_provenance:[{...y.registration_provenance[0],updated_at:'2026-11-01T05:00:00.000002Z'}]}));
 assert.notEqual(previewRevision(x),previewRevision({...x,registration_provenance:y.registration_provenance}));
});
test('save reconstructs generated history on server, discards forged browser metadata and distinguishes manual selection',()=>{
 const x=fixture(),generated=generateSchedule(x);
 const forged=generated.assignments.map(a=>({...a,reason:'FORGED',selection_history:{initial:{employee_id:'attacker'},replacements:[]}}));
 const verified=serverVerifiedPlan(x,forged);assert.equal(verified.plan_origin,'ENGINE_GENERATED');assert.deepEqual(verified.assignments,generated.assignments);assert.deepEqual(verified.optimization,generated.optimization);
 const manual=serverVerifiedPlan(x,[{employee_id:'b',work_date:'2026-11-02',shift_id:'s',department_id:'d',reason:'FORGED'}]);
 assert.equal(manual.plan_origin,'MANAGER_REVIEWED');assert.equal(manual.optimization,null);assert.equal(manual.assignments[0].reason,'MANAGER_CONFIRMED;RULE_ENGINE_VALIDATED');assert.equal(manual.assignments[0].selection_history.initial.employee_id,'b');
 assert.throws(()=>serverVerifiedPlan(x,[{employee_id:'unknown',work_date:'2026-11-02',shift_id:'s',department_id:'d'}]));
});
