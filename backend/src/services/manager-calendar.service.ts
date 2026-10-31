import { supabaseAdmin } from '../config/supabase.js';
import { readTv2Source, tv2Availability } from '../registrations/tv3-source.js';
import { ScheduleError } from './scheduling.engine.js';

async function all(make: (a:number,b:number)=>any):Promise<any[]> {
  const rows:any[]=[];
  for(let a=0;;a+=500){const result=await make(a,a+499);if(result.error)throw new ScheduleError(503,'CALENDAR_UNAVAILABLE','Không tải được lịch. Vui lòng thử lại.');rows.push(...(result.data||[]));if((result.data||[]).length<500)return rows;}
}
export async function readManagerCalendar(periodId:string,branchId:string) {
  const p=await supabaseAdmin.from('registration_periods').select('id,branch_id,work_start_date,work_end_date,status').eq('id',periodId).eq('branch_id',branchId).maybeSingle();
  if(p.error)throw new ScheduleError(503,'CALENDAR_UNAVAILABLE','Không tải được tuần đăng ký.');
  if(!p.data)throw new ScheduleError(404,'PERIOD_NOT_FOUND','Không tìm thấy tuần trong chi nhánh được phân công.');
  const [people,shifts,departments,source,schedules,assignments]=await Promise.all([
    all((a,b)=>supabaseAdmin.from('employees').select('id,full_name,department_id,branch_id,status,skill_level,user:user_id(role,is_active,branch_id)').eq('branch_id',branchId).order('id').range(a,b)),
    all((a,b)=>supabaseAdmin.from('shifts').select('id,name,start_time,end_time,is_active,branch_id').or(`branch_id.eq.${branchId},branch_id.is.null`).order('id').range(a,b)),
    all((a,b)=>supabaseAdmin.from('departments').select('id,name').order('id').range(a,b)),
    readTv2Source(supabaseAdmin,periodId),
    all((a,b)=>supabaseAdmin.from('schedules').select('id,schedule_group_id,version,status,created_at,published_at').eq('branch_id',branchId).eq('period_id',periodId).order('id').range(a,b)),
    all((a,b)=>supabaseAdmin.from('shift_assignments').select('id,schedule_id,employee_id,department_id,work_date,shift_id,status,assignment_source,employee:employees(id,full_name,department_id),shift:shifts(id,name,start_time,end_time),schedule:schedules!inner(branch_id,period_id)').eq('schedule.branch_id',branchId).eq('schedule.period_id',periodId).order('id').range(a,b)),
  ]);
  const one=(v:any)=>Array.isArray(v)?v[0]:v;
  const employees=people.map(({user,...e})=>{const u=one(user);return {...e,role:u?.branch_id===branchId?u.role:null,is_active:u?.branch_id===branchId?u.is_active:false};});
  const availability=tv2Availability(source,p.data,employees,shifts);
  return {source:'supabase' as const,period:p.data,employees:employees.map(e=>({id:e.id,full_name:e.full_name,department_id:e.department_id})),departments,shifts,
    registrations:availability.registrations.map(r=>({employee_id:r.employee_id,work_date:r.work_date,shift_id:r.shift_id})),declarations:availability.declarations,
    schedules:schedules.sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.version-a.version),
    assignments:assignments.map(({employee,shift,schedule,...a})=>({...a,employee:one(employee),shift:one(shift)}))};
}
