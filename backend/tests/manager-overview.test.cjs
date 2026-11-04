const {test}=require('node:test'),assert=require('node:assert/strict');
const {managerOverview}=require('../dist/services/manager-overview.service.js');
const calendar={period:{id:'week'},employees:[{id:'a'},{id:'b'},{id:'c'}],declarations:[{employee_id:'a',declaration:'SHIFT'},{employee_id:'a',declaration:'OFF'},{employee_id:'b',declaration:'OFF'}],schedules:[{id:'published',version:1,status:'PUBLISHED',published_at:'date',created_at:'date',schedule_group_id:'group'},{id:'draft',version:2,status:'DRAFT',created_at:'later',schedule_group_id:'group'}],assignments:[{id:'old',schedule_id:'published',employee_id:'a',work_date:'day',shift_id:'s',department_id:'d',status:'REPLACED'},{id:'new',schedule_id:'published',employee_id:'b',work_date:'day',shift_id:'s',department_id:'d',status:'ACTIVE'},{id:'planned',schedule_id:'draft',employee_id:'c',work_date:'day',shift_id:'s',department_id:'d',status:'DRAFT'}]};
test('dashboard uses current published assignments after replacement and deduplicates people',()=>{
 const r=managerOverview(calendar,[{work_date:'day',shift_id:'s',department_id:'d',required_count:2}],[{kind:'REQUEST',status:'SEARCHING',original_assignment_id:'old'},{kind:'REQUEST',status:'PENDING',original_assignment_id:'outside'}]);
 assert.equal(r.employee_count,3);assert.equal(r.registered_employees,2);assert.equal(r.assignment_count,1);assert.equal(r.assignment_kind,'official');assert.equal(r.schedule_status,'DRAFT');assert.equal(r.pending_requests,1);assert.equal(r.shortage_cells,1);assert.equal(r.shortage_positions,1);
});
test('dashboard distinguishes zero, absent schedule, absent demand, and ambiguous published groups',()=>{
 const empty=managerOverview({...calendar,schedules:[],assignments:[],declarations:[]},[],[]);assert.equal(empty.assignment_count,null);assert.equal(empty.shortage_cells,null);assert.equal(empty.registered_employees,0);assert.equal(empty.pending_requests,0);
 const complete=managerOverview(calendar,[{work_date:'day',shift_id:'s',department_id:'d',required_count:1}],[]);assert.equal(complete.shortage_cells,0);
 assert.throws(()=>managerOverview({...calendar,schedules:[...calendar.schedules,{id:'other',version:3,status:'PUBLISHED',published_at:'date',created_at:'date',schedule_group_id:'other'}]},[],[]));
});
