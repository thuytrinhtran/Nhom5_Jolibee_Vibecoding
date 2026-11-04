import { authorized } from './auth.service';
export interface EmployeeShift {
 assignment_id:string;employee_id:string;schedule_id:string;schedule_group_id:string;period_id:string;version:number;
 work_date:string;shift_id:string;shift_name:string;start_time:string;end_time:string;department_id:string;department_name:string;
 actual_branch_id:string;branch_name:string;assignment_source:string;published_at:string;feedback_deadline_at:string|null;
}
export interface EmployeeWeek {
 employee:{id:string;full_name:string;branch_id:string};week_start:string;week_end:string;timezone:string;
 schedules:{id:string;period_id:string;version:number;published_at:string}[];assignments:EmployeeShift[];
}
export const employeeScheduleService={async week(start:string):Promise<EmployeeWeek>{
 return (await authorized(`?week_start=${encodeURIComponent(start)}`,{},'/employee-schedule')).result;
}};
export function weekMonday(now=new Date()):string{
 const local=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const part=(key:string)=>local.find(p=>p.type===key)!.value;
 const date=new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00Z`);
 date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);return date.toISOString().slice(0,10);
}
export function addDays(day:string,n:number){const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export function employeeDate(day:string){return day.slice(0,10).split('-').reverse().join('/');}
export function employeeDateTime(value:string){return new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));}
export function requestWindowOpen(shift:Pick<EmployeeShift,'feedback_deadline_at'>,now=Date.now()){
 return !!shift.feedback_deadline_at&&Date.parse(shift.feedback_deadline_at)>=now;
}
export function vietnamToday(now=new Date()){
 const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 return ['year','month','day'].map(k=>p.find(v=>v.type===k)!.value).join('-');
}
export function shiftPeriod(time:string,name=''){
 const label=name.toLocaleLowerCase('vi-VN');
 if(label.includes('tối')||label.includes('đêm')||label.includes('night'))return 'evening';
 if(label.includes('chiều')||label.includes('afternoon'))return 'afternoon';
 if(label.includes('sáng')||label.includes('morning'))return 'morning';
 const h=Number(time.slice(0,2));return h<12?'morning':h<18?'afternoon':'evening';
}
