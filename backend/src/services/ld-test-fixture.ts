import { createHash } from 'node:crypto';
import type { SummaryEmployee, SummarySnapshot } from '../repositories/registration-summary.types.js';
import { tv2Availability, type RegistrationHeader, type RegistrationRow } from '../registrations/tv3-source.js';
import { interval, ScheduleError } from './scheduling.engine.js';
import { LD_TEST_BATCH_ID, LD_TEST_BRANCH_ID, LD_TEST_PERIOD_ID } from './test-preview-policy.js';

const kitchen='22222222-2222-2222-2222-222222222222';
const cashier='0a3de5e1-873b-5f7b-acfc-e71e5b8e97f8';
const service='e10533b2-57df-55e0-adf0-64894c2ca58a';
const layouts=[
  {department:kitchen,code:'BEP',levels:['NEW','NEW','REGULAR','REGULAR','REGULAR','CREW_TRAINING'],pool:26,counts:[12,12,4],special:2},
  {department:service,code:'PV',levels:['NEW','NEW','NEW','REGULAR','REGULAR','CREW_TRAINING'],pool:24,counts:[13,13,3],special:2},
  {department:cashier,code:'TN',levels:['NEW','NEW','REGULAR','REGULAR','REGULAR'],pool:18,counts:[12,3,8],special:1},
];
function fixtureId(key:string) {
  const h=createHash('sha256').update(`${LD_TEST_BATCH_ID}/${key}`).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
}
function invalid(message:string):never {throw new ScheduleError(409,'TEST_FIXTURE_SOURCE_CHANGED',message);}

/** Pure in-memory overlay. Never updates an employee, registration or period. */
export function buildLDTestFixture(base:SummarySnapshot,batchId:string,generatedAt=new Date().toISOString()) {
  if(batchId!==LD_TEST_BATCH_ID)throw new ScheduleError(403,'TEST_BATCH_NOT_ALLOWED','Batch không thuộc fixture đã duyệt.');
  if(base.source!=='supabase'||base.branch.id!==LD_TEST_BRANCH_ID||base.period.branch_id!==LD_TEST_BRANCH_ID||
    base.period.id!==LD_TEST_PERIOD_ID||base.period.work_start_date!=='2026-11-02'||base.period.work_end_date!=='2026-11-08')
    throw new ScheduleError(403,'TEST_FIXTURE_SCOPE','Fixture chỉ áp dụng Lê Duẩn, tuần 02–08/11/2026.');
  if(!base.registration_submission_employee_ids)invalid('Thiếu danh sách header TV2 để bảo vệ cả đăng ký thật, DRAFT và mẫu có sẵn.');
  const snapshot=structuredClone(base);
  const occupied=new Set([...base.registration_submission_employee_ids!,...base.registrations.map(r=>r.employee_id)]);
  for(const d of base.registration_declarations??[])if(d.declaration!=='NOT_SUBMITTED')occupied.add(d.employee_id);
  const virtual:SummaryEmployee[]=[];
  for(const layout of layouts)for(const [index,skill_level] of layout.levels.entries()) {
    const id=fixtureId(`employee/${layout.code}/${index}`);
    if(base.employees.some(e=>e.id===id))invalid('UUID nhân viên ảo trùng dữ liệu có sẵn.');
    virtual.push({id,employee_code:`TV3_TEST_LD_${layout.code}_${index+1}`,full_name:`[TV3 TEST] ${layout.code} ${index+1}`,
      branch_id:LD_TEST_BRANCH_ID,department_id:layout.department,skill_level,status:'ACTIVE',is_active:true,role:'NV',max_weekly_hours:null,skills:[]});
  }
  snapshot.employees.push(...virtual);
  const shifts=snapshot.shifts.filter(s=>s.is_active&&(s.branch_id==null||s.branch_id===LD_TEST_BRANCH_ID)).sort((a,b)=>a.start_time.localeCompare(b.start_time)||a.id.localeCompare(b.id));
  if(shifts.length!==3||shifts.some((s,i)=>s.start_time!==['08:00:00','12:00:00','17:00:00'][i]||s.end_time!==['12:00:00','17:00:00','22:00:00'][i]))
    invalid('Danh mục ca đã thay đổi; cần duyệt lại fixture, không tự sửa ca.');
  const rows:RegistrationRow[]=[];
  const participants=new Set<string>();
  for(let day=0;day<7;day++)for(const layout of layouts) {
    const pool=snapshot.employees.filter(e=>e.department_id===layout.department&&e.branch_id===LD_TEST_BRANCH_ID&&
      e.status==='ACTIVE'&&e.is_active===true&&e.role==='NV'&&['NEW','REGULAR','CREW_TRAINING'].includes(e.skill_level)&&!occupied.has(e.id))
      .sort((a,b)=>a.id.localeCompare(b.id)).slice(0,layout.pool);
    if(pool.length!==layout.pool)invalid('Không đủ nhân viên chưa có header TV2; không ghi đè hoặc thay thế đăng ký có sẵn.');
    const experienced=pool.filter(e=>e.skill_level!=='NEW');
    if(experienced.length<7)invalid('Cơ cấu nhân viên nguồn đã thay đổi.');
    const active=pool.filter(e=>e.id!==experienced[day%experienced.length].id);
    for(const e of active)participants.add(e.id);
    const cells:string[][]=[[],[],[]];
    const newbies=active.filter(e=>e.skill_level==='NEW').slice(0,3);
    if(newbies.length!==3)invalid('Thiếu NEW để tái hiện tình huống cơ cấu đã thiết kế.');
    cells[layout.special]=newbies.map(e=>e.id);
    if(layout.department===kitchen)cells[layout.special].push(active.find(e=>e.skill_level!=='NEW')!.id);
    const used=new Set(cells[layout.special]);
    const other=[0,1,2].filter(i=>i!==layout.special);
    for(const e of active.filter(e=>!used.has(e.id))) {
      const cell=other.find(i=>cells[i].length<layout.counts[i]);
      if(cell===undefined)invalid('Ma trận fixture không chứa đủ người tham gia.');
      cells[cell].push(e.id);
    }
    for(const cell of other)for(const e of active) {
      if(cells[cell].length>=layout.counts[cell])break;
      if(!cells[cell].includes(e.id))cells[cell].push(e.id);
    }
    for(let cell=0;cell<3;cell++)for(const employee_id of cells[cell]) {
      const work_date=`2026-11-0${day+2}`,shift_id=shifts[cell].id;
      rows.push({id:fixtureId(`registration/${employee_id}/${work_date}/${shift_id}`),period_id:base.period.id,
        employee_id,work_date,shift_id,status:'VALID',submitted_at:generatedAt});
    }
  }
  const headers:RegistrationHeader[]=[...participants].sort().map(employee_id=>({employee_id,status:'VALID',submitted_at:generatedAt,updated_at:generatedAt,sample_batch_id:batchId}));
  // Reuse TV2's VALID/OFF/branch/shift contract; only this exact batch is accepted.
  const accepted=tv2Availability({headers,rows},snapshot.period,snapshot.employees,shifts,batchId);
  if(accepted.registrations.length!==rows.length)invalid('Fixture bị bộ lọc TV2 loại; cần kiểm tra lại nguồn.');
  snapshot.registrations.push(...accepted.registrations);
  snapshot.registration_declarations=[...(base.registration_declarations??[]).filter(d=>!participants.has(d.employee_id)),
    ...accepted.declarations.filter(d=>participants.has(d.employee_id))];
  // Independent check, including adjacent dates; no implicit registration hour cap.
  const keys=new Set<string>();
  for(const a of snapshot.registrations) {
    const key=`${a.employee_id}/${a.work_date}/${a.shift_id}`;
    if(keys.has(key))invalid('Đăng ký thật và fixture bị trùng.');
    keys.add(key);
    const [start,end]=interval(a.work_date,shifts.find(s=>s.id===a.shift_id)!);
    for(const b of snapshot.registrations.filter(b=>b.employee_id===a.employee_id&&b.id!==a.id)) {
      const [s,t]=interval(b.work_date,shifts.find(s=>s.id===b.shift_id)!);
      if(start<t&&s<end)invalid('Có nguyện vọng trùng giờ; không tự loại hoặc sửa đăng ký thật.');
    }
  }
  const daily=Array.from({length:7},(_,i)=>{
    const work_date=`2026-11-0${i+2}`,real=base.registrations.filter(r=>r.work_date===work_date),fixture=rows.filter(r=>r.work_date===work_date);
    const people=new Set([...real,...fixture].map(r=>r.employee_id)).size;
    if(people<60||people>70)invalid('Nguồn thật đã thay đổi làm quy mô vượt khoảng 60–70 người/ngày.');
    return {work_date,fixture_people:new Set(fixture.map(r=>r.employee_id)).size,total_people:people,real_rows:real.length,fixture_rows:fixture.length,total_rows:real.length+fixture.length};
  });
  return {snapshot,metadata:{batch_id:batchId,generated_at:generatedAt,storage:'memory' as const,
    fixture_people:participants.size,virtual_employee_ids:virtual.map(e=>e.id),fixture_employee_ids:[...participants].sort(),
    fixture_registration_ids:rows.map(r=>r.id),real_registration_count:base.registrations.length,fixture_registration_count:rows.length,daily,
    no_auth_accounts_created:true,submitted_via_tv2:false}};
}
