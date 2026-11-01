const {test}=require('node:test');
const assert=require('node:assert/strict');
const {generateSchedule,reviewAssignments}=require('../dist/services/scheduling.engine.js');
function fixture(levels=['REGULAR','CREW_TRAINING','NEW']) {
 const employees=levels.map((skill_level,i)=>({id:String(i),employee_code:`NV${i}`,department_id:'d',skill_level,status:'ACTIVE',is_active:true,role:'NV',max_weekly_hours:null,skills:['fry']}));
 return {period:{id:'p',branch_id:'b',work_start_date:'2026-11-02',work_end_date:'2026-11-08',status:'CLOSED'},employees,
 shifts:[{id:'s',start_time:'08:00:00',end_time:'12:00:00',is_active:true},{id:'long',start_time:'12:00:00',end_time:'20:00:00',is_active:true}],
 registrations:employees.map(e=>({employee_id:e.id,work_date:'2026-11-02',shift_id:'s',status:'VALID'})),
 requirements:[{id:'r',work_date:'2026-11-02',shift_id:'s',department_id:'d',required_count:1,required_skill_name:'fry'}],existing:[],new_employee_count_threshold:null};
}
const booking=(id,date='2026-11-03',shift='s')=>({employee_id:id,work_date:date,shift_id:shift,department_id:'d'});
function verify(x){const before=JSON.stringify(x),r=generateSchedule(x);assert.equal(JSON.stringify(x),before);assert.equal(r.assigned_count,r.assignments.length);assert.equal(r.covered_count,r.assigned_count+r.existing_count);assert.deepEqual(reviewAssignments(x,r.assignments).coverage,r.coverage);return r;}
test('one-person cell needs one experienced worker, REGULAR and training are equal',()=>{
 const x=fixture();x.existing=[booking('1')];const r=verify(x);assert.equal(r.assignments[0].employee_id,'0');assert.equal(r.coverage[0].experienced_target,1);assert.equal(r.coverage[0].warning,null);
});
test('after two experienced workers NEW wins by fewer hours; never demand a third experienced worker',()=>{
 const x=fixture(['REGULAR','CREW_TRAINING','REGULAR','NEW']);x.requirements[0].required_count=3;
 x.existing=[booking('0'),booking('1'),booking('2','2026-11-03','long')];const r=verify(x);
 assert.deepEqual(r.assignments.map(a=>a.employee_id),['0','1','3']);assert.equal(r.coverage[0].experienced_count,2);
});
test('NEW fills missing experience and reports composition independently from staffing',()=>{
 const x=fixture(['REGULAR','NEW','NEW']);x.requirements[0].required_count=3;const r=verify(x);
 assert.equal(r.assigned_count,3);assert.equal(r.shortages.length,0);assert.equal(r.coverage[0].missing_experienced_count,1);assert.equal(r.coverage[0].warning,'EXPERIENCE_SHORTAGE');
 x.registrations=[];const empty=verify(x);assert.equal(empty.shortages[0].missing_count,3);assert.deepEqual(empty.coverage[0].warnings,['STAFFING_SHORTAGE','EXPERIENCE_SHORTAGE']);
});
test('hours beat shift count and employee code; explanation records decision inputs',()=>{
 const x=fixture(['REGULAR','REGULAR']);x.existing=[booking('0','2026-11-03','long'),booking('1','2026-11-03'),booking('1','2026-11-04')];
 x.shifts.push({id:'short',start_time:'08:00:00',end_time:'10:00:00',is_active:true});x.existing[1].shift_id='short';x.existing[2].shift_id='short';
 const r=verify(x);assert.equal(r.assignments[0].employee_id,'1');assert.match(r.assignments[0].reason,/PRIOR_HOURS=4;/);assert.match(r.assignments[0].reason,/WEEKLY_LIMIT_NOT_CONFIGURED/);
});
test('holiday counts break equal hours only on an explicitly marked holiday',()=>{
 const x=fixture(['REGULAR','REGULAR']);x.existing=[booking('0','2026-11-03'),booking('1','2026-11-04')];
 x.holiday_dates=['2026-11-02','2026-11-03'];assert.equal(verify(x).assignments[0].employee_id,'1');
 x.holiday_dates=['2026-11-03'];assert.equal(verify(x).assignments[0].employee_id,'0');
 x.existing[1].shift_id='long';x.holiday_dates.push('2026-11-02');assert.equal(verify(x).assignments[0].employee_id,'0');
});
test('remaining ties use shift count then employee code regardless of input ordering',()=>{
 const x=fixture(['REGULAR','REGULAR']);x.employees[0].employee_code='Z';x.employees[1].employee_code='A';assert.equal(verify(x).assignments[0].employee_id,'1');
 x.employees.reverse();x.registrations.reverse();assert.equal(verify(x).assignments[0].employee_id,'1');
 x.existing=[booking('1')];assert.equal(verify(x).assignments[0].employee_id,'0');
});
test('valid existing work covers demand once, counts experience and never enters write payload',()=>{
 const x=fixture();const a=booking('0','2026-11-02');x.existing=[a,{...a}];x.requirements[0].required_count=2;
 const r=verify(x);assert.equal(r.existing_count,1);assert.equal(r.assigned_count,1);assert.equal(r.covered_count,2);assert.equal(r.shortages.length,0);assert.equal(r.coverage[0].experienced_count,2);
 assert.equal(r.employee_statistics.find(e=>e.employee_id==='0').total_weekly_hours,4);
 assert.throws(()=>reviewAssignments(x,[booking('1','2026-11-02'),booking('2','2026-11-02')]),e=>e.code==='DEMAND_EXCEEDED');
});
test('existing outside period, wrong department, without registration or skill never covers demand',()=>{
 for(const change of [x=>x.existing[0].work_date='2026-11-01',x=>x.existing[0].department_id='other',x=>x.registrations=x.registrations.filter(r=>r.employee_id!=='0'),x=>x.employees[0].skills=[]]){
 const x=fixture();x.existing=[booking('0','2026-11-02')];change(x);assert.equal(verify(x).existing_count,0);}
});
test('conflicting existing assignments are not treated as valid coverage',()=>{
 const x=fixture();x.shifts.push({id:'overlap',start_time:'09:00:00',end_time:'13:00:00',is_active:true});x.existing=[booking('0','2026-11-02'),booking('0','2026-11-02','overlap')];assert.equal(verify(x).existing_count,0);
});
test('no implicit weekly or daily cap; configured caps remain enforced',()=>{
 const x=fixture(['REGULAR']);x.requirements=[];x.registrations=[];
 for(let d=2;d<=8;d++)for(const shift of ['s','long']){const date=`2026-11-0${d}`;x.requirements.push({...fixture().requirements[0],id:date+shift,work_date:date,shift_id:shift});x.registrations.push({employee_id:'0',work_date:date,shift_id:shift,status:'VALID'});}
 assert.equal(verify(x).employee_statistics[0].total_weekly_hours,84);
 x.employees[0].max_weekly_hours=40;assert.ok(verify(x).employee_statistics[0].total_weekly_hours<=40);
 x.employees[0].max_weekly_hours=null;x.test_rules={max_shifts_per_day:1};assert.equal(verify(x).assigned_count,7);
});

test('equal hours use fewer shifts before employee code',()=>{
 const x=fixture(['REGULAR','REGULAR']);x.existing=[booking('0','2026-11-03'),booking('0','2026-11-04'),booking('1','2026-11-03','long')];
 assert.equal(verify(x).assignments[0].employee_id,'1');
});
test('existing valid experienced staff satisfy composition before balancing new slots',()=>{
 const x=fixture(['REGULAR','CREW_TRAINING','NEW','REGULAR']);x.requirements[0].required_count=3;
 x.existing=[booking('0','2026-11-02'),booking('1','2026-11-02'),booking('3','2026-11-03')];
 const r=verify(x);assert.equal(r.assignments[0].employee_id,'2');assert.equal(r.coverage[0].composition_status,'PASS');
});
test('explicit empty calendar is allowed; malformed holiday dates fail closed',()=>{
 const x=fixture();x.holiday_dates=[];verify(x);
 for(const date of ['2026-02-30','not-a-date']){x.holiday_dates=[date];assert.throws(()=>generateSchedule(x),e=>e.code==='INVALID_HOLIDAY_CALENDAR');}
});

test('AI coverage levels include valid existing workers and use the confirmed composition warning',()=>{
 const {buildAISummary}=require('../dist/services/schedule-ai.summary.js');
 const x=fixture();x.existing=[booking('0','2026-11-02')];x.requirements[0].required_count=2;
 const r=verify(x),snapshot={...x,source:'mock',branch:{id:'b',name:'Test'},departments:[{id:'d',name:'Test'}],employees:x.employees.map(e=>({...e,branch_id:'b',full_name:e.id})),registrations:x.registrations.map((v,i)=>({...v,id:String(i),period_id:'p'})),shifts:x.shifts.map(s=>({...s,name:s.id}))};
 const {summary}=buildAISummary({rule_snapshot:snapshot,assignments:r.assignments,scope:'preview',validation:{hard_constraints:'PASS',data_complete:true,coverage_complete:true,issues:[],warnings:[]}});
 assert.equal(summary.coverage[0].assigned,2);assert.deepEqual(summary.coverage[0].levels,{REGULAR:1,CREW_TRAINING:1});assert.equal(summary.coverage[0].warning,null);
 assert.ok(!summary.missing_criteria.some(v=>v.includes('NEW')));
});
