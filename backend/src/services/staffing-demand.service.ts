import { registrationSummaryRepository } from '../repositories/registration-summary.repository.js';
import type { DemandInput, RegistrationSummaryRepository, SummarySnapshot } from '../repositories/registration-summary.types.js';
import { summarizeRegistrations } from './registration-summary.service.js';
import { interval, ScheduleError } from './scheduling.engine.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dateValid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
export function validateDemandInput(body: unknown): DemandInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ScheduleError(400,'INVALID_DEMAND','Nội dung nhu cầu không hợp lệ.');
  const value = body as Record<string, unknown>;
  const allowed = ['work_date','shift_id','department_id','required_count','required_skill_name','sales_forecast_ref','expected_updated_at'];
  if (Object.keys(value).some(k => !allowed.includes(k))) throw new ScheduleError(400,'INVALID_DEMAND_FIELDS','Chỉ gửi các trường nhu cầu được hỗ trợ; chi nhánh và người tạo do Backend xác định.');
  if (typeof value.work_date !== 'string' || !dateValid(value.work_date) || typeof value.shift_id !== 'string' || !uuid.test(value.shift_id) || typeof value.department_id !== 'string' || !uuid.test(value.department_id))
    throw new ScheduleError(400,'INVALID_DEMAND','Ngày, ca hoặc bộ phận không hợp lệ.');
  if (typeof value.required_count !== 'number' || !Number.isInteger(value.required_count) || value.required_count < 0 || value.required_count > 2147483647)
    throw new ScheduleError(400,'INVALID_DEMAND_COUNT','Nhu cầu phải là số nguyên không âm trong giới hạn kiểu integer của database.');
  const text = (field: string) => {
    const item = value[field];
    if (item !== null && typeof item !== 'string') throw new ScheduleError(400,'INVALID_DEMAND_TEXT','Kỹ năng và nguồn forecast phải là chuỗi hoặc null.');
    return typeof item === 'string' ? item.trim() || null : null;
  };
  const skill = text('required_skill_name'), forecast = text('sales_forecast_ref');
  if (skill && [...skill].length > 100) throw new ScheduleError(400,'INVALID_SKILL_NAME','Tên kỹ năng tối đa 100 ký tự theo schema.');
  const expected = value.expected_updated_at;
  if (expected !== null && (typeof expected !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(expected) || !Number.isFinite(Date.parse(expected))))
    throw new ScheduleError(400,'INVALID_DEMAND_VERSION','Cần gửi expected_updated_at nhận từ API, hoặc null cho nhu cầu mới.');
  return { work_date:value.work_date,shift_id:value.shift_id,department_id:value.department_id,required_count:value.required_count,
    required_skill_name:skill,sales_forecast_ref:forecast,expected_updated_at:expected as string|null };
}
function demandView(snapshot: SummarySnapshot) {
  return { source:snapshot.source,is_mock:snapshot.source==='mock',branch:snapshot.branch,period:snapshot.period,
    shifts:snapshot.shifts.filter(s=>s.branch_id==null||s.branch_id===snapshot.period.branch_id),departments:snapshot.departments,
    requirements:snapshot.requirements,skill_names:[...new Set(snapshot.employees.flatMap(e=>e.skills??[]))].sort(),
    forecast_mode:'REFERENCE_ONLY' as const,staffing_formula_status:'NOT_CONFIGURED' as const,summary:summarizeRegistrations(snapshot) };
}
export async function readDemand(periodId: string, branchId: string, repository: RegistrationSummaryRepository = registrationSummaryRepository()) {
  return demandView(await repository.load(branchId,periodId));
}
// Unknown demand is absence of a row, never a numeric zero or a nullable count.
export async function clearDemand(periodId:string,branchId:string,body:unknown,repository:RegistrationSummaryRepository=registrationSummaryRepository()) {
  if (!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['work_date','shift_id','department_id','expected_updated_at'].includes(k)))
    throw new ScheduleError(400,'INVALID_DEMAND_FIELDS','Chỉ gửi ngày, ca, bộ phận và phiên bản cần xóa.');
  const input=validateDemandInput({...body,required_count:0,required_skill_name:null,sales_forecast_ref:null});
  if (!input.expected_updated_at) throw new ScheduleError(400,'INVALID_DEMAND_VERSION','Cần phiên bản nhu cầu đã lưu trước khi xóa.');
  const snapshot=await repository.load(branchId,periodId);
  if(input.work_date<snapshot.period.work_start_date||input.work_date>snapshot.period.work_end_date)
    throw new ScheduleError(422,'DEMAND_OUTSIDE_PERIOD','Ngày phải thuộc tuần đã chọn.');
  const rows=snapshot.requirements.filter(r=>r.work_date===input.work_date&&r.shift_id===input.shift_id&&r.department_id===input.department_id);
  if(rows.length!==1||rows[0].updated_at!==input.expected_updated_at) throw new ScheduleError(409,'DEMAND_CHANGED','Nhu cầu đã thay đổi. Vui lòng tải lại tuần.');
  await repository.clearRequirement(branchId,periodId,rows[0].id,input.expected_updated_at);
  return {source:repository.source,is_mock:repository.source==='mock',cleared_id:rows[0].id};
}
export async function saveDemand(periodId: string, branchId: string, actorId: string, body: unknown, repository: RegistrationSummaryRepository = registrationSummaryRepository()) {
  const input = validateDemandInput(body);
  const snapshot = await repository.load(branchId,periodId);
  if (input.work_date < snapshot.period.work_start_date || input.work_date > snapshot.period.work_end_date)
    throw new ScheduleError(422,'DEMAND_OUTSIDE_PERIOD','Ngày nhập nhu cầu phải thuộc tuần đã chọn.');
  if (!snapshot.departments.some(d=>d.id===input.department_id)) throw new ScheduleError(422,'UNKNOWN_DEPARTMENT','Bộ phận chưa được cấu hình.');
  const shift=snapshot.shifts.find(s=>s.id===input.shift_id);
  if (!shift?.is_active || (shift.branch_id!=null && shift.branch_id!==branchId)) throw new ScheduleError(422,'INVALID_DEMAND_SHIFT','Ca không hoạt động hoặc không thuộc chi nhánh.');
  interval(input.work_date,shift);
  const existing=snapshot.requirements.filter(r=>r.work_date===input.work_date&&r.shift_id===input.shift_id&&r.department_id===input.department_id);
  if (existing.length>1) throw new ScheduleError(409,'DUPLICATE_DEMAND','Có nhu cầu trùng; cần nhóm kiểm tra dữ liệu nguồn.');
  if ((existing[0]?.updated_at??null)!==input.expected_updated_at || (existing.length>0&&!input.expected_updated_at))
    throw new ScheduleError(409,'DEMAND_CHANGED','Nhu cầu đã thay đổi hoặc thiếu phiên bản dữ liệu. Vui lòng tải lại tuần.');
  return { source:repository.source,is_mock:repository.source==='mock',requirement:await repository.saveRequirement(branchId,periodId,actorId,input,existing[0]?.id??null) };
}
