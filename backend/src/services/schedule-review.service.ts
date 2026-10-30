import { createHash } from 'node:crypto';
import { registrationSummaryRepository } from '../repositories/registration-summary.repository.js';
import { readDraft } from './scheduling.service.js';
import { schedulingInput } from './scheduling-input.js';
import { generateSchedule, reviewAssignments, ScheduleError, type Assignment } from './scheduling.engine.js';
import { summarizeRegistrations } from './registration-summary.service.js';

export interface ScheduleValidation {
  schedule_id:string;version:number;scope:'DECLARED_REQUIREMENTS_AND_VALID_REGISTRATIONS';
  hard_constraints:'PASS'|'FAIL'|'UNKNOWN';data_complete:boolean;coverage_complete:boolean;input_current:boolean;
  can_submit:boolean;issues:{code:string;message:string}[];warnings:{code:string;message:string}[];
  coverage:ReturnType<typeof reviewAssignments>['coverage'];checked_at:string;input_revision:string;
}
export interface ApprovalHandoffPayload {
  contract_version:'tv3-tv4.v1';source:'mock'|'supabase';is_mock:boolean;
  schedule_id:string;schedule_group_id:string;version:number;branch_id:string;period_id:string;
  work_start_date:string;work_end_date:string;current_status:'DRAFT'|'NEEDS_REVISION';requested_status:'PENDING_APPROVAL';
  created_by:string;created_at:string;prepared_by:string;prepared_at:string;
  assignments:Assignment[];requirements:ReturnType<typeof reviewAssignments>['coverage'];validation:ScheduleValidation;note:string|null;
}
export interface ScheduleApprovalGateway {
  readonly configured:boolean;
  submit(payload:ApprovalHandoffPayload):Promise<{schedule_id:string;version:number;status:'PENDING_APPROVAL'}>;
}
export class UnconfiguredScheduleApprovalGateway implements ScheduleApprovalGateway {
  readonly configured=false;
  async submit(_payload:ApprovalHandoffPayload):Promise<never>{throw new ScheduleError(503,'TV4_NOT_CONFIGURED','Chưa kết nối API tiếp nhận lịch của TV4. Lịch chưa được gửi.');}
}
export async function inspectSchedule(id:string,branchId:string,expectedVersion:number) {
  if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1)throw new ScheduleError(400,'INVALID_VERSION','Cần expected_version hợp lệ để kiểm tra đúng phiên bản.');
  const saved=await readDraft(id,branchId);
  if(saved.schedule.version!==expectedVersion)throw new ScheduleError(409,'SCHEDULE_VERSION_CHANGED','Phiên bản lịch đã đổi. Vui lòng tải lại tuần.');
  if(!saved.schedule.period_id)throw new ScheduleError(422,'PERIOD_NOT_FOUND','Lịch thiếu đợt áp dụng.');
  const repository=registrationSummaryRepository(),snapshot=await repository.load(branchId,saved.schedule.period_id);
  const options=await repository.listPeriods(branchId);
  if(options.find(p=>p.id===saved.schedule.period_id)?.schedules.some(s=>s.version>expectedVersion))throw new ScheduleError(409,'SCHEDULE_VERSION_CHANGED','Đã có phiên bản lịch mới hơn. Vui lòng kiểm tra bản mới nhất.');
  const ownIds=new Set<string>((saved.assignments??[]).map(a=>a.id).filter((id):id is string=>typeof id==='string'));
  const ownFree={...snapshot,existing:snapshot.existing.filter(a=>!a.id||!ownIds.has(a.id))};
  const issues:ScheduleValidation['issues']=[];
  let hard:ScheduleValidation['hard_constraints']='UNKNOWN';let checked:ReturnType<typeof reviewAssignments>|null=null;
  const active=(saved.assignments??[]).filter(a=>a.status!=='REPLACED');
  const assignments:Assignment[]=active.map(a=>({employee_id:a.employee_id,work_date:a.work_date,shift_id:a.shift_id,department_id:a.department_id}));
  try{const input=schedulingInput(ownFree);generateSchedule(input);checked=reviewAssignments(input,assignments);hard='PASS';}
  catch(err){const issue=err instanceof ScheduleError?err:new ScheduleError(422,'INCOMPLETE_INPUT','Không đủ dữ liệu để kiểm tra lịch.');hard=['INCOMPLETE_EMPLOYEE_DATA','NO_REQUIREMENTS','MISSING_SHIFT','INVALID_REQUIREMENT','INVALID_LIMIT'].includes(issue.code)?'UNKNOWN':'FAIL';issues.push({code:issue.code,message:issue.message});}
  const summary=summarizeRegistrations(ownFree);
  const unknown=summary.rows.filter(row=>row.status==='UNKNOWN');
  let dataComplete=unknown.length===0&&!summary.warnings.some(w=>w.code==='INVALID_REGISTRATION'||w.code==='INVALID_REQUIREMENT'||w.code==='MISSING_REQUIREMENT');
  if(!dataComplete)issues.push({code:'INCOMPLETE_DATA',message:'Thiếu nhu cầu hoặc dữ liệu bắt buộc cho các ca đã khai báo/đăng ký.'});
  if(active.some(a=>a.assignment_source&&a.assignment_source!=='REGULAR')){dataComplete=false;issues.push({code:'EXTERNAL_STAFFING_REVIEW_REQUIRED',message:'Cần kiểm tra riêng Crew Leader/nhân sự hỗ trợ trước khi bàn giao.'});}
  if(!saved.schedule.created_by||!saved.schedule.schedule_group_id||saved.schedule.branch_id!==branchId||typeof saved.schedule.created_at!=='string'||!Number.isFinite(Date.parse(saved.schedule.created_at))){dataComplete=false;issues.push({code:'INCOMPLETE_SCHEDULE_METADATA',message:'Thiếu mã nhóm lịch, phạm vi chi nhánh, người tạo hoặc thời điểm tạo hợp lệ.'});}
  const inputCurrent=!('demand_changed' in saved&&saved.demand_changed===true);
  if(!inputCurrent)issues.push({code:'INPUT_CHANGED',message:'Dữ liệu đã đổi sau khi tạo lịch. Cần tạo lại hoặc cập nhật phiên bản nháp trước.'});
  const coverageComplete=!!checked&&checked.shortages.length===0;
  if(checked&&!coverageComplete)issues.push({code:'STAFFING_SHORTAGE',message:`Lịch còn thiếu ${checked.shortages.reduce((n,r)=>n+r.missing_count,0)} lượt phân công.`});
  const statusEligible=['DRAFT','NEEDS_REVISION'].includes(saved.schedule.status);
  if(!statusEligible)issues.push({code:'INVALID_HANDOFF_STATUS',message:'TV3 chỉ chuẩn bị bàn giao bản DRAFT hoặc NEEDS_REVISION.'});
  const periodClosed=snapshot.period.status==='CLOSED';if(!periodClosed)issues.push({code:'PERIOD_NOT_CLOSED',message:'Đợt đăng ký chưa đóng.'});
  const validation:ScheduleValidation={schedule_id:id,version:expectedVersion,scope:'DECLARED_REQUIREMENTS_AND_VALID_REGISTRATIONS',
    hard_constraints:hard,data_complete:dataComplete,coverage_complete:coverageComplete,input_current:inputCurrent,
    can_submit:hard==='PASS'&&dataComplete&&coverageComplete&&inputCurrent&&statusEligible&&periodClosed,
    issues,warnings:[...summary.warnings,...(checked?.coverage.filter(r=>r.warning).map(r=>({code:r.warning!,message:'Cảnh báo cơ cấu nhân viên mới theo cấu hình.'}))??[])],
    coverage:checked?.coverage??[],checked_at:new Date().toISOString(),input_revision:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')};
  return {saved,snapshot,rule_snapshot:ownFree,assignments,validation};
}
export async function validateSchedule(id:string,branchId:string,expectedVersion:number){return(await inspectSchedule(id,branchId,expectedVersion)).validation;}
export async function prepareApprovalHandoff(id:string,branchId:string,actorId:string,body:unknown) {
  if(!body||typeof body!=='object'||Array.isArray(body))throw new ScheduleError(400,'INVALID_HANDOFF','Nội dung chuẩn bị bàn giao không hợp lệ.');
  const request=body as Record<string,unknown>;
  if(Object.keys(request).some(k=>!['expected_version','note'].includes(k))||(request.note!==undefined&&request.note!==null&&typeof request.note!=='string'))throw new ScheduleError(400,'INVALID_HANDOFF','Chỉ hỗ trợ expected_version và ghi chú.');
  const {saved,snapshot,assignments,validation}=await inspectSchedule(id,branchId,request.expected_version as number);
  const payload:ApprovalHandoffPayload|null=validation.can_submit?{
    contract_version:'tv3-tv4.v1',source:snapshot.source,is_mock:snapshot.source==='mock',schedule_id:id,schedule_group_id:saved.schedule.schedule_group_id,
    version:saved.schedule.version,branch_id:branchId,period_id:snapshot.period.id,work_start_date:snapshot.period.work_start_date,work_end_date:snapshot.period.work_end_date,
    current_status:saved.schedule.status as 'DRAFT'|'NEEDS_REVISION',requested_status:'PENDING_APPROVAL',created_by:saved.schedule.created_by,created_at:saved.schedule.created_at,
    prepared_by:actorId,prepared_at:validation.checked_at,assignments,requirements:validation.coverage,validation,
    note:typeof request.note==='string'?request.note.trim()||null:('note' in saved&&typeof saved.note==='string'?saved.note:null),
  }:null;
  return {validation,payload,current_status:saved.schedule.status,target_status:'PENDING_APPROVAL' as const,
    delivery:{configured:false,sent:false,message:'Chưa kết nối API tiếp nhận TV4. Đây chỉ là chuẩn bị dữ liệu; lịch chưa được gửi hoặc đổi trạng thái.'}};
}
