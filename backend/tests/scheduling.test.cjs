const {test} = require('node:test');
const assert = require('node:assert/strict');
const {generateSchedule,interval} = require('../dist/services/scheduling.engine.js');
function fixture() {
  return {period:{id:'p',branch_id:'b',work_start_date:'2026-11-02',work_end_date:'2026-11-08',status:'CLOSED'},
    employees:['a','b'].map(id=>({id,department_id:'d',skill_level:'REGULAR',status:'ACTIVE',is_active:true,role:'NV',max_weekly_hours:null,skills:['fry']})),
    shifts:[{id:'s',start_time:'08:00:00',end_time:'12:00:00',is_active:true}],
    registrations:['a','b'].map(employee_id=>({employee_id,work_date:'2026-11-02',shift_id:'s',status:'VALID'})),
    requirements:[{id:'r',department_id:'d',work_date:'2026-11-02',shift_id:'s',required_count:2,required_skill_name:'fry'}],existing:[],new_employee_count_threshold:null};
}
test('fills demand, explains decisions, reports stats and never exceeds demand',()=>{
  const x=fixture(),r=generateSchedule(x); assert.equal(r.assigned_count,2);assert.deepEqual(r.shortages,[]);
  assert.equal(r.employee_statistics[0].total_weekly_hours,4); assert.match(r.assignments[0].reason,/VALID_REGISTRATION/);
  x.requirements[0].required_count=1; assert.equal(generateSchedule(x).assigned_count,1);
});
test('shortages are retained, with no invalid fallback',()=>{const x=fixture();x.requirements[0].required_count=3;assert.equal(generateSchedule(x).shortages[0].missing_count,1);});
for (const [name,mutate] of [
  ['missing registration',x=>x.registrations=[]], ['draft registration',x=>x.registrations.forEach(r=>r.status='DRAFT')],
  ['invalid registration',x=>x.registrations.forEach(r=>r.status='INVALID')],
  ['skill mismatch',x=>x.requirements[0].required_skill_name='cash'],
  ['department mismatch',x=>x.requirements[0].department_id='other'],
  ['inactive employee',x=>x.employees.forEach(e=>e.status='INACTIVE')],
  ['inactive account',x=>x.employees.forEach(e=>e.is_active=false)],
  ['wrong business role',x=>x.employees.forEach(e=>e.role='QL')],
  ['Crew Leader excluded from regular demand',x=>x.employees.forEach(e=>e.skill_level='CREW_LEADER')],
  ['weekly limit',x=>x.employees.forEach(e=>e.max_weekly_hours=3.99)],
]) test(name,()=>{const x=fixture();mutate(x);assert.equal(generateSchedule(x).assigned_count,0);});
test('overlapping shifts on different IDs cannot double book an employee',()=>{
  const x=fixture();x.employees=x.employees.slice(0,1);x.requirements[0].required_count=1;
  x.shifts.push({id:'t',start_time:'11:00:00',end_time:'15:00:00',is_active:true});
  x.requirements.push({...x.requirements[0],id:'r2',shift_id:'t'});x.registrations.push({...x.registrations[0],shift_id:'t'});
  assert.equal(generateSchedule(x).assigned_count,1);
});
test('previous-day overnight commitment blocks overlap; touching endpoints permitted',()=>{
  const x=fixture();x.employees=x.employees.slice(0,1);
  x.shifts.push({id:'night',start_time:'23:00:00',end_time:'09:00:00',is_active:true});
  x.existing.push({employee_id:'a',work_date:'2026-11-01',shift_id:'night',department_id:'d'});
  assert.equal(generateSchedule(x).assigned_count,0);
  x.shifts[1].end_time='08:00:00';assert.equal(generateSchedule(x).assigned_count,1);
});
test('weekly cap includes existing work and permits exact limit',()=>{
  const x=fixture();x.employees=x.employees.slice(0,1);x.employees[0].max_weekly_hours=8;
  x.existing.push({employee_id:'a',work_date:'2026-11-03',shift_id:'s',department_id:'d'});
  assert.equal(generateSchedule(x).employee_statistics[0].total_weekly_hours,8);
  x.employees[0].max_weekly_hours=7.99;assert.equal(generateSchedule(x).assigned_count,0);
});
test('level priority precedes fairness; equal levels choose least shifts then stable ID',()=>{
  const x=fixture();x.requirements[0].required_count=1;
  x.existing.push({employee_id:'a',work_date:'2026-11-03',shift_id:'s',department_id:'d'});
  assert.equal(generateSchedule(x).assignments[0].employee_id,'b');
  x.employees[0].skill_level='CREW_TRAINING';assert.equal(generateSchedule(x).assignments[0].employee_id,'a');
  x.existing=[];x.employees[0].skill_level='REGULAR';x.employees.reverse();x.registrations.reverse();
  assert.equal(generateSchedule(x).assignments[0].employee_id,'a');
});
test('scarce skill demand is filled first to preserve coverage',()=>{
  const x=fixture();x.employees[1].skills=[];x.requirements[0].required_count=1;x.requirements[0].required_skill_name=null;
  x.shifts.push({...x.shifts[0],id:'t'});x.requirements.push({...x.requirements[0],id:'r2',shift_id:'t',required_skill_name:'fry'});
  x.registrations.push(...x.registrations.map(r=>({...r,shift_id:'t'})));assert.equal(generateSchedule(x).assigned_count,2);
});
test('duplicate registrations do not duplicate assignments',()=>{const x=fixture();x.registrations.push(...x.registrations);assert.equal(generateSchedule(x).assigned_count,2);});
test('empty needs, invalid count, duplicate needs and open period rejected',()=>{
  for (const change of [x=>x.requirements=[],x=>x.requirements[0].required_count=-1,x=>x.requirements.push({...x.requirements[0]}),x=>x.period.status='OPEN',x=>x.shifts[0].is_active=false]) {
    const x=fixture();change(x);assert.throws(()=>generateSchedule(x));
  }
});
test('warning requires configured threshold reached AND no Crew Training',()=>{
  const x=fixture();x.employees.forEach(e=>e.skill_level='NEW');
  assert.equal(generateSchedule(x).coverage[0].warning,null);x.new_employee_count_threshold=1;
  assert.equal(generateSchedule(x).coverage[0].warning,'MANY_NEW_WITHOUT_CREW_TRAINING');
  x.new_employee_count_threshold=2;assert.equal(generateSchedule(x).coverage[0].warning,'MANY_NEW_WITHOUT_CREW_TRAINING');
  x.new_employee_count_threshold=3;assert.equal(generateSchedule(x).coverage[0].warning,null);
  x.new_employee_count_threshold=1;x.employees[0].skill_level='CREW_TRAINING';assert.equal(generateSchedule(x).coverage[0].warning,null);
});
test('overnight duration and target-week clipping use fixed Vietnam offset',()=>{
  assert.equal(interval('2026-11-08',{start_time:'22:00:00',end_time:'06:00:00'})[1]-interval('2026-11-08',{start_time:'22:00:00',end_time:'06:00:00'})[0],8*3600);
  const x=fixture();x.shifts[0].start_time='22:00:00';x.shifts[0].end_time='06:00:00';
  x.requirements[0].work_date='2026-11-08';x.registrations.forEach(r=>r.work_date='2026-11-08');
  assert.equal(generateSchedule(x).employee_statistics[0].total_weekly_hours,2);
});
module.exports={fixture};

test('Sunday overnight assignment respects hours already booked in next week',()=>{
  const x=fixture();x.employees=x.employees.slice(0,1);x.employees[0].max_weekly_hours=8;
  x.shifts[0].start_time='22:00:00';x.shifts[0].end_time='06:00:00';
  x.requirements[0].work_date='2026-11-08';x.registrations.forEach(r=>r.work_date='2026-11-08');
  x.existing.push({employee_id:'a',work_date:'2026-11-10',shift_id:'s',department_id:'d'});
  assert.equal(generateSchedule(x).assigned_count,0);
});
test('a requirement cannot use another branch shift even when that shift is loaded for conflicts',()=>{
  const x=fixture();x.shifts[0].branch_id='another-branch';assert.throws(()=>generateSchedule(x),e=>e.code==='INVALID_REQUIREMENT');
});

test('scarcity counts weekly-hour eligibility so feasible long shift is not stranded',()=>{
  const x=fixture();x.requirements[0].required_count=1;
  x.employees[0].max_weekly_hours=5;x.employees[1].max_weekly_hours=4;
  x.shifts.push({id:'t',start_time:'12:00:00',end_time:'17:00:00',is_active:true});
  x.requirements.push({...x.requirements[0],id:'r2',shift_id:'t'});
  x.registrations.push(...x.registrations.map(r=>({...r,shift_id:'t'})));
  const result=generateSchedule(x);
  assert.equal(result.assigned_count,2,'B can cover 4h; only A can cover 5h');
  assert.equal(result.assignments.find(a=>a.shift_id==='s').employee_id,'b');
  assert.equal(result.assignments.find(a=>a.shift_id==='t').employee_id,'a');
});

test('scarcity counts existing overlap eligibility without changing level priority within a shift',()=>{
  const x=fixture();x.requirements[0].required_count=1;
  x.shifts.push({id:'t',start_time:'12:00:00',end_time:'17:00:00',is_active:true},
    {id:'booked',start_time:'12:00:00',end_time:'17:00:00',is_active:true});
  x.requirements.push({...x.requirements[0],id:'r2',shift_id:'t'});
  x.registrations.push(...x.registrations.map(r=>({...r,shift_id:'t'})));
  x.existing=[{employee_id:'b',work_date:'2026-11-02',shift_id:'booked',department_id:'d'}];
  x.employees[0].max_weekly_hours=5;
  const result=generateSchedule(x);assert.equal(result.assigned_count,2);
  assert.equal(result.assignments.find(a=>a.shift_id==='t').employee_id,'a');
});
