export interface CalendarPerson { id:string;full_name:string;department_id:string }
export interface CalendarShift { id:string;name:string;start_time:string;end_time:string }
export interface ManagerCalendarData {
  source:'supabase';period:{id:string;branch_id:string;work_start_date:string;work_end_date:string};
  employees:CalendarPerson[];departments:{id:string;name:string}[];shifts:CalendarShift[];
  registrations:{employee_id:string;work_date:string;shift_id:string}[];
  declarations:{employee_id:string;work_date:string;declaration:'SHIFT'|'OFF'|'NOT_SUBMITTED'}[];
  schedules:{id:string;schedule_group_id:string;version:number;status:string;created_at:string;published_at:string|null}[];
  assignments:{id:string;schedule_id:string;employee_id:string;department_id:string;work_date:string;shift_id:string;status:string;assignment_source:string;employee:CalendarPerson|null;shift:CalendarShift|null}[];
}
