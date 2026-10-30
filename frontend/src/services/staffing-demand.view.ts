import type { DemandContext, RegistrationSummaryRow } from '../types/scheduling';
export function demandRowKey(row: {work_date:string;shift_id:string;department_id:string}) { return `${row.work_date}/${row.shift_id}/${row.department_id}`; }
export function demandDays(data: Pick<DemandContext,'period'>) {
  const days:string[]=[];const day=new Date(`${data.period.work_start_date}T00:00:00Z`);
  while(day.toISOString().slice(0,10)<=data.period.work_end_date){days.push(day.toISOString().slice(0,10));day.setUTCDate(day.getUTCDate()+1);}
  return days;
}
export function demandRows(data: Pick<DemandContext,'period'|'branch'|'summary'|'shifts'|'departments'>): RegistrationSummaryRow[] {
  const rows=new Map(data.summary.rows.map(row=>[demandRowKey(row),row]));
  for(const date of demandDays(data))for(const shift of data.shifts.filter(s=>s.is_active))for(const department of data.departments){
    const key=demandRowKey({work_date:date,shift_id:shift.id,department_id:department.id});
    if(!rows.has(key))rows.set(key,{branch_id:data.branch.id,period_id:data.period.id,work_date:date,shift_id:shift.id,shift_name:shift.name,
      start_time:shift.start_time,end_time:shift.end_time,department_id:department.id,department_name:department.name,
      registered_count:0,eligible_count:null,confirmed_eligible_count:0,required_count:null,balance:null,shortage_count:null,surplus_count:null,status:'UNKNOWN',
      required_skill_name:null,exclusions:{},other_department_registered_count:0,warnings:[{code:'MISSING_REQUIREMENT',message:'Chưa khai báo nhu cầu. Không coi nhu cầu trống là 0.'}]});
  }
  return [...rows.values()].sort((a,b)=>demandRowKey(a).localeCompare(demandRowKey(b)));
}
