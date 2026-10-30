import { schedulingInput } from './scheduling-input.js';
import { randomUUID } from 'node:crypto';
import { registrationSummaryRepository } from '../repositories/registration-summary.repository.js';
import { MockRegistrationSummaryRepository } from '../repositories/registration-summary.mock.js';
import { mockRecord, mockRecords, storeMockRecord, type MockScheduleRecord } from '../repositories/mock-schedule.store.js';
import { generateSchedule, reviewAssignments, ScheduleError, type Assignment, type SchedulingInput } from './scheduling.engine.js';

export function isMockSchedulingFlow() {
  const repository=registrationSummaryRepository();
  return repository instanceof MockRegistrationSummaryRepository;
}
function mockInput(branchId:string,periodId:string):SchedulingInput {
  const repository=registrationSummaryRepository();
  if(!(repository instanceof MockRegistrationSummaryRepository))throw new ScheduleError(409,'MOCK_FLOW_REQUIRED','Chỉnh sửa thử nghiệm chỉ khả dụng khi bật Mock Mode, không ghi vào lịch thật.');
  return schedulingInput(repository.snapshot(branchId,periodId));
}
function scenario(){const repository=registrationSummaryRepository();if(!(repository instanceof MockRegistrationSummaryRepository))throw new ScheduleError(409,'MOCK_FLOW_REQUIRED','Mock Mode chưa được bật.');return repository.scenario;}
function makeRecord(input:SchedulingInput,actorId:string,result:ReturnType<typeof generateSchedule>,previous?:MockScheduleRecord,note:string|null=null):MockScheduleRecord {
  return {scenario:scenario(),schedule:{id:randomUUID(),schedule_group_id:previous?.schedule.schedule_group_id??randomUUID(),period_id:input.period.id,branch_id:input.period.branch_id,
    version:(previous?.schedule.version??0)+1,status:'DRAFT',created_by:actorId,created_at:new Date().toISOString()},
    input,result,fingerprint:JSON.stringify(input),note};
}
export async function createMockDraft(periodId:string,branchId:string,actorId:string,options:{regenerate?:boolean;expectedVersion?:number}={}) {
  const input=mockInput(branchId,periodId);
  // Snapshot, version checks, validation and the memory write do not yield to other requests.
  const previous=mockRecords(branchId,periodId,scenario())[0];
  if(options.regenerate){
    if(!previous||previous.schedule.version!==options.expectedVersion)throw new ScheduleError(409,'MOCK_VERSION_CHANGED','Lịch thử nghiệm đã có phiên bản mới. Vui lòng tải lại tuần.');
  }else if(previous){
    if(previous.fingerprint!==JSON.stringify(input))throw new ScheduleError(409,'MOCK_DRAFT_STALE','Nhu cầu đã đổi sau khi tạo lịch. Hãy đọc lại lịch và bấm Tạo lại lịch dự kiến.');
    return {reused:true,result:{...previous.result,schedule:previous.schedule,week:input.period},source:'mock',is_mock:true};
  }
  const record=makeRecord(input,actorId,generateSchedule(input),previous);
  storeMockRecord(record);
  return {reused:false,result:{...record.result,schedule:record.schedule,week:input.period},source:'mock',is_mock:true};
}
export async function readMockDraft(id:string,branchId:string) {
  if(!isMockSchedulingFlow())throw new ScheduleError(409,'MOCK_FLOW_REQUIRED','Kịch bản thử nghiệm chưa được bật.');
  const record=mockRecord(id,branchId,scenario());
  if(!record)throw new ScheduleError(404,'SCHEDULE_NOT_FOUND','Không tìm thấy lịch thử nghiệm trong chi nhánh.');
  const current=mockInput(branchId,record.schedule.period_id);
  return {source:'mock' as const,is_mock:true,test_configuration:{max_shifts_per_day:record.input.test_rules?.max_shifts_per_day??null,policy_source:'TEST_ONLY'},
    schedule:record.schedule,assignments:record.result.assignments.map((a,i)=>({...a,id:`${record.schedule.id}:${i}`,status:'DRAFT',assignment_source:'REGULAR'})),
    generation_snapshot:record.result,validation:{hard_constraints:record.fingerprint===JSON.stringify(current)?'PASS':'UNKNOWN',coverage_complete:record.result.shortages.length===0&&record.fingerprint===JSON.stringify(current)},
    demand_changed:record.fingerprint!==JSON.stringify(current),note:record.note};
}
export async function editMockDraft(id:string,branchId:string,actorId:string,body:unknown) {
  if(!isMockSchedulingFlow())throw new ScheduleError(409,'MOCK_FLOW_REQUIRED','Chỉnh sửa thử nghiệm chỉ dùng trong Mock Mode, không ghi lịch thật.');
  if(!body||typeof body!=='object'||Array.isArray(body))throw new ScheduleError(400,'INVALID_DRAFT_EDIT','Nội dung chỉnh sửa không hợp lệ.');
  const value=body as Record<string,unknown>;
  if(Object.keys(value).some(k=>!['expected_version','assignments','note'].includes(k))||!Number.isSafeInteger(value.expected_version)||!Array.isArray(value.assignments))throw new ScheduleError(400,'INVALID_DRAFT_EDIT','Cần expected_version và danh sách assignments.');
  if(value.note!==undefined&&value.note!==null&&typeof value.note!=='string')throw new ScheduleError(400,'INVALID_DRAFT_NOTE','Ghi chú phải là văn bản.');
  const currentRecord=mockRecord(id,branchId,scenario());
  if(!currentRecord)throw new ScheduleError(404,'SCHEDULE_NOT_FOUND','Không tìm thấy lịch thử nghiệm trong chi nhánh.');
  const input=mockInput(branchId,currentRecord.schedule.period_id);
  const previous=mockRecords(branchId,input.period.id,scenario())[0];
  if(previous?.schedule.id!==id||previous.schedule.version!==value.expected_version)throw new ScheduleError(409,'MOCK_VERSION_CHANGED','Lịch đã thay đổi. Vui lòng tải lại phiên bản mới.');
  if(previous.fingerprint!==JSON.stringify(input))throw new ScheduleError(409,'MOCK_DRAFT_STALE','Nhu cầu đã đổi; cần tạo lại lịch trước khi chỉnh sửa.');
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const assignments:Assignment[]=value.assignments.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!['employee_id','work_date','shift_id','department_id'].includes(k))||
      !['employee_id','shift_id','department_id'].every(k=>typeof item[k]==='string'&&uuid.test(item[k]))||typeof item.work_date!=='string')throw new ScheduleError(400,'INVALID_ASSIGNMENT','Thông tin nhân viên, ngày, ca hoặc bộ phận không hợp lệ.');
    return {employee_id:item.employee_id,work_date:item.work_date,shift_id:item.shift_id,department_id:item.department_id};
  });
  const record=makeRecord(input,actorId,reviewAssignments(input,assignments),previous,typeof value.note==='string'?value.note.trim()||null:null);
  storeMockRecord(record);
  return {source:'mock',is_mock:true,schedule:record.schedule};
}
