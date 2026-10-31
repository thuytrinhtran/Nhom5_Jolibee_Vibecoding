import { createMockDraft, isMockSchedulingFlow, readMockDraft } from './mock-scheduling.service.js';
import { registrationSummaryRepository, requireRealSchedulingData } from '../repositories/registration-summary.repository.js';
import { summarizeRegistrations } from './registration-summary.service.js';
import { supabaseAdmin } from '../config/supabase.js';
import { generateSchedule, ScheduleError, SchedulingInput } from './scheduling.engine.js';
import { requireDraftPersistenceEnabled } from './draft-write-policy.js';

export function databaseError(error: { code?: string; message?: string }): never {
  if (error.code === 'PGRST202') throw new ScheduleError(503, 'SCHEDULING_NOT_CONFIGURED', 'Chức năng tạo lịch chưa được cấu hình trên hệ thống. Vui lòng liên hệ quản trị viên.');
  if (error.code === '42501') throw new ScheduleError(403, 'FORBIDDEN', 'Không có quyền xếp lịch cho chi nhánh này.');
  if (error.code === 'P0002') throw new ScheduleError(404, 'PERIOD_NOT_FOUND', 'Không tìm thấy đợt đăng ký.');
  if (error.message?.includes('DRAFT_LOCKED')) throw new ScheduleError(409,'DRAFT_LOCKED','Chỉ có thể chỉnh sửa DRAFT chưa gửi duyệt.');
  if (error.message?.includes('SCHEDULE_VERSION_CHANGED')||error.message?.includes('REQUEST_CONFLICT')) throw new ScheduleError(409,'SCHEDULE_VERSION_CHANGED','Phiên bản hoặc yêu cầu lưu đã thay đổi. Hãy tải lại lịch.');
  if (error.message?.includes('SCHEDULE_EXISTS')) throw new ScheduleError(409, 'SCHEDULE_EXISTS', 'Tuần đã có lịch; vui lòng sử dụng quy trình điều chỉnh lịch.');
  if (error.code === '40001') throw new ScheduleError(409, 'INPUT_CHANGED', 'Dữ liệu đã thay đổi. Vui lòng thử tạo lịch lại.');
  if (error.message?.includes('PERIOD_NOT_CLOSED')) throw new ScheduleError(409,'PERIOD_NOT_CLOSED','Đợt đăng ký phải được đóng trước khi xếp lịch.');
  if (error.code === '23505') throw new ScheduleError(409,'SCHEDULE_CONFLICT','Dữ liệu lịch bị trùng. Vui lòng tải lại tuần.');
  if (error.code === '22023') throw new ScheduleError(422,'INVALID_ASSIGNMENTS','Phân công không phù hợp dữ liệu hiện tại. Vui lòng tải lại tuần và kiểm tra ràng buộc.');
  if (['55P03','57014','40P01'].includes(error.code || '')) throw new ScheduleError(503,'SCHEDULING_BUSY','Dữ liệu đang được xử lý. Vui lòng tải lại tuần trước khi thử lại.');
  throw new ScheduleError(503, 'SCHEDULING_DATABASE_ERROR', 'Không thể đọc hoặc lưu lịch. Vui lòng thử lại.');
}
export async function createDraft(periodId: string, actorId: string, branchId?:string, options:{regenerate?:boolean;expectedVersion?:number}={}) {
  requireDraftPersistenceEnabled();
  if(isMockSchedulingFlow()){
    if(!branchId)throw new ScheduleError(403,'BRANCH_REQUIRED','Quản lý chưa được phân công chi nhánh.');
    return createMockDraft(periodId,branchId,actorId,options);
  }
  if(options.regenerate)throw new ScheduleError(409,'MOCK_FLOW_REQUIRED','Tạo lại phiên bản trong luồng này chỉ dành cho dữ liệu thử nghiệm.');
  requireRealSchedulingData();
  const loaded = await supabaseAdmin.rpc('generate_schedule_draft', { p_period_id: periodId, p_actor_id: actorId });
  if (loaded.error) databaseError(loaded.error);
  if (loaded.data?.result) return loaded.data;
  if (!loaded.data?.input) throw new ScheduleError(503, 'INVALID_DATABASE_RESPONSE', 'Không thể đọc dữ liệu xếp lịch.');
  const input = loaded.data.input as SchedulingInput;
  const result = generateSchedule(input);
  requireDraftPersistenceEnabled();
  const saved = await supabaseAdmin.rpc('generate_schedule_draft', {
    p_period_id: periodId, p_actor_id: actorId, p_snapshot: input, p_result: result,
  });
  if (saved.error) databaseError(saved.error);
  if (!saved.data?.result) throw new ScheduleError(503, 'INVALID_DATABASE_RESPONSE', 'Không thể xác nhận lưu lịch.');
  return saved.data;
}

export async function readDraft(scheduleId: string, branchId: string) {
  if(isMockSchedulingFlow())return readMockDraft(scheduleId,branchId);
  requireRealSchedulingData();
  const { data: schedule, error } = await supabaseAdmin.from('schedules').select('*').eq('id', scheduleId).eq('branch_id', branchId).maybeSingle();
  if (error) databaseError(error);
  if (!schedule) throw new ScheduleError(404, 'SCHEDULE_NOT_FOUND', 'Không tìm thấy lịch trong chi nhánh.');
  const assignments = await supabaseAdmin.from('shift_assignments').select('*').eq('schedule_id',scheduleId).order('work_date').order('shift_id').order('employee_id');
  if (assignments.error) databaseError(assignments.error);
  const audit = await supabaseAdmin.from('audit_logs').select('new_data').eq('entity_type','schedules').eq('entity_id',scheduleId).eq('action','AUTO_GENERATE').order('created_at',{ascending:false}).limit(1).maybeSingle();
  if (audit.error) databaseError(audit.error);
  return { schedule, assignments: assignments.data, generation_snapshot: audit.data?.new_data ?? null };
}

// Read-only data for the manager's week selector. Never accept branch scope from client.
export async function listSchedulingPeriods(branchId: string) {
  return registrationSummaryRepository().listPeriods(branchId);
}

export async function readSchedulingContext(periodId: string, branchId: string) {
  const repository = registrationSummaryRepository();
  if (repository.source === 'mock') {
    const data = await repository.load(branchId, periodId);
    return { source: data.source, can_generate_mock:isMockSchedulingFlow(), test_rules:data.test_rules, period: data.period, requirements: data.requirements,
      valid_registration_count: new Set(data.registrations.filter(r => r.status === 'VALID').map(r => `${r.employee_id}/${r.work_date}/${r.shift_id}`)).size,
      employees: data.employees.map(e => ({ id: e.id, full_name: e.full_name, department_id: e.department_id })),
      shifts: data.shifts, departments: data.departments };
  }
  const data=await repository.load(branchId,periodId);
  return {source:data.source,period:data.period,requirements:data.requirements,
    valid_registration_count:data.registrations.length,registration_declarations:data.registration_declarations,
    employees:data.employees.map(e=>({id:e.id,full_name:e.full_name,department_id:e.department_id})),
    shifts:data.shifts,departments:data.departments};
}


export async function readRegistrationSummary(periodId: string, branchId: string, filters: { work_date?: string; shift_id?: string; department_id?: string } = {}) {
  const snapshot = await registrationSummaryRepository().load(branchId, periodId);
  const summary = summarizeRegistrations(snapshot);
  return { ...summary, registration_declarations:snapshot.registration_declarations, rows: summary.rows.filter(row =>
    (!filters.work_date || row.work_date === filters.work_date) &&
    (!filters.shift_id || row.shift_id === filters.shift_id) &&
    (!filters.department_id || row.department_id === filters.department_id)) };
}
