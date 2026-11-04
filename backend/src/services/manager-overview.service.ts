import { supabaseAdmin } from '../config/supabase.js';
import { acceptedDevHeader } from '../registrations/tv3-source.js';
import { devImportContext } from '../registrations/dev-import-policy.js';
import { ScheduleError } from './scheduling.engine.js';

export function managerOverview(calendar:any,requirements:any[],sources:any[]){
 const schedules=[...calendar.schedules].sort((a,b)=>b.version-a.version||b.created_at.localeCompare(a.created_at));
 const published=schedules.filter(s=>s.status==='PUBLISHED'&&s.published_at);
 if(new Set(published.map(s=>s.schedule_group_id)).size>1)throw new ScheduleError(409,'AMBIGUOUS_SCHEDULE','Có nhiều lịch công bố cho cùng tuần. Cần kiểm tra dữ liệu.');
 const current=published[0]??schedules[0]??null;
 const rows=calendar.assignments.filter((a:any)=>a.schedule_id===current?.id&&(current.status==='PUBLISHED'?a.status==='ACTIVE':a.status==='DRAFT'));
 const unique=new Map(rows.map((a:any)=>[[a.employee_id,a.work_date,a.shift_id,a.department_id].join('/'),a]));
 const assigned=[...unique.values()] as any[],ids=new Set(calendar.assignments.map((a:any)=>a.id));
 const shortages=current&&requirements.length?requirements.map(r=>Math.max(0,r.required_count-assigned.filter(a=>a.work_date===r.work_date&&a.shift_id===r.shift_id&&a.department_id===r.department_id).length)):null;
 return {source:'supabase',period:calendar.period,employee_count:calendar.employees.length,
  registered_employees:new Set(calendar.registered_employee_ids??calendar.declarations.filter((d:any)=>d.declaration!=='NOT_SUBMITTED').map((d:any)=>d.employee_id)).size,
  schedule_status:schedules[0]?.status??null,official_schedule_status:published[0]?.status??null,
  assignment_count:current?assigned.length:null,assignment_kind:published.length?'official':'planned',
  pending_requests:sources.filter(s=>s.kind==='REQUEST'&&['PENDING','SEARCHING'].includes(s.status)&&ids.has(s.original_assignment_id)).length,
  shortage_cells:shortages?shortages.filter(n=>n>0).length:null,shortage_positions:shortages?shortages.reduce((a,b)=>a+b,0):null};
}
export async function readManagerOverview(periodId:string,branchId:string,actorId:string){
 const p=await supabaseAdmin.from('registration_periods').select('id,branch_id,work_start_date,work_end_date,status').eq('id',periodId).eq('branch_id',branchId).maybeSingle();
 if(p.error)throw new ScheduleError(503,'OVERVIEW_UNAVAILABLE','Không tải được tuần làm việc.');
 if(!p.data)throw new ScheduleError(404,'PERIOD_NOT_FOUND','Không tìm thấy tuần trong chi nhánh.');
 const all=async(make:(a:number,b:number)=>any)=>{const rows:any[]=[];for(let a=0;;a+=500){const r=await make(a,a+499);if(r.error)throw new ScheduleError(503,'OVERVIEW_UNAVAILABLE','Không tải được tổng quan.');rows.push(...(r.data??[]));if((r.data??[]).length<500)return rows;}};
 const [people,headers,schedules,assignments]=await Promise.all([
  all((a,b)=>supabaseAdmin.from('employees').select('id,branch_id,status,skill_level,user:user_id(role,is_active,branch_id)').eq('branch_id',branchId).order('id').range(a,b)),
  all((a,b)=>supabaseAdmin.from('registration_submissions_sourced').select('employee_id,status,submitted_at,updated_at,sample_batch_id'+(devImportContext()?',dev_import_allowed':'')).eq('period_id',periodId).order('employee_id').range(a,b)),
  all((a,b)=>supabaseAdmin.from('schedules').select('id,schedule_group_id,status,version,created_at,published_at').eq('branch_id',branchId).eq('period_id',periodId).order('id').range(a,b)),
  all((a,b)=>supabaseAdmin.from('shift_assignments').select('id,schedule_id,employee_id,work_date,shift_id,department_id,status,schedule:schedules!inner(branch_id,period_id)').eq('schedule.branch_id',branchId).eq('schedule.period_id',periodId).order('id').range(a,b)),
 ]);
 const eligible=new Set(people.filter(e=>{const u=Array.isArray(e.user)?e.user[0]:e.user;return e.status==='ACTIVE'&&e.skill_level!=='CREW_LEADER'&&u?.role==='NV'&&u.is_active&&u.branch_id===branchId;}).map(e=>e.id));
 const registered=headers.filter(h=>h.status==='VALID'&&h.submitted_at&&eligible.has(h.employee_id)&&(!h.sample_batch_id||acceptedDevHeader(h,p.data!)));
 const calendar={period:p.data,employees:people,schedules,assignments,registered_employee_ids:registered.map(h=>h.employee_id)};
 const loadDemand=async()=>{const rows:any[]=[];for(let offset=0;;offset+=500){
  const result=await supabaseAdmin.from('staffing_requirements').select('work_date,shift_id,department_id,required_count').eq('branch_id',branchId).gte('work_date',calendar.period.work_start_date).lte('work_date',calendar.period.work_end_date).order('id').range(offset,offset+499);
  if(result.error)throw new ScheduleError(503,'OVERVIEW_UNAVAILABLE','Không tải được nhu cầu nhân sự.');
  rows.push(...(result.data??[]));if((result.data??[]).length<500)return rows;
 }};
 const [demand,queue]=await Promise.all([
  loadDemand(),
  supabaseAdmin.rpc('tv5_read',{p_actor_id:actorId}),
 ]);
 if(queue.error||!Array.isArray(queue.data?.sources))throw new ScheduleError(503,'OVERVIEW_UNAVAILABLE','Không tải được số liệu tổng quan. Vui lòng thử lại.');
 return managerOverview(calendar,demand,queue.data.sources);
}
