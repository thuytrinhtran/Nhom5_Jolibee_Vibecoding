import { supabaseAdmin } from '../config/supabase.js';
import { draftWriteScopeAllowed, isLocalTestWriteScope } from './draft-write-scope.js';
import { ScheduleError } from './scheduling.engine.js';

export async function requireShiftChangeWriteScope(action:string,data:Record<string,unknown>,actorBranch?:string|null){
 if(isLocalTestWriteScope())return;
 if(process.env.TV3_WRITE_SCOPE_ENABLED!=='true')throw new ScheduleError(403,'TV5_SCOPE_FORBIDDEN','Chưa cấu hình phạm vi đổi ca được phê duyệt.');
 const get=async(table:string,id:unknown,fields:string)=>{
  const {data:row,error}=await supabaseAdmin.from(table).select(fields).eq('id',String(id)).maybeSingle();
  if(error)throw new ScheduleError(503,'TV5_SCOPE_UNAVAILABLE','Chưa xác minh được phạm vi đổi ca.');
  if(!row)throw new ScheduleError(404,'NOT_FOUND','Không tìm thấy dữ liệu đổi ca.');return row as unknown as Record<string,string|null>;
 };
 let assignmentId=data.assignment_id;
 if(!['CREATE_REQUEST','REPORT'].includes(action)){
  let kind=data.kind,sourceId=data.source_id;
  if(['ACCEPT','DECLINE'].includes(action)){
   const invitation=await get('replacement_invitations',data.invitation_id,'shift_change_request_id,incident_id');
   if(!!invitation.shift_change_request_id===!!invitation.incident_id)throw new ScheduleError(409,'INVALID_INVITATION','Nguồn lời mời không hợp lệ.');
   kind=invitation.shift_change_request_id?'REQUEST':'INCIDENT';sourceId=invitation.shift_change_request_id??invitation.incident_id;
  }
  const source=await get(kind==='REQUEST'?'shift_change_requests':'incidents',sourceId,'original_assignment_id');assignmentId=source.original_assignment_id;
 }
 const assignment=await get('shift_assignments',assignmentId,'schedule_id');
 const schedule=await get('schedules',assignment.schedule_id,'period_id,branch_id');
 if(typeof schedule.period_id!=='string'||typeof schedule.branch_id!=='string')throw new ScheduleError(503,'TV5_SCOPE_UNAVAILABLE','Thiếu phạm vi lịch làm việc.');
 if(actorBranch!==schedule.branch_id||!draftWriteScopeAllowed(schedule.period_id,schedule.branch_id))throw new ScheduleError(403,'TV5_SCOPE_FORBIDDEN','Ngoài chi nhánh hoặc kỳ kiểm thử đã được cấu hình.');
 // SQL rechecks ownership, recipient, eligibility and races atomically.
}
