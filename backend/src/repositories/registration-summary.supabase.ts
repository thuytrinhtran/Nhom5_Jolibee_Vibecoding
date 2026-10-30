import { effectivePeriodStatus } from '../registrations/period-status.js';
import { readTv2Source, tv2Availability, RegistrationSourceError } from '../registrations/tv3-source.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ScheduleError } from '../services/scheduling.engine.js';
import type { DemandInput, DemandRequirement, RegistrationSummaryRepository, SummaryEmployee, SummaryPeriodOption, SummarySnapshot } from './registration-summary.types.js';

type DbError = { code?: string; message?: string } | null;
function check(error: DbError, writing = false) {
  if (error && ['42703','42P01','PGRST204','PGRST205'].includes(error.code || '')) throw new ScheduleError(503, 'DEMAND_SCHEMA_NOT_READY', 'Database chưa hỗ trợ đủ trường nhu cầu/nguồn forecast. Cần nhóm kiểm tra schema; hệ thống không tự thay đổi database.');
  if (error) throw new ScheduleError(503, writing ? 'DEMAND_DATABASE_ERROR' : 'SUMMARY_DATABASE_ERROR', writing ? 'Không thể xác nhận lưu nhu cầu. Hãy tải lại tuần trước khi thử lại.' : 'Không thể đọc dữ liệu tổng hợp đăng ký. Vui lòng thử lại.');
}
// Technical pagination only; never silently truncate counts at PostgREST's row limit.
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: DbError }>): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += 500) {
    const result = await page(start, start + 499); check(result.error);
    const batch = (result.data ?? []) as T[]; rows.push(...batch);
    if (batch.length < 500) return rows;
  }
}
export class SupabaseRegistrationSummaryRepository implements RegistrationSummaryRepository {
  readonly source = 'supabase' as const;
  constructor(private db: SupabaseClient) {}
  async listPeriods(branchId: string): Promise<SummaryPeriodOption[]> {
    const periods=await all<SummaryPeriodOption & {open_at:string;close_at:string}>((from, to) => this.db.from('registration_periods')
      .select('id, branch_id, work_start_date, work_end_date, status, open_at, close_at, schedules(id, status, version, created_at)')
      .eq('branch_id', branchId).order('work_start_date', { ascending: false }).order('id').range(from, to));
    return periods.map(p=>({...p,stored_status:p.status,status:effectivePeriodStatus(p)}));
  }
  async load(branchId: string, periodId: string): Promise<SummarySnapshot> {
    const period = await this.db.from('registration_periods').select('id, branch_id, work_start_date, work_end_date, status, open_at, close_at')
      .eq('id', periodId).eq('branch_id', branchId).maybeSingle(); check(period.error);
    if (!period.data) throw new ScheduleError(404, 'PERIOD_NOT_FOUND', 'Không tìm thấy đợt đăng ký trong chi nhánh.');
    const selectedPeriod = {...period.data,stored_status:period.data.status,status:effectivePeriodStatus(period.data)};
    const start = new Date(`${selectedPeriod.work_start_date}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 1);
    const end = new Date(`${selectedPeriod.work_end_date}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 7);
    const [branch, departments, employees, source, requirements, shifts, skills, existing, warning] = await Promise.all([
      this.db.from('branches').select('id, name').eq('id', branchId).single(),
      all<SummarySnapshot['departments'][number]>((a,b) => this.db.from('departments').select('id, name').order('id').range(a,b)),
      all<Omit<SummaryEmployee, 'is_active' | 'role' | 'skills'> & { user: { is_active: boolean; role: string; branch_id: string } | null }>((a,b) => this.db.from('employees')
        .select('id, branch_id, full_name, department_id, skill_level, status, max_weekly_hours, user:user_id(is_active, role, branch_id)')
        .eq('branch_id', branchId).order('id').range(a,b)),
      readTv2Source(this.db,periodId).catch(error=>{throw new ScheduleError(error instanceof RegistrationSourceError&&error.code==='REGISTRATION_CHANGED'?409:503,error instanceof RegistrationSourceError?error.code:'REGISTRATION_UNAVAILABLE','Nguồn đăng ký TV2 chưa sẵn sàng hoặc vừa thay đổi. Vui lòng tải lại.');}),
      all<SummarySnapshot['requirements'][number]>((a,b) => this.db.from('staffing_requirements')
        .select('id, department_id, shift_id, work_date, required_count, required_skill_name, sales_forecast_ref, created_by, updated_at').eq('branch_id', branchId)
        .gte('work_date', selectedPeriod.work_start_date).lte('work_date', selectedPeriod.work_end_date).order('id').range(a,b)),
      all<SummarySnapshot['shifts'][number]>((a,b) => this.db.from('shifts').select('id, name, start_time, end_time, is_active, branch_id')
        .or(`branch_id.eq.${branchId},branch_id.is.null`).order('id').range(a,b)),
      all<{ employee_id: string; skill_name: string }>((a,b) => this.db.from('employee_skills')
        .select('id, employee_id, skill_name, employee:employees!inner(branch_id)').eq('employee.branch_id', branchId).order('id').range(a,b)),
      all<SummarySnapshot['existing'][number] & { shift: SummarySnapshot['shifts'][number] }>((a,b) => this.db.from('shift_assignments')
        .select('id, employee_id, work_date, shift_id, department_id, employee:employees!inner(branch_id), shift:shift_id(id, name, start_time, end_time, is_active, branch_id)')
        .eq('employee.branch_id', branchId).neq('status', 'REPLACED').gte('work_date', start.toISOString().slice(0,10))
        .lte('work_date', end.toISOString().slice(0,10)).order('id').range(a,b)),
      this.db.from('warning_configs').select('new_employee_count_threshold').eq('branch_id', branchId).maybeSingle(),
    ]);
    check(branch.error); check(warning.error);
    const shiftMap = new Map(shifts.map(s => [s.id,s]));
    for (const assignment of existing) if (assignment.shift) shiftMap.set(assignment.shift.id, assignment.shift);
    const people=employees.map(({user,...employee}) => ({ ...employee, is_active: user?.branch_id === branchId ? user.is_active : null,
      role: user?.branch_id === branchId ? user.role : null, skills: skills.filter(s=>s.employee_id===employee.id).map(s=>s.skill_name) }));
    const availability=tv2Availability(source,selectedPeriod,people,shifts);
    return { source:this.source, branch:branch.data!,period:selectedPeriod,departments,
      registrations:availability.registrations,registration_declarations:availability.declarations,
      requirements,shifts:[...shiftMap.values()],existing,employees:people,
      new_employee_count_threshold:warning.data?.new_employee_count_threshold??null };
  }

  async clearRequirement(branchId:string,_periodId:string,id:string,expected:string) {
    const result=await this.db.from('staffing_requirements').delete().eq('id',id).eq('branch_id',branchId).eq('updated_at',expected).select('id').maybeSingle();
    if (result.error?.code==='42501') throw new ScheduleError(503,'DEMAND_WRITE_NOT_ALLOWED','Backend chưa có quyền xóa nhu cầu trên database.');
    check(result.error,true);
    if (!result.data) throw new ScheduleError(409,'DEMAND_CHANGED','Nhu cầu đã thay đổi. Vui lòng tải lại tuần.');
  }
  async saveRequirement(branchId: string, _periodId: string, actorId: string, input: DemandInput, existingId: string | null): Promise<DemandRequirement> {
    const { expected_updated_at, ...fields } = input;
    const updated_at = new Date(Math.max(Date.now(), expected_updated_at ? Date.parse(expected_updated_at) + 1 : 0)).toISOString();
    // A single-row INSERT or conditional UPDATE is atomic; do not overwrite created_by.
    const query = existingId
      ? this.db.from('staffing_requirements').update({ required_count: fields.required_count,
          required_skill_name: fields.required_skill_name, sales_forecast_ref: fields.sales_forecast_ref, updated_at })
          .eq('id', existingId).eq('branch_id', branchId).eq('updated_at', expected_updated_at!)
      : this.db.from('staffing_requirements').insert({ ...fields, branch_id: branchId, created_by: actorId, excludes_crew_leader: true, updated_at });
    const result = await query.select('id, department_id, shift_id, work_date, required_count, required_skill_name, sales_forecast_ref, created_by, updated_at').maybeSingle();
    if (result.error?.code === '23505') throw new ScheduleError(409, 'DEMAND_CHANGED', 'Nhu cầu đã tồn tại hoặc vừa được thay đổi. Vui lòng tải lại tuần.');
    if (result.error?.code === '42501') throw new ScheduleError(503, 'DEMAND_WRITE_NOT_ALLOWED', 'Backend chưa có quyền ghi nhu cầu trên database. Liên hệ quản trị viên; hệ thống không tự sửa quyền.');
    check(result.error, true);
    if (!result.data) throw new ScheduleError(409, 'DEMAND_CHANGED', 'Nhu cầu đã được người khác thay đổi. Vui lòng tải lại tuần.');
    return result.data as DemandRequirement;
  }

}
