const {test}=require('node:test'),assert=require('node:assert/strict');
const {generateSchedule,reviewAssignments,scheduleBalance}=require('../dist/services/scheduling.engine.js');
const {findAlternative,assignmentFingerprint,parseAlternativeHistory}=require('../dist/services/schedule-alternatives.service.js');
function fixture(n=3,days=1){return {period:{id:'p',branch_id:'b',work_start_date:'2026-11-02',work_end_date:'2026-11-08',status:'CLOSED'},employees:Array.from({length:n},(_,i)=>({id:String(i),department_id:'d',skill_level:'REGULAR',status:'ACTIVE',is_active:true,role:'NV',skills:[],max_weekly_hours:40})),shifts:[{id:'s',start_time:'08:00:00',end_time:'12:00:00',is_active:true}],registrations:Array.from({length:n},(_,i)=>Array.from({length:days},(_,d)=>({employee_id:String(i),work_date:'2026-11-0'+(2+d),shift_id:'s',status:'VALID'}))).flat(),requirements:Array.from({length:days},(_,d)=>({id:String(d),department_id:'d',work_date:'2026-11-0'+(2+d),shift_id:'s',required_count:1,required_skill_name:null})),existing:[],new_employee_count_threshold:null};}
const plain=rows=>rows.map(({employee_id,work_date,shift_id,department_id})=>({employee_id,work_date,shift_id,department_id}));
test('repeated alternatives never cycle A B A and leave first generation unchanged',()=>{
 const x=fixture(),a=generateSchedule(x),history=[plain(a.assignments)];let current=a.assignments;
 for(let i=0;i<2;i++){const r=findAlternative(x,current,history);assert.equal(r.status,'FOUND');assert.ok(!history.some(h=>assignmentFingerprint(h)===assignmentFingerprint(r.result.assignments)));assert.ok(scheduleBalance(x,r.result.assignments).objective<=scheduleBalance(x,current).objective);reviewAssignments(x,r.result.assignments);history.push(plain(r.result.assignments));current=r.result.assignments;}
 const r=findAlternative(x,current,history);assert.equal(r.status,'NOT_FOUND');assert.equal(assignmentFingerprint(r.result.assignments),assignmentFingerprint(current));assert.deepEqual(generateSchedule(x),a);
});
test('controlled swap succeeds when single replacements worsen balance; ordering is not a new plan',()=>{
 const x=fixture(2,2),a=generateSchedule(x),r=findAlternative(x,a.assignments,[]);assert.equal(r.status,'FOUND');assert.equal(r.result.assignments.filter((row,i)=>row.employee_id!==a.assignments[i].employee_id).length,2);assert.equal(scheduleBalance(x,r.result.assignments).objective,0);assert.equal(assignmentFingerprint([...r.result.assignments].reverse()),assignmentFingerprint(r.result.assignments));
});
test('availability experience and weekly limits remain enforced; untrusted fingerprints rejected',()=>{
 for(const change of [x=>{x.registrations=x.registrations.filter(r=>r.employee_id==='0');},x=>{x.employees[1].skill_level='NEW';},x=>{x.employees[1].max_weekly_hours=1;}]){const x=fixture(2);change(x);const a=generateSchedule(x);assert.equal(findAlternative(x,a.assignments,[]).status,'NOT_FOUND');}
 assert.throws(()=>findAlternative(fixture(),[{employee_id:'unknown',department_id:'d',shift_id:'s',work_date:'2026-11-02'}],[]));assert.throws(()=>parseAlternativeHistory(['forged']),e=>e.code==='INVALID_ALTERNATIVE_HISTORY');assert.throws(()=>parseAlternativeHistory(Array(65).fill([])));
});
