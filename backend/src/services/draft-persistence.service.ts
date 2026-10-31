import { createHash } from 'node:crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { registrationSummaryRepository, requireRealSchedulingData } from '../repositories/registration-summary.repository.js';
import { previewSnapshot, previewRevision } from './schedule-preview.service.js';
import { databaseError } from './scheduling.service.js';
import { schedulingInput } from './scheduling-input.js';
import { requireDraftPersistenceEnabled } from './draft-write-policy.js';
import { generateSchedule, reviewAssignments, ScheduleError, type Assignment, type SchedulingInput } from './scheduling.engine.js';

// Compare rule inputs, not UI labels/DB timestamps or query ordering. SQL repeats
// this check against its own snapshot under write-conflicting transaction locks.
export function canonicalInput(input:SchedulingInput):string {
  const project=(rows:unknown[],keys:string[])=>rows.map(row=>Object.fromEntries(keys.map(k=>[k,(row as Record<string,unknown>)[k]??null])))
    .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify({period:Object.fromEntries(['id','branch_id','work_start_date','work_end_date','status'].map(k=>[k,(input.period as unknown as Record<string,unknown>)[k]])),
    employees:project(input.employees.map(e=>({...e,skills:[...e.skills].sort()})),['id','department_id','skill_level','status','is_active','role','max_weekly_hours','skills']),
    shifts:project(input.shifts,['id','start_time','end_time','is_active','branch_id']),
    registrations:project(input.registrations,['employee_id','work_date','shift_id','status']),
    requirements:project(input.requirements,['id','department_id','work_date','shift_id','required_count','required_skill_name']),
    existing:project(input.existing,['employee_id','work_date','shift_id','department_id']),new_employee_count_threshold:input.new_employee_count_threshold});
}
export async function persistPreview(periodId:string,branchId:string,actorId:string,body:Record<string,unknown>,scheduleId?:string) {
  requireDraftPersistenceEnabled();
  requireRealSchedulingData();
  const allowed=['period_id','assignments','input_revision','request_id',...(scheduleId?['expected_version']:[])];
  const fields=['employee_id','work_date','shift_id','department_id'];
  if(Object.keys(body).some(k=>!allowed.includes(k))||typeof body.input_revision!=='string'||!/^[a-f0-9]{64}$/.test(body.input_revision)
    ||typeof body.request_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.request_id)
    ||!Array.isArray(body.assignments)||body.assignments.length>10000||body.assignments.some(a=>!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).some(k=>!fields.includes(k))||fields.some(k=>typeof a[k]!=='string'))
    ||(scheduleId&&(!Number.isSafeInteger(body.expected_version)||Number(body.expected_version)<1)))throw new ScheduleError(400,'INVALID_DRAFT_REQUEST','Cần phương án đã kiểm tra, phiên bản và mã yêu cầu lưu hợp lệ.');
  const fingerprint=createHash('sha256').update(JSON.stringify({periodId,scheduleId:scheduleId??null,version:body.expected_version??null,revision:body.input_revision,assignments:body.assignments})).digest('hex');
  // Recovery after a lost HTTP response: same request cannot create another version.
  const retry=await supabaseAdmin.from('audit_logs').select('new_data,entity_id,actor_id').eq('entity_type','schedules').eq('new_data->>request_id',body.request_id).maybeSingle();
  if(retry.error)databaseError(retry.error);
  if(retry.data){
    if(retry.data.actor_id!==actorId||retry.data.new_data?.request_fingerprint!==fingerprint)throw new ScheduleError(409,'REQUEST_CONFLICT','Mã yêu cầu đã dùng cho phương án khác.');
    const replay=await supabaseAdmin.rpc('persist_schedule_draft',{p_period_id:periodId,p_actor_id:actorId,p_schedule_id:scheduleId??null,p_expected_version:body.expected_version??null,p_request_id:body.request_id,p_fingerprint:fingerprint});
    if(replay.error)databaseError(replay.error);return replay.data;
  }
  const {snapshot}=await previewSnapshot(periodId,branchId,{...(scheduleId?{schedule_id:scheduleId,expected_version:body.expected_version}:{})},registrationSummaryRepository());
  if(previewRevision(snapshot)!==body.input_revision)throw new ScheduleError(409,'PREVIEW_STALE','Dữ liệu nguồn đã thay đổi. Hãy tạo và kiểm tra lại phương án.');
  const sourceInput=schedulingInput(snapshot);generateSchedule(sourceInput);reviewAssignments(sourceInput,body.assignments as Assignment[]);
  const args={p_period_id:periodId,p_actor_id:actorId,p_schedule_id:scheduleId??null,p_expected_version:body.expected_version??null};
  const loaded=await supabaseAdmin.rpc('persist_schedule_draft',args);if(loaded.error)databaseError(loaded.error);
  if(!loaded.data?.input||canonicalInput(sourceInput)!==canonicalInput(loaded.data.input))throw new ScheduleError(409,'INPUT_CHANGED','Dữ liệu nguồn đã thay đổi hoặc chưa đồng nhất. Hãy tải lại tuần.');
  generateSchedule(loaded.data.input);
  const result=reviewAssignments(loaded.data.input,body.assignments as Assignment[]);
  requireDraftPersistenceEnabled();
  const saved=await supabaseAdmin.rpc('persist_schedule_draft',{...args,p_snapshot:loaded.data.input,p_result:result,p_request_id:body.request_id,p_fingerprint:fingerprint});
  if(saved.error)databaseError(saved.error);
  if(!saved.data?.result?.schedule?.id)throw new ScheduleError(503,'INVALID_DATABASE_RESPONSE','Chưa thể xác nhận lưu. Hãy tải lại tuần trước khi thử lại.');
  return saved.data;
}
