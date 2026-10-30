export interface Employee {
  id: string; department_id: string; skill_level: string; status: string;
  is_active: boolean; role: string; max_weekly_hours: number | null; skills: string[];
}
export interface Shift { id: string; start_time: string; end_time: string; is_active: boolean; branch_id?: string | null }
export interface Registration { employee_id: string; work_date: string; shift_id: string; status: string }
export interface Requirement { id: string; department_id: string; work_date: string; shift_id: string; required_count: number; required_skill_name: string | null }
export interface Assignment { employee_id: string; work_date: string; shift_id: string; department_id: string }
export interface SchedulingInput {
  period: { id: string; branch_id: string; work_start_date: string; work_end_date: string; status: string };
  employees: Employee[]; shifts: Shift[]; registrations: Registration[];
  requirements: Requirement[]; existing: Assignment[]; new_employee_count_threshold: number | null;
  test_rules?: { max_shifts_per_day: number };
}
export class ScheduleError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const rank: Record<string, number> = { CREW_TRAINING: 0, REGULAR: 1, NEW: 2 };

// Local business dates in Asia/Ho_Chi_Minh; numeric intervals preserve overnight overlap.
export function interval(date: string, shift: Shift): [number, number] {
  const seconds = (time: string) => {
    if (!/^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(time)) throw new ScheduleError(422, 'INVALID_SHIFT', 'Giờ ca không hợp lệ.');
    const [h, m, s = 0] = time.split(':').map(Number);
    if (h > 23 || m > 59 || s >= 60) throw new ScheduleError(422, 'INVALID_SHIFT', 'Giờ ca không hợp lệ.');
    return h * 3600 + m * 60 + s;
  };
  const start = seconds(shift.start_time), end = seconds(shift.end_time);
  if (start === end) throw new ScheduleError(422, 'INVALID_SHIFT', 'Ca phải có thời lượng xác định.');
  const day = Date.parse(`${date}T00:00:00+07:00`) / 1000;
  if (!Number.isFinite(day)) throw new ScheduleError(422, 'INVALID_DATE', 'Ngày làm không hợp lệ.');
  return [day + start, day + end + (end < start ? 86400 : 0)];
}


export function assignmentIssue(input:SchedulingInput,employee:Employee,need:Requirement,booked:Assignment[]):{code:string;message:string}|null {
  if(employee.status!=='ACTIVE'||employee.is_active!==true||employee.role!=='NV'||rank[employee.skill_level]===undefined)return{code:'INACTIVE_EMPLOYEE',message:'Nhân viên không hoạt động hoặc không thuộc nhóm được phân công.'};
  if(employee.department_id!==need.department_id)return{code:'DEPARTMENT_MISMATCH',message:'Nhân viên không thuộc bộ phận của vị trí.'};
  if(need.required_skill_name&&!employee.skills.includes(need.required_skill_name))return{code:'SKILL_MISMATCH',message:'Nhân viên không đáp ứng kỹ năng bắt buộc.'};
  if(!input.registrations.some(r=>r.status==='VALID'&&r.employee_id===employee.id&&r.work_date===need.work_date&&r.shift_id===need.shift_id))return{code:'REGISTRATION_REQUIRED',message:'Nhân viên chưa đăng ký hợp lệ cho ngày và ca này.'};
  const shift=input.shifts.find(s=>s.id===need.shift_id);
  if(!shift?.is_active||(shift.branch_id!=null&&shift.branch_id!==input.period.branch_id))return{code:'INVALID_SHIFT',message:'Ca không hoạt động hoặc ngoài chi nhánh.'};
  const [start,end]=interval(need.work_date,shift);
  const personal=booked.filter(a=>a.employee_id===employee.id);
  const times=personal.map(a=>{const s=input.shifts.find(s=>s.id===a.shift_id);if(!s)throw new ScheduleError(422,'MISSING_SHIFT','Thiếu giờ ca đã phân công.');return interval(a.work_date,s);});
  if(times.some(([s,t])=>start<t&&s<end))return{code:'SHIFT_OVERLAP',message:'Nhân viên bị trùng thời gian với một phân công khác.'};
  if(input.test_rules&&personal.filter(a=>a.work_date===need.work_date).length>=input.test_rules.max_shifts_per_day)return{code:'DAILY_LIMIT_EXCEEDED',message:'Phân công vượt giới hạn ca/ngày đã cấu hình cho thử nghiệm.'};
  if(employee.max_weekly_hours!==null){
    if(!Number.isFinite(Number(employee.max_weekly_hours))||Number(employee.max_weekly_hours)<=0)throw new ScheduleError(422,'INVALID_LIMIT','Giới hạn giờ làm không hợp lệ.');
    const first=Date.parse(`${input.period.work_start_date}T00:00:00+07:00`)/1000;
    for(let week=first;week<end;week+=7*86400){const inside=(s:number,t:number)=>Math.max(0,Math.min(t,week+7*86400)-Math.max(s,week));
      if(times.reduce((sum,[s,t])=>sum+inside(s,t),0)+inside(start,end)>Number(employee.max_weekly_hours)*3600+0.000001)return{code:'WEEKLY_LIMIT_EXCEEDED',message:'Phân công vượt giới hạn giờ làm tuần đã cấu hình.'};
    }
  }
  return null;
}

export function generateSchedule(input: SchedulingInput) {
  const { period, employees, shifts, registrations, requirements, existing } = input;
  if (period.status !== 'CLOSED') throw new ScheduleError(409, 'PERIOD_NOT_CLOSED', 'Đợt đăng ký phải được đóng trước khi xếp lịch.');
  if (input.test_rules && (!Number.isSafeInteger(input.test_rules.max_shifts_per_day) || input.test_rules.max_shifts_per_day < 1)) throw new ScheduleError(422,'INVALID_TEST_RULE','Giới hạn ca thử nghiệm không hợp lệ.');
  if (!requirements.length) throw new ScheduleError(422, 'NO_REQUIREMENTS', 'Chưa khai báo nhu cầu nhân sự.');
  const byShift = new Map(shifts.map(s => [s.id, s]));
  const windowStart = Date.parse(`${period.work_start_date}T00:00:00+07:00`) / 1000;
  const getInterval = (a: { work_date: string; shift_id: string }) => {
    const shift = byShift.get(a.shift_id);
    if (!shift) throw new ScheduleError(422, 'MISSING_SHIFT', 'Không tìm thấy ca làm việc.');
    return interval(a.work_date, shift);
  };
  const weeklySeconds = (a: { work_date: string; shift_id: string }) => {
    const [start, end] = getInterval(a);
    return Math.max(0, Math.min(end, windowStart + 7 * 86400) - Math.max(start, windowStart));
  };
  const assigned: (Assignment & { requirement_id: string; reason: string })[] = [];
  const eligibleEmployees = employees.filter(e => e.status === 'ACTIVE' && e.is_active && e.role === 'NV' && rank[e.skill_level] !== undefined);
  for (const e of eligibleEmployees) if (e.max_weekly_hours !== null && (!Number.isFinite(Number(e.max_weekly_hours)) || Number(e.max_weekly_hours) <= 0)) {
    throw new ScheduleError(422, 'INVALID_LIMIT', 'Giới hạn giờ làm không hợp lệ.');
  }
  const counts = new Map(employees.map(e => [e.id, existing.filter(a => a.employee_id === e.id && weeklySeconds(a) > 0).length]));
  const available = new Set(registrations.filter(r => r.status === 'VALID').map(r => `${r.employee_id}/${r.work_date}/${r.shift_id}`));
  const candidates = (r: Requirement) => eligibleEmployees.filter(e => e.department_id === r.department_id &&
    (!r.required_skill_name || e.skills.includes(r.required_skill_name)) && available.has(`${e.id}/${r.work_date}/${r.shift_id}`));
  const seen = new Set<string>();
  for (const r of requirements) {
    const key = `${r.work_date}/${r.shift_id}/${r.department_id}`;
    if (seen.has(key) || !Number.isSafeInteger(r.required_count) || r.required_count < 0 || r.work_date < period.work_start_date || r.work_date > period.work_end_date || (!byShift.get(r.shift_id)?.is_active || (byShift.get(r.shift_id)?.branch_id != null && byShift.get(r.shift_id)?.branch_id !== period.branch_id))) {
      throw new ScheduleError(422, 'INVALID_REQUIREMENT', 'Nhu cầu nhân sự không hợp lệ.');
    }
    seen.add(key); getInterval(r);
  }
  // Scarce requirements first; stable order prevents database row ordering changing the result.
  // Registrations alone overstate supply when existing bookings or configured
  // hour limits already exclude someone. Count actual initial eligibility.
  const eligibleCounts = new Map(requirements.map(r => [r.id,
    candidates(r).filter(e => !assignmentIssue(input,e,r,existing)).length]));
  const sorted = [...requirements].sort((a, b) =>
    (eligibleCounts.get(a.id)! - a.required_count) - (eligibleCounts.get(b.id)! - b.required_count) ||
    order(a.work_date, b.work_date) || order(a.shift_id, b.shift_id) || order(a.department_id, b.department_id));
  for (const r of sorted) {
    for (let slot = 0; slot < r.required_count; slot++) {
      const eligible = candidates(r).filter(e => !assignmentIssue(input,e,r,[...existing,...assigned])).sort((a, b) => rank[a.skill_level] - rank[b.skill_level] ||
        (counts.get(a.id) || 0) - (counts.get(b.id) || 0) || order(a.id, b.id));
      const e = eligible[0]; if (!e) break;
      assigned.push({ employee_id: e.id, work_date: r.work_date, shift_id: r.shift_id, department_id: r.department_id,
        requirement_id: r.id, reason: `VALID_REGISTRATION;DEPARTMENT_AND_SKILL_MATCH;NO_OVERLAP;WITHIN_WEEKLY_HOURS;LEVEL_PRIORITY=${e.skill_level};PRIOR_SHIFTS=${counts.get(e.id) || 0};STABLE_ID_TIEBREAK` });
      counts.set(e.id, (counts.get(e.id) || 0) + 1);
    }
  }
  assigned.sort((a,b) => order(a.work_date,b.work_date) || order(a.shift_id,b.shift_id) || order(a.employee_id,b.employee_id));
  return buildScheduleResult(input,assigned);
}

export function buildScheduleResult(input:SchedulingInput, assigned:(Assignment & {requirement_id:string;reason:string})[]) {
  const {employees,requirements,existing}=input;
  const start=Date.parse(`${input.period.work_start_date}T00:00:00+07:00`)/1000,end=start+7*86400;
  const eligibleEmployees=employees.filter(e=>e.status==='ACTIVE'&&e.is_active&&e.role==='NV'&&rank[e.skill_level]!==undefined);
  const hours=new Map(employees.map(e=>[e.id,[...existing,...assigned].filter(a=>a.employee_id===e.id).reduce((sum,a)=>{
    const shift=input.shifts.find(s=>s.id===a.shift_id);
    if(!shift)throw new ScheduleError(422,'MISSING_SHIFT','Không tìm thấy ca làm việc.');
    const [s,t]=interval(a.work_date,shift);return sum+Math.max(0,Math.min(t,end)-Math.max(s,start));
  },0)]));
  const coverage = [...requirements].sort((a,b) => order(a.work_date,b.work_date) || order(a.shift_id,b.shift_id) || order(a.department_id,b.department_id)).map(r => {
    const rows = assigned.filter(a => a.requirement_id === r.id);
    const levels = rows.map(a => employees.find(e => e.id === a.employee_id)!.skill_level);
    const threshold = input.new_employee_count_threshold;
    return { ...r, assigned_count: rows.length, missing_count: r.required_count - rows.length,
      warning: threshold !== null && levels.filter(l => l === 'NEW').length >= threshold && !levels.includes('CREW_TRAINING') ? 'MANY_NEW_WITHOUT_CREW_TRAINING' : null };
  });
  return { new_employee_count_threshold: input.new_employee_count_threshold, assignments: assigned, coverage, shortages: coverage.filter(r => r.missing_count > 0),
    required_count: coverage.reduce((n,r) => n + r.required_count,0), assigned_count: assigned.length,
    employee_statistics: [...eligibleEmployees].sort((a,b) => order(a.id,b.id)).map(e => ({ employee_id: e.id,
      shift_count: assigned.filter(a => a.employee_id === e.id).length, total_weekly_hours: (hours.get(e.id) || 0) / 3600 })),
    notes: ['Crew Leader do quản lý thiết lập riêng; không được tính vào nhu cầu nhân viên thường.',
      'Thuật toán tham lam ưu tiên ca ít ứng viên; không bảo đảm tối ưu toàn cục.'] };
}

export function reviewAssignments(input:SchedulingInput, assignments:Assignment[]) {
  const checked:(Assignment & {requirement_id:string;reason:string})[]=[];
  const seen=new Set<string>();
  for(const assignment of assignments){
    const key=`${assignment.employee_id}/${assignment.work_date}/${assignment.shift_id}`;
    if(seen.has(key))throw new ScheduleError(422,'DUPLICATE_ASSIGNMENT','Phân công bị trùng.');seen.add(key);
    const need=input.requirements.find(r=>r.work_date===assignment.work_date&&r.shift_id===assignment.shift_id&&r.department_id===assignment.department_id);
    if(!need||checked.filter(a=>a.requirement_id===need.id).length>=need.required_count)throw new ScheduleError(422,'DEMAND_EXCEEDED','Phân công không có nhu cầu hoặc vượt số người cần.');
    const employee=input.employees.find(e=>e.id===assignment.employee_id);
    if(!employee)throw new ScheduleError(422,'UNKNOWN_EMPLOYEE','Nhân viên không thuộc dữ liệu lịch.');
    const issue=assignmentIssue(input,employee,need,[...input.existing,...checked]);
    if(issue)throw new ScheduleError(422,issue.code,issue.message);
    const check=generateSchedule({...input,employees:[employee],requirements:[{...need,required_count:1}],existing:[...input.existing,...checked]});
    if(check.assigned_count!==1)throw new ScheduleError(422,'ASSIGNMENT_CONSTRAINT_FAILED','Phân công vi phạm đăng ký, bộ phận/kỹ năng, trùng giờ hoặc giới hạn ca/giờ đã cấu hình.');
    checked.push({...assignment,requirement_id:need.id,reason:'MANAGER_CONFIRMED;RULE_ENGINE_VALIDATED'});
  }
  return buildScheduleResult(input,checked);
}
