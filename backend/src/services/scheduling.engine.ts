import { SCHEDULING_RULE_VERSION } from './scheduling-contract.js';
export interface Employee {
  id: string; employee_code?: string; department_id: string; skill_level: string; status: string;
  is_active: boolean; role: string; max_weekly_hours: number | null; skills: string[];
}
export interface Shift { id: string; start_time: string; end_time: string; is_active: boolean; branch_id?: string | null }
export interface Registration { employee_id: string; work_date: string; shift_id: string; status: string }
export interface Requirement { id: string; department_id: string; work_date: string; shift_id: string; required_count: number; required_skill_name: string | null }
export interface Assignment { employee_id: string; work_date: string; shift_id: string; department_id: string }
export interface ExplainedAssignment extends Assignment {
  requirement_id:string; reason:string; fixed?:boolean;
  selection_history?:{
    initial:{employee_id:string;reason:string};
    replacements:{iteration:number;from_employee_id:string;to_employee_id:string;from_hours_before:number;to_hours_before:number;shift_hours:number;objective_before:number;objective_after:number}[];
  };
}
export interface SchedulingInput {
  rule_version?:string;
  registration_provenance?:{employee_id:string;batch_id:string|null;submitted_at:string;updated_at:string}[];
  period: { id: string; branch_id: string; work_start_date: string; work_end_date: string; status: string };
  employees: Employee[]; shifts: Shift[]; registrations: Registration[];
  requirements: Requirement[]; existing: Assignment[]; new_employee_count_threshold: number | null;
  holiday_dates?: string[]; // Explicit business calendar only; never infer holidays.
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

const experienced = (e: Employee) => e.skill_level === 'REGULAR' || e.skill_level === 'CREW_TRAINING';
const sameCell = (a: Assignment, r: Requirement) => a.work_date === r.work_date && a.shift_id === r.shift_id && a.department_id === r.department_id;
const assignmentKey = (a: Assignment) => JSON.stringify([a.employee_id,a.work_date,a.shift_id,a.department_id]);
const uniqueAssignments = (rows: Assignment[]) => [...new Map(rows.map(a=>[assignmentKey(a),a])).values()]
  .sort((a,b)=>order(assignmentKey(a),assignmentKey(b)));
// Existing bookings remain blockers, including adjacent dates, but only valid bookings
// in this period and a declared demand cell contribute to coverage. Duplicate rows count once.
export function existingCoverage(input: SchedulingInput) {
  const booked = uniqueAssignments(input.existing);
  return booked.filter(a=>{
    if(a.work_date<input.period.work_start_date||a.work_date>input.period.work_end_date)return false;
    const need=input.requirements.find(r=>sameCell(a,r));
    const employee=input.employees.find(e=>e.id===a.employee_id);
    return !!need && !!employee && !assignmentIssue(input,employee,need,booked.filter(b=>assignmentKey(b)!==assignmentKey(a)));
  });
}

export function generateSchedule(input: SchedulingInput, options:{optimize?:boolean}={}) {
  input={...input,existing:uniqueAssignments(input.existing)};
  const { period, employees, shifts, registrations, requirements, existing } = input;
  if (period.status !== 'CLOSED') throw new ScheduleError(409, 'PERIOD_NOT_CLOSED', 'Đợt đăng ký phải được đóng trước khi xếp lịch.');
  if (input.test_rules && (!Number.isSafeInteger(input.test_rules.max_shifts_per_day) || input.test_rules.max_shifts_per_day < 1)) throw new ScheduleError(422,'INVALID_TEST_RULE','Giới hạn ca thử nghiệm không hợp lệ.');
  if(input.holiday_dates?.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d))throw new ScheduleError(422,'INVALID_HOLIDAY_CALENDAR','Ngày lễ phải là ngày hợp lệ được khai báo rõ ràng.');
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
  const assigned: ExplainedAssignment[] = [];
  const eligibleEmployees = employees.filter(e => e.status === 'ACTIVE' && e.is_active && e.role === 'NV' && rank[e.skill_level] !== undefined);
  for (const e of eligibleEmployees) if (e.max_weekly_hours !== null && (!Number.isFinite(Number(e.max_weekly_hours)) || Number(e.max_weekly_hours) <= 0)) {
    throw new ScheduleError(422, 'INVALID_LIMIT', 'Giới hạn giờ làm không hợp lệ.');
  }
  const counts = new Map(employees.map(e => [e.id, existing.filter(a => a.employee_id === e.id && weeklySeconds(a) > 0).length]));
  const hours = new Map(employees.map(e=>[e.id,existing.filter(a=>a.employee_id===e.id).reduce((n,a)=>n+weeklySeconds(a),0)]));
  const holidayCounts = new Map(employees.map(e=>[e.id,existing.filter(a=>a.employee_id===e.id && a.work_date>=period.work_start_date && a.work_date<=period.work_end_date && input.holiday_dates?.includes(a.work_date)).length]));
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
  const covered=existingCoverage(input);
  const remaining=(r:Requirement)=>Math.max(0,r.required_count-covered.filter(a=>sameCell(a,r)).length);
  // Scarce requirements first; stable order prevents database row ordering changing the result.
  // Registrations alone overstate supply when existing bookings or configured
  // hour limits already exclude someone. Count actual initial eligibility.
  const eligibleCounts = new Map(requirements.map(r => [r.id,
    candidates(r).filter(e => !assignmentIssue(input,e,r,existing)).length]));
  const sorted = [...requirements].sort((a, b) =>
    (eligibleCounts.get(a.id)! - remaining(a)) - (eligibleCounts.get(b.id)! - remaining(b)) ||
    order(a.work_date, b.work_date) || order(a.shift_id, b.shift_id) || order(a.department_id, b.department_id));
  for (const r of sorted) {
    for (let slot = 0; slot < remaining(r); slot++) {
      const experiencedCount=[...covered.filter(a=>sameCell(a,r)),...assigned.filter(a=>sameCell(a,r))]
        .filter(a=>experienced(employees.find(e=>e.id===a.employee_id)!)).length;
      const target=Math.min(2,r.required_count), needsExperience=experiencedCount<target;
      const holiday=input.holiday_dates?.includes(r.work_date)===true;
      const eligible = candidates(r).filter(e => !assignmentIssue(input,e,r,[...existing,...assigned])).sort((a,b)=>
        (needsExperience ? Number(experienced(b))-Number(experienced(a)) : 0) ||
        hours.get(a.id)!-hours.get(b.id)! ||
        (holiday ? holidayCounts.get(a.id)!-holidayCounts.get(b.id)! : 0) ||
        counts.get(a.id)!-counts.get(b.id)! || order(a.employee_code??a.id,b.employee_code??b.id) || order(a.id,b.id));
      const e = eligible[0]; if (!e) break;
      assigned.push({ employee_id:e.id,work_date:r.work_date,shift_id:r.shift_id,department_id:r.department_id,requirement_id:r.id,
        reason:`VALID_REGISTRATION;DEPARTMENT_AND_SKILL_MATCH;NO_OVERLAP;${e.max_weekly_hours===null?'WEEKLY_LIMIT_NOT_CONFIGURED':'WITHIN_WEEKLY_HOURS'};EXPERIENCE_TARGET=${target};EXPERIENCED_BEFORE=${experiencedCount};EXPERIENCE_PRIORITY=${needsExperience};PRIOR_HOURS=${hours.get(e.id)!/3600};HOLIDAY=${holiday};PRIOR_HOLIDAY_SHIFTS=${holidayCounts.get(e.id)};PRIOR_SHIFTS=${counts.get(e.id)};EMPLOYEE_CODE_TIEBREAK=${e.employee_code??e.id}` });
      counts.set(e.id,counts.get(e.id)!+1);
      hours.set(e.id,hours.get(e.id)!+weeklySeconds(assigned[assigned.length-1]));
      if(holiday)holidayCounts.set(e.id,holidayCounts.get(e.id)!+1);
    }
  }
  assigned.sort((a,b) => order(a.work_date,b.work_date) || order(a.shift_id,b.shift_id) || order(a.employee_id,b.employee_id));
  if(options.optimize===false)return buildScheduleResult(input,assigned);
  const optimized=optimizeScheduleAssignments(input,assigned);
  return {...buildScheduleResult(input,optimized.assignments),optimization:optimized.optimization};
}

/** Sum of squared deviations in hours, using the SAME active employee set throughout. */
export function scheduleBalance(input:SchedulingInput, assignments:Assignment[]) {
  const start=Date.parse(`${input.period.work_start_date}T00:00:00+07:00`)/1000;
  const employees=input.employees.filter(e=>e.status==='ACTIVE'&&e.is_active===true&&e.role==='NV'&&rank[e.skill_level]!==undefined)
    .sort((a,b)=>order(a.id,b.id));
  const hours=new Map(employees.map(e=>[e.id,0]));
  for(const a of uniqueAssignments([...input.existing,...assignments])) {
    const shift=input.shifts.find(s=>s.id===a.shift_id);
    if(!shift)throw new ScheduleError(422,'MISSING_SHIFT','Thiếu giờ ca đã phân công.');
    const [s,t]=interval(a.work_date,shift);
    if(hours.has(a.employee_id))hours.set(a.employee_id,hours.get(a.employee_id)!+Math.max(0,Math.min(t,start+7*86400)-Math.max(s,start))/3600);
  }
  const departments=[...new Set(employees.map(e=>e.department_id))].sort().map(department_id=>{
    const ids=employees.filter(e=>e.department_id===department_id).map(e=>e.id);
    const total=ids.reduce((n,id)=>n+hours.get(id)!,0),mean=total/ids.length;
    return {department_id,employee_count:ids.length,total_hours:total,mean_hours:mean,
      squared_deviation:ids.reduce((n,id)=>n+(hours.get(id)!-mean)**2,0)};
  });
  return {hours,departments,objective:departments.reduce((n,d)=>n+d.squared_deviation,0)};
}

/** Best-improvement single replacements; no timer/randomness, no changes to existing work.
 * The caller supplies an already validated generated plan. Strict descent prevents cycles.
 */
export function optimizeScheduleAssignments(input:SchedulingInput, initial:ExplainedAssignment[],maxIterations=200) {
  if(!Number.isSafeInteger(maxIterations)||maxIterations<0||maxIterations>10000)
    throw new ScheduleError(422,'INVALID_SEARCH_LIMIT','Giới hạn vòng tìm kiếm không hợp lệ.');
  input={...input,existing:uniqueAssignments(input.existing)};
  const assignments=structuredClone(initial).sort((a,b)=>order(a.work_date,b.work_date)||order(a.shift_id,b.shift_id)||order(a.department_id,b.department_id)||order(a.employee_id,b.employee_id));
  const employees=new Map(input.employees.map(e=>[e.id,e]));
  const covered=existingCoverage(input);
  const before=scheduleBalance(input,assignments);
  let balance=before,iterations=0,converged=false;
  const epsilon=1e-9;
  const pools=new Map(input.requirements.map(r=>[r.id,input.employees.filter(e=>
    e.status==='ACTIVE'&&e.is_active===true&&e.role==='NV'&&rank[e.skill_level]!==undefined&&e.department_id===r.department_id&&
    (!r.required_skill_name||e.skills.includes(r.required_skill_name))&&input.registrations.some(a=>a.status==='VALID'&&a.employee_id===e.id&&a.work_date===r.work_date&&a.shift_id===r.shift_id))
    .sort((a,b)=>order(a.employee_code??a.id,b.employee_code??b.id)||order(a.id,b.id))]));
  for(const a of assignments)if(!a.fixed&&!a.selection_history)a.selection_history={initial:{employee_id:a.employee_id,reason:a.reason},replacements:[]};
  while(iterations<maxIterations) {
    let best:{index:number;employee:Employee;gain:number;duration:number}|null=null;
    for(let index=0;index<assignments.length;index++) {
      const a=assignments[index];
      if(a.fixed)continue;
      const donor=employees.get(a.employee_id)!;
      const need=input.requirements.find(r=>r.id===a.requirement_id)!;
      const shift=input.shifts.find(s=>s.id===a.shift_id)!;
      const [s,t]=interval(a.work_date,shift),start=Date.parse(`${input.period.work_start_date}T00:00:00+07:00`)/1000;
      const duration=Math.max(0,Math.min(t,start+7*86400)-Math.max(s,start))/3600;
      const others=assignments.filter((_,i)=>i!==index);
      for(const employee of pools.get(need.id)!) {
        if(employee.id===donor.id||Number(experienced(employee))<Number(experienced(donor)))continue;
        // A move stays within the same department, so its total and mean are fixed.
        const gain=2*duration*(balance.hours.get(donor.id)!-balance.hours.get(employee.id)!-duration);
        if(gain<=epsilon||(best&&gain<=best.gain+epsilon))continue;
        if(assignmentIssue(input,employee,need,[...input.existing,...others]))continue;
        // Existing coverage must also remain unchanged, even on malformed old inputs.
        if(covered.some(c=>c.employee_id===employee.id&&sameCell(c,need)))continue;
        best={index,employee,gain,duration};
      }
    }
    if(!best){converged=true;break;}
    const original=assignments[best.index],from=original.employee_id;
    const candidate={...original,employee_id:best.employee.id};
    const proposed=assignments.map((a,i)=>i===best!.index?candidate:a);
    const next=scheduleBalance(input,proposed);
    if(!(next.objective<balance.objective-epsilon))break;
    iterations++;
    const event={iteration:iterations,from_employee_id:from,to_employee_id:best.employee.id,
      from_hours_before:balance.hours.get(from)!,to_hours_before:balance.hours.get(best.employee.id)!,shift_hours:best.duration,
      objective_before:balance.objective,objective_after:next.objective};
    candidate.selection_history={initial:original.selection_history!.initial,replacements:[...original.selection_history!.replacements,event]};
    candidate.reason=`LOCAL_SEARCH_REPLACEMENT;VALID_REGISTRATION;DEPARTMENT_AND_SKILL_MATCH;NO_OVERLAP;${best.employee.max_weekly_hours===null?'WEEKLY_LIMIT_NOT_CONFIGURED':'WITHIN_WEEKLY_HOURS'};COVERAGE_UNCHANGED;EXPERIENCED_COUNT_NOT_DECREASED;FROM_EMPLOYEE=${from};TO_EMPLOYEE=${best.employee.id};FROM_HOURS_BEFORE=${event.from_hours_before};TO_HOURS_BEFORE=${event.to_hours_before};SHIFT_HOURS=${best.duration};OBJECTIVE_BEFORE=${event.objective_before};OBJECTIVE_AFTER=${event.objective_after};ITERATION=${iterations}`;
    assignments[best.index]=candidate;
    balance=next;
  }
  for(const a of assignments)if(!a.fixed&&!a.selection_history!.replacements.length&&!a.reason.startsWith('INITIAL_SELECTION;'))a.reason=`INITIAL_SELECTION;${a.reason}`;
  assignments.sort((a,b)=>order(a.work_date,b.work_date)||order(a.shift_id,b.shift_id)||order(a.employee_id,b.employee_id));
  return {assignments,optimization:{method:'DETERMINISTIC_SINGLE_REPLACEMENT' as const,objective:'WITHIN_DEPARTMENT_SQUARED_HOUR_DEVIATION' as const,
    max_iterations:maxIterations,iterations,converged,limit_reached:iterations===maxIterations,
    before:{objective:before.objective,departments:before.departments},after:{objective:balance.objective,departments:balance.departments}}};
}

export function buildScheduleResult(input:SchedulingInput, assigned:ExplainedAssignment[]) {
  input={...input,existing:uniqueAssignments(input.existing)};
  const {employees,requirements,existing}=input;
  const covered=existingCoverage(input);
  const start=Date.parse(`${input.period.work_start_date}T00:00:00+07:00`)/1000,end=start+7*86400;
  const eligibleEmployees=employees.filter(e=>e.status==='ACTIVE'&&e.is_active&&e.role==='NV'&&rank[e.skill_level]!==undefined);
  const hours=new Map(employees.map(e=>[e.id,[...existing,...assigned].filter(a=>a.employee_id===e.id).reduce((sum,a)=>{
    const shift=input.shifts.find(s=>s.id===a.shift_id);
    if(!shift)throw new ScheduleError(422,'MISSING_SHIFT','Không tìm thấy ca làm việc.');
    const [s,t]=interval(a.work_date,shift);return sum+Math.max(0,Math.min(t,end)-Math.max(s,start));
  },0)]));
  const coverage = [...requirements].sort((a,b) => order(a.work_date,b.work_date) || order(a.shift_id,b.shift_id) || order(a.department_id,b.department_id)).map(r => {
    const newRows = assigned.filter(a => a.requirement_id === r.id);
    const existingRows=covered.filter(a=>sameCell(a,r));
    const rows=uniqueAssignments([...existingRows,...newRows]);
    const levels = rows.map(a => employees.find(e => e.id === a.employee_id)!.skill_level);
    const experiencedTarget=Math.min(2,r.required_count),experiencedCount=levels.filter(l=>l==='REGULAR'||l==='CREW_TRAINING').length;
    const missingExperience=Math.max(0,experiencedTarget-experiencedCount);
    const warnings=[...(rows.length<r.required_count?['STAFFING_SHORTAGE']:[]),...(rows.length>r.required_count?['STAFFING_EXCESS']:[]),...(missingExperience?['EXPERIENCE_SHORTAGE']:[])];
    return {...r,assigned_count:rows.length,new_assigned_count:newRows.length,existing_count:existingRows.length,
      missing_count:Math.max(0,r.required_count-rows.length),excess_count:Math.max(0,rows.length-r.required_count),
      experienced_target:experiencedTarget,experienced_count:experiencedCount,missing_experienced_count:missingExperience,
      composition_status:missingExperience?'SHORTAGE' as const:'PASS' as const,warnings,
      warning:missingExperience?'EXPERIENCE_SHORTAGE':null};
  });
  return { rule_version:SCHEDULING_RULE_VERSION,new_employee_count_threshold: input.new_employee_count_threshold, assignments: assigned, coverage, shortages: coverage.filter(r => r.missing_count > 0),
    existing_count:covered.length,covered_count:coverage.reduce((n,r)=>n+r.assigned_count,0),
    composition_shortages:coverage.filter(r=>r.missing_experienced_count>0),
    required_count: coverage.reduce((n,r) => n + r.required_count,0), assigned_count: assigned.length,
    employee_statistics: [...eligibleEmployees].sort((a,b) => order(a.id,b.id)).map(e => ({ employee_id: e.id,
      shift_count: assigned.filter(a => a.employee_id === e.id).length,
      existing_shift_count:existing.filter(a=>a.employee_id===e.id&&a.work_date>=input.period.work_start_date&&a.work_date<=input.period.work_end_date).length,
      holiday_shift_count:[...existing,...assigned].filter(a=>a.employee_id===e.id&&a.work_date>=input.period.work_start_date&&a.work_date<=input.period.work_end_date&&input.holiday_dates?.includes(a.work_date)).length,
      total_weekly_hours: (hours.get(e.id) || 0) / 3600 })),
    notes: ['assignments/assigned_count chỉ gồm phân công mới; covered_count và coverage gồm cả phân công có sẵn hợp lệ, đã gộp trùng.',
      ...(input.holiday_dates===undefined?['Chưa có lịch ngày lễ được xác nhận; không áp dụng ưu tiên ca lễ.']:[]),
      'Crew Leader do quản lý thiết lập riêng; không được tính vào nhu cầu nhân viên thường.',
      'Thuật toán tham lam ưu tiên ca ít ứng viên; không bảo đảm tối ưu toàn cục.'] };
}

export function reviewAssignments(input:SchedulingInput, assignments:Assignment[]) {
  input={...input,existing:uniqueAssignments(input.existing)};
  // Apply the same input validation even for an empty manual proposal.
  generateSchedule(input,{optimize:false});
  const checked:(Assignment & {requirement_id:string;reason:string})[]=[];
  const seen=new Set<string>();
  for(const assignment of assignments){
    const key=`${assignment.employee_id}/${assignment.work_date}/${assignment.shift_id}`;
    if(seen.has(key))throw new ScheduleError(422,'DUPLICATE_ASSIGNMENT','Phân công bị trùng.');seen.add(key);
    const need=input.requirements.find(r=>r.work_date===assignment.work_date&&r.shift_id===assignment.shift_id&&r.department_id===assignment.department_id);
    if(!need)throw new ScheduleError(422,'DEMAND_EXCEEDED','Phân công không thuộc ô nhu cầu đã khai báo.');
    const employee=input.employees.find(e=>e.id===assignment.employee_id);
    if(!employee)throw new ScheduleError(422,'UNKNOWN_EMPLOYEE','Nhân viên không thuộc dữ liệu lịch.');
    const issue=assignmentIssue(input,employee,need,[...input.existing,...checked]);
    if(issue)throw new ScheduleError(422,issue.code,issue.message);
    checked.push({...assignment,requirement_id:need.id,reason:'MANAGER_CONFIRMED;RULE_ENGINE_VALIDATED'});
  }
  return buildScheduleResult(input,checked);
}
