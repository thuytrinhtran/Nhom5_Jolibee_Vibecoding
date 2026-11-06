import { effectivePeriodStatus } from '../registrations/period-status.js';
import { readTv2Source, tv2Availability, acceptedDevHeader, RegistrationSourceError } from '../registrations/tv3-source.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ScheduleError } from '../services/scheduling.engine.js';
import type { DemandInput, DemandRequirement, RegistrationSummaryRepository, SummaryEmployee, SummaryPeriodOption, SummarySnapshot } from './registration-summary.types.js';

type DbError = { code?: string; message?: string } | null;
function check(error: DbError, writing = false) {
  if (error && ['42703','42P01','PGRST200','PGRST201','PGRST204','PGRST205'].includes(error.code || '')) throw new ScheduleError(503, writing ? 'DEMAND_SCHEMA_NOT_READY' : 'SUMMARY_SCHEMA_NOT_READY', 'Database chưa hỗ trợ đủ bảng, view, cột hoặc quan hệ của hợp đồng TV2–TV3. Cần nhóm kiểm tra schema/cache; không tự thay database hoặc chuyển sang MOCK.');
  if (error && ['42501','PGRST301','PGRST302','PGRST303'].includes(error.code || '')) throw new ScheduleError(503, writing ? 'DEMAND_WRITE_NOT_ALLOWED' : 'SUMMARY_ACCESS_DENIED', 'Backend chưa có quyền truy cập dữ liệu Supabase cần thiết. Kiểm tra cấu hình/quyền phía máy chủ; không chuyển sang MOCK.');
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
<<<<<<< Updated upstream
    const periods=await all<SummaryPeriodOption & {open_at:string;close_at:string}>((from, to) => this.db.from('registration_periods')
      .select('id, branch_id, work_start_date, work_end_date, status, open_at, close_at, schedules(id, status, version, created_at)')
=======
    return all((from, to) => this.db.from('registration_periods_effective')
      .select('id, branch_id, work_start_date, work_end_date, status, schedules(id, status, version, created_at)')
>>>>>>> Stashed changes
      .eq('branch_id', branchId).order('work_start_date', { ascending: false }).order('id').range(from, to));
    return periods.map(p=>({...p,stored_status:p.status,status:effectivePeriodStatus(p)}));
  }
  async load(branchId: string, periodId: string): Promise<SummarySnapshot> {
<<<<<<< Updated upstream
    const period = await this.db.from('registration_periods').select('id, branch_id, work_start_date, work_end_date, status, open_at, close_at')
=======
    const period = await this.db.from('registration_periods_effective').select('id, branch_id, work_start_date, work_end_date, status')
>>>>>>> Stashed changes
      .eq('id', periodId).eq('branch_id', branchId).maybeSingle(); check(period.error);
    if (!period.data) throw new ScheduleError(404, 'PERIOD_NOT_FOUND', 'Không tìm thấy đợt đăng ký trong chi nhánh.');
    const selectedPeriod = {...period.data,stored_status:period.data.status,status:effectivePeriodStatus(period.data)};
    const start = new Date(`${selectedPeriod.work_start_date}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 1);
    const end = new Date(`${selectedPeriod.work_end_date}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 7);
<<<<<<< Updated upstream
    const [branch, departments, employees, source, requirements, shifts, skills, existing, warning] = await Promise.all([
=======
    const [branch, departments, employees, rawRegistrations, submissions, requirements, shifts, skills, existing, warning] = await Promise.all([
>>>>>>> Stashed changes
      this.db.from('branches').select('id, name').eq('id', branchId).single(),
      all<SummarySnapshot['departments'][number]>((a,b) => this.db.from('departments').select('id, name').order('id').range(a,b)),
      all<Omit<SummaryEmployee, 'is_active' | 'role' | 'skills'> & { user: { is_active: boolean; role: string; branch_id: string; username?: string } | null }>((a,b) => this.db.from('employees')
        .select('id, branch_id, full_name, department_id, skill_level, status, max_weekly_hours, user:user_id(is_active, role, branch_id, username)')
        .eq('branch_id', branchId).order('id').range(a,b)),
<<<<<<< Updated upstream
      readTv2Source(this.db,periodId).catch(error=>{throw new ScheduleError(error instanceof RegistrationSourceError&&error.code==='REGISTRATION_CHANGED'?409:503,error instanceof RegistrationSourceError?error.code:'REGISTRATION_UNAVAILABLE','Nguồn đăng ký TV2 chưa sẵn sàng hoặc vừa thay đổi. Vui lòng tải lại.');}),
=======
      all<SummarySnapshot['registrations'][number] & {submitted_at:string|null}>((a,b) => this.db.from('shift_registrations')
        .select('id, period_id, employee_id, work_date, shift_id, status, submitted_at').eq('period_id', periodId).eq('status', 'VALID').order('id').range(a,b)),
      all<{period_id:string;employee_id:string;status:string;submitted_at:string|null;sample_batch_id:string|null}>((a,b) => this.db.from('registration_submissions_sourced')
        .select('period_id, employee_id, status, submitted_at, sample_batch_id').eq('period_id', periodId).order('employee_id').range(a,b)),
>>>>>>> Stashed changes
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
    // TV2 handoff: a row marked VALID alone is not confirmed availability.
    // Missing headers never mean OFF; samples are excluded without an implicit opt-in.
    const submitted = new Set(submissions.filter(h => h.period_id === periodId && h.status === 'VALID' && h.submitted_at && h.sample_batch_id === null).map(h => h.employee_id));
    const people = new Map(employees.map(e => [e.id,e]));
    const applicableShifts = new Map(shifts.map(s => [s.id,s]));
    const registrations = rawRegistrations.filter(r => {
      const employee = people.get(r.employee_id), shift = applicableShifts.get(r.shift_id);
      return r.period_id === periodId && r.status === 'VALID' && !!r.submitted_at && submitted.has(r.employee_id) &&
        employee?.branch_id === branchId && employee.status === 'ACTIVE' && employee.skill_level !== 'CREW_LEADER' &&
        employee.user?.branch_id === branchId && employee.user.role === 'NV' && employee.user.is_active === true &&
        shift?.is_active === true && (shift.branch_id == null || shift.branch_id === branchId) &&
        r.work_date >= selectedPeriod.work_start_date && r.work_date <= selectedPeriod.work_end_date;
    });
    const shiftMap = new Map(shifts.map(s => [s.id,s]));
    for (const assignment of existing) if (assignment.shift) shiftMap.set(assignment.shift.id, assignment.shift);
    const people=employees.map(({user,...employee}) => ({ ...employee, employee_code:user?.username, is_active: user?.branch_id === branchId ? user.is_active : null,
      role: user?.branch_id === branchId ? user.role : null, skills: skills.filter(s=>s.employee_id===employee.id).map(s=>s.skill_name) }));
    const availability=tv2Availability(source,selectedPeriod,people,shifts);
    return { source:this.source, branch:branch.data!,period:selectedPeriod,departments,
      registrations:availability.registrations,registration_declarations:availability.declarations,
      registration_submission_employee_ids:source.headers.map(h=>h.employee_id),
      registration_provenance:source.headers.filter(h=>h.status==='VALID'&&h.submitted_at&&(!h.sample_batch_id||acceptedDevHeader(h,selectedPeriod))&&availability.declarations.some(d=>d.employee_id===h.employee_id&&d.declaration!=='NOT_SUBMITTED')).map(h=>({employee_id:h.employee_id,batch_id:h.sample_batch_id,submitted_at:h.submitted_at!,updated_at:h.updated_at})),
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
