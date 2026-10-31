import { createHash } from 'node:crypto';
import { registrationSummaryRepository } from '../repositories/registration-summary.repository.js';
import type { RegistrationSummaryRepository } from '../repositories/registration-summary.types.js';
import { schedulingInput } from './scheduling-input.js';
import { generateSchedule, reviewAssignments, ScheduleError, type Assignment } from './scheduling.engine.js';
import { readDraft } from './scheduling.service.js';
import { isDraftPersistenceEnabled } from './draft-write-policy.js';

export async function previewSnapshot(periodId:string,branchId:string,body:Record<string,unknown>,repository:RegistrationSummaryRepository) {
  const snapshot=await repository.load(branchId,periodId);
  let target:{id:string;version:number}|null=null;
  if(body.schedule_id!==undefined){
    if(typeof body.schedule_id!=='string'||!Number.isSafeInteger(body.expected_version)||Number(body.expected_version)<1)throw new ScheduleError(400,'INVALID_VERSION','Cần mã lịch và phiên bản DRAFT hợp lệ.');
    const saved=await readDraft(body.schedule_id,branchId);
    if(saved.schedule.period_id!==periodId||saved.schedule.status!=='DRAFT')throw new ScheduleError(409,'DRAFT_LOCKED','Chỉ chỉnh sửa DRAFT của tuần đang chọn.');
    const periods=await repository.listPeriods(branchId);
    if(saved.schedule.version!==body.expected_version||periods.find(p=>p.id===periodId)?.schedules.some(s=>s.version>saved.schedule.version))throw new ScheduleError(409,'SCHEDULE_VERSION_CHANGED','Đã có phiên bản lịch mới. Hãy tải lại tuần.');
    if((saved.assignments??[]).some(a=>a.status!=='DRAFT'||a.assignment_source!=='REGULAR'))throw new ScheduleError(409,'DRAFT_LOCKED','Phân công không thuộc DRAFT thông thường.');
    const ids=new Set((saved.assignments??[]).map(a=>a.id));
    snapshot.existing=snapshot.existing.filter(a=>!a.id||!ids.has(a.id));
    target={id:saved.schedule.id,version:saved.schedule.version};
  }else if(body.expected_version!==undefined)throw new ScheduleError(400,'INVALID_VERSION','Thiếu mã lịch cần sửa.');
  return {snapshot,target};
}
export const previewRevision=(snapshot:unknown)=>createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');

export async function previewSchedule(periodId:string,branchId:string,body:Record<string,unknown>,repository:RegistrationSummaryRepository=registrationSummaryRepository()) {
  if(Object.keys(body).some(k=>!['period_id','assignments','input_revision','schedule_id','expected_version','use_saved_assignments'].includes(k)))throw new ScheduleError(400,'INVALID_PREVIEW','Chỉ gửi tuần và phương án cần kiểm tra.');
  const {snapshot,target}=await previewSnapshot(periodId,branchId,body,repository);
  const input=schedulingInput(snapshot);
  const revision=previewRevision(snapshot);
  // Always apply the existing engine's common input/CLOSED validation.
  const generated=generateSchedule(input);
  let result=generated;
  if(body.assignments!==undefined){
    if(typeof body.input_revision!=='string'||body.input_revision!==revision)throw new ScheduleError(409,'PREVIEW_STALE','Dữ liệu đã thay đổi. Hãy tạo lại phương án trước khi điều chỉnh.');
    const fields=['employee_id','work_date','shift_id','department_id'];
    if(!Array.isArray(body.assignments)||body.assignments.length>10000||body.assignments.some(a=>!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).some(k=>!fields.includes(k))||fields.some(k=>typeof a[k]!=='string')))
      throw new ScheduleError(400,'INVALID_PREVIEW_ASSIGNMENTS','Danh sách phân công không hợp lệ.');
    result=reviewAssignments(input,body.assignments as Assignment[]);
  }else if(body.input_revision!==undefined)throw new ScheduleError(400,'INVALID_PREVIEW','Không gửi phiên bản khi tạo phương án mới.');
  if(body.use_saved_assignments!==undefined){
    if(body.use_saved_assignments!==true||!target||body.assignments!==undefined)throw new ScheduleError(400,'INVALID_PREVIEW','Không thể mở phân công đã lưu.');
    const saved=await readDraft(target.id,branchId);
    if(saved.schedule.version!==target.version||saved.schedule.status!=='DRAFT')throw new ScheduleError(409,'SCHEDULE_VERSION_CHANGED','Lịch đã thay đổi.');
    result=reviewAssignments(input,(saved.assignments??[]).map(({employee_id,work_date,shift_id,department_id})=>({employee_id,work_date,shift_id,department_id})));
  }
  return {kind:'preview' as const,persisted:false as const,source:snapshot.source,period:snapshot.period,input_revision:revision,edit_target:target,
    result,context:{source:snapshot.source,period:snapshot.period,requirements:snapshot.requirements,valid_registration_count:snapshot.registrations.length,
      employees:snapshot.employees.map(e=>({id:e.id,full_name:e.full_name,department_id:e.department_id})),shifts:snapshot.shifts,departments:snapshot.departments},
    warnings:result.coverage.filter(c=>c.warning).map(c=>({code:c.warning!,work_date:c.work_date,shift_id:c.shift_id,department_id:c.department_id})),
    persistence:{enabled:snapshot.source==='supabase'&&isDraftPersistenceEnabled(),reason:isDraftPersistenceEnabled()?'Lưu thành phiên bản DRAFT; dữ liệu sẽ được kiểm tra lại trước khi ghi.':'Chưa bật lưu DRAFT. Cần triển khai và xác minh migration trước.'}};
}
