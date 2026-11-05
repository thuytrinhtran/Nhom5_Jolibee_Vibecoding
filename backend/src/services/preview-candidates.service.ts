import { supabaseAdmin } from '../config/supabase.js';
import { inspectPreview } from './schedule-preview.service.js';
import { reviewAssignments, ScheduleError } from './scheduling.engine.js';
import type { RegistrationSummaryRepository } from '../repositories/registration-summary.types.js';
type PreviewState=Awaited<ReturnType<typeof inspectPreview>>;
export interface PreviewCandidate {
 id:string;full_name:string;skill_level:string;phone:string|null;
 employee_status:string;status:'ELIGIBLE';availability:string;
}
export const INTERNAL_SUPPORT_UNAVAILABLE='Không có ứng viên nội bộ hợp lệ. Vị trí vẫn còn thiếu; yêu cầu chi viện từ chi nhánh khác chưa được hỗ trợ.';
function candidatesFor(state:PreviewState,branch:string,requirementId:string,replaceIndex?:number):PreviewCandidate[]{
 const need=state.input.requirements.find(n=>n.id===requirementId);
 if(!need)throw new ScheduleError(400,'INVALID_REQUIREMENT','Không có vị trí này trong kỳ.');
 const assignments=state.result.assignments;
 const old=replaceIndex===undefined?undefined:assignments[replaceIndex];
 if(replaceIndex!==undefined&&(!old||old.work_date!==need.work_date||old.shift_id!==need.shift_id||old.department_id!==need.department_id))throw new ScheduleError(400,'INVALID_REPLACEMENT','Phân công thay thế không khớp.');
 const base=assignments.filter((_,i)=>i!==replaceIndex);
 return state.snapshot.employees.filter(e=>e.branch_id===branch&&e.department_id===need.department_id&&e.id!==old?.employee_id).flatMap(e=>{
  try{reviewAssignments(state.input,[...base,{employee_id:e.id,work_date:need.work_date,shift_id:need.shift_id,department_id:need.department_id}]);}
  catch(error){if(error instanceof ScheduleError&&error.status===422)return [];throw error;}
  return [{id:e.id,full_name:e.full_name,skill_level:e.skill_level,phone:e.phone??null,employee_status:e.status,status:'ELIGIBLE' as const,availability:'Đã đăng ký hợp lệ · Đủ điều kiện · Chờ xác nhận liên hệ'}];
 }).sort((a,b)=>Number(a.skill_level==='NEW')-Number(b.skill_level==='NEW')||a.full_name.localeCompare(b.full_name,'vi'));
}
async function contacts(rows:PreviewCandidate[],branch:string,repository?:RegistrationSummaryRepository){
 if(repository||!rows.length)return;
 const ids=[...new Set(rows.map(e=>e.id))];
 for(let from=0;from<ids.length;from+=100){
  const result=await supabaseAdmin.from('employees').select('id, phone').eq('branch_id',branch).in('id',ids.slice(from,from+100));
  if(result.error)throw new ScheduleError(503,'CONTACTS_UNAVAILABLE','Không đọc được thông tin liên hệ.');
  for(const row of rows)if(ids.slice(from,from+100).includes(row.id))row.phone=result.data?.find(e=>e.id===row.id)?.phone??null;
 }
}
export async function previewCandidates(period:string,branch:string,body:Record<string,unknown>,repository?:RegistrationSummaryRepository){
 const {requirement_id,replace_index,...plan}=body;
 if(typeof plan.input_revision!=='string'||!Array.isArray(plan.assignments))throw new ScheduleError(400,'INVALID_CANDIDATE_REQUEST','Cần phương án đã kiểm tra và phiên bản dữ liệu nguồn.');
 if(typeof requirement_id!=='string'||(replace_index!==undefined&&(!Number.isSafeInteger(replace_index)||Number(replace_index)<0)))throw new ScheduleError(400,'INVALID_CANDIDATE_REQUEST','Vị trí không hợp lệ.');
 const state=await inspectPreview(period,branch,plan,repository);
 const candidates=candidatesFor(state,branch,requirement_id,replace_index as number|undefined);
 await contacts(candidates,branch,repository);
 await inspectPreview(period,branch,plan,repository);
 return candidates;
}

// Read-only business tool used by chat. Contact data never enters a Gemini payload.
export async function searchPreviewCandidates(state:PreviewState,branch:string,scope:{department_id?:string;work_date?:string;shift_id?:string},repository?:RegistrationSummaryRepository){
 const needs=state.result.coverage.filter(r=>(r.assigned_count<r.required_count||r.missing_experienced_count>0)&&(!scope.department_id||r.department_id===scope.department_id)&&(!scope.work_date||r.work_date===scope.work_date)&&(!scope.shift_id||r.shift_id===scope.shift_id));
 if(needs.length>30)throw new ScheduleError(422,'REQUEST_NEEDS_CLARIFICATION','Có nhiều vị trí thiếu. Hãy chọn ngày, ca hoặc bộ phận cần tìm người.');
 const groups=needs.map(r=>{
  const missing=r.required_count-r.assigned_count;
  const replacement=missing>0?-1:state.result.assignments.findIndex(a=>a.work_date===r.work_date&&a.shift_id===r.shift_id&&a.department_id===r.department_id&&state.input.employees.find(e=>e.id===a.employee_id)?.skill_level==='NEW');
  const rows=missing>0?candidatesFor(state,branch,r.id):replacement<0?[]:candidatesFor(state,branch,r.id,replacement).filter(e=>e.skill_level==='REGULAR'||e.skill_level==='CREW_TRAINING');
  return {requirement_id:r.id,work_date:r.work_date,shift_id:r.shift_id,department_id:r.department_id,missing_count:missing,missing_experienced_count:r.missing_experienced_count,...(replacement>=0?{replace_index:replacement}:{}),candidates:rows};
 });
 await contacts(groups.flatMap(g=>g.candidates),branch,repository);
 return groups;
}

