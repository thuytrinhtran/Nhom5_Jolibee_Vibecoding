import { createMockDraft, isMockSchedulingFlow, readMockDraft } from './mock-scheduling.service.js';
import { registrationSummaryRepository, requireRealSchedulingData } from '../repositories/registration-summary.repository.js';
import { summarizeRegistrations } from './registration-summary.service.js';
import { supabaseAdmin } from '../config/supabase.js';
import { generateSchedule, ScheduleError, SchedulingInput } from './scheduling.engine.js';

function databaseError(error: { code?: string; message?: string }): never {
  if (error.code === 'PGRST202') throw new ScheduleError(503, 'SCHEDULING_NOT_CONFIGURED', 'Chức năng tạo lịch chưa được cấu hình trên hệ thống. Vui lòng liên hệ quản trị viên.');
  if (error.code === '42501') throw new ScheduleError(403, 'FORBIDDEN', 'Không có quyền xếp lịch cho chi nhánh này.');
  if (error.code === 'P0002') throw new ScheduleError(404, 'PERIOD_NOT_FOUND', 'Không tìm thấy đợt đăng ký.');
  if (error.message?.includes('SCHEDULE_EXISTS')) throw new ScheduleError(409, 'SCHEDULE_EXISTS', 'Tuần đã có lịch; vui lòng sử dụng quy trình điều chỉnh lịch.');
  if (error.code === '40001') throw new ScheduleError(409, 'INPUT_CHANGED', 'Dữ liệu đã thay đổi. Vui lòng thử tạo lịch lại.');
  throw new ScheduleError(503, 'SCHEDULING_DATABASE_ERROR', 'Không thể đọc hoặc lưu lịch. Vui lòng thử lại.');
}
export async function createDraft(periodId: string, actorId: string, branchId?:string, options:{regenerate?:boolean;expectedVersion?:number}={}) {
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
  const period = await supabaseAdmin.from('registration_periods')
    .select('id, branch_id, work_start_date, work_end_date, status').eq('id', periodId).eq('branch_id', branchId).maybeSingle();
  if (period.error) databaseError(period.error);
  if (!period.data) throw new ScheduleError(404, 'PERIOD_NOT_FOUND', 'Không tìm thấy đợt đăng ký trong chi nhánh.');
  const results = await Promise.all([
    supabaseAdmin.from('staffing_requirements').select('id, department_id, shift_id, work_date, required_count, required_skill_name')
      .eq('branch_id', branchId).gte('work_date', period.data.work_start_date).lte('work_date', period.data.work_end_date).order('work_date').order('shift_id'),
    supabaseAdmin.from('shift_registrations').select('id', { count: 'exact', head: true }).eq('period_id', periodId).eq('status', 'VALID'),
    supabaseAdmin.from('employees').select('id, full_name, department_id').eq('branch_id', branchId).order('full_name'),
    supabaseAdmin.from('shifts').select('id, name, start_time, end_time').or(`branch_id.eq.${branchId},branch_id.is.null`).order('start_time'),
    supabaseAdmin.from('departments').select('id, name').order('name'),
  ]);
  for (const result of results) if (result.error) databaseError(result.error);
  return { source: 'supabase' as const, period: period.data, requirements: results[0].data ?? [], valid_registration_count: results[1].count ?? 0,
    employees: results[2].data ?? [], shifts: results[3].data ?? [], departments: results[4].data ?? [] };
}


export async function readRegistrationSummary(periodId: string, branchId: string, filters: { work_date?: string; shift_id?: string; department_id?: string } = {}) {
  const snapshot = await registrationSummaryRepository().load(branchId, periodId);
  const summary = summarizeRegistrations(snapshot);
  return { ...summary, rows: summary.rows.filter(row =>
    (!filters.work_date || row.work_date === filters.work_date) &&
    (!filters.shift_id || row.shift_id === filters.shift_id) &&
    (!filters.department_id || row.department_id === filters.department_id)) };
}
