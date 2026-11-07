import { supabaseAdmin as db } from '../config/supabase.js';
import { ScheduleError } from './scheduling.engine.js';
export interface OfficialFilters {page:number;page_size:number;work_date?:string;shift_id?:string;department_id?:string;employee_id?:string;metadata:boolean}
export async function readOfficialCalendar(periodId:string,branchId:string,f:OfficialFilters){
 const [p,periods]=await Promise.all([
  db.from('registration_periods').select('id,branch_id,work_start_date,work_end_date').eq('id',periodId).eq('branch_id',branchId).maybeSingle(),
  db.from('schedules').select('id,schedule_group_id,version,status,created_at,published_at').eq('branch_id',branchId).eq('period_id',periodId).eq('status','PUBLISHED').not('published_at','is',null).order('version',{ascending:false}),
 ]);
 if(p.error)throw new ScheduleError(503,'CALENDAR_UNAVAILABLE','Không tải được tuần.');if(!p.data)throw new ScheduleError(404,'PERIOD_NOT_FOUND','Không có tuần tại chi nhánh.');
 if(periods.error)throw new ScheduleError(503,'CALENDAR_UNAVAILABLE','Không tải được lịch công bố.');
 if(new Set((periods.data??[]).map(s=>s.schedule_group_id)).size>1)throw new ScheduleError(409,'AMBIGUOUS_SCHEDULE','Có nhiều lịch công bố trùng tuần.');
 const all=async(make:(a:number,b:number)=>any)=>{const rows:any[]=[];for(let a=0;;a+=500){const r=await make(a,a+499);if(r.error)throw new ScheduleError(503,'CALENDAR_UNAVAILABLE','Không tải được danh mục.');rows.push(...(r.data??[]));if((r.data??[]).length<500)return rows;}};
 const metadata=f.metadata?Promise.all([
  all((a,b)=>db.from('employees').select('id,full_name,department_id').eq('branch_id',branchId).order('id').range(a,b)),
  all((a,b)=>db.from('departments').select('id,name').order('id').range(a,b)),
  all((a,b)=>db.from('shifts').select('id,name,start_time,end_time').or(`branch_id.eq.${branchId},branch_id.is.null`).order('id').range(a,b)),
 ]):Promise.resolve([[],[],[]]);
 const current=periods.data?.[0];
 let query=db.from('shift_assignments').select('id,schedule_id,employee_id,department_id,work_date,shift_id,status,assignment_source,employee:employees(id,full_name,department_id),shift:shifts(id,name,start_time,end_time)',{count:'exact'}).eq('schedule_id',current?.id??'00000000-0000-0000-0000-000000000000').eq('status','ACTIVE');
 for(const k of ['work_date','shift_id','department_id','employee_id'] as const)if(f[k])query=query.eq(k,f[k]!);
 const [result,[employees,departments,shifts]]=await Promise.all([current?query.order('work_date').order('shift(start_time)').order('employee(full_name)').order('id').range(f.page*f.page_size,(f.page+1)*f.page_size-1):Promise.resolve({data:[],count:0,error:null}),metadata]);
 if(result.error)throw new ScheduleError(503,'CALENDAR_UNAVAILABLE','Không tải được phân công.');
 const one=(v:any)=>Array.isArray(v)?v[0]:v;
 return{source:'supabase',period:p.data,schedules:current?[current]:[],employees,departments,shifts,assignments:(result.data??[]).map(({employee,shift,...a})=>({...a,employee:one(employee),shift:one(shift)})),total:result.count??0,page:f.page,page_size:f.page_size,metadata_included:f.metadata};
}
