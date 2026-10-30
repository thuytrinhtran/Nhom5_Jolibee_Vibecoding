import type { SummarySnapshot } from '../repositories/registration-summary.types.js';
import { ScheduleError, type SchedulingInput } from './scheduling.engine.js';
export function schedulingInput(snapshot:SummarySnapshot):SchedulingInput {
  const employees=snapshot.employees.map(employee=>{
    if(typeof employee.is_active!=='boolean'||typeof employee.role!=='string'||!Array.isArray(employee.skills))throw new ScheduleError(422,'INCOMPLETE_EMPLOYEE_DATA','Thiếu dữ liệu tài khoản hoặc kỹ năng để kiểm tra lịch.');
    return {...employee,is_active:employee.is_active,role:employee.role,skills:employee.skills};
  });
  return {period:snapshot.period,employees,shifts:snapshot.shifts,registrations:snapshot.registrations,requirements:snapshot.requirements,
    existing:snapshot.existing,new_employee_count_threshold:snapshot.new_employee_count_threshold,test_rules:snapshot.test_rules};
}
