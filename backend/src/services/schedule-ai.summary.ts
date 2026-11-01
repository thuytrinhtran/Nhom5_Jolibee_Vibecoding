import type { ScheduleValidation } from './schedule-review.service.js';
import type { SummarySnapshot } from '../repositories/registration-summary.types.js';
import { existingCoverage, interval, reviewAssignments, type Assignment } from './scheduling.engine.js';
import { schedulingInput } from './scheduling-input.js';
import { summarizeRegistrations } from './registration-summary.service.js';
import type { AISummary, AIAssignment } from './schedule-ai.types.js';

export function buildAISummary(inspection:{rule_snapshot:SummarySnapshot;assignments:Assignment[];
  validation:Pick<ScheduleValidation,'hard_constraints'|'data_complete'|'coverage_complete'|'issues'|'warnings'>;
  saved?:{schedule:{version:number}};scope?:'preview'}) {
  const {rule_snapshot:data,assignments,validation,saved}=inspection;
  const input=schedulingInput(data),checked=reviewAssignments(input,assignments);
  const coverageAssignments=[...existingCoverage(input),...assignments];
  const codeMap=(ids:string[],prefix:string)=>new Map([...new Set(ids)].sort().map((id,i)=>[id,`${prefix}${String(i+1).padStart(3,'0')}`]));
  const employeeCodes=codeMap(data.employees.map(e=>e.id),'E'),departmentCodes=codeMap([...data.departments.map(d=>d.id),...data.employees.map(e=>e.department_id),...data.requirements.map(r=>r.department_id)],'D');
  const shiftCodes=codeMap(data.shifts.map(s=>s.id),'S'),skillCodes=codeMap(data.employees.flatMap(e=>e.skills??[]).concat(data.requirements.flatMap(r=>r.required_skill_name?[r.required_skill_name]:[])),'K');
  const ownShiftIds=new Set(data.shifts.filter(s=>s.is_active&&(s.branch_id==null||s.branch_id===data.period.branch_id)).map(s=>s.id));
  const coded=(a:Assignment):AIAssignment=>({employee_code:employeeCodes.get(a.employee_id)!,work_date:a.work_date,shift_code:shiftCodes.get(a.shift_id)!,department_code:departmentCodes.get(a.department_id)!});
  const summaryRows=summarizeRegistrations(data).rows;
  const missing=['Chưa có thứ tự ưu tiên nguyện vọng ngoài đăng ký VALID.','Đã ưu tiên tổng giờ thấp hơn sau mục tiêu kinh nghiệm min(2, nhu cầu); chưa có ngưỡng chênh lệch giờ được phê duyệt.'];
  if(data.holiday_dates===undefined)missing.push('Chưa có lịch ngày lễ được xác nhận; chưa áp dụng ưu tiên số ca lễ.');
  if(!validation.data_complete)missing.push('Thiếu nhu cầu hoặc dữ liệu bắt buộc ở một số tổ hợp ngày/ca/bộ phận.');
  const summary:AISummary={contract_version:'tv3-ai.v1',version:saved?.schedule.version??0,...(inspection.scope?{scope:inspection.scope}:{}),dates:{start:data.period.work_start_date,end:data.period.work_end_date},
    rules:{hard_constraints:validation.hard_constraints,data_complete:validation.data_complete,coverage_complete:validation.coverage_complete,codes:[...new Set([...validation.issues,...validation.warnings].map(i=>i.code))],new_employee_count_threshold:data.new_employee_count_threshold,test_rules:data.test_rules??null},
    shifts:data.shifts.filter(s=>ownShiftIds.has(s.id)).map(s=>({code:shiftCodes.get(s.id)!,start:s.start_time,end:s.end_time})),
    coverage:checked.coverage.map(r=>{const row=summaryRows.find(s=>s.work_date===r.work_date&&s.shift_id===r.shift_id&&s.department_id===r.department_id);const levels:Record<string,number>={};
      for(const a of coverageAssignments.filter(a=>a.work_date===r.work_date&&a.shift_id===r.shift_id&&a.department_id===r.department_id)){const e=data.employees.find(e=>e.id===a.employee_id)!;levels[e.skill_level]=(levels[e.skill_level]??0)+1;}
      return {work_date:r.work_date,shift_code:shiftCodes.get(r.shift_id)!,department_code:departmentCodes.get(r.department_id)!,required:r.required_count,assigned:r.assigned_count,registered:row?.registered_count??0,eligible:row?.eligible_count??null,skill_code:r.required_skill_name?skillCodes.get(r.required_skill_name)!:null,levels,experienced_target:r.experienced_target,experienced_count:r.experienced_count,missing_experienced_count:r.missing_experienced_count,warning:r.warning};}),
    employees:checked.employee_statistics.map(stat=>{const e=data.employees.find(e=>e.id===stat.employee_id)!;return {code:employeeCodes.get(e.id)!,department_code:departmentCodes.get(e.department_id)!,level:e.skill_level,skill_codes:(e.skills??[]).map(s=>skillCodes.get(s)!),
      registered:[...new Map(data.registrations.filter(r=>r.employee_id===e.id&&r.status==='VALID'&&r.period_id===data.period.id&&r.work_date>=data.period.work_start_date&&r.work_date<=data.period.work_end_date&&ownShiftIds.has(r.shift_id)).map(r=>[`${r.work_date}/${r.shift_id}`,{work_date:r.work_date,shift_code:shiftCodes.get(r.shift_id)!}])).values()],
      assignments:assignments.filter(a=>a.employee_id===e.id).map(coded),shift_count:stat.shift_count,total_weekly_hours:stat.total_weekly_hours,max_weekly_hours:e.max_weekly_hours};}),missing_criteria:missing};
  // Only summary crosses the provider boundary. UUID/label mappings stay inside the application.
  const aliases=[...employeeCodes].map(([employee_id,code])=>({code,employee_id}));
  const labels=[...data.departments.map(d=>({code:departmentCodes.get(d.id)!,label:d.name})),...data.shifts.map(s=>({code:shiftCodes.get(s.id)!,label:`${s.name} ${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)}`})),...[...skillCodes].map(([label,code])=>({code,label}))];
  return {summary,aliases,labels,input,decode(a:AIAssignment):Assignment|null {
    const lookup=(map:Map<string,string>,code:string)=>[...map].find(([,value])=>value===code)?.[0];
    const employee_id=lookup(employeeCodes,a.employee_code),shift_id=lookup(shiftCodes,a.shift_code),department_id=lookup(departmentCodes,a.department_code);
    if(!employee_id||!shift_id||!department_id)return null;
    // Validate the date with the same interval parser; requirement membership is enforced by reviewAssignments.
    const shift=data.shifts.find(s=>s.id===shift_id)!;interval(a.work_date,shift);
    return {employee_id,shift_id,department_id,work_date:a.work_date};
  }};
}
