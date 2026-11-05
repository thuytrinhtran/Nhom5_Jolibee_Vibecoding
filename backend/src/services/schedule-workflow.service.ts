import { supabaseAdmin } from '../config/supabase.js';
import { ScheduleError } from './scheduling.engine.js';
import { requireNonTestScheduleWrites } from './test-preview-policy.js';
import { inspectSchedule } from './schedule-review.service.js';
import { requireRealSchedulingData } from '../repositories/registration-summary.repository.js';
import { draftWriteScopeAllowed } from './draft-write-scope.js';

export const workflowEnabled=()=>process.env.TV4_WORKFLOW_PERSISTENCE_ENABLED==='true'&&process.env.TV3_TEST_PREVIEW_ENABLED!=='true';
export function requireWorkflowWrites(){
 requireNonTestScheduleWrites();
 if(!workflowEnabled())throw new ScheduleError(503,'WORKFLOW_PERSISTENCE_DISABLED','Chưa bật lưu workflow TV4. Cần nghiệm thu migration trước.');
 requireRealSchedulingData();
}
export async function transitionSchedule(id:string,actor:{id:string;role:string;branch_id?:string|null},body:Record<string,unknown>,action:string){
 requireWorkflowWrites();
 const allowed=['expected_version','request_id',...(action==='PUBLISH'?['feedback_deadline_at']:['reason','note'])];
 if(Object.keys(body).some(k=>!allowed.includes(k))||!Number.isSafeInteger(body.expected_version)||Number(body.expected_version)<1
  ||typeof body.request_id!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.request_id))
  throw new ScheduleError(400,'INVALID_WORKFLOW_REQUEST','Cần phiên bản lịch và mã yêu cầu hợp lệ.');
 if((['APPROVED','NEEDS_REVISION'].includes(action)?actor.role!=='GS':actor.role!=='QL'))throw new ScheduleError(403,'FORBIDDEN','Không có quyền thao tác.');
 const reason=body.reason??body.note;
 if(reason!==undefined&&reason!==null&&typeof reason!=='string')throw new ScheduleError(400,'INVALID_REASON','Lý do không hợp lệ.');
 if(action==='NEEDS_REVISION'&&!(typeof reason==='string'&&reason.trim()))throw new ScheduleError(422,'REASON_REQUIRED','Cần lý do từ chối.');
 // A past deadline may only recover an already recorded publication request.
 if(action==='PUBLISH'&&(typeof body.feedback_deadline_at!=='string'||!Number.isFinite(Date.parse(body.feedback_deadline_at))))throw new ScheduleError(400,'INVALID_FEEDBACK_DEADLINE','Thời hạn phản hồi phải là thời điểm hợp lệ.');
 // Resolve scope from storage, never from a period/branch supplied by the browser.
 if(process.env.TV3_WRITE_SCOPE_ENABLED!==undefined&&process.env.TV3_WRITE_SCOPE_ENABLED!=='false'){
  const {data:target,error:scopeError}=await supabaseAdmin.from('schedules').select('id,period_id,branch_id').eq('id',id).maybeSingle();
  if(scopeError)throw new ScheduleError(503,'WORKFLOW_SCOPE_UNAVAILABLE','Chưa thể xác minh phạm vi lịch.');
  if(!target)throw new ScheduleError(404,'SCHEDULE_NOT_FOUND','Không tìm thấy lịch.');
  if(!draftWriteScopeAllowed(target.period_id,target.branch_id))throw new ScheduleError(403,'WORKFLOW_SCOPE_FORBIDDEN','Chỉ được thao tác lịch Lê Duẩn, kỳ 02–08/11/2026 trong đợt kiểm thử này.');
 }
 if(action==='PUBLISH'&&Date.parse(body.feedback_deadline_at as string)<=Date.now()){
  const {data:receipt,error:receiptError}=await supabaseAdmin.from('audit_logs').select('actor_id,new_data')
   .eq('entity_type','schedules').eq('new_data->>request_id',body.request_id).maybeSingle();
  if(receiptError)throw new ScheduleError(503,'WORKFLOW_BUSY','Chưa thể xác minh yêu cầu công bố trước đó. Hãy tải lại lịch hoặc thử lại cùng yêu cầu.');
  if(!receipt)throw new ScheduleError(400,'INVALID_FEEDBACK_DEADLINE','Thời hạn phản hồi phải là thời điểm hợp lệ trong tương lai.');
  const fingerprint=receipt.new_data?.workflow_request;
  if(receipt.actor_id!==actor.id||fingerprint?.schedule_id!==id||fingerprint?.version!==body.expected_version
   ||fingerprint?.action!=='PUBLISH'||(fingerprint?.reason??null)!==(typeof reason==='string'?reason.trim()||null:null)
   ||Date.parse(fingerprint?.feedback_deadline_at)!==Date.parse(body.feedback_deadline_at as string))
   throw new ScheduleError(409,'REQUEST_CONFLICT','Mã yêu cầu đã dùng cho thao tác khác. Hãy tải lại lịch.');
 }
 // Authorization and all current constraints are repeated atomically in SQL.
 // Do not pre-check status here: an exact retry must recover its audit response.
 const {data,error}=await supabaseAdmin.rpc('tv4_transition_schedule_v2',{
  p_schedule_id:id,p_actor_id:actor.id,p_expected_version:body.expected_version,p_action:action,p_request_id:body.request_id,
  p_reason:typeof reason==='string'?reason.trim()||null:null,p_feedback_deadline_at:action==='PUBLISH'?body.feedback_deadline_at:null,
 });
 if(error){if(['55P03','57014','40P01'].includes(error.code??''))throw new ScheduleError(503,'WORKFLOW_BUSY','Workflow đang bận; thử lại cùng yêu cầu.');
  const message=String(error.message??'');const code=['FORBIDDEN','SCHEDULE_NOT_FOUND','STALE_SCHEDULE_VERSION','REQUEST_CONFLICT','REASON_REQUIRED','HARD_CONSTRAINT_FAILED','COVERAGE_INCOMPLETE','INVALID_ASSIGNMENTS','INVALID_SCHEDULE_STATUS','INVALID_FEEDBACK_DEADLINE','DUPLICATE_ASSIGNMENT','INCOMPLETE_DATA','INVALID_RULE_INPUT'].find(k=>message.includes(k));
  throw new ScheduleError(code==='FORBIDDEN'?403:code==='SCHEDULE_NOT_FOUND'?404:code==='INVALID_FEEDBACK_DEADLINE'?400:error.code==='42883'||error.code==='PGRST202'?503:409,code??'WORKFLOW_UNAVAILABLE',code?`Không thể chuyển trạng thái: ${code}. Hãy tải lại lịch.`:'Workflow chưa sẵn sàng hoặc đang bận; hãy thử lại cùng yêu cầu.');}
 if(!data?.schedule?.id)throw new ScheduleError(503,'INVALID_WORKFLOW_RESPONSE','Không xác nhận được kết quả workflow.');
 return data;
}

export async function workflowReview(id:string,branchId:string,version:number){
 const checked=await inspectSchedule(id,branchId,version);
 const validation={...checked.validation,issues:checked.validation.issues.filter(i=>i.code!=='INVALID_HANDOFF_STATUS')};
 const ready=validation.hard_constraints==='PASS'&&validation.data_complete&&validation.coverage_complete&&validation.input_current&&validation.issues.length===0;
 return {validation,ready,workflow_enabled:workflowEnabled()&&draftWriteScopeAllowed(checked.saved.schedule.period_id,branchId),generation_snapshot:checked.saved.generation_snapshot,
  labels:{shifts:Object.fromEntries(checked.snapshot.shifts.map(s=>[s.id,s.name])),departments:Object.fromEntries(checked.snapshot.departments.map(d=>[d.id,d.name]))}};
}
