// Pure business fixtures: no Supabase SDK, database, credentials or persistence flag.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {generateSchedule,reviewAssignments}=require('../dist/services/scheduling.engine.js');
const days=['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01'];
const employee=id=>({id,department_id:'kitchen',skill_level:'REGULAR',status:'ACTIVE',is_active:true,role:'NV',skills:['hot-kitchen'],max_weekly_hours:40});
const need=(id,date=days[0],shift='morning',count=1)=>({id,department_id:'kitchen',work_date:date,shift_id:shift,required_count:count,required_skill_name:null});
const registration=(id,date=days[0],shift='morning')=>({employee_id:id,work_date:date,shift_id:shift,status:'VALID'});
const assignment=(id,date=days[0],shift='morning')=>({employee_id:id,work_date:date,shift_id:shift,department_id:'kitchen'});
const plain=({employee_id,work_date,shift_id,department_id})=>({employee_id,work_date,shift_id,department_id});
function fixture(count=2,demand=1){const employees=Array.from({length:count},(_,i)=>employee(`nv-${String(i+1).padStart(2,'0')}`));return{
 period:{id:'isolated-week',branch_id:'isolated-branch',work_start_date:days[0],work_end_date:days[6],status:'CLOSED'},employees,
 shifts:[{id:'morning',start_time:'08:00:00',end_time:'12:00:00',is_active:true},{id:'afternoon',start_time:'12:00:00',end_time:'16:00:00',is_active:true}],
 registrations:employees.map(e=>registration(e.id)),requirements:[need('need',days[0],'morning',demand)],existing:[],new_employee_count_threshold:null};}
function verify(input){const before=JSON.stringify(input),r=generateSchedule(input);assert.equal(JSON.stringify(input),before,'engine must not mutate input');
 assert.equal(r.assigned_count,r.assignments.length);assert.equal(r.required_count,r.assigned_count+r.shortages.reduce((n,c)=>n+c.missing_count,0));
 for(const c of r.coverage){assert.ok(c.assigned_count<=c.required_count);assert.equal(c.assigned_count+c.missing_count,c.required_count);}
 const reviewed=reviewAssignments(input,r.assignments.map(plain));assert.deepEqual(reviewed.coverage,r.coverage);assert.equal(JSON.stringify(input),before,'review must not mutate input');return r;}
test('many applicants fill only declared demand with experience target then stable ties and deterministic output',()=>{
 const f=fixture(10,3);f.employees[0].skill_level='CREW_TRAINING';f.employees[1].skill_level='NEW';
 const r=verify(f);assert.equal(r.assigned_count,3);assert.deepEqual(r.assignments.map(a=>a.employee_id),['nv-01','nv-02','nv-03']);
 assert.deepEqual(generateSchedule({...f,employees:[...f.employees].reverse(),registrations:[...f.registrations].reverse()}),r);
});
test('one employee registering fourteen adjacent shifts is capped at forty hours across seven days',()=>{
 const f=fixture(1);f.requirements=days.flatMap((day,i)=>[need(`am-${i}`,day),need(`pm-${i}`,day,'afternoon')]);
 f.registrations=days.flatMap(day=>[registration('nv-01',day),registration('nv-01',day,'afternoon')]);
 const r=verify(f);assert.equal(r.required_count,14);assert.equal(r.assigned_count,10);assert.equal(r.shortages.length,4);assert.equal(r.employee_statistics[0].total_weekly_hours,40);
 assert.throws(()=>reviewAssignments(f,f.registrations.map(r=>assignment(r.employee_id,r.work_date,r.shift_id))),e=>e.code==='WEEKLY_LIMIT_EXCEEDED');
});
test('unselected days are OFF for a submitted employee and cannot be added by manual review',()=>{
 const f=fixture(1);f.requirements=days.map((day,i)=>need(`day-${i}`,day));f.registrations=[registration('nv-01',days[0]),registration('nv-01',days[2])];
 const r=verify(f);assert.equal(r.assigned_count,2);assert.deepEqual(r.assignments.map(a=>a.work_date),[days[0],days[2]]);assert.equal(r.shortages.length,5);
 assert.throws(()=>reviewAssignments(f,[assignment('nv-01',days[1])]),e=>e.code==='REGISTRATION_REQUIRED');
});
test('insufficient people remain visible as shortage; duplicate preferences cannot invent staff',()=>{
 const f=fixture(2,3);f.registrations.push({...f.registrations[0]});const r=verify(f);assert.equal(r.assigned_count,2);assert.equal(r.shortages[0].missing_count,1);
 assert.throws(()=>reviewAssignments(f,[assignment('nv-01'),assignment('nv-01')]),e=>e.code==='DUPLICATE_ASSIGNMENT');
});
test('skill shortage excludes unqualified staff and manual replacement must respect skills',()=>{
 const f=fixture(3,2);f.requirements[0].required_skill_name='hot-kitchen';f.employees[1].skills=[];f.employees[2].skills=[];
 const r=verify(f);assert.equal(r.assigned_count,1);assert.equal(r.shortages[0].missing_count,1);
 assert.throws(()=>reviewAssignments(f,[assignment('nv-02')]),e=>e.code==='SKILL_MISMATCH');
 const accepted=reviewAssignments(f,[assignment('nv-01')]);assert.equal(accepted.assigned_count,1);assert.equal(accepted.shortages[0].missing_count,1);
});
test('existing overlapping assignment forces another candidate; manager cannot override overlap',()=>{
 const f=fixture(2);f.shifts.push({id:'booked',start_time:'10:00:00',end_time:'14:00:00',is_active:true});f.existing=[assignment('nv-01',days[0],'booked')];
 const r=verify(f);assert.equal(r.assignments[0].employee_id,'nv-02');assert.throws(()=>reviewAssignments(f,[assignment('nv-01')]),e=>e.code==='SHIFT_OVERLAP');
});
test('manually assigning one employee to two overlapping registered shifts is rejected',()=>{
 const f=fixture(1);f.shifts[1]={...f.shifts[1],start_time:'11:00:00',end_time:'15:00:00'};f.requirements.push(need('pm',days[0],'afternoon'));f.registrations.push(registration('nv-01',days[0],'afternoon'));
 const r=verify(f);assert.equal(r.assigned_count,1);assert.equal(r.shortages.length,1);
 assert.throws(()=>reviewAssignments(f,[assignment('nv-01'),assignment('nv-01',days[0],'afternoon')]),e=>e.code==='SHIFT_OVERLAP');
});
test('manual add remove replacement preserves original suggestion and recomputes coverage only when valid',()=>{
 const f=fixture(3,2),original=verify(f),before=JSON.stringify(original);
 const removed=reviewAssignments(f,[assignment('nv-03')]);assert.equal(removed.assigned_count,1);assert.equal(removed.shortages[0].missing_count,1);
 const replaced=reviewAssignments(f,[assignment('nv-02'),assignment('nv-03')]);assert.equal(replaced.assigned_count,2);assert.equal(replaced.shortages.length,0);
 const excess=reviewAssignments(f,[assignment('nv-01'),assignment('nv-02'),assignment('nv-03')]);assert.equal(excess.coverage[0].excess_count,1);assert.ok(excess.coverage[0].warnings.includes('STAFFING_EXCESS'));
 f.employees[0].department_id='service';assert.throws(()=>reviewAssignments(f,[assignment('nv-01')]),e=>e.code==='DEPARTMENT_MISMATCH');assert.equal(JSON.stringify(original),before);
});
