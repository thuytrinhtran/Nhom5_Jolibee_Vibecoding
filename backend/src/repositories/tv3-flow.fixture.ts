import type { SummarySnapshot } from './registration-summary.types.js';
const MOCK_PERIOD_ID='33333333-0000-4000-8000-000000000001';
const id=(n:number)=>`44444444-0000-4000-8000-${String(n).padStart(12,'0')}`;
// Entire scenario is synthetic: counts, hours and the daily cap are test inputs only.
export function tv3FlowSnapshot(branchId:string):SummarySnapshot {
  const departments=[{id:id(10),name:'Bếp'},{id:id(11),name:'Thu ngân'},{id:id(12),name:'Phục vụ'}];
  const shifts=[{id:id(20),name:'Sáng',start_time:'08:00:00',end_time:'12:00:00',is_active:true,branch_id:branchId},
    {id:id(21),name:'Chiều',start_time:'12:00:00',end_time:'17:00:00',is_active:true,branch_id:branchId},
    {id:id(22),name:'Ca 3',start_time:'17:00:00',end_time:'22:00:00',is_active:true,branch_id:branchId}];
  const specs:[string,number,number[]][]=[['NV01 An',0,[0]],['NV02 Bình',0,[0,1]],['NV03 Cường',0,[1]],['NV04 Dung',1,[0]],
    ['NV05 Hà',1,[1]],['NV06 Lan',2,[0]],['NV07 Minh',2,[0,1]],['NV08 Phúc',2,[1]]];
  const skills=['Bếp nóng','Thu ngân','Phục vụ'];
  const employees=specs.map(([name,dept],i)=>({id:id(100+i),branch_id:branchId,full_name:name,department_id:departments[dept].id,
    skill_level:'REGULAR',status:'ACTIVE',is_active:true,role:'NV',max_weekly_hours:null,skills:[skills[dept]]}));
  let serial=200;
  const registrations=specs.flatMap(([, ,available],i)=>available.map(shift=>({id:id(serial++),period_id:MOCK_PERIOD_ID,
    employee_id:employees[i].id,work_date:'2026-11-02',shift_id:shifts[shift].id,status:'VALID'})));
  const counts=[[2,1,2],[1,1,2]];
  const requirements=counts.flatMap((counts,shift)=>counts.map((required_count,dept)=>({id:id(300+shift*10+dept),work_date:'2026-11-02',
    shift_id:shifts[shift].id,department_id:departments[dept].id,required_count,required_skill_name:skills[dept],
    sales_forecast_ref:'Số lượng thử nghiệm do quản lý xác định; không phải định mức Jollibee.',created_by:id(999),updated_at:'2026-10-29T00:00:00.000Z'})));
  return {source:'mock',branch:{id:branchId,name:'Chi nhánh dữ liệu thử nghiệm TV3'},
    period:{id:MOCK_PERIOD_ID,branch_id:branchId,work_start_date:'2026-11-02',work_end_date:'2026-11-08',status:'CLOSED'},
    departments,shifts,employees,registrations,requirements,existing:[],new_employee_count_threshold:null,
    test_rules:{max_shifts_per_day:1}};
}
