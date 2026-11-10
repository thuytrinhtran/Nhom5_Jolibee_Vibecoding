import type { ScheduleCoverage } from '../../types/scheduling';
import type { ScheduleAssignment, ScheduleWorkflowRecord, ScheduleWorkflowService } from './scheduleWorkflow.types';

export type ApprovalReview = Awaited<ReturnType<NonNullable<ScheduleWorkflowService['reviewSchedule']>>>;
export const cellKey = (date: string, shift: string, department: string) => JSON.stringify([date, shift, department]);
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;

/** A read model only. Coverage numbers and warnings always remain backend values. */
export function approvalMatrixView(schedule: ScheduleWorkflowRecord, review: ApprovalReview | null) {
  const active = schedule.shift_assignments.filter(a => a.status !== 'REPLACED');
  const replacedCount = schedule.shift_assignments.length - active.length;
  const coverage = review?.validation.coverage ?? [];
  const days = new Set<string>();
  const {work_start_date:start, work_end_date:end} = schedule.registration_periods;
  if (validDate(start) && validDate(end)) {
    for (let stamp=Date.parse(start+'T00:00:00Z'), last=Date.parse(end+'T00:00:00Z');stamp<=last && days.size<366;stamp+=86400000) days.add(new Date(stamp).toISOString().slice(0,10));
  }
  const shifts = new Map<string,{id:string;name:string;time:string}>();
  const departments = new Map<string,string>();
  for (const [id,name] of Object.entries(review?.labels?.shifts ?? {})) shifts.set(id,{id,name,time:''});
  for (const [id,name] of Object.entries(review?.labels?.departments ?? {})) departments.set(id,name);
  const grouped = new Map<string,ScheduleAssignment[]>(), requirements = new Map<string,ScheduleCoverage[]>();
  const ungrouped:ScheduleAssignment[]=[];
  for (const c of coverage) {
    if(validDate(c.work_date))days.add(c.work_date);
    if(!c.shift_id || !c.department_id || !validDate(c.work_date))continue;
    if(!shifts.has(c.shift_id))shifts.set(c.shift_id,{id:c.shift_id,name:`Ca (${c.shift_id})`,time:''});
    if(!departments.has(c.department_id))departments.set(c.department_id,`Bộ phận (${c.department_id})`);
    const key=cellKey(c.work_date,c.shift_id,c.department_id);
    requirements.set(key,[...(requirements.get(key)??[]),c]);
  }
  for (const a of active) {
    if(validDate(a.work_date))days.add(a.work_date);
    if(!a.shifts.id || !a.department_id || !validDate(a.work_date)){ungrouped.push(a);continue;}
    const previous=shifts.get(a.shifts.id);
    const time=a.shifts.start_time&&a.shifts.end_time?`${a.shifts.start_time.slice(0,5)}–${a.shifts.end_time.slice(0,5)}`:'';
    shifts.set(a.shifts.id,{id:a.shifts.id,name:previous?.name||a.shifts.name||`Ca (${a.shifts.id})`,time:time||previous?.time||''});
    if(!departments.has(a.department_id))departments.set(a.department_id,a.departments.name||`Bộ phận (${a.department_id})`);
    const key=cellKey(a.work_date,a.shifts.id,a.department_id);
    grouped.set(key,[...(grouped.get(key)??[]),a]);
  }
  const rows=[...shifts.values()].sort((a,b)=>a.time.localeCompare(b.time)||a.name.localeCompare(b.name,'vi')).flatMap(shift=>[...departments].map(([departmentId,departmentName])=>({shift,departmentId,departmentName})));
  const cells=rows.flatMap(row=>[...days].sort().map(date=>{
    const key=cellKey(date,row.shift.id,row.departmentId),sources=requirements.get(key)??[],c=sources.length===1?sources[0]:null;
    return {...row,date,key,coverage:c,sources,assignments:grouped.get(key)??[],staffingShortage:!!c&&(c.missing_count>0||c.warnings?.includes('STAFFING_SHORTAGE')===true),experienceShortage:!!c&&((typeof c.missing_experienced_count==='number'&&c.missing_experienced_count>0)||c.warning==='EXPERIENCE_SHORTAGE'||c.warnings?.includes('EXPERIENCE_SHORTAGE')===true)};
  }));
  return {days:[...days].sort(),rows,cells,active,replacedCount,ungrouped};
}
