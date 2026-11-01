const {test}=require('node:test'),assert=require('node:assert/strict');
const {generateSchedule,optimizeScheduleAssignments,scheduleBalance,reviewAssignments}=require('../dist/services/scheduling.engine.js');
function fixture(){return {
 period:{id:'p',branch_id:'b',work_start_date:'2026-11-02',work_end_date:'2026-11-08',status:'CLOSED'},
 employees:['a','b','c'].map(id=>({id,employee_code:id,department_id:'d',skill_level:'REGULAR',status:'ACTIVE',is_active:true,role:'NV',max_weekly_hours:null,skills:['fry']})),
 shifts:[{id:'s',start_time:'08:00:00',end_time:'12:00:00',is_active:true},{id:'night',start_time:'22:00:00',end_time:'06:00:00',is_active:true}],
 registrations:['a','b','c'].flatMap(employee_id=>['2026-11-02','2026-11-03'].map(work_date=>({employee_id,work_date,shift_id:'s',status:'VALID'}))),
 requirements:['2026-11-02','2026-11-03'].map((work_date,i)=>({id:`r${i}`,department_id:'d',work_date,shift_id:'s',required_count:1,required_skill_name:'fry'})),
 existing:[],new_employee_count_threshold:null};}
function seed(x,id='a'){return x.requirements.map(n=>({employee_id:id,department_id:n.department_id,shift_id:n.shift_id,work_date:n.work_date,requirement_id:n.id,reason:'ORIGINAL_CHOICE'}));}
function check(x,initial,optimized){const a=reviewAssignments(x,initial),b=reviewAssignments(x,optimized.assignments);
 assert.deepEqual(b.coverage.map(c=>[c.id,c.assigned_count,c.missing_count]),a.coverage.map(c=>[c.id,c.assigned_count,c.missing_count]));
 for(const c of b.coverage)assert.ok(c.experienced_count>=a.coverage.find(n=>n.id===c.id).experienced_count);
 assert.ok(optimized.optimization.after.objective<=optimized.optimization.before.objective);
 assert.deepEqual(scheduleBalance(x,optimized.assignments).departments,optimized.optimization.after.departments);
}
test('strict improvement includes eligible zero-hour staff and retains an honest selection history',()=>{
 const x=fixture(),initial=seed(x),before=JSON.stringify({x,initial}),r=optimizeScheduleAssignments(x,initial);
 check(x,initial,r);assert.equal(JSON.stringify({x,initial}),before);assert.equal(r.optimization.iterations,1);assert.equal(r.optimization.converged,true);
 assert.ok(Math.abs(r.optimization.before.objective-128/3)<1e-8);assert.ok(Math.abs(r.optimization.after.objective-32/3)<1e-8);
 const changed=r.assignments.find(a=>a.employee_id!=='a');assert.equal(changed.employee_id,'b');assert.match(changed.reason,/^LOCAL_SEARCH_REPLACEMENT;/);
 assert.deepEqual(changed.selection_history.initial,{employee_id:'a',reason:'ORIGINAL_CHOICE'});const event=changed.selection_history.replacements[0];assert.equal(event.from_employee_id,'a');assert.equal(event.to_employee_id,'b');assert.ok(event.objective_after<event.objective_before);
 assert.match(r.assignments.find(a=>a.employee_id==='a').reason,/^INITIAL_SELECTION;/);
 assert.equal(r.optimization.before.departments[0].employee_count,3);assert.equal(r.optimization.after.departments[0].employee_count,3);
});
test('unregistered, wrong department, missing skill, inactive, overlap and configured caps cannot be used',()=>{
 for(const change of [
  x=>x.registrations=x.registrations.filter(a=>a.employee_id==='a'),
  x=>x.employees.slice(1).forEach(e=>e.department_id='other'),
  x=>x.employees.slice(1).forEach(e=>e.skills=[]),
  x=>x.employees.slice(1).forEach(e=>e.is_active=false),
  x=>x.employees.slice(1).forEach(e=>e.max_weekly_hours=3),
  x=>{x.shifts.push({id:'booked',start_time:'09:00:00',end_time:'13:00:00',is_active:true});x.existing=['b','c'].flatMap(employee_id=>x.requirements.map(n=>({employee_id,department_id:'d',work_date:n.work_date,shift_id:'booked'})));},
  x=>{x.test_rules={max_shifts_per_day:1};x.shifts.push({id:'booked',start_time:'12:00:00',end_time:'16:00:00',is_active:true});x.existing=['b','c'].flatMap(employee_id=>x.requirements.map(n=>({employee_id,department_id:'d',work_date:n.work_date,shift_id:'booked'})));},
 ]){const x=fixture();change(x);const initial=seed(x),r=optimizeScheduleAssignments(x,initial);check(x,initial,r);assert.equal(r.optimization.iterations,0);assert.ok(r.assignments.every(a=>a.employee_id==='a'));}
});
test('even surplus experienced workers cannot be replaced by NEW; NEW can be replaced by experience',()=>{
 const x=fixture();x.requirements=x.requirements.slice(0,1);x.employees[2].skill_level='NEW';
 x.existing=[{employee_id:'a',department_id:'d',work_date:'2026-11-03',shift_id:'s'},{employee_id:'b',department_id:'d',work_date:'2026-11-03',shift_id:'s'}];
 const r=optimizeScheduleAssignments(x,seed(x));assert.equal(r.optimization.iterations,0);assert.equal(r.assignments[0].employee_id,'a');
 x.employees[0].skill_level='NEW';x.existing=x.existing.filter(a=>a.employee_id==='a');const improved=optimizeScheduleAssignments(x,seed(x));check(x,seed(x),improved);assert.equal(improved.assignments[0].employee_id,'b');
});
test('preserves the full experienced count, including workers above the min(2, demand) target',()=>{
 const x=fixture();x.employees.push({...x.employees[0],id:'new',employee_code:'new',skill_level:'NEW'});
 x.requirements=x.requirements.slice(0,1);x.requirements[0].required_count=3;
 x.registrations.push({employee_id:'new',work_date:'2026-11-02',shift_id:'s',status:'VALID'});
 x.existing=['a','b','c'].map(employee_id=>({employee_id,work_date:'2026-11-03',shift_id:'s',department_id:'d'}));
 const initial=['a','b','c'].map(id=>seed(x,id)[0]),r=optimizeScheduleAssignments(x,initial);
 assert.ok(scheduleBalance(x,[...initial.slice(1),{...initial[0],employee_id:'new'}]).objective<r.optimization.before.objective);
 check(x,initial,r);assert.equal(r.optimization.iterations,0);assert.equal(reviewAssignments(x,r.assignments).coverage[0].experienced_count,3);
});
test('existing and explicitly fixed assignments remain untouched and contribute to hours',()=>{
 const x=fixture();x.existing=[{employee_id:'a',department_id:'d',work_date:'2026-11-04',shift_id:'s'}];
 const initial=seed(x);initial[0].fixed=true;const before=JSON.stringify(x.existing),r=optimizeScheduleAssignments(x,initial);check(x,initial,r);
 assert.deepEqual(r.assignments.find(a=>a.work_date===initial[0].work_date),initial[0]);assert.equal(JSON.stringify(x.existing),before);assert.equal(r.optimization.before.departments[0].total_hours,12);
 const fixed=initial.map(a=>({...a,fixed:true})),locked=optimizeScheduleAssignments(x,fixed);assert.deepEqual(locked.assignments,fixed);assert.equal(locked.optimization.iterations,0);
});
test('deterministic under reordered inputs, converges without equal-score swaps and is idempotent',()=>{
 const x=fixture(),initial=seed(x),r=optimizeScheduleAssignments(x,initial);
 const reverse={...x,employees:[...x.employees].reverse(),registrations:[...x.registrations].reverse(),requirements:[...x.requirements].reverse(),shifts:[...x.shifts].reverse()};
 assert.deepEqual(optimizeScheduleAssignments(reverse,[...initial].reverse()),r);
 const again=optimizeScheduleAssignments(x,r.assignments);assert.equal(again.optimization.iterations,0);assert.deepEqual(again.assignments,r.assignments);
 assert.equal(again.optimization.before.objective,again.optimization.after.objective);
});
test('iteration budget is deterministic and returns a valid strictly improving partial plan',()=>{
 const x=fixture();x.requirements.push({...x.requirements[0],id:'r2',work_date:'2026-11-04'},{...x.requirements[0],id:'r3',work_date:'2026-11-05'});
 for(const employee_id of ['a','b','c'])for(const work_date of ['2026-11-04','2026-11-05'])x.registrations.push({employee_id,work_date,shift_id:'s',status:'VALID'});
 const initial=seed(x),r=optimizeScheduleAssignments(x,initial,1);check(x,initial,r);assert.equal(r.optimization.iterations,1);assert.equal(r.optimization.limit_reached,true);assert.equal(r.optimization.converged,false);
 assert.ok(optimizeScheduleAssignments(x,initial).optimization.after.objective<r.optimization.after.objective);
 assert.equal(optimizeScheduleAssignments(x,initial,0).optimization.after.objective,r.optimization.before.objective);
});
test('objective uses within-department deviations and the existing overnight week clipping',()=>{
 const x=fixture();x.employees[2].department_id='other';x.existing=[{employee_id:'c',department_id:'other',work_date:'2026-11-08',shift_id:'night'}];
 const metric=scheduleBalance(x,seed(x));assert.equal(metric.hours.get('c'),2);assert.equal(metric.departments.find(d=>d.department_id==='other').squared_deviation,0);assert.equal(metric.objective,32);
});
test('generate runs optimization automatically; manual review does not change a supplied plan',()=>{
 const x=fixture(),greedy=generateSchedule(x,{optimize:false}),r=generateSchedule(x);
 assert.ok(r.optimization);assert.equal(r.assigned_count,greedy.assigned_count);assert.deepEqual(r.coverage,greedy.coverage);
 assert.deepEqual(reviewAssignments(x,seed(x)).assignments.map(a=>a.employee_id),['a','a']);
});
