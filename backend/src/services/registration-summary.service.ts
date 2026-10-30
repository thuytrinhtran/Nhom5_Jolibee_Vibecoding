import { generateSchedule, interval } from './scheduling.engine.js';
import type { Requirement } from './scheduling.engine.js';
import type { SummarySnapshot } from '../repositories/registration-summary.types.js';

export interface SummaryWarning { code: string; message: string }
const warnings: Record<string, string> = {
  DUPLICATE_REGISTRATION: 'Đăng ký trùng đã được gộp; mỗi nhân viên chỉ được đếm một lần trong ngày/ca/bộ phận.',
  INVALID_REGISTRATION: 'Có đăng ký sai đợt, ngày hoặc nhân viên ngoài chi nhánh; đã loại khỏi tổng hợp.',
  MISSING_REQUIREMENT: 'Chưa có nhu cầu nhân sự; chưa thể tính thiếu/thừa hoặc kết luận đủ điều kiện.',
  INVALID_REQUIREMENT: 'Nhu cầu bị trùng hoặc không hợp lệ; cần kiểm tra dữ liệu nguồn.',
  INVALID_SHIFT: 'Thiếu ca, giờ ca hoặc ca không áp dụng cho chi nhánh.',
  UNKNOWN_DEPARTMENT: 'Thiếu thông tin bộ phận.',
  INCOMPLETE_EMPLOYEE_DATA: 'Thiếu dữ liệu tài khoản, kỹ năng hoặc giới hạn để đánh giá ứng viên.',
  SKILL_MISMATCH: 'Có nhân viên đăng ký nhưng không có kỹ năng bắt buộc.',
  INACTIVE_EMPLOYEE: 'Có nhân viên hoặc tài khoản không hoạt động.',
  CREW_LEADER_EXCLUDED: 'Crew Leader không được tính là ứng viên cho nhu cầu nhân viên thường.',
  CONSTRAINT_FAILED: 'Có nhân viên không thể nhận thêm ca do lịch hiện có, giới hạn giờ hoặc vai trò không phù hợp.',
  OTHER_DEPARTMENT_NOT_COUNTED: 'Đăng ký thuộc bộ phận khác trong cùng ca không được tính vào nhu cầu bộ phận này.',
  NEW_THRESHOLD_NOT_CONFIGURED: 'Chưa đủ dữ liệu đánh giá: chưa cấu hình ngưỡng cảnh báo NEW.',
};
const warning = (code: string): SummaryWarning => ({ code, message: warnings[code] || code });
const key = (date: string, shift: string, department: string) => `${date}/${shift}/${department}`;
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date;

export function summarizeRegistrations(data: SummarySnapshot) {
  const { period } = data;
  const globalCodes = new Set<string>();
  const employees = new Map(data.employees.filter(e => e.branch_id === period.branch_id).map(e => [e.id, e]));
  const groups = new Map<string, { work_date: string; shift_id: string; department_id: string; requirements: Requirement[]; employee_ids: Set<string>; codes: Set<string> }>();
  const group = (date: string, shift: string, department: string) => {
    const id = key(date,shift,department);
    if (!groups.has(id)) groups.set(id,{work_date:date,shift_id:shift,department_id:department,requirements:[],employee_ids:new Set(),codes:new Set()});
    return groups.get(id)!;
  };
  const inPeriod = (date: string) => validDate(date) && date >= period.work_start_date && date <= period.work_end_date;
  for (const requirement of data.requirements) {
    if (!inPeriod(requirement.work_date)) { globalCodes.add('INVALID_REQUIREMENT'); continue; }
    group(requirement.work_date,requirement.shift_id,requirement.department_id).requirements.push(requirement);
  }
  for (const registration of data.registrations) {
    if (registration.status !== 'VALID') continue;
    const employee = employees.get(registration.employee_id);
    if (registration.period_id !== period.id || !inPeriod(registration.work_date) || !employee) { globalCodes.add('INVALID_REGISTRATION'); continue; }
    const row = group(registration.work_date,registration.shift_id,employee.department_id);
    if (row.employee_ids.has(employee.id)) row.codes.add('DUPLICATE_REGISTRATION');
    row.employee_ids.add(employee.id);
  }
  const threshold = Number.isInteger(data.new_employee_count_threshold) && Number(data.new_employee_count_threshold) > 0 ? data.new_employee_count_threshold : null;
  if (threshold === null) globalCodes.add('NEW_THRESHOLD_NOT_CONFIGURED');
  if (!data.requirements.length) globalCodes.add('MISSING_REQUIREMENT');
  const rows = [...groups.values()].sort((a,b) => key(a.work_date,a.shift_id,a.department_id).localeCompare(key(b.work_date,b.shift_id,b.department_id))).map(row => {
    const codes = new Set(row.codes);
    const requirement = row.requirements[0];
    const demandValid = row.requirements.length === 1 && Number.isSafeInteger(requirement.required_count) && requirement.required_count >= 0;
    if (!row.requirements.length) codes.add('MISSING_REQUIREMENT');
    else if (!demandValid) codes.add('INVALID_REQUIREMENT');
    const department = data.departments.find(d => d.id === row.department_id);
    if (!department) codes.add('UNKNOWN_DEPARTMENT');
    const shift = data.shifts.find(s => s.id === row.shift_id);
    let shiftValid = shift?.is_active === true && (shift.branch_id == null || shift.branch_id === period.branch_id);
    if (shiftValid) { try { interval(row.work_date, shift!); } catch { shiftValid = false; } }
    if (!shiftValid) codes.add('INVALID_SHIFT');
    let confirmed = 0;
    let unknown = !demandValid || !department || !shiftValid;
    const excluded: Record<string, number> = {};
    const exclude = (reason: string) => { codes.add(reason); excluded[reason] = (excluded[reason] || 0) + 1; };
    if (!unknown) for (const employeeId of row.employee_ids) {
      const employee = employees.get(employeeId)!;
      if (employee.skill_level === 'CREW_LEADER') { exclude('CREW_LEADER_EXCLUDED'); continue; }
      if (employee.status === 'INACTIVE' || employee.is_active === false) { exclude('INACTIVE_EMPLOYEE'); continue; }
      if (typeof employee.is_active !== 'boolean' || typeof employee.role !== 'string' || !['ACTIVE','INACTIVE'].includes(employee.status) ||
        !['NEW','REGULAR','CREW_TRAINING'].includes(employee.skill_level) || !Array.isArray(employee.skills) ||
        (employee.max_weekly_hours !== null && (!Number.isFinite(Number(employee.max_weekly_hours)) || Number(employee.max_weekly_hours) <= 0))) {
        unknown = true; exclude('INCOMPLETE_EMPLOYEE_DATA'); continue;
      }
      if (requirement.required_skill_name && !employee.skills.includes(requirement.required_skill_name)) { exclude('SKILL_MISMATCH'); continue; }
      try {
        // Reuse the scheduler to assess each candidate independently without creating or saving a schedule.
        const result = generateSchedule({ period: { ...period, status: 'CLOSED' },
          employees: [{ ...employee, is_active: employee.is_active, role: employee.role, skills: employee.skills }],
          shifts: data.shifts, registrations: [{ employee_id: employee.id, work_date: row.work_date, shift_id: row.shift_id, status: 'VALID' }],
          requirements: [{ ...requirement, required_count: 1 }], existing: data.existing.filter(a => a.employee_id === employee.id),
          new_employee_count_threshold: threshold, test_rules:data.test_rules });
        if (result.assigned_count) confirmed++; else exclude('CONSTRAINT_FAILED');
      } catch { unknown = true; exclude('INCOMPLETE_EMPLOYEE_DATA'); }
    }
    const otherDepartmentCount = [...groups.values()].filter(g => g.work_date === row.work_date && g.shift_id === row.shift_id && g.department_id !== row.department_id).reduce((n,g) => n + g.employee_ids.size,0);
    if (otherDepartmentCount > 0 && demandValid && confirmed < requirement.required_count) codes.add('OTHER_DEPARTMENT_NOT_COUNTED');
    const eligible = unknown ? null : confirmed;
    const required = demandValid ? requirement.required_count : null;
    const balance = required !== null && eligible !== null ? eligible - required : null;
    return { branch_id: period.branch_id, period_id: period.id, work_date: row.work_date,
      shift_id: row.shift_id, shift_name: shift?.name ?? row.shift_id, start_time: shift?.start_time ?? null, end_time: shift?.end_time ?? null,
      department_id: row.department_id, department_name: department?.name ?? row.department_id,
      registered_count: row.employee_ids.size, eligible_count: eligible, confirmed_eligible_count: confirmed,
      required_count: required, balance, shortage_count: balance === null ? null : Math.max(0,-balance), surplus_count: balance === null ? null : Math.max(0,balance),
      status: balance === null ? 'UNKNOWN' : balance < 0 ? 'SHORTAGE' : balance > 0 ? 'SURPLUS' : 'BALANCED',
      required_skill_name: requirement?.required_skill_name ?? null,
      exclusions: excluded, other_department_registered_count: otherDepartmentCount, warnings: [...codes].map(warning) };
  });
  return { source: data.source, is_mock: data.source === 'mock', branch: data.branch, period,
    new_employee_count_threshold: threshold, rows, warnings: [...globalCodes].map(warning),
    notes: ['Số người đủ điều kiện được kiểm tra độc lập cho từng ca; không phải lịch phân công đồng thời.',
      'Phân công hiện có, kể cả bản nháp, được coi là bận. Không tính nhu cầu từ Sales Forecast.'] };
}
